import { useEffect, useMemo, useState } from 'react'
import {
  buildAttendanceReport,
  buildAttendanceDetailRows,
  checkIn,
  checkOut,
  createManualShiftRegistration,
  createShiftRegistration,
  createWorkShift,
  canManageShiftSetup,
  DEFAULT_WORK_SHIFT_TEMPLATES,
  deleteSchedulePerson,
  ensureCurrentDefaultWorkShifts,
  archiveWorkShift,
  fetchAttendanceRecords,
  fetchEmployees,
  fetchScheduleEntries,
  fetchSchedulePeople,
  fetchShiftRegistrations,
  createAttendanceReadContext,
  fetchWorkShifts,
  findAttendanceRecordForRegistration,
  flushAttendanceOutbox,
  isCheckOutOverdue,
  isOvertimeRegistration,
  permittedBranchIds,
  setScheduleEntry,
  setScheduleRegistration,
  switchActiveBranch,
  withAttendanceReadDeadline,
} from '../lib/attendance'
import { useRef } from 'react'
import { branchName as configuredBranchName, useConfiguredBranches } from '../lib/branches'
import { burstGuard, downloadBlob, shareOrDownloadBlob } from '../lib/browser'
import { calculateStock, ensureOperationDay } from '../lib/store'
import { getFinishedBulkProducts, getSaleProducts } from '../lib/constants'
import {
  findOwnOpenShift,
  markShiftLeftWithoutHandover,
  openShiftAfterLeaderCheckIn,
} from '../lib/shiftAutoOpen'
import { shouldUseLanApi, supabase, uniqueChannelName } from '../lib/supabase'
import { addLocalDateKeyDays, localDateKey, localDateKeyWeekday, VN_UTC_OFFSET } from '../lib/dates'
import { employeePositionLabel, hasSystemWideScope, roleLabel as accessRoleLabel } from '../lib/access'
import { useLang } from '../lib/i18n'
import { createAttendanceAdjustment } from '../lib/attendanceAdjustments'
import { ATTENDANCE_OUTBOX_EVENT, inspectAttendanceOutbox, type AttendanceOutboxOp } from '../lib/attendanceOutbox'
import { AttendanceAdjustmentArchive } from '../components/AttendanceAdjustmentArchive'
import { formatDecimalHoursAsDuration, formatWorkDurationBetween } from '../lib/workDuration'
import type {
  AppUser,
  AttendanceAdjustmentKind,
  AttendanceRecord,
  EmployeeProfile,
  EmploymentType,
  ScheduleEntry,
  SchedulePerson,
  ShiftRegistration,
  WorkShift,
  StockMovement,
} from '../types'
import type { Page } from '../components/AppShell'

type AttendanceTab = 'schedule' | 'board' | 'report' | 'documents'
type AttendanceDataKey = 'shifts' | 'registrations' | 'records' | 'employees' | 'schedulePeople'
const CUSTOM_SHIFT_VALUE = '__custom'
const FALLBACK_SHIFT_PREFIX = 'fallback-shift:'

function attendanceDataNeeds(tab: AttendanceTab, canAdjustSchedule: boolean) {
  const byTab: Record<AttendanceTab, AttendanceDataKey[]> = {
    schedule: ['registrations', 'records'],
    board: [
      'shifts',
      'registrations',
      'schedulePeople',
      ...(canAdjustSchedule ? ['employees' as const] : []),
    ],
    report: ['shifts', 'registrations', 'records', 'employees'],
    documents: [],
  }
  return new Set<AttendanceDataKey>(byTab[tab])
}

export function AttendancePage({ user, movements, onNavigate }: { user: AppUser; movements: StockMovement[]; onNavigate: (page: Page) => void }) {
  const isManager = (user.role === 'manager' || user.role === 'admin') && !user.canRoamBranches
  const canViewAttendanceDocuments = user.role === 'admin' || user.role === 'shift_leader'
  const canAdjustSchedule = canManageShiftSetup(user)
  const [tab, setTab] = useState<AttendanceTab>(isManager ? 'report' : 'schedule')
  const [shifts, setShifts] = useState<WorkShift[]>([])
  const [registrations, setRegistrations] = useState<ShiftRegistration[]>([])
  const [records, setRecords] = useState<AttendanceRecord[]>([])
  const [employees, setEmployees] = useState<EmployeeProfile[]>([])
  const [schedulePeople, setSchedulePeople] = useState<SchedulePerson[]>([])
  const [loading, setLoading] = useState(true)
  // Đã tải xong ít nhất một lần. Sau đó KHÔNG được tháo panel nữa: state của panel
  // giữ ảnh nhân viên vừa chụp, tháo ra là mất ảnh mà không báo gì (BUG-114).
  const [ready, setReady] = useState(false)
  // Lượt tải gần nhất có đọc được lịch + chấm công không. BUG-131 bỏ màn khóa nên
  // màn hình vẫn dùng được khi mạng lỗi, nhưng KHÔNG được khẳng định "chưa đăng ký
  // ca" từ một mảng rỗng chỉ vì request hỏng — đó là câu làm nhân viên hoang mang.
  const [loadFailed, setLoadFailed] = useState(false)
  const [feedback, setFeedback] = useState('')
  const [reportRange, setReportRange] = useState(() => attendanceMonthRange())
  const [boardRange, setBoardRange] = useState(() => {
    const from = canAdjustSchedule ? registrationWeekStartKey() : localDateKey()
    return { from, to: addLocalDateKeyDays(from, 6) }
  })
  const refreshInFlightRef = useRef<Promise<void> | null>(null)
  const refreshQueuedRef = useRef(false)
  const attendanceRefreshContextRef = useRef({ tab, reportRange, boardRange })
  attendanceRefreshContextRef.current = { tab, reportRange, boardRange }

  async function refresh(showLoading = false) {
    if (refreshInFlightRef.current) {
      refreshQueuedRef.current = true
      return refreshInFlightRef.current
    }
    if (showLoading) setLoading(true)
    const run = (async () => {
      try {
        const refreshContext = attendanceRefreshContextRef.current
        const needs = attendanceDataNeeds(refreshContext.tab, canAdjustSchedule)
        const attendanceFilters = isManager && refreshContext.tab === 'report'
          ? refreshContext.reportRange
          : refreshContext.tab === 'schedule'
            ? { userId: user.id }
            : refreshContext.tab === 'board'
              ? refreshContext.boardRange
              : {}
        // Mỗi lệnh đọc phải có hạn chót cứng: một request treo không được phép
        // giữ màn chấm công ở trạng thái quay vòng vĩnh viễn (xem BUG-111).
        const readContext = createAttendanceReadContext()
        const results = await Promise.allSettled([
          needs.has('shifts') ? withAttendanceReadDeadline(() => fetchWorkShifts(user, readContext), 'khung ca') : Promise.resolve(undefined),
          needs.has('registrations') ? withAttendanceReadDeadline(() => fetchShiftRegistrations(user, { ...attendanceFilters, readContext }), 'ca đã đăng ký') : Promise.resolve(undefined),
          needs.has('records') ? withAttendanceReadDeadline(() => fetchAttendanceRecords(user, { ...attendanceFilters, readContext }), 'chấm công') : Promise.resolve(undefined),
          needs.has('employees') ? withAttendanceReadDeadline(() => fetchEmployees(user, { readContext }), 'nhân sự') : Promise.resolve(undefined),
          needs.has('schedulePeople') ? withAttendanceReadDeadline(() => fetchSchedulePeople(user, readContext), 'danh sách lịch') : Promise.resolve(undefined),
        ])
        const [nextShifts, nextRegistrations, nextRecords, nextEmployees, nextSchedulePeople] = results
        if (nextShifts.status === 'fulfilled' && nextShifts.value) setShifts(nextShifts.value)
        if (nextRegistrations.status === 'fulfilled' && nextRegistrations.value) setRegistrations(nextRegistrations.value)
        if (needs.has('records') && nextRecords.status === 'fulfilled' && nextRecords.value) {
          setRecords(nextRecords.value)
        }
        if (nextEmployees.status === 'fulfilled' && nextEmployees.value) setEmployees(nextEmployees.value)
        if (nextSchedulePeople.status === 'fulfilled' && nextSchedulePeople.value) setSchedulePeople(nextSchedulePeople.value)
        const failed = results.find((result) => result.status === 'rejected') as PromiseRejectedResult | undefined
        setLoadFailed(Boolean(failed))
        if (failed) throw failed.reason
      } catch (error) {
        setLoadFailed(true)
        setFeedback(error instanceof Error ? error.message : 'Không thể tải dữ liệu chấm công.')
      } finally {
        if (showLoading) setLoading(false)
        setReady(true)
      }
    })()
    refreshInFlightRef.current = run
    try {
      await run
    } finally {
      refreshInFlightRef.current = null
      if (refreshQueuedRef.current) {
        refreshQueuedRef.current = false
        void refresh(false)
      }
    }
  }

  useEffect(() => { void refresh(true) }, [user.id, user.branchId])

  useEffect(() => {
    if (loading) return
    void refresh(false)
  }, [tab, reportRange.from, reportRange.to, boardRange.from, boardRange.to])

  useEffect(() => {
    const reload = () => void refresh(false)
    const reloadSoon = burstGuard(reload, 400)
    const reloadWhenVisible = () => {
      if (document.visibilityState === 'visible') reload()
    }
    // Supabase realtime là đường chính; polling chỉ là lưới an toàn khi socket bị
    // rớt. LAN không có realtime nên giữ nhịp cũ 15 giây.
    const timer = window.setInterval(reload, shouldUseLanApi(user) ? 15000 : 60000)
    window.addEventListener('gustino-attendance-updated', reload)
    window.addEventListener('focus', reload)
    document.addEventListener('visibilitychange', reloadWhenVisible)
    const client = shouldUseLanApi(user) ? null : supabase
    if (!client) {
      return () => {
        reloadSoon.cancel()
        window.clearInterval(timer)
        window.removeEventListener('gustino-attendance-updated', reload)
        window.removeEventListener('focus', reload)
        document.removeEventListener('visibilitychange', reloadWhenVisible)
      }
    }
    let channel = client.channel(uniqueChannelName(`attendance-live:${user.id}`))
    const personalScope = tab === 'schedule' && !isManager
    if (tab === 'board') {
      // Bảng lịch chỉ dùng registration; không nghe bảng bản ghi chấm công rồi tải
      // lại dữ liệu không dùng mỗi khi bất kỳ nhân viên nào chấm công.
      for (const branchId of permittedBranchIds(user)) {
        channel = channel.on('postgres_changes', {
          event: '*', schema: 'public', table: 'shift_registrations', filter: `branch_id=eq.${branchId}`,
        }, reloadSoon)
      }
    } else if (personalScope) {
      channel = channel
        .on('postgres_changes', { event: '*', schema: 'public', table: 'shift_registrations', filter: `user_id=eq.${user.id}` }, reloadSoon)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'attendance_records', filter: `user_id=eq.${user.id}` }, reloadSoon)
    } else if (tab === 'report') {
      // Ca trưởng/quản lý chỉ nghe các chi nhánh họ được phép xem. Một sự kiện ở
      // chi nhánh khác không còn làm mọi máy tải lại toàn bộ bảng chấm công.
      for (const branchId of permittedBranchIds(user)) {
        channel = channel
          .on('postgres_changes', { event: '*', schema: 'public', table: 'shift_registrations', filter: `branch_id=eq.${branchId}` }, reloadSoon)
          .on('postgres_changes', { event: '*', schema: 'public', table: 'attendance_records', filter: `branch_id=eq.${branchId}` }, reloadSoon)
      }
    }
    const subscribedChannel = channel.subscribe()
    return () => {
      reloadSoon.cancel()
      window.clearInterval(timer)
      window.removeEventListener('gustino-attendance-updated', reload)
      window.removeEventListener('focus', reload)
      document.removeEventListener('visibilitychange', reloadWhenVisible)
      void client.removeChannel(subscribedChannel)
    }
  }, [user.id, user.branchId, user.role, (user.branchIds || []).join(','), tab, isManager])

  const tabs: Array<{ id: AttendanceTab; label: string; show: boolean }> = [
    { id: 'schedule', label: 'Hôm nay', show: !isManager },
    // Tab bảng lịch phải hiện CẢ cho manager/admin: SharedScheduleBoard là nơi duy nhất
    // lập/sửa lịch tuần (heading manager cũng hứa "Lập lịch theo tuần").
    { id: 'board', label: canAdjustSchedule ? 'Bảng lịch' : 'Đăng ký tuần', show: true },
    { id: 'documents', label: 'Chứng từ', show: canViewAttendanceDocuments },
    { id: 'report', label: 'Bảng công', show: isManager || user.role === 'manager' },
  ]

  const changeTab = (nextTab: AttendanceTab) => {
    setTab(nextTab)
  }

  return (
    <div className="page attendance-page">
      <div className="function-navigation">
        <button className="function-back-button" onClick={() => onNavigate('launcher')}>
          <span>←</span> Trở lại
        </button>
      </div>
      <div className="page-heading attendance-heading">
        <div>
          <span className="eyebrow dark">QUY TRÌNH CA LÀM</span>
          <h1>{canAdjustSchedule ? 'Lập lịch, kiểm tra công, xuất bảng công' : 'Đăng ký lịch, check-in, check-out'}</h1>
          <p>{canAdjustSchedule
            ? '1) Lập lịch theo tuần. 2) Theo dõi check-in/out. 3) Xuất bảng công khi cần.'
            : '1) Đăng ký ca trong tuần. 2) Đến ca chụp selfie check-in. 3) Kết thúc ca check-out để tự tính công.'}</p>
        </div>
        <div className="attendance-heading-status">
          <span className="attendance-sync-status" title={supabase ? 'Thay đổi được nhận trực tiếp từ máy chủ' : 'Dữ liệu được kiểm tra lại mỗi 15 giây'}>
            <i aria-hidden="true" />
            {supabase ? 'Đồng bộ realtime' : 'Tự đồng bộ 15 giây'}
          </span>
          <span className="attendance-role">{roleLabel(user.role)}</span>
          {/* Khi một lệnh đọc hết hạn (BUG-111), người dùng phải có đường tải lại
              ngay tại chỗ thay vì phải thoát ra vào lại app. */}
          <button type="button" className="attendance-reload-button" disabled={loading} onClick={() => void refresh(true)}>
            {loading ? 'Đang tải…' : '↻ Tải lại'}
          </button>
        </div>
      </div>

      {feedback && <div className="feedback-bar">{feedback}<button onClick={() => setFeedback('')}>×</button></div>}

      <div className="attendance-tabs">
        {tabs.filter((item) => item.show).map((item) => (
          <button key={item.id} className={tab === item.id ? 'active' : ''} disabled={loading} onClick={() => changeTab(item.id)}>{item.label}</button>
        ))}
      </div>

      {/* Khung chờ CHỈ cho lần tải đầu. Những lần tải lại sau vẫn giữ nguyên panel,
          nếu không thì ảnh nhân viên vừa chụp bị xoá âm thầm (BUG-114). */}
      {loading && !ready && (
        <section className="section-card attendance-loading" aria-busy="true" aria-live="polite">
          <div className="attendance-loading-skeleton" aria-hidden="true"><i /><i /><i /></div>
          <strong>Đang đồng bộ dữ liệu cần thiết</strong>
          <small>Chỉ tải nội dung của mục đang mở.</small>
        </section>
      )}
      {ready && tab === 'schedule' && (
        <SchedulePanel
          user={user}
          registrations={registrations}
          records={records}
          loadFailed={loadFailed}
          movements={movements}
          onChanged={refresh}
          onFeedback={setFeedback}
          onOpenRegistration={() => setTab('board')}
          onNavigate={onNavigate}
        />
      )}
      {ready && tab === 'board' && (
        <SharedScheduleBoard
          user={user}
          shifts={shifts}
          registrations={registrations}
          people={schedulePeople}
          employees={employees}
          range={boardRange}
          onRangeChange={setBoardRange}
          onChanged={refresh}
          onFeedback={setFeedback}
        />
      )}
      {ready && tab === 'report' && isManager && (
        <AttendanceReportPanel
          user={user}
          shifts={shifts}
          registrations={registrations}
          records={records}
          employees={employees}
          from={reportRange.from}
          to={reportRange.to}
          onRangeChange={setReportRange}
        />
      )}
      {ready && tab === 'documents' && canViewAttendanceDocuments && (
        <AttendanceAdjustmentArchive user={user} />
      )}
    </div>
  )
}

function mergeAttendanceRecords(
  records: AttendanceRecord[],
  optimisticRecords: Record<string, AttendanceRecord>,
) {
  const byId = new Map(records.map((record) => [record.id, record]))
  Object.values(optimisticRecords).forEach((record) => {
    const serverRecord = byId.get(record.id)
    if (!serverRecord || record.checkOutTime || !serverRecord.checkOutTime) byId.set(record.id, record)
  })
  return Array.from(byId.values())
}

function attendanceTimestampMatches(left?: string, right?: string) {
  if (!left || !right) return !left && !right
  if (left === right) return true
  const leftTime = Date.parse(left)
  const rightTime = Date.parse(right)
  return Number.isFinite(leftTime) && Number.isFinite(rightTime) && leftTime === rightTime
}

function SchedulePanel({
  user, registrations, records, loadFailed, movements, onChanged, onFeedback, onOpenRegistration, onNavigate,
}: {
  user: AppUser
  registrations: ShiftRegistration[]
  records: AttendanceRecord[]
  loadFailed: boolean
  movements: StockMovement[]
  onChanged: () => Promise<void>
  onFeedback: (message: string) => void
  onOpenRegistration: () => void
  onNavigate: (page: Page) => void
}) {
  const [selfies, setSelfies] = useState<Record<string, File | undefined>>({})
  const [selfieLocalPreviews, setSelfieLocalPreviews] = useState<Record<string, string>>({})
  const [selfiePreviews, setSelfiePreviews] = useState<Record<string, string>>({})
  const [optimisticRecords, setOptimisticRecords] = useState<Record<string, AttendanceRecord>>({})
  const [pendingCheckOut, setPendingCheckOut] = useState<{ registrationId: string; sequence: number } | null>(null)
  // Cảnh báo khi bấm check-in ca khác trong lúc còn một ca chưa check-out: đây là
  // đường sinh ra bản ghi treo rồi "sáng hôm sau bị đòi check-out lại" (BUG-113).
  const [pendingDoubleCheckIn, setPendingDoubleCheckIn] = useState<{
    registrationId: string
    openLabel: string
    autoClosing: boolean
  } | null>(null)
  const [busyId, setBusyId] = useState('')
  const [busyPhase, setBusyPhase] = useState<'locating' | 'saving' | ''>('')
  /** Lượt chấm công đã chụp đủ bằng chứng nhưng máy chủ CHƯA xác nhận (BUG-118). */
  const [outboxOps, setOutboxOps] = useState<AttendanceOutboxOp[]>([])
  // BUG-131 (quyết định chủ quán 04/08): outbox chỉ còn là hàng chờ gửi-lại-nền
  // cho các lượt CŨ từng lưu trên máy — tuyệt đối không tham gia/chặn đường
  // Check-in trực tiếp. Chống trùng phiên do DB đảm nhiệm (unique một-phiên-mở).
  const [now, setNow] = useState(() => new Date())
  const ownRegistrations = registrations.filter((item) => item.userId === user.id && item.status !== 'rejected')
  const effectiveRecords = useMemo(
    () => mergeAttendanceRecords(records, optimisticRecords),
    [records, optimisticRecords],
  )
  const today = localDateKey(now)
  const hasTodayRegistration = ownRegistrations.some((item) => item.workDate === today)
  const hasOwnOpenRecord = effectiveRecords.some((item) => item.userId === user.id && !item.checkOutTime)

  // Optimistic chỉ che khoảng trống cho tới khi server xác nhận. Dọn ngay khi
  // bản authoritative đã hội tụ để sửa/xóa realtime sau đó không bị state cũ
  // trong tab ghi đè mãi tới lúc remount.
  useEffect(() => {
    setOptimisticRecords((current) => {
      let changed = false
      const next = { ...current }
      for (const [id, optimistic] of Object.entries(current)) {
        const server = records.find((item) => item.id === id)
        if (!server) continue
        if (attendanceTimestampMatches(server.checkInTime, optimistic.checkInTime)
          && attendanceTimestampMatches(server.checkOutTime, optimistic.checkOutTime)) {
          delete next[id]
          changed = true
        }
      }
      return changed ? next : current
    })
  }, [records])

  useEffect(() => {
    const updateClock = () => setNow(new Date())
    const timer = window.setInterval(updateClock, 15000)
    window.addEventListener('focus', updateClock)
    document.addEventListener('visibilitychange', updateClock)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('focus', updateClock)
      document.removeEventListener('visibilitychange', updateClock)
    }
  }, [])

  useEffect(() => {
    let active = true
    const reloadOutbox = () => {
      void inspectAttendanceOutbox(user.id)
        .then((snapshot) => {
          if (!active) return
          setOutboxOps(snapshot.ops)
        })
        .catch(() => undefined)
    }
    reloadOutbox()
    window.addEventListener(ATTENDANCE_OUTBOX_EVENT, reloadOutbox)
    window.addEventListener('focus', reloadOutbox)
    window.addEventListener('storage', reloadOutbox)
    return () => {
      active = false
      window.removeEventListener(ATTENDANCE_OUTBOX_EVENT, reloadOutbox)
      window.removeEventListener('focus', reloadOutbox)
      window.removeEventListener('storage', reloadOutbox)
    }
  }, [user.id])

  // Ảnh xem trước cục bộ để PG kiểm tra trước khi check-in (cho phép chụp lại)
  function pickSelfie(registration: ShiftRegistration, file?: File) {
    setSelfies((current) => ({ ...current, [registration.id]: file }))
    setSelfieLocalPreviews((current) => {
      const previous = current[registration.id]
      if (previous) URL.revokeObjectURL(previous)
      const next = { ...current }
      if (file) next[registration.id] = URL.createObjectURL(file)
      else delete next[registration.id]
      return next
    })
  }

  /**
   * BẤT KỲ phiên chấm công nào của mình còn đang mở (đã check-in, chưa check-out)
   * — kể cả ca treo của NGÀY TRƯỚC. DB có ràng buộc một-phiên-mở
   * (attendance_records_one_open_per_user) nên check-in mới chắc chắn bị từ chối;
   * guard này để báo sớm và chỉ đúng chỗ cần xử lý thay vì đợi lỗi máy chủ.
   */
  function findOpenShift(registration: ShiftRegistration) {
    const openRecord = effectiveRecords.find((item) =>
      item.userId === user.id && !item.checkOutTime && item.shiftRegistrationId !== registration.id,
    )
    if (!openRecord) return undefined
    const owner = ownRegistrations.find((item) => item.id === openRecord.shiftRegistrationId)
    return { registration: owner, record: openRecord }
  }

  async function handleCheckIn(registration: ShiftRegistration) {
    onFeedback('')
    // Check-in khi còn một phiên chưa đóng là cách bản ghi cũ bị bỏ quên: người
    // dùng tưởng đã check-out xong, hôm sau ca cũ vẫn đòi check-out. DB đã chặn
    // cứng (một-phiên-mở); ở đây KHÔNG còn đường "vẫn check-in" — phải đóng ca cũ.
    const openShift = findOpenShift(registration)
    if (openShift) {
      const label = openShift.registration
        ? `${formatDate(openShift.registration.workDate)} ${openShift.registration.startTime}–${openShift.registration.endTime}`
        : `check-in lúc ${formatTime(openShift.record.checkInTime)}`
      const autoClosing = Boolean(openShift.registration && openShift.registration.workDate < today)
      setPendingDoubleCheckIn({ registrationId: registration.id, openLabel: label, autoClosing })
      onFeedback(autoClosing
        ? `Ca ${label} thuộc ngày trước đang được hệ thống tự đóng. Vui lòng tải lại sau ít phút; Admin sẽ thấy lỗi để rà soát.`
        : `Bạn còn ca ${label} trong ngày chưa check-out. Hãy hoàn tất check-out ca đang làm rồi mới check-in ca mới.`)
      return
    }
    // BUG-131 (chốt cuối theo chủ quán): outbox/bộ nhớ tạm là best-effort — KHÔNG
    // được chặn Check-in vì bất kỳ trạng thái nào của nó. Chống trùng phiên do DB
    // đảm nhiệm (unique attendance_records_one_open_per_user + dedupe read-back).
    const selfie = selfies[registration.id]
    if (!selfie) {
      onFeedback('Chưa có ảnh nên chưa check-in được. Hãy bấm "Chụp ảnh check-in" trước, rồi bấm Check-in lại.')
      return
    }
    setPendingDoubleCheckIn(null)
    setBusyId(registration.id)
    setBusyPhase('locating')
    try {
      let activeUser = user
      if (user.canRoamBranches && registration.branchId && registration.branchId !== user.branchId) {
        const switchedBranch = await switchActiveBranch(user, registration.branchId)
        activeUser = { ...user, branchId: switchedBranch }
      }
      const record = await checkIn(
        activeUser,
        registration,
        selfie,
        setBusyPhase,
      )
      if (record.selfiePreviewUrl) {
        setSelfiePreviews((current) => ({ ...current, [registration.id]: record.selfiePreviewUrl! }))
      }
      setOptimisticRecords((current) => ({ ...current, [record.id]: record }))
      pickSelfie(registration, undefined)
      let autoShiftMessage = ''
      if (user.role === 'shift_leader') {
        try {
          autoShiftMessage = await openShiftAfterLeaderCheckIn(user, registration)
        } catch (error) {
          // Check-in đã lưu rồi nên không thể check-in lại để thử mở ca lần nữa.
          // Chỉ đường sang màn Bàn giao, ở đó có nút "Nhận ca ngay" để tự khắc phục.
          autoShiftMessage = ` Check-in đã lưu, nhưng ca vận hành chưa tự mở: ${error instanceof Error ? error.message : 'lỗi kết nối.'} Hãy vào mục Bàn giao và bấm "Nhận ca ngay".`
        }
      }
      void onChanged().catch(() => undefined)
      onFeedback(`Check-in thành công.${autoShiftMessage || ' Chúc bạn một ca làm việc tốt!'}`)
    } catch (error) {
      onFeedback(error instanceof Error ? error.message : 'Không thể check-in. Hãy thử lại.')
      void onChanged().catch(() => undefined)
    } finally {
      setBusyId('')
      setBusyPhase('')
    }
  }

  async function handleCheckOut(
    record: AttendanceRecord,
    registration: ShiftRegistration,
    options: { force?: boolean } = {},
  ) {
    // Xoá thông báo cũ NGAY khi bắt đầu: dòng "Check-in thành công" từ đầu ca còn
    // nằm trên màn hình khiến nhân viên tưởng vừa check-out xong (BUG-114).
    onFeedback('')
    const selfie = selfies[registration.id]
    if (!selfie) {
      onFeedback('Chưa có ảnh bàn giao nên chưa check-out được. Hãy bấm "Chụp ảnh check-out" trước, rồi bấm Check-out lại.')
      return
    }
    // Chặn MỀM: check-out là việc cá nhân, chốt ca là việc vận hành có kiểm đếm
    // tồn thật. Không bao giờ để check-out tự ghi số tồn. Chỉ nhắc ca trưởng
    // sang Bàn giao trước; vẫn có lối vượt cho sự cố thật (ốm, hết pin, mất máy).
    if (user.role === 'shift_leader' && !options.force) {
      const openShift = await findOwnOpenShift(user).catch(() => undefined)
      if (openShift) {
        setPendingCheckOut({ registrationId: registration.id, sequence: openShift.sequence })
        onFeedback(`Bạn còn Ca ${openShift.sequence} chưa bàn giao. Hãy chốt ca ở mục Bàn giao trước khi check-out.`)
        return
      }
    }
    setPendingCheckOut(null)
    setBusyId(record.id)
    setBusyPhase('locating')
    try {
      const saved = await checkOut(
        user,
        record,
        registration,
        selfie,
        setBusyPhase,
      )
      setOptimisticRecords((current) => ({ ...current, [saved.id]: saved }))
      pickSelfie(registration, undefined)
      // Vượt chặn: ghi dấu lên chính phiên ca để quản lý thấy trong báo cáo rằng
      // ca này kết thúc mà chưa kiểm đếm. KHÔNG tự chốt ca, KHÔNG tự ghi tồn.
      let overrideNote = ''
      if (options.force) {
        const marked = await markShiftLeftWithoutHandover(user).catch(() => false)
        overrideNote = marked
          ? ' Ca vận hành vẫn đang mở và đã được đánh dấu "chưa kiểm đếm" để quản lý rà soát.'
          : ' Lưu ý: ca vận hành vẫn đang mở và chưa được bàn giao.'
      }
      void onChanged().catch(() => undefined)
      onFeedback(`Check-out thành công. Ảnh, GPS và địa chỉ bàn giao đã được lưu.${overrideNote}`)
    } catch (error) {
      onFeedback(error instanceof Error ? error.message : 'Không thể check-out. Hãy thử lại.')
      void onChanged().catch(() => undefined)
    } finally {
      setBusyId('')
      setBusyPhase('')
    }
  }

  // Phân loại: ca cần chấm (chưa hoàn tất) lên đầu, ca đã chấm xong tách riêng
  const decorated = ownRegistrations.map((registration) => {
    const record = findAttendanceRecordForRegistration(effectiveRecords, registration)
    const checkInWindow = getCheckInWindow(registration)
    const pendingOp = outboxOps.find((item) => item.registrationId === registration.id)
    const blockedByOpenSession = !record && hasOwnOpenRecord
    const canCheckIn = registration.workDate === today
      && !record
      && !hasOwnOpenRecord
    const isCheckedOut = Boolean(record?.checkOutTime)
    const isOpenRecord = Boolean(record && !record.checkOutTime)
    // Quá hạn thì KHÔNG cho check-out bằng giờ bấm nút nữa: giờ đó sai sự thật và
    // đi thẳng vào bảng công (đã có ca 24h/96h/238h trên dữ liệu thật — BUG-113).
    const isOverdueCheckOut = isOpenRecord && isCheckOutOverdue(registration, now)
    const canCheckOut = isOpenRecord && !isOverdueCheckOut && pendingOp?.kind !== 'check-out'
    const checkOutTooEarly = false
    return {
      registration,
      record,
      checkInWindow,
      canCheckIn,
      canCheckOut,
      isCheckedOut,
      isOverdueCheckOut,
      checkOutTooEarly,
      blockedByOpenSession,
      pendingOp,
    }
  })
  function sortKey(d: typeof decorated[number]) {
    if (d.canCheckIn || d.canCheckOut) return 0 // thao tác được ngay → lên đầu
    if (!d.record && d.registration.workDate >= today) return 1 // sắp tới
    if (d.record && !d.record.checkOutTime) return 2 // đang làm, chưa tới giờ ra
    return 3
  }
  const missed = decorated.filter((d) => !d.record && d.registration.workDate < today)
    .sort((a, b) => b.registration.workDate.localeCompare(a.registration.workDate))
  const overdue = decorated.filter((d) => d.isOverdueCheckOut)
    .sort((a, b) => b.registration.workDate.localeCompare(a.registration.workDate))
  const pending = decorated.filter((d) =>
    !d.isCheckedOut
    && !d.isOverdueCheckOut
    && !(d.registration.workDate < today && !d.record)
    && (d.registration.workDate === today || Boolean(d.record && !d.record.checkOutTime)),
  )
    .sort((a, b) => sortKey(a) - sortKey(b) || a.registration.workDate.localeCompare(b.registration.workDate))
  const completed = decorated.filter((d) => d.isCheckedOut)
    .sort((a, b) => b.registration.workDate.localeCompare(a.registration.workDate))

  function renderCard(d: typeof decorated[number], readOnly: boolean) {
    const { registration, record, checkInWindow, canCheckIn, canCheckOut, checkOutTooEarly } = d
    const isOvertime = isOvertimeRegistration(registration)
    const localPreview = selfieLocalPreviews[registration.id]
    const pendingOp = d.pendingOp
    return (
      <article className={`shift-card ${registration.status}${d.isCheckedOut ? ' done' : ''}${isOvertime ? ' overtime' : ''}`} key={registration.id}>
        <div className="shift-date">
          <strong>{new Date(`${registration.workDate}T00:00:00`).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' })}</strong>
          <small>{new Date(`${registration.workDate}T00:00:00`).toLocaleDateString('vi-VN', { weekday: 'short' })}</small>
        </div>
        <div className="shift-main">
          <span className={`attendance-status ${d.isCheckedOut ? 'done' : registration.status}`}>
            {d.isCheckedOut ? (isOvertime ? 'Đã chấm tăng ca' : 'Đã chấm xong') : `${isOvertime ? 'Tăng ca · ' : ''}${statusLabel(registration.status)}`}
          </span>
          <h3>{registration.startTime} – {registration.endTime}</h3>
          <p>{branchName(registration.branchId)}{registration.note ? ` · ${registration.note}` : ''}</p>
          {pendingOp && (
            <p className="attendance-outbox-note">
              {pendingOp.deliveryState === 'needs-review'
                ? `⚠️ Lượt ${pendingOp.kind === 'check-in' ? 'check-in' : 'check-out'} lúc ${formatTime(pendingOp.capturedAt)} không tự gửi lại: ${pendingOp.deliveryNote || 'cần quản lý rà soát.'}`
                : pendingOp.durability === 'memory'
                  ? `⏳ Lượt ${pendingOp.kind === 'check-in' ? 'check-in' : 'check-out'} lúc ${formatTime(pendingOp.capturedAt)} chỉ đang GIỮ TẠM trong tab này. Giữ app mở và gửi lại ngay khi có mạng.`
                  : `⏳ Lượt ${pendingOp.kind === 'check-in' ? 'check-in' : 'check-out'} lúc ${formatTime(pendingOp.capturedAt)} đã lưu bền trên máy, đang chờ máy chủ xác nhận (giữ nguyên giờ chấm gốc).`}
            </p>
          )}
          {d.blockedByOpenSession && (
            <p className="attendance-outbox-note">Bạn còn một ca chưa check-out. Hãy đóng ca đang mở trước khi check-in ca mới.</p>
          )}
          {record && <div className="attendance-times">
            <span>Vào: <strong>{formatTime(record.checkInTime)}</strong></span>
            <span>Ra: <strong>{record.checkOutTime ? formatTime(record.checkOutTime) : 'Chưa check-out'}</strong></span>
            {isOvertime && record.checkOutTime && <span>Giờ tăng ca: <strong>{formatWorkDurationBetween(record.checkInTime, record.checkOutTime)}</strong></span>}
            {record.checkInAddress && <span className="attendance-location">Vị trí: <strong>{record.checkInAddress}</strong></span>}
            {record.checkOutAddress && <span className="attendance-location">Vị trí ra: <strong>{record.checkOutAddress}</strong></span>}
          </div>}
          {record && selfiePreviews[registration.id] && (
            <figure className="attendance-selfie-preview">
              <img src={selfiePreviews[registration.id]} alt="Ảnh chấm công đã đóng dấu" />
              <figcaption>Ảnh chấm công vừa lưu</figcaption>
            </figure>
          )}
          {localPreview && (
            <figure className="attendance-selfie-preview">
              <img src={localPreview} alt="Ảnh chuẩn bị chấm công" />
              <figcaption>Ảnh sắp chấm · chụp lại nếu bị rung/mờ</figcaption>
            </figure>
          )}
        </div>
        {!readOnly && (
          <div className="shift-actions">
            {canCheckIn && <>
              <label className="selfie-button">
                <input
                  type="file"
                  accept="image/*"
                  capture="user"
                  onChange={(event) => pickSelfie(registration, event.target.files?.[0])}
                />
                {selfies[registration.id] ? '🔄 Chụp lại bằng camera máy' : '📷 Camera máy'}
              </label>
              <button className="primary-button" disabled={busyId === registration.id} onClick={() => handleCheckIn(registration)}>
                {busyId === registration.id ? busyLabel(busyPhase) : 'Check-in'}
              </button>
              {pendingDoubleCheckIn?.registrationId === registration.id && (
                <div className="checkout-handover-guard">
                  <p>{pendingDoubleCheckIn.autoClosing
                    ? `Ca ${pendingDoubleCheckIn.openLabel} thuộc ngày trước đang chờ hệ thống tự đóng. Bạn không cần khai thêm giờ; Admin sẽ nhận lỗi để chỉnh nếu cần.`
                    : `Ca ${pendingDoubleCheckIn.openLabel} của bạn trong ngày chưa check-out. Hệ thống chỉ cho phép một phiên làm việc đang mở.`}</p>
                  <button className="primary-button" onClick={() => {
                    if (pendingDoubleCheckIn.autoClosing) void onChanged()
                    setPendingDoubleCheckIn(null)
                  }}>{pendingDoubleCheckIn.autoClosing ? 'Tải lại trạng thái' : 'Về ca chưa check-out'}</button>
                </div>
              )}
              {busyId === registration.id && <small className="attendance-busy-hint">Đang xử lý, vui lòng giữ máy vài giây…</small>}
            </>}
            {canCheckOut && <>
              <label className="selfie-button checkout-selfie-button">
                <input
                  type="file"
                  accept="image/*"
                  capture="user"
                  onChange={(event) => pickSelfie(registration, event.target.files?.[0])}
                />
                {selfies[registration.id] ? 'Chụp lại bằng camera máy' : 'Camera máy check-out'}
              </label>
              {/* KHÔNG tắt nút theo ảnh: nút tắt bấm vào không phản hồi gì, nhân viên
                  tưởng đã check-out xong rồi bỏ đi (BUG-114). Cứ cho bấm để
                  handleCheckOut() nói thẳng là còn thiếu ảnh. */}
              <button className="primary-button checkout-button" disabled={busyId === record?.id} onClick={() => handleCheckOut(record!, registration)}>
                {busyId === record?.id ? busyLabel(busyPhase) : 'Check-out'}
              </button>
              {pendingCheckOut?.registrationId === registration.id && (
                <div className="checkout-handover-guard">
                  <p>{`Ca ${pendingCheckOut.sequence} chưa bàn giao. Chốt tồn ở mục Bàn giao rồi hãy check-out để số liệu kho đúng.`}</p>
                  <button className="primary-button" onClick={() => onNavigate('handover')}>Sang Bàn giao chốt ca</button>
                  <button
                    className="secondary-button"
                    disabled={busyId === record?.id}
                    onClick={() => handleCheckOut(record!, registration, { force: true })}
                  >
                    Vẫn check-out (ca ghi "chưa kiểm đếm")
                  </button>
                </div>
              )}
              {busyId === record?.id && <small className="attendance-busy-hint">Đang xử lý, vui lòng giữ máy vài giây…</small>}
            </>}
            {checkOutTooEarly && (
              <small>Check-out mở lúc {checkInWindow.checkOutOpensAt.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })} (30 phút trước giờ ra).</small>
            )}
            {!canCheckIn && !canCheckOut && !checkOutTooEarly && !record
              && !d.blockedByOpenSession && (
              <small>{checkInHint(registration, checkInWindow, now)}</small>
            )}
          </div>
        )}
      </article>
    )
  }

  function renderCompletedRow(d: typeof decorated[number]) {
    const { registration, record } = d
    const isOvertime = isOvertimeRegistration(registration)
    return (
      <article className={`completed-shift-row${isOvertime ? ' overtime' : ''}`} key={registration.id}>
        <time>{formatDate(registration.workDate)}</time>
        <strong>{registration.startTime} - {registration.endTime}</strong>
        <span>{branchName(registration.branchId)}</span>
        <span>
          {isOvertime ? 'Tăng ca · ' : ''}Vào <b>{record ? formatTime(record.checkInTime) : '-'}</b>
          {' · '}Ra <b>{record?.checkOutTime ? formatTime(record.checkOutTime) : '-'}</b>
          {record?.checkOutTime && <>{' · '}Đã làm <b>{formatWorkDurationBetween(record.checkInTime, record.checkOutTime)}</b></>}
        </span>
      </article>
    )
  }

  function renderOverdueCard(d: typeof decorated[number]) {
    const { registration, record } = d
    return (
      <article className="shift-card overdue-checkout" key={registration.id}>
        <div className="shift-date">
          <strong>{new Date(`${registration.workDate}T00:00:00`).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' })}</strong>
          <small>{new Date(`${registration.workDate}T00:00:00`).toLocaleDateString('vi-VN', { weekday: 'short' })}</small>
        </div>
        <div className="shift-main">
          <span className="attendance-status overdue">Chờ hệ thống tự đóng</span>
          <h3>{registration.startTime} – {registration.endTime}</h3>
          <p>{branchName(registration.branchId)}</p>
          <div className="attendance-times">
            <span>Vào: <strong>{record ? formatTime(record.checkInTime) : '-'}</strong></span>
            <span>Ra: <strong>Chưa ghi nhận</strong></span>
          </div>
          <p className="overdue-checkout-note">
            Hệ thống sẽ tự đóng ca này khi sang ngày mới theo giờ tan ca đã đăng ký. Bạn không cần nhập hay chấm thêm giờ. Admin sẽ nhận ca này trong danh sách lỗi chấm công và chỉnh lại nếu giờ thực tế khác.
          </p>
        </div>
      </article>
    )
  }

  function renderMissedRow(d: typeof decorated[number]) {
    const { registration } = d
    return (
      <article className="completed-shift-row missed" key={registration.id}>
        <time>{formatDate(registration.workDate)}</time>
        <strong>{registration.startTime} - {registration.endTime}</strong>
        <span>{branchName(registration.branchId)}</span>
        <span>Chưa chấm công</span>
      </article>
    )
  }

  const memoryOutboxCount = outboxOps.filter((op) => op.durability === 'memory').length
  const reviewOutboxCount = outboxOps.filter((op) => op.deliveryState === 'needs-review').length
  const sendableOutboxCount = outboxOps.length - reviewOutboxCount
  // Chỉ hiện khi còn lượt CŨ chờ gửi lại — không còn trạng thái "chưa xác minh"
  // và không khóa gì cả (BUG-131).
  const outboxBanner = outboxOps.length > 0 ? (
    <section className="section-card attendance-outbox-banner">
      <div className="section-title">
        <div>
          <span className="eyebrow dark">CHỜ XỬ LÝ</span>
          <h2>{`${outboxOps.length} lượt chấm công chưa được máy chủ xác nhận`}</h2>
        </div>
      </div>
      {reviewOutboxCount > 0 && <p className="empty-copy">{reviewOutboxCount} lượt xung đột được giữ làm bằng chứng và KHÔNG tự replay giờ cũ. Quản lý cần rà soát/chỉnh công nếu cần.</p>}
      {sendableOutboxCount > 0 && <p className="empty-copy">Các lượt này sẽ tự gửi lại theo thứ tự và giữ nguyên giờ chấm gốc.</p>}
    </section>
  ) : null

  // BUG-131: mạng chậm/lỗi đọc KHÔNG chặn màn chấm công nữa — nếu người đã
  // check-in bấm lại, máy chủ tự nhận diện bản ghi hiện có (idempotent) hoặc
  // unique một-phiên-mở từ chối; client không cần màn hình khóa.
  return (
    <>
      {outboxBanner}
      <section className="section-card attendance-schedule">
        <div className="section-title">
          <div><span className="eyebrow dark">CẦN CHẤM CÔNG</span><h2>Ca cần chấm</h2></div>
          <span className="date-chip">{pending.length} ca</span>
        </div>
        <div className="shift-card-list">
          {pending.map((d) => renderCard(d, false))}
          {!pending.length && loadFailed && (
            <p className="empty-copy">Chưa tải được lịch và dữ liệu chấm công nên chưa biết hôm nay bạn có ca hay không. Hãy kiểm tra mạng rồi bấm "Tải lại".</p>
          )}
          {!pending.length && !loadFailed && !hasTodayRegistration && (
            <div className="attendance-registration-empty">
              <p className="empty-copy">Bạn chưa đăng ký ca hôm nay nên chưa thể check-in.</p>
              <button type="button" className="primary-button" onClick={onOpenRegistration}>Đăng ký ca hôm nay</button>
            </div>
          )}
          {!pending.length && !loadFailed && hasTodayRegistration && <p className="empty-copy">Không có ca nào cần chấm công lúc này.</p>}
        </div>
      </section>
      {overdue.length > 0 && (
        <section className="section-card attendance-schedule attendance-overdue">
          <div className="section-title">
            <div><span className="eyebrow dark">CA CHỜ TỰ ĐÓNG</span><h2>Ca quá hạn đang được hệ thống xử lý</h2></div>
            <span className="date-chip">{overdue.length} ca</span>
          </div>
          <div className="shift-card-list">
            {overdue.map(renderOverdueCard)}
          </div>
        </section>
      )}
      <AttendanceAdjustmentForm user={user} onFeedback={onFeedback} />
      {completed.length > 0 && (
        <section className="section-card attendance-schedule attendance-done">
          <div className="section-title">
            <div><span className="eyebrow dark">ĐÃ CHẤM CÔNG</span><h2>Ca đã hoàn tất</h2></div>
            <span className="date-chip">{completed.length} ca</span>
          </div>
          <div className="completed-shift-list">
            {completed.map(renderCompletedRow)}
          </div>
        </section>
      )}
      {missed.length > 0 && (
        <section className="section-card attendance-schedule attendance-done">
          <div className="section-title">
            <div><span className="eyebrow dark">QUÁ HẠN</span><h2>Ca đã qua chưa chấm</h2></div>
            <span className="date-chip">{missed.length} ca</span>
          </div>
          <div className="shift-card-list">
            {missed.map(renderMissedRow)}
          </div>
        </section>
      )}
    </>
  )
}

type EmployeeAdjustmentKind = Exclude<AttendanceAdjustmentKind, 'missing_checkout'>

function AttendanceAdjustmentForm({ user, onFeedback }: {
  user: AppUser
  onFeedback: (message: string) => void
}) {
  const [kind, setKind] = useState<EmployeeAdjustmentKind>('late_arrival')
  const [workDate, setWorkDate] = useState(localDateKey())
  const [scheduledTime, setScheduledTime] = useState('08:00')
  const [actualTime, setActualTime] = useState('08:15')
  const [reason, setReason] = useState('')
  const [evidenceNote, setEvidenceNote] = useState('')
  const [saving, setSaving] = useState(false)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!reason.trim()) {
      onFeedback('Cần nhập lý do để lưu chứng từ.')
      return
    }
    setSaving(true)
    try {
      await createAttendanceAdjustment(user, {
        kind,
        workDate,
        scheduledTime,
        actualTime,
        reason,
        evidenceNote,
      })
      setReason('')
      setEvidenceNote('')
      onFeedback('Đã lưu chứng từ đi trễ/về sớm.')
    } catch (error) {
      onFeedback(error instanceof Error ? error.message : 'Không thể lưu chứng từ.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="section-card attendance-adjustment-card" id="attendance-adjustment-form">
      <div className="section-title">
        <div>
          <span className="eyebrow dark">CHỨNG TỪ CÔNG</span>
          <h2>Đơn xác nhận đi trễ / về sớm</h2>
        </div>
      </div>
      <form className="attendance-adjustment-form" onSubmit={submit}>
        <label>Loại đơn
          <select value={kind} onChange={(event) => setKind(event.target.value as EmployeeAdjustmentKind)}>
            <option value="late_arrival">Đi trễ</option>
            <option value="early_leave">Xin về sớm</option>
          </select>
        </label>
        <label>Ngày
          <input type="date" value={workDate} onChange={(event) => setWorkDate(event.target.value)} />
        </label>
        <label>Giờ theo ca
          <input type="time" value={scheduledTime} onChange={(event) => setScheduledTime(event.target.value)} />
        </label>
        <label>Giờ thực tế / xin phép
          <input type="time" value={actualTime} onChange={(event) => setActualTime(event.target.value)} />
        </label>
        <label className="span-2">Lý do
          <input value={reason} onChange={(event) => setReason(event.target.value)} placeholder="VD: kẹt xe, việc gia đình, sức khỏe..." />
        </label>
        <label className="span-2">Ghi chú chứng từ
          <input value={evidenceNote} onChange={(event) => setEvidenceNote(event.target.value)} placeholder="VD: đã báo ca trưởng lúc 08:05, kèm tin nhắn Zalo..." />
        </label>
        <button className="primary-button" disabled={saving}>{saving ? 'Đang lưu...' : 'Lưu đơn'}</button>
      </form>
    </section>
  )
}

/**
 * Chi nhánh được phép chọn khi TỰ đăng ký ca / chấm công.
 *
 * SUP MT (giám sát thị trường) và admin không gắn chi nhánh cố định: đi giám sát chi
 * nhánh nào thì đăng ký ca và chấm công tại chi nhánh đó. Nhân viên/ca trưởng vẫn khóa
 * đúng chi nhánh của mình như cũ.
 */
function attendanceBranchOptions(user: AppUser) {
  if (hasSystemWideScope(user.role) || user.role === 'manager' || user.canRoamBranches) return permittedBranchIds(user)
  return [user.branchId]
}

function RegistrationPanel({
  user, shifts, registrations, onChanged, onFeedback,
}: {
  user: AppUser
  shifts: WorkShift[]
  registrations: ShiftRegistration[]
  onChanged: () => Promise<void>
  onFeedback: (message: string) => void
}) {
  const branchIds = attendanceBranchOptions(user)
  const branches = useConfiguredBranches({ user })
  const [branchId, setBranchId] = useState(user.branchId || branchIds[0] || '')
  const [workDate, setWorkDate] = useState(localDateKey())
  const [shiftId, setShiftId] = useState('')
  const [startTime, setStartTime] = useState('08:00')
  const [endTime, setEndTime] = useState('16:00')
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const employmentType = user.employmentType || (user.role === 'shift_leader' ? 'leader' : 'part_time')
  const availableShifts = shifts.filter((item) =>
    item.branchId === branchId
    && (!item.employmentTypes?.length || item.employmentTypes.includes(employmentType)),
  )
  const matchingRegistrations = registrations.filter((item) =>
    item.branchId === branchId
    && item.workDate === workDate
    && (shiftId ? item.shiftId === shiftId : item.startTime === startTime && item.endTime === endTime)
    && item.status !== 'rejected',
  )
  const selectedShift = shifts.find((item) => item.id === shiftId)
  const recommendedStaff = selectedShift?.recommendedStaff || 3
  const crowdLevel = matchingRegistrations.length < recommendedStaff
    ? 'available'
    : matchingRegistrations.length === recommendedStaff
      ? 'balanced'
      : 'crowded'

  useEffect(() => {
    if (user.branchId && user.branchId !== branchId) {
      setBranchId(user.branchId)
      setShiftId('')
    }
  }, [user.branchId])

  useEffect(() => {
    if (shiftId || !availableShifts.length) return
    const firstShift = availableShifts[0]
    setShiftId(firstShift.id)
    setStartTime(firstShift.startTime)
    setEndTime(firstShift.endTime)
  }, [availableShifts, shiftId])

  function selectShift(id: string) {
    setShiftId(id)
    const shift = shifts.find((item) => item.id === id)
    if (shift) {
      setStartTime(shift.startTime)
      setEndTime(shift.endTime)
    }
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (matchingRegistrations.length >= recommendedStaff) {
      const proceed = window.confirm(
        `Ca này đã có ${matchingRegistrations.length}/${recommendedStaff} người khuyến nghị. Bạn vẫn muốn đăng ký?`,
      )
      if (!proceed) return
    }
    setSaving(true)
    try {
      await createShiftRegistration(user, { branchId, workDate, startTime, endTime, shiftId: shiftId || undefined, note })
      setNote('')
      onFeedback('Đã thêm ca làm. Ca có hiệu lực ngay và không cần duyệt.')
      await onChanged()
    } catch (error) {
      onFeedback(error instanceof Error ? error.message : 'Không thể đăng ký ca.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="attendance-two-column">
      <form className="entry-card attendance-form" onSubmit={submit}>
        <div className="section-title"><div><span className="eyebrow dark">THÊM CA LÀM</span><h2>Chọn ngày và giờ làm</h2></div></div>
        <div className="form-grid">
          <label>Chi nhánh
            <select value={branchId} disabled={branchIds.length === 1} onChange={(event) => {
              const nextBranch = event.target.value
              setBranchId(nextBranch)
              setShiftId('')
              if (user.canRoamBranches) void switchActiveBranch(user, nextBranch).catch(() => undefined)
            }}>
              {branches.filter((item) => branchIds.includes(item.id)).map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
            </select>
          </label>
          <label>Ngày làm việc
            <input type="date" min={localDateKey()} value={workDate} onChange={(event) => setWorkDate(event.target.value)} required />
          </label>
          <label className="full">Ca có sẵn
            <select value={shiftId} onChange={(event) => selectShift(event.target.value)}>
              <option value="">Tự chọn giờ</option>
              {availableShifts.map((shift) => <option key={shift.id} value={shift.id}>{shift.name} · {shift.startTime}–{shift.endTime}</option>)}
            </select>
          </label>
          <label>Giờ bắt đầu<input type="time" value={startTime} onChange={(event) => { setStartTime(event.target.value); setShiftId('') }} required /></label>
          <label>Giờ kết thúc<input type="time" value={endTime} onChange={(event) => { setEndTime(event.target.value); setShiftId('') }} required /></label>
          <label className="full">Ghi chú<textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="Ví dụ: Có thể đến sớm 15 phút" /></label>
        </div>
        <div className={`shift-capacity-hint ${crowdLevel}`}>
          <strong>{matchingRegistrations.length}/{recommendedStaff} người</strong>
          <span>
            {crowdLevel === 'available' && 'Ca này vẫn còn thiếu người so với mức khuyến nghị.'}
            {crowdLevel === 'balanced' && 'Ca này đã vừa đủ người. Bạn vẫn có thể đăng ký thêm.'}
            {crowdLevel === 'crowded' && 'Ca này đang đông. Hệ thống chỉ cảnh báo, không khóa đăng ký.'}
          </span>
        </div>
        <button className="primary-button wide" disabled={saving}>{saving ? 'Đang lưu…' : 'Lưu ca làm'}</button>
      </form>
      <section className="section-card">
        <div className="section-title"><div><span className="eyebrow dark">GẦN ĐÂY</span><h2>Ca làm của tôi</h2></div></div>
        <div className="compact-shift-list">
          {registrations.filter((item) => item.userId === user.id).slice(0, 8).map((item) => (
            <div key={item.id}>
              <span><strong>{formatDate(item.workDate)} · {item.startTime}–{item.endTime}</strong><small>{branchName(item.branchId)}</small></span>
              <span className={`attendance-status ${item.status}`}>{statusLabel(item.status)}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}

function SharedScheduleBoard({
  user, shifts, registrations, people, employees, range, onRangeChange, onChanged, onFeedback,
}: {
  user: AppUser
  shifts: WorkShift[]
  registrations: ShiftRegistration[]
  people: SchedulePerson[]
  employees: EmployeeProfile[]
  range: { from: string; to: string }
  onRangeChange: (range: { from: string; to: string }) => void
  onChanged: () => Promise<void>
  onFeedback: (message: string) => void
}) {
  const isScheduleManager = canManageShiftSetup(user)
  const [branchId, setBranchId] = useState(user.branchId || attendanceBranchOptions(user)[0] || '')
  const from = range.from
  const [liveUsers, setLiveUsers] = useState<string[]>([])
  const [savingCell, setSavingCell] = useState('')
  const [entries, setEntries] = useState<ScheduleEntry[]>([])
  const [setupOpen, setSetupOpen] = useState(false)
  const [overtimeOpen, setOvertimeOpen] = useState(false)
  const [overtimePersonId, setOvertimePersonId] = useState('')
  const [overtimeDate, setOvertimeDate] = useState(localDateKey())
  const [overtimeStart, setOvertimeStart] = useState('18:00')
  const [overtimeEnd, setOvertimeEnd] = useState('22:00')
  const [overtimeNote, setOvertimeNote] = useState('')
  const [overtimeBusy, setOvertimeBusy] = useState(false)
  const [shiftName, setShiftName] = useState('')
  const [shiftStart, setShiftStart] = useState('08:00')
  const [shiftEnd, setShiftEnd] = useState('16:00')
  const [shiftType, setShiftType] = useState<EmploymentType | ''>('')
  const [customDrafts, setCustomDrafts] = useState<Record<string, { startTime: string; endTime: string }>>({})
  const [savedCustomCells, setSavedCustomCells] = useState<Record<string, string>>({})
  const [bootstrappedBranches, setBootstrappedBranches] = useState<Record<string, boolean>>({})
  const days = Array.from({ length: 7 }, (_, index) => addLocalDateKeyDays(from, index))
  function setFrom(next: string) {
    onRangeChange({ from: next, to: addLocalDateKeyDays(next, 6) })
  }
  function moveWeek(deltaDays: number) {
    let next = addLocalDateKeyDays(from, deltaDays)
    if (!isScheduleManager && next < localDateKey()) next = localDateKey()
    setFrom(next)
  }
  function resetWeek() {
    setFrom(isScheduleManager ? registrationWeekStartKey() : localDateKey())
  }
  const canSetupShifts = canManageShiftSetup(user)
  const branchIds = isScheduleManager ? permittedBranchIds(user) : attendanceBranchOptions(user)
  const branches = useConfiguredBranches({ user })
  const branchShifts = shifts.filter((shift) => shift.branchId === branchId)
  const fallbackShiftOptions: WorkShift[] = DEFAULT_WORK_SHIFT_TEMPLATES.map((template, index) => ({
    id: `${FALLBACK_SHIFT_PREFIX}${index}`,
    branchId,
    name: template.name,
    startTime: template.startTime,
    endTime: template.endTime,
    graceMinutes: 5,
    recommendedStaff: 3,
    employmentTypes: template.employmentTypes,
    active: true,
  }))
  const sheetShiftOptions = (branchShifts.length ? branchShifts : fallbackShiftOptions)
    .slice()
    .sort((a, b) => a.startTime.localeCompare(b.startTime) || a.endTime.localeCompare(b.endTime) || a.name.localeCompare(b.name, 'vi'))
  const usingFallbackShifts = !branchShifts.length && fallbackShiftOptions.length > 0

  useEffect(() => {
    if (user.branchId && user.branchId !== branchId) {
      setBranchId(user.branchId)
    }
  }, [user.branchId])

  useEffect(() => {
    if (!isScheduleManager && from < localDateKey()) setFrom(localDateKey())
  }, [from, isScheduleManager])

  useEffect(() => {
    if (!canSetupShifts || bootstrappedBranches[branchId]) return
    const branch = branches.find((item) => item.id === branchId)
    if (!branch) return
    setBootstrappedBranches((items) => ({ ...items, [branchId]: true }))
    void ensureCurrentDefaultWorkShifts(user, branch)
      .then(async (nextShifts) => {
        if (nextShifts.length) window.dispatchEvent(new CustomEvent('gustino-attendance-updated'))
        await onChanged()
        onFeedback('Đã cập nhật khung ca mới; lịch cũ vẫn giữ nguyên.')
      })
      .catch((error) => {
        onFeedback(error instanceof Error ? error.message : 'Không thể khởi tạo khung ca mặc định.')
      })
  }, [bootstrappedBranches, branchId, branchShifts.length, branches, canSetupShifts, onChanged, onFeedback, user])
  // Gộp tài khoản thật vào danh sách: trigger DB lẽ ra tự đồng bộ profiles → schedule_people,
  // nhưng nếu thiếu (chưa chạy migration / account chưa gắn chi nhánh) thì account vẫn hiện ở đây.
  const mergedPeople = useMemo(() => {
    const byProfile = new Map<string, SchedulePerson>()
    const unlinked: SchedulePerson[] = []
    for (const person of people) {
      if (person.profileId) {
        const isCurrentRoamingUser = person.profileId === user.id && (hasSystemWideScope(user.role) || Boolean(user.canRoamBranches))
        byProfile.set(person.profileId, isCurrentRoamingUser ? { ...person, branchId } : person)
      } else {
        unlinked.push(person)
      }
    }
    let order = people.length
    if (!byProfile.has(user.id)) {
      byProfile.set(user.id, {
        id: user.id,
        profileId: user.id,
        name: user.name,
        // SUP MT/admin hoặc nhân sự lưu động: gắn theo chi nhánh đang xem để dòng
        // của chính họ không bị lọc mất (bảng lịch lọc theo `person.branchId === branchId`).
        branchId: (hasSystemWideScope(user.role) || user.canRoamBranches) ? branchId : (user.branchId || branchId),
        employmentType: user.employmentType,
        positionTitle: user.positionTitle,
        active: true,
        sortOrder: -1,
      })
    }
    for (const employee of employees) {
      if ((!employee.branchId && !employee.canRoamBranches) || employee.active === false) continue
      const targetEmployeeBranch = employee.canRoamBranches ? branchId : employee.branchId!
      if (byProfile.has(employee.id)) {
        if (employee.canRoamBranches) {
          const existing = byProfile.get(employee.id)!
          byProfile.set(employee.id, { ...existing, branchId })
        }
        continue
      }
      byProfile.set(employee.id, {
        id: employee.id,
        profileId: employee.id,
        name: employee.name,
        branchId: targetEmployeeBranch,
        employmentType: employee.employmentType,
        positionTitle: employee.positionTitle,
        active: true,
        sortOrder: order++,
      })
    }
    return [...byProfile.values(), ...unlinked]
  }, [people, employees, branchId, user.id, user.name, user.role, user.branchId, user.canRoamBranches, user.employmentType, user.positionTitle])
  const schedulePeople = mergedPeople
    .filter((person) => person.branchId === branchId && person.active)
    .sort((a, b) => {
      const aIsMe = a.profileId === user.id ? 0 : 1
      const bIsMe = b.profileId === user.id ? 0 : 1
      return aIsMe - bIsMe
        || a.sortOrder - b.sortOrder
        || employmentOrder(a.employmentType) - employmentOrder(b.employmentType)
        || a.name.localeCompare(b.name, 'vi')
    })
  const ownPerson = schedulePeople.find((person) => person.profileId === user.id)
  const displayEntries = useMemo(() => {
    const merged = new Map<string, ScheduleEntry>()
    entries.forEach((entry) => merged.set(`${entry.personId}|${entry.workDate}`, entry))
    const mainRegistrations = registrations
      .filter((registration) => !isSupplementalScheduleRegistration(registration))
      .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
    for (const registration of mainRegistrations) {
      if (
        registration.branchId !== branchId
        || registration.status === 'rejected'
        || registration.workDate < days[0]
        || registration.workDate > days[6]
      ) continue
      const person = schedulePeople.find((item) => item.profileId === registration.userId)
      if (!person) continue
      const key = `${person.id}|${registration.workDate}`
      if (!merged.has(key)) {
        merged.set(key, {
          id: `registration-${registration.id}`,
          personId: person.id,
          branchId: registration.branchId,
          workDate: registration.workDate,
          shiftId: registration.shiftId,
          startTime: registration.startTime,
          endTime: registration.endTime,
          note: registration.note,
        })
      }
    }
    return Array.from(merged.values())
  }, [branchId, days, entries, registrations, schedulePeople])

  async function loadEntries() {
    try {
      setEntries(await fetchScheduleEntries(user, { branchId, from: days[0], to: days[6] }))
    } catch (error) {
      onFeedback(error instanceof Error ? error.message : 'Không thể tải bảng lịch chung.')
    }
  }

  useEffect(() => { void loadEntries() }, [branchId, from, user.id])

  useEffect(() => {
    const client = supabase
    if (!client) {
      const timer = window.setInterval(() => void onChanged(), 10000)
      return () => window.clearInterval(timer)
    }
    // Topic presence phải GIỮ CHUNG giữa các client ('schedule:company') để thấy nhau
    // online — không được đổi tên duy nhất như các channel postgres_changes khác.
    // supabase-js mới tái sử dụng channel trùng topic và .on() sau subscribe sẽ THROW,
    // nên nếu channel cũ chưa gỡ xong (StrictMode/đổi tuần) thì gỡ nó rồi thử lại.
    let channel: ReturnType<typeof client.channel> | null = null
    let retryTimer: number | null = null
    let cancelled = false
    const connect = (attempt = 0) => {
      if (cancelled) return
      try {
        const next = client.channel('schedule:company', { config: { presence: { key: user.id } } })
          .on('postgres_changes', {
            event: '*', schema: 'public', table: 'schedule_entries',
          }, () => void Promise.all([loadEntries(), onChanged()]))
          .on('postgres_changes', {
            event: '*', schema: 'public', table: 'schedule_people',
          }, () => void onChanged())
          .on('postgres_changes', {
            event: '*', schema: 'public', table: 'shifts',
          }, () => void onChanged())
          .on('presence', { event: 'sync' }, () => {
            const state = next.presenceState<{ name: string; branchId: string }>()
            setLiveUsers(Object.values(state).flat().map((entry) =>
              `${entry.name} · ${branchName(entry.branchId)}`,
            ).filter(Boolean))
          })
          .subscribe(async (status) => {
            if (status === 'SUBSCRIBED') await next.track({
              name: user.name,
              branchId: user.branchId,
              page: 'schedule',
              at: new Date().toISOString(),
            })
          })
        channel = next
      } catch {
        const stale = client.getChannels().find((item) => item.topic === 'realtime:schedule:company')
        if (stale) void client.removeChannel(stale).catch(() => null)
        if (attempt < 3) retryTimer = window.setTimeout(() => connect(attempt + 1), 500)
      }
    }
    connect()
    return () => {
      cancelled = true
      if (retryTimer) window.clearTimeout(retryTimer)
      if (channel) void client.removeChannel(channel)
    }
  }, [user.id, user.name, user.branchId, branchId, from])

  useEffect(() => {
    if (!overtimePersonId && ownPerson) setOvertimePersonId(ownPerson.id)
    if (!isScheduleManager && ownPerson && overtimePersonId !== ownPerson.id) setOvertimePersonId(ownPerson.id)
    if (isScheduleManager && overtimePersonId && !schedulePeople.some((person) => person.id === overtimePersonId)) {
      setOvertimePersonId(schedulePeople[0]?.id || '')
    }
  }, [isScheduleManager, ownPerson?.id, overtimePersonId, schedulePeople, user.role])

  useEffect(() => {
    if (!branchIds.includes(branchId)) setBranchId(branchIds[0] || user.branchId)
  }, [branchId, branchIds, user.branchId])

  function customDraftKey(person: SchedulePerson, date: string) {
    return `${person.id}|${date}`
  }

  function openCustomDraft(person: SchedulePerson, date: string, registration?: ScheduleEntry) {
    const key = customDraftKey(person, date)
    setCustomDrafts((current) => ({
      ...current,
      [key]: current[key] || {
        startTime: registration?.startTime || '09:00',
        endTime: registration?.endTime || '17:00',
      },
    }))
  }

  function closeCustomDraft(person: SchedulePerson, date: string) {
    const key = customDraftKey(person, date)
    setCustomDrafts((current) => {
      const next = { ...current }
      delete next[key]
      return next
    })
  }

  async function selectCellShift(person: SchedulePerson, date: string, value: string, registration?: ScheduleEntry) {
    if (value === CUSTOM_SHIFT_VALUE) {
      openCustomDraft(person, date, registration)
      return
    }
    closeCustomDraft(person, date)
    await changeCell(person, date, value)
  }

  async function changeCell(person: SchedulePerson, date: string, shiftId: string) {
    if (person.profileId !== user.id && !isScheduleManager) return
    const shift = shifts.find((item) => item.id === shiftId)
    const fallbackShift = sheetShiftOptions.find((item) => item.id === shiftId && item.id.startsWith(FALLBACK_SHIFT_PREFIX))
    const key = `${person.id}-${date}`
    setSavingCell(key)
    try {
      if (person.profileId) {
        if (fallbackShift) {
          await setScheduleRegistration(user, {
            userId: person.profileId,
            userName: person.name,
            branchId,
            workDate: date,
            startTime: fallbackShift.startTime,
            endTime: fallbackShift.endTime,
            note: fallbackShift.name,
            employmentType: person.employmentType,
            positionTitle: person.positionTitle,
          })
        } else {
          await setScheduleRegistration(user, {
            userId: person.profileId,
            userName: person.name,
            branchId,
            workDate: date,
            shift,
            employmentType: person.employmentType,
            positionTitle: person.positionTitle,
          })
        }
      } else {
        await setScheduleEntry(user, {
          personId: person.id,
          branchId,
          workDate: date,
          shiftId: shiftId || undefined,
        })
      }
      await Promise.all([loadEntries(), onChanged()])
      onFeedback(`Đã cập nhật ca của ${person.name}.`)
    } catch (error) {
      onFeedback(error instanceof Error ? error.message : 'Không thể cập nhật ô lịch.')
    } finally {
      setSavingCell('')
    }
  }

  async function saveCustomCell(person: SchedulePerson, date: string) {
    if (person.profileId !== user.id && !isScheduleManager) return
    const key = customDraftKey(person, date)
    const draft = customDrafts[key]
    if (!draft) return
    setSavingCell(`${person.id}-${date}`)
    try {
      if (!person.profileId) {
        onFeedback('Nhân viên này chưa có tài khoản đăng nhập nên chưa thể lưu giờ tùy chỉnh.')
        return
      }
      await setScheduleRegistration(user, {
        userId: person.profileId,
        userName: person.name,
        branchId,
        workDate: date,
        startTime: draft.startTime,
        endTime: draft.endTime,
        note: 'Ca tùy chỉnh',
        employmentType: person.employmentType,
        positionTitle: person.positionTitle,
      })
      await Promise.all([loadEntries(), onChanged()])
      setSavedCustomCells((current) => ({ ...current, [key]: `${draft.startTime}-${draft.endTime}` }))
      window.setTimeout(() => {
        setSavedCustomCells((current) => {
          const next = { ...current }
          delete next[key]
          return next
        })
      }, 2400)
      closeCustomDraft(person, date)
      onFeedback(`Đã cập nhật giờ làm ${draft.startTime}-${draft.endTime} cho ${person.name}.`)
    } catch (error) {
      onFeedback(error instanceof Error ? error.message : 'Không thể lưu giờ tùy chỉnh.')
    } finally {
      setSavingCell('')
    }
  }

  async function removePerson(person: SchedulePerson) {
    try {
      await deleteSchedulePerson(user, person.id)
      await onChanged()
      onFeedback(`Đã xóa ${person.name} khỏi bảng lịch.`)
    } catch (error) {
      onFeedback(error instanceof Error ? error.message : 'Không thể xóa dòng nhân sự.')
    }
  }

  async function addShift(event: React.FormEvent) {
    event.preventDefault()
    try {
      await createWorkShift(user, {
        branchId,
        name: shiftName || `${shiftStart}-${shiftEnd}`,
        startTime: shiftStart,
        endTime: shiftEnd,
        employmentTypes: shiftType ? [shiftType] : [],
      })
      setShiftName('')
      await onChanged()
      onFeedback('Đã thêm khung ca mới.')
    } catch (error) {
      onFeedback(error instanceof Error ? error.message : 'Không thể thêm khung ca.')
    }
  }

  async function removeShift(shift: WorkShift) {
    try {
      await archiveWorkShift(user, shift.id)
      await onChanged()
      onFeedback(`Đã xóa khung ca ${shift.startTime}-${shift.endTime}.`)
    } catch (error) {
      onFeedback(error instanceof Error ? error.message : 'Không thể xóa khung ca.')
    }
  }

  async function addOvertime(event: React.FormEvent) {
    event.preventDefault()
    const person = schedulePeople.find((item) => item.id === overtimePersonId)
    if (!person?.profileId) {
      onFeedback('Nhân viên này chưa có tài khoản đăng nhập nên chưa thể thêm ca chấm công.')
      return
    }
    setOvertimeBusy(true)
    try {
      await createManualShiftRegistration(user, {
        userId: person.profileId,
        userName: person.name,
        branchId,
        workDate: overtimeDate,
        startTime: overtimeStart,
        endTime: overtimeEnd,
        note: overtimeNote.trim() ? `Tăng ca · ${overtimeNote.trim()}` : 'Tăng ca',
        employmentType: person.employmentType,
        positionTitle: person.positionTitle,
      })
      setOvertimeNote('')
      await onChanged()
      onFeedback(`Đã đăng ký tăng ca cho ${person.name}. Ca tăng ca sẽ check-in/check-out riêng.`)
    } catch (error) {
      onFeedback(error instanceof Error ? error.message : 'Không thể đăng ký tăng ca.')
    } finally {
      setOvertimeBusy(false)
    }
  }

  return (
    <>
      <section className="section-card shared-schedule-toolbar">
        <div>
          <span className="eyebrow dark">LỊCH CHUNG THEO CHI NHÁNH</span>
          <h2>Đăng ký ca trong tuần</h2>
          <p>Thẻ của bạn được ghim lên đầu — chọn khung giờ cho từng ngày là xong. Nhân viên chỉ sửa thẻ của mình; Quản lý chỉnh được toàn bảng.</p>
          <div className="schedule-live-users"><i />{liveUsers.length ? `${liveUsers.join(', ')} đang xem lịch` : 'Lịch tự đồng bộ khi có người đăng ký'}</div>
          {canSetupShifts && (
            <button className="secondary-button schedule-setup-button" onClick={() => setSetupOpen((value) => !value)}>
              {setupOpen ? 'Đóng thiết lập' : '⚙ Thiết lập nhân sự & ca'}
            </button>
          )}
        </div>
        <div className="shared-schedule-filters">
          <label>Chi nhánh
            <select value={branchId} disabled={branchIds.length === 1} onChange={(event) => {
              const nextBranch = event.target.value
              setBranchId(nextBranch)
              if (user.canRoamBranches) void switchActiveBranch(user, nextBranch).catch(() => undefined)
            }}>
              {branches.filter((branch) => branchIds.includes(branch.id)).map((branch) =>
                <option key={branch.id} value={branch.id}>{branch.name}</option>,
              )}
            </select>
          </label>
          <label>Tuần bắt đầu
            <input type="date" value={from} min={isScheduleManager ? undefined : localDateKey()} onChange={(event) => setFrom(event.target.value)} />
          </label>
          <div className="schedule-week-nav" role="group" aria-label="Chuyển tuần">
            <button type="button" onClick={() => moveWeek(-7)} disabled={!isScheduleManager && from <= localDateKey()}>‹ Tuần trước</button>
            <button type="button" onClick={resetWeek}>Tuần này</button>
            <button type="button" onClick={() => moveWeek(7)}>Tuần sau ›</button>
          </div>
        </div>
      </section>

      <section className="section-card overtime-panel">
        <div>
          <span className="eyebrow dark">TĂNG CA</span>
          <h2>Đăng ký tăng ca</h2>
          <p>Tăng ca là một phiên chấm công riêng: nhân viên phải check-in và check-out riêng, sau đó hệ thống ghi nhận số giờ tăng ca thực tế.</p>
        </div>
        <button className="secondary-button" type="button" onClick={() => setOvertimeOpen((value) => !value)}>
          {overtimeOpen ? 'Đóng' : '+ Tăng ca'}
        </button>
        {overtimeOpen && (
          <form className="overtime-form" onSubmit={addOvertime}>
            <label>Nhân viên
              <select value={overtimePersonId} onChange={(event) => setOvertimePersonId(event.target.value)} disabled={!isScheduleManager}>
                {schedulePeople.map((person) => (
                  <option key={person.id} value={person.id}>{person.name}{person.profileId === user.id ? ' · Tôi' : ''}</option>
                ))}
              </select>
            </label>
            <label>Ngày làm
              <input type="date" min={isScheduleManager ? undefined : localDateKey()} value={overtimeDate} onChange={(event) => setOvertimeDate(event.target.value)} />
            </label>
            <label>Bắt đầu
              <input type="time" value={overtimeStart} onChange={(event) => setOvertimeStart(event.target.value)} />
            </label>
            <label>Kết thúc
              <input type="time" value={overtimeEnd} onChange={(event) => setOvertimeEnd(event.target.value)} />
            </label>
            <label className="overtime-note">Lý do tăng ca
              <input value={overtimeNote} onChange={(event) => setOvertimeNote(event.target.value)} placeholder="Ví dụ: hỗ trợ quầy giờ cao điểm" />
            </label>
            <button className="primary-button" disabled={overtimeBusy || !overtimePersonId}>{overtimeBusy ? 'Đang lưu...' : 'Lưu tăng ca'}</button>
          </form>
        )}
      </section>

      {setupOpen && canSetupShifts && (
        <section className="schedule-setup-panel">
          <form onSubmit={addShift}>
            <strong>Tạo khung ca</strong>
            <input value={shiftName} onChange={(event) => setShiftName(event.target.value)} placeholder="Tên ca (không bắt buộc)" />
            <input type="time" value={shiftStart} onChange={(event) => setShiftStart(event.target.value)} required />
            <input type="time" value={shiftEnd} onChange={(event) => setShiftEnd(event.target.value)} required />
            <select value={shiftType} onChange={(event) => setShiftType(event.target.value as EmploymentType | '')}>
              <option value="">Mọi vai trò</option>
              <option value="leader">Ca trưởng</option>
              <option value="full_time">Full-time</option>
              <option value="part_time">Part-time</option>
            </select>
            <button className="primary-button">+ Thêm ca</button>
          </form>
          <div className="schedule-shift-manager">
            {branchShifts.map((shift) => <span key={shift.id}>
              <b>{shift.startTime}-{shift.endTime}</b>
              <small>{shift.name}</small>
              {canSetupShifts && <button type="button" onClick={() => void removeShift(shift)}>×</button>}
            </span>)}
          </div>
        </section>
      )}

      {/* Vertical registration board — mỗi người một thẻ, 7 ngày xếp dọc, không cuộn ngang */}
      <section className="schedule-vboard" aria-label="Bảng đăng ký ca theo chiều dọc">
        {!sheetShiftOptions.length && (
          <p className="schedule-vboard-empty">
            Chi nhánh chưa có khung ca nào nên chưa đăng ký được.{' '}
            {setupOpen
              ? 'Tạo ít nhất một khung giờ trong phần thiết lập đang mở ở trên.'
              : 'Mở “Thiết lập nhân sự & ca” ở trên để tạo khung giờ trước.'}
          </p>
        )}
        {schedulePeople.map((person) => {
          const editable = person.profileId === user.id || isScheduleManager
          const isMe = person.profileId === user.id
          return (
            <article className={`schedule-vcard ${isMe ? 'me' : ''}`} key={person.id}>
              <header className="schedule-vcard-head">
                <span className="vec-avatar">{person.name.trim().slice(0, 1).toUpperCase()}</span>
                <div>
                  <strong>{person.name}{isMe ? ' · Tôi' : ''}</strong>
                  <span>{person.positionTitle || employmentLabel(person.employmentType)}</span>
                </div>
                {(user.role === 'manager' || user.role === 'admin') && !isMe && (
                  <button className="schedule-vcard-remove" title="Xóa khỏi bảng lịch" onClick={() => void removePerson(person)}>×</button>
                )}
              </header>
              <div className="schedule-vcard-days">
                {days.map((date) => {
                  const registration = displayEntries.find((item) => item.personId === person.id && item.workDate === date)
                  const matchedShift = sheetShiftOptions.find((shift) =>
                    shift.id === registration?.shiftId
                    || (shift.startTime === registration?.startTime && shift.endTime === registration?.endTime),
                  )
                  const draftKey = customDraftKey(person, date)
                  const customDraft = customDrafts[draftKey] || (registration && !matchedShift
                    ? { startTime: registration.startTime, endTime: registration.endTime }
                    : undefined)
                  const value = customDraft ? CUSTOM_SHIFT_VALUE : (registration ? (matchedShift?.id || CUSTOM_SHIFT_VALUE) : '')
                  const selectedCustomLabel = customDraft ? `${customDraft.startTime}-${customDraft.endTime}` : 'Tùy chỉnh giờ'
                  const savedCustomLabel = savedCustomCells[draftKey]
                  const canChange = editable
                    && (isScheduleManager || date >= localDateKey())
                  const extraRegistrations = registrations.filter((item) =>
                    person.profileId
                    && isSupplementalScheduleRegistration(item)
                    && item.userId === person.profileId
                    && item.branchId === branchId
                    && item.workDate === date
                    && item.status !== 'rejected'
                    && (!registration || item.shiftId !== registration.shiftId || item.startTime !== registration.startTime || item.endTime !== registration.endTime)
                    && (!customDraft || item.startTime !== customDraft.startTime || item.endTime !== customDraft.endTime)
                  )
                  return (
                    <label className={`schedule-vday ${canChange ? 'editable' : 'readonly'} ${registration ? 'on' : ''}`} key={date}>
                      <span className="schedule-vday-date">
                        <b>{new Date(`${date}T00:00:00`).toLocaleDateString('vi-VN', { weekday: 'long' })}</b>
                        <small>{formatDate(date)}</small>
                      </span>
                      <select
                        aria-label={`${person.name} ${formatDate(date)}`}
                        className={`schedule-cell ${registration ? shiftColor(registration.startTime) : 'off'}`}
                        value={value}
                        disabled={!canChange || savingCell === `${person.id}-${date}`}
                        onChange={(event) => void selectCellShift(person, date, event.target.value, registration)}
                      >
                        <option value="">OFF</option>
                        {value === CUSTOM_SHIFT_VALUE && (
                          <option value={CUSTOM_SHIFT_VALUE}>{selectedCustomLabel}</option>
                        )}
                        {sheetShiftOptions.map((shift) =>
                          <option key={shift.id} value={shift.id}>{shift.startTime}-{shift.endTime}</option>,
                        )}
                        {person.profileId && value !== CUSTOM_SHIFT_VALUE && <option value={CUSTOM_SHIFT_VALUE}>Tùy chỉnh giờ</option>}
                      </select>
                      {canChange && customDrafts[draftKey] && (
                        <div className="schedule-custom-time-grid">
                          <input
                            type="time"
                            aria-label={`Bat dau ${person.name} ${formatDate(date)}`}
                            value={customDraft.startTime}
                            onChange={(event) => setCustomDrafts((current) => ({
                              ...current,
                              [draftKey]: { ...customDraft, startTime: event.target.value },
                            }))}
                          />
                          <input
                            type="time"
                            aria-label={`Ket thuc ${person.name} ${formatDate(date)}`}
                            value={customDraft.endTime}
                            onChange={(event) => setCustomDrafts((current) => ({
                              ...current,
                              [draftKey]: { ...customDraft, endTime: event.target.value },
                            }))}
                          />
                          <button
                            type="button"
                            className="schedule-custom-save"
                            disabled={savingCell === `${person.id}-${date}`}
                            onClick={() => void saveCustomCell(person, date)}
                          >
                            {savingCell === `${person.id}-${date}` ? 'Đang lưu' : savedCustomLabel ? 'Đã lưu' : 'Lưu'}
                          </button>
                          {savedCustomLabel && <strong className="schedule-custom-saved">Đã lưu {savedCustomLabel}</strong>}
                        </div>
                      )}
                      {extraRegistrations.map((item) => (
                        <i key={item.id}>+ {item.startTime}-{item.endTime}</i>
                      ))}
                    </label>
                  )
                })}
              </div>
            </article>
          )
        })}
        {!schedulePeople.length && <p className="empty-copy">Chưa có nhân viên hoặc đăng ký ca trong tuần này.</p>}
      </section>
    </>
  )
}

function employmentOrder(type?: EmployeeProfile['employmentType']) {
  return type === 'leader' ? 0 : type === 'full_time' ? 1 : 2
}
function employmentLabel(type?: EmployeeProfile['employmentType']) {
  return type === 'leader' ? 'Ca trưởng / Ca phó' : type === 'full_time' ? 'Full-time' : type === 'part_time' ? 'Part-time' : 'Nhân viên'
}
function isSupplementalScheduleRegistration(item: { shiftId?: string; note?: string }) {
  if (item.shiftId) return false
  const note = normalizeScheduleNote(item.note || '')
  return ['tang ca', 'bo sung', 'phat sinh'].some((keyword) => note.includes(keyword))
}
function normalizeScheduleNote(value: string) {
  return value.trim().toLocaleLowerCase('vi').normalize('NFD').replace(/\p{Diacritic}/gu, '')
}
function shiftColor(startTime: string) {
  if (startTime < '09:00') return 'morning'
  if (startTime < '12:00') return 'middle'
  if (startTime < '15:00') return 'afternoon'
  return 'evening'
}

function AttendanceReportPanel({
  user, shifts, registrations, records, employees, from, to, onRangeChange,
}: {
  user: AppUser
  shifts: WorkShift[]
  registrations: ShiftRegistration[]
  records: AttendanceRecord[]
  employees: EmployeeProfile[]
  from: string
  to: string
  onRangeChange: (range: { from: string; to: string }) => void
}) {
  const lang = useLang()
  const text = ATTENDANCE_REPORT_TEXT[lang]
  const [branchId, setBranchId] = useState('')
  const [userId, setUserId] = useState('')
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState('')
  const branchIds = permittedBranchIds(user)
  const branches = useConfiguredBranches({ user })
  const activeEmployeeIds = useMemo(
    () => new Set(employees.filter((item) => item.active !== false).map((item) => item.id)),
    [employees],
  )
  const filteredRegistrations = useMemo(() => registrations.filter((item) =>
    (!branchId || item.branchId === branchId)
    && (!userId || item.userId === userId)
    && (!activeEmployeeIds.size || activeEmployeeIds.has(item.userId))
    && item.workDate >= from && item.workDate <= to,
  ), [registrations, branchId, userId, from, to, activeEmployeeIds])
  const filteredRegistrationIds = useMemo(
    () => new Set(filteredRegistrations.map((item) => item.id)),
    [filteredRegistrations],
  )
  const filteredRecords = useMemo(() => records.filter((item) =>
    (!branchId || item.branchId === branchId)
    && (!userId || item.userId === userId)
    && (!activeEmployeeIds.size || activeEmployeeIds.has(item.userId))
    // Ngày bảng công thuộc về registration.workDate. Không lọc lại bằng giờ
    // check-in vì ca qua đêm/offline có thể được gửi ở ngày kế tiếp.
    && Boolean(item.shiftRegistrationId && filteredRegistrationIds.has(item.shiftRegistrationId)),
  ), [records, branchId, userId, activeEmployeeIds, filteredRegistrationIds])
  const grace = useMemo(() => new Map(shifts.map((item) => [item.id, item.graceMinutes])), [shifts])
  const registeredEmployeeKeys = useMemo(
    () => new Set(filteredRegistrations.filter((item) => item.status !== 'rejected').map((item) => `${item.userId}|${item.branchId}`)),
    [filteredRegistrations],
  )
  const rows = useMemo(
    () => buildAttendanceReport(filteredRegistrations, filteredRecords, grace)
      .filter((row) => registeredEmployeeKeys.has(`${row.userId}|${row.branchId}`)),
    [filteredRegistrations, filteredRecords, grace, registeredEmployeeKeys],
  )
  const detailRows = useMemo(
    () => buildAttendanceDetailRows(filteredRegistrations, filteredRecords, grace)
      .filter((row) => filteredRegistrations.some((registration) => registration.id === row.registrationId)),
    [filteredRegistrations, filteredRecords, grace],
  )

  function exportCsv() {
    const headers = [text.employee, text.branch, text.totalShifts, `${text.totalHours} (thập phân)`, `${text.overtimeHours} (thập phân)`, text.workDays, text.late, text.absent, text.missingCheckout]
    const csv = [
      headers,
      ...rows.map((row) => [row.employeeName, branchName(row.branchId), row.totalShifts, row.totalHours, row.overtimeHours, row.workDays, row.lateCount, row.absentCount, row.missingCheckoutCount]),
    ].map((line) => line.map(csvCell).join(',')).join('\n')
    download(new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' }), `bang-cong-${from}-${to}.csv`)
  }

  async function exportXlsx() {
    if (exporting) return
    if (!rows.length) {
      setExportError('Chưa có dữ liệu chấm công trong bộ lọc hiện tại để xuất Excel.')
      return
    }
    setExporting(true)
    setExportError('')
    try {
      await exportXlsxInner()
    } catch (error) {
      setExportError(error instanceof Error ? `Không thể xuất Excel: ${error.message}` : 'Không thể xuất Excel.')
    } finally {
      setExporting(false)
    }
  }

  async function exportXlsxInner() {
    const ExcelJS = await import('exceljs')
    const workbook = new ExcelJS.Workbook()
    const positionByUser = new Map<string, string>()
    const positionByName = new Map<string, string>()
    employees.forEach((employee) => {
      const label = employeePositionLabel(employee)
      if (employee.id) positionByUser.set(employee.id, label)
      positionByName.set(`${employee.branchId}|${normalizeName(employee.name)}`, label)
    })
    const resolvePosition = (userId: string, branchId: string, name: string) =>
      positionByUser.get(userId) || positionByName.get(`${branchId}|${normalizeName(name)}`) || ''
    const sheet = workbook.addWorksheet(text.summarySheet)
    sheet.columns = [
      { header: text.employee, key: 'employeeName', width: 26 },
      { header: 'Vị trí', key: 'position', width: 16 },
      { header: text.branch, key: 'branch', width: 26 },
      { header: text.totalShifts, key: 'totalShifts', width: 12 },
      { header: `${text.totalHours} (thập phân)`, key: 'totalHours', width: 20 },
      { header: `${text.overtimeHours} (thập phân)`, key: 'overtimeHours', width: 23 },
      { header: text.workDays, key: 'workDays', width: 12 },
      { header: text.late, key: 'lateCount', width: 10 },
      { header: text.absent, key: 'absentCount', width: 11 },
      { header: text.missingCheckout, key: 'missingCheckoutCount', width: 16 },
    ]
    rows.forEach((row) => sheet.addRow({ ...row, position: resolvePosition(row.userId, row.branchId, row.employeeName), branch: branchName(row.branchId) }))
    sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } }
    sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F1F33' } }
    sheet.views = [{ state: 'frozen', ySplit: 1 }]
    styleAttendanceSheet(sheet)

    const exportBranchIds = Array.from(new Set([
      ...rows.map((row) => row.branchId),
      ...detailRows.map((row) => row.branchId),
    ])).sort((a, b) => branchName(a).localeCompare(branchName(b), 'vi'))
    const usedSheetNames = new Set(workbook.worksheets.map((item) => item.name))
    for (const id of exportBranchIds) {
      const branchSheet = workbook.addWorksheet(uniqueSheetName(branchName(id), usedSheetNames))
      branchSheet.columns = attendanceDetailColumns()
      for (const row of detailRows.filter((item) => item.branchId === id)) {
        await addAttendanceDetailRow(branchSheet, row, resolvePosition(row.userId, row.branchId, row.employeeName))
      }
      styleAttendanceSheet(branchSheet)
    }

    const buffer = await workbook.xlsx.writeBuffer()
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
    const fileName = `bang-cong-${from}-${to}.xlsx`
    if (/iPhone|iPad|iPod|Android/i.test(navigator.userAgent) && typeof navigator.share === 'function') {
      await shareOrDownloadBlob(blob, fileName, { title: `Bảng công ${from} - ${to}` })
    } else {
      download(blob, fileName)
    }
  }

  return (
    <>
      <section className="section-card attendance-filters">
        <div className="attendance-filter-grid">
          <label>{text.branch}<select value={branchId} onChange={(event) => setBranchId(event.target.value)}><option value="">{text.allBranches}</option>{branches.filter((item) => branchIds.includes(item.id)).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          <label>{text.employee}<select value={userId} onChange={(event) => setUserId(event.target.value)}><option value="">{text.allEmployees}</option>{employees.filter((item) => !branchId || item.branchId === branchId).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          <label>{text.from}<input type="date" value={from} onChange={(event) => onRangeChange({ from: event.target.value, to })} /></label>
          <label>{text.to}<input type="date" value={to} min={from} onChange={(event) => onRangeChange({ from, to: event.target.value })} /></label>
        </div>
        <div className="attendance-export-actions">
          <button type="button" className="secondary-button" onClick={exportCsv}>{text.exportCsv}</button>
          <button type="button" className="primary-button" disabled={exporting} onClick={() => void exportXlsx()}>{exporting ? 'Đang xuất…' : text.exportExcel}</button>
        </div>
        {exportError && <div className="feedback-bar">{exportError}<button onClick={() => setExportError('')}>×</button></div>}
      </section>
      <section className="section-card stock-section">
        <div className="section-title"><div><span className="eyebrow dark">{text.eyebrow}</span><h2>{text.title}</h2></div><span className="date-chip">{rows.length} {text.employees}</span></div>
        <div className="table-scroll">
          <table className="data-table attendance-data-table">
            <thead>
              <tr>
                <th>{text.employee}</th>
                <th>{text.branch}</th>
                <th>{text.totalShifts}</th>
                <th>{text.totalHours}</th>
                <th>{text.overtimeHours}</th>
                <th>{text.workDays}</th>
                <th>{text.late}</th>
                <th>{text.absent}</th>
                <th>{text.missingCheckout}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={`${row.userId}-${row.branchId}`}>
                  <td><strong>{row.employeeName}</strong></td>
                  <td>{branchName(row.branchId)}</td>
                  <td>{row.totalShifts}</td>
                  <td>{formatDecimalHoursAsDuration(row.totalHours)}</td>
                  <td>{formatDecimalHoursAsDuration(row.overtimeHours)}</td>
                  <td>{row.workDays}</td>
                  <td className={row.lateCount ? 'warn' : ''}>{row.lateCount}</td>
                  <td className={row.absentCount ? 'warn' : ''}>{row.absentCount}</td>
                  <td className={row.missingCheckoutCount ? 'warn' : ''}>{row.missingCheckoutCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!rows.length && <p className="empty-copy">{text.empty}</p>}
      </section>
    </>
  )
}

const ATTENDANCE_REPORT_TEXT = {
  vi: {
    eyebrow: 'BẢNG CHẤM CÔNG',
    title: 'Chấm công theo ngày, tháng',
    branch: 'Chi nhánh',
    allBranches: 'Tất cả chi nhánh',
    employee: 'Nhân viên',
    employees: 'nhân viên',
    allEmployees: 'Tất cả nhân viên',
    from: 'Từ ngày',
    to: 'Đến ngày',
    exportCsv: 'Xuất CSV',
    exportExcel: 'Xuất Excel',
    summarySheet: 'Tổng hợp',
    totalShifts: 'Tổng ca',
    totalHours: 'Tổng giờ',
    overtimeHours: 'Giờ tăng ca',
    workDays: 'Ngày công',
    late: 'Đi trễ',
    absent: 'Vắng',
    missingCheckout: 'Quên check-out',
    empty: 'Không có dữ liệu trong khoảng thời gian đã chọn.',
  },
  en: {
    eyebrow: 'TIMESHEET',
    title: 'Attendance by day and month',
    branch: 'Branch',
    allBranches: 'All branches',
    employee: 'Employee',
    employees: 'employees',
    allEmployees: 'All employees',
    from: 'From',
    to: 'To',
    exportCsv: 'Export CSV',
    exportExcel: 'Export Excel',
    summarySheet: 'Summary',
    totalShifts: 'Shifts',
    totalHours: 'Hours',
    overtimeHours: 'Overtime hours',
    workDays: 'Work days',
    late: 'Late',
    absent: 'Absent',
    missingCheckout: 'Missed checkout',
    empty: 'No data in the selected range.',
  },
} as const

function branchName(id: string) { return configuredBranchName(id) || id }
function roleLabel(role: AppUser['role']) { return accessRoleLabel(role) }
function statusLabel(status: ShiftRegistration['status']) { return status === 'rejected' ? 'Không hiệu lực' : 'Đã đăng ký' }
function busyLabel(phase: 'locating' | 'saving' | '') { return phase === 'saving' ? 'Đang lưu ảnh…' : 'Đang định vị chính xác…' }

function normalizeName(value: string) { return value.trim().toLocaleLowerCase('vi').normalize('NFD').replace(/\p{Diacritic}/gu, '') }
function formatDate(date: string) { return new Date(`${date}T00:00:00`).toLocaleDateString('vi-VN') }
function formatTime(date: string) { return new Date(date).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }) }
function formatDateTime(date: string) { return new Date(date).toLocaleString('vi-VN', { hour12: false }) }
function attendanceDetailStatus(status: 'completed' | 'working' | 'absent' | 'scheduled') {
  return ({ completed: 'Đã hoàn thành', working: 'Đang làm', absent: 'Vắng', scheduled: 'Chưa tới ca' })[status]
}
function styleAttendanceSheet(sheet: import('exceljs').Worksheet) {
  sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } }
  sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F1F33' } }
  sheet.views = [{ state: 'frozen', ySplit: 1 }]
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: sheet.columnCount } }
}
function attendanceDetailColumns() {
  return [
    { header: 'Ngày làm', key: 'workDate', width: 13 },
    { header: 'Nhân viên', key: 'employeeName', width: 26 },
    { header: 'Vị trí', key: 'position', width: 16 },
    { header: 'Chi nhánh', key: 'branch', width: 24 },
    { header: 'Ca dự kiến', key: 'scheduled', width: 17 },
    { header: 'Giờ vào', key: 'checkIn', width: 20 },
    { header: 'Giờ ra', key: 'checkOut', width: 20 },
    { header: 'Giờ thực tế (thập phân)', key: 'totalHours', width: 22 },
    { header: 'Giờ tăng ca (thập phân)', key: 'overtimeHours', width: 22 },
    { header: 'Loại ca', key: 'shiftType', width: 14 },
    { header: 'Ngày công', key: 'workDayCredit', width: 12 },
    { header: 'Đi trễ (phút)', key: 'lateMinutes', width: 14 },
    { header: 'Trạng thái', key: 'status', width: 16 },
    { header: 'Địa chỉ check-in', key: 'address', width: 50 },
    { header: 'Địa chỉ check-out', key: 'checkOutAddress', width: 50 },
    { header: 'Ảnh check-in', key: 'checkInSelfieUrl', width: 18 },
    { header: 'Ảnh check-out', key: 'checkOutSelfieUrl', width: 18 },
    { header: 'Ghi chú', key: 'note', width: 30 },
  ]
}
async function addAttendanceDetailRow(sheet: import('exceljs').Worksheet, row: ReturnType<typeof buildAttendanceDetailRows>[number], position = '') {
  const [evidenceUrl, checkOutEvidenceUrl] = await Promise.all([
    selfieEvidenceUrl(row.selfieUrl),
    selfieEvidenceUrl(row.checkOutSelfieUrl),
  ])
  sheet.addRow({
    workDate: formatDate(row.workDate),
    employeeName: row.employeeName,
    position,
    branch: branchName(row.branchId),
    scheduled: `${row.scheduledStart}-${row.scheduledEnd}`,
    checkIn: row.checkInTime ? formatDateTime(row.checkInTime) : '',
    checkOut: row.checkOutTime ? formatDateTime(row.checkOutTime) : '',
    totalHours: row.totalHours,
    overtimeHours: row.isOvertime ? row.totalHours : 0,
    shiftType: row.isOvertime ? 'Tăng ca' : 'Ca thường',
    workDayCredit: row.workDayCredit,
    lateMinutes: row.lateMinutes,
    status: attendanceDetailStatus(row.status),
    address: row.checkInAddress || '',
    checkOutAddress: row.checkOutAddress || '',
    checkInSelfieUrl: evidenceUrl ? { text: 'Check-in', hyperlink: evidenceUrl } : '',
    checkOutSelfieUrl: checkOutEvidenceUrl ? { text: 'Check-out', hyperlink: checkOutEvidenceUrl } : '',
    note: row.note,
  })
}
const attendanceEvidenceUrlCache = new Map<string, Promise<string>>()

async function selfieEvidenceUrl(value?: string) {
  if (!value) return ''
  const cached = attendanceEvidenceUrlCache.get(value)
  if (cached) return cached
  const pending = resolveSelfieEvidenceUrl(value).catch(() => {
    attendanceEvidenceUrlCache.delete(value)
    return ''
  })
  attendanceEvidenceUrlCache.set(value, pending)
  return pending
}

async function resolveSelfieEvidenceUrl(value: string) {
  const path = normalizeAttendanceSelfiePath(value)
  if (/^https?:\/\//i.test(value) && !path) return value
  if (value.startsWith('/')) return `${window.location.origin}${value}`
  if (!supabase) return value
  const storagePath = path || value.replace(/^attendance-selfies\//, '')
  const signed = await supabase.storage.from('attendance-selfies').createSignedUrl(storagePath, 60 * 60 * 24 * 30)
  return signed.data?.signedUrl || supabase.storage.from('attendance-selfies').getPublicUrl(storagePath).data.publicUrl || value
}
function safeSheetName(value: string) {
  return value.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31).trim() || 'Chi nhánh'
}
function uniqueSheetName(value: string, used: Set<string>) {
  const base = safeSheetName(value)
  let name = base
  let index = 2
  while (used.has(name)) {
    const suffix = ` ${index}`
    name = `${base.slice(0, Math.max(1, 31 - suffix.length)).trim()}${suffix}`
    index += 1
  }
  used.add(name)
  return name
}
function normalizeAttendanceSelfiePath(value: string) {
  try {
    const rawPath = /^https?:\/\//i.test(value) ? decodeURIComponent(new URL(value).pathname) : value
    const marker = '/attendance-selfies/'
    const index = rawPath.indexOf(marker)
    if (index >= 0) return rawPath.slice(index + marker.length)
    if (rawPath.startsWith('attendance-selfies/')) return rawPath.slice('attendance-selfies/'.length)
  } catch {
    // Keep original value when it is not a parseable URL.
  }
  return ''
}
function attendanceMonthRange(date = new Date()) {
  const [year, month] = localDateKey(date).split('-').map(Number)
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate()
  const monthKey = String(month).padStart(2, '0')
  return {
    from: `${year}-${monthKey}-01`,
    to: `${year}-${monthKey}-${String(lastDay).padStart(2, '0')}`,
  }
}
function getCheckInWindow(registration: ShiftRegistration) {
  const startsAt = new Date(`${registration.workDate}T${registration.startTime}:00${VN_UTC_OFFSET}`)
  let closesAt = new Date(`${registration.workDate}T${registration.endTime}:00${VN_UTC_OFFSET}`)
  if (registration.endTime <= registration.startTime) closesAt = new Date(closesAt.getTime() + 24 * 60 * 60 * 1000)
  return {
    startsAt,
    opensAt: new Date(startsAt.getTime() - 30 * 60000),
    closesAt,
    // Không cho check-out sớm hơn 30 phút trước giờ ra
    checkOutOpensAt: new Date(closesAt.getTime() - 30 * 60000),
  }
}
function checkInHint(
  registration: ShiftRegistration,
  window: ReturnType<typeof getCheckInWindow>,
  now: Date,
) {
  if (registration.workDate !== localDateKey(now)) return 'Check-in vào đúng ngày đã đăng ký.'
  if (now < window.opensAt) {
    return `Mở check-in lúc ${window.opensAt.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}.`
  }
  if (now > window.closesAt) return 'Đã quá thời gian của ca này.'
  return 'Đang chuẩn bị mở chấm công.'
}
function weekStartKey(date = new Date()) {
  const dateKey = localDateKey(date)
  const day = localDateKeyWeekday(dateKey)
  return addLocalDateKeyDays(dateKey, -(day === 0 ? 6 : day - 1))
}
function registrationWeekStartKey(date = new Date()) {
  const dateKey = localDateKey(date)
  const day = localDateKeyWeekday(dateKey)
  const offset = day === 0 ? 1 : -(day - 1)
  return addLocalDateKeyDays(dateKey, offset)
}
function csvCell(value: string | number) { return `"${String(value).replace(/"/g, '""')}"` }
function download(blob: Blob, name: string) {
  downloadBlob(blob, name)
}
