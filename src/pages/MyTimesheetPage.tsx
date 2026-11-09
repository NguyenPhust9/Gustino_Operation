import { useCallback, useEffect, useMemo, useState } from 'react'
import type { AppUser, WorkShift } from '../types'
import { localDateKey } from '../lib/dates'
import { calculatePersonalKpiReward, type PersonalKpiRewardSummary } from '../lib/commission'
import { fetchSalesReceiptsRange } from '../lib/salesReceipts'
import { fetchBagAllocations } from '../lib/shiftLedger'
import {
  buildAttendanceDetailRows,
  fetchAttendanceRecords,
  fetchShiftRegistrations,
  fetchWorkShifts,
  permittedBranchIds,
  withAttendanceReadDeadline,
  type AttendanceDetailRow,
} from '../lib/attendance'

// Trang Xem công (#my-timesheet): nhân viên xem tháng này mình làm những ngày nào,
// mỗi ngày mấy giờ — dạng lịch tháng bấm từng ngày, ưu tiên màn hình điện thoại.
// Chỉ đọc dữ liệu của CHÍNH MÌNH; Thưởng KPI là đúng cột thưởng ngày/tuần của bảng Thi đua.

interface Props {
  user: AppUser
}

const WEEKDAY_LABELS = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN']
const EMPTY_KPI_REWARD: PersonalKpiRewardSummary = { revenue: 0, dailyBonus: 0, weeklyBonus: 0, reward: 0, achievedDays: 0 }

const DAY_STATUS_LABELS: Record<AttendanceDetailRow['status'], string> = {
  completed: 'Đã hoàn thành',
  working: 'Đang làm',
  absent: 'Vắng',
  scheduled: 'Chưa tới ca',
}

function monthBounds(month: string) {
  const [year, monthNumber] = month.split('-').map(Number)
  const lastDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate()
  return { from: `${month}-01`, to: `${month}-${String(lastDay).padStart(2, '0')}`, lastDay }
}

function shiftMonth(month: string, amount: number) {
  const [year, monthNumber] = month.split('-').map(Number)
  const shifted = new Date(Date.UTC(year, monthNumber - 1 + amount, 1))
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, '0')}`
}

/** 7.5 → "7g30". Giờ lẻ làm tròn theo phút để nhân viên đọc là hiểu ngay. */
function formatHours(value: number) {
  const totalMinutes = Math.round(value * 60)
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  if (!hours && !minutes) return '0g'
  if (!minutes) return `${hours}g`
  return `${hours}g${String(minutes).padStart(2, '0')}`
}

/**
 * Giờ nghiệp vụ luôn neo Asia/Ho_Chi_Minh (quy tắc §45). Máy đặt sai múi giờ mà
 * hiển thị theo giờ thiết bị thì bảng công lệch giờ so với ảnh đóng dấu.
 */
function formatClock(value?: string) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleTimeString('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
}

function formatWorkDate(value: string) {
  const [year, month, day] = value.split('-')
  return `${day}/${month}/${year}`
}

export function MyTimesheetPage({ user }: Props) {
  const todayKey = localDateKey()
  const [month, setMonth] = useState(() => todayKey.slice(0, 7))
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [rows, setRows] = useState<AttendanceDetailRow[]>([])
  const [kpiReward, setKpiReward] = useState<PersonalKpiRewardSummary>(EMPTY_KPI_REWARD)
  const [selectedDate, setSelectedDate] = useState(todayKey)
  const [showLateDetails, setShowLateDetails] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const { from, to } = monthBounds(month)
      // Mọi lệnh đọc phải có hạn chót cứng: supabase-js không tự timeout, một
      // request treo sẽ giữ màn hình ở "Đang tải…" vĩnh viễn (BUG-106/§36).
      const canEarnKpi = user.role === 'staff' || user.role === 'shift_leader' || Boolean(user.canRoamBranches)
      const kpiBranchIds = user.canRoamBranches ? permittedBranchIds(user) : [user.branchId]
      const [workShifts, registrations, records, rewardSources] = await Promise.all([
        withAttendanceReadDeadline(() => fetchWorkShifts(user), 'khung ca').catch(() => [] as WorkShift[]),
        withAttendanceReadDeadline(() => fetchShiftRegistrations(user, { userId: user.id, from, to }), 'ca đã đăng ký'),
        withAttendanceReadDeadline(() => fetchAttendanceRecords(user, { userId: user.id, from, to }), 'công đã chấm'),
        canEarnKpi
          ? Promise.all([
              withAttendanceReadDeadline(() => fetchBagAllocations(user, user.canRoamBranches ? {} : { branchId: user.branchId }), 'doanh thu phát túi'),
              withAttendanceReadDeadline(() => fetchSalesReceiptsRange(user, { branchIds: kpiBranchIds, from, to }), 'doanh thu POS'),
            ])
          : Promise.resolve(null),
      ])
      const grace = new Map(workShifts.map((shift) => [shift.id, shift.graceMinutes]))
      setRows(buildAttendanceDetailRows(registrations, records, grace)
        .filter((row) => row.userId === user.id))
      setKpiReward(rewardSources
        ? calculatePersonalKpiReward(user, rewardSources[0], rewardSources[1], from, to)
        : EMPTY_KPI_REWARD)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Không thể tải dữ liệu công.')
    } finally {
      setLoading(false)
    }
  }, [user, month])

  useEffect(() => { void load() }, [load])

  // Mở lại app / quay về tab là tải lại — cùng quy tắc với các màn nghiệp vụ khác.
  useEffect(() => {
    const reload = () => { void load() }
    const reloadWhenVisible = () => { if (document.visibilityState === 'visible') reload() }
    window.addEventListener('focus', reload)
    window.addEventListener('online', reload)
    document.addEventListener('visibilitychange', reloadWhenVisible)
    return () => {
      window.removeEventListener('focus', reload)
      window.removeEventListener('online', reload)
      document.removeEventListener('visibilitychange', reloadWhenVisible)
    }
  }, [load])

  const rowsByDate = useMemo(() => {
    const map = new Map<string, AttendanceDetailRow[]>()
    rows.forEach((row) => {
      map.set(row.workDate, [...(map.get(row.workDate) || []), row])
    })
    map.forEach((dayRows) => dayRows.sort((a, b) => a.scheduledStart.localeCompare(b.scheduledStart)))
    return map
  }, [rows])

  const summary = useMemo(() => {
    let totalHours = 0
    let workDays = 0
    let shifts = 0
    let late = 0
    rows.forEach((row) => {
      totalHours += row.totalHours
      workDays += row.workDayCredit
      if (row.attendanceRecordId) shifts += 1
      if (row.attendanceRecordId && row.lateMinutes > 0) late += 1
    })
    return {
      totalHours,
      workDays: Number(workDays.toFixed(2)),
      shifts,
      late,
      daysWorked: Array.from(rowsByDate.entries())
        .filter(([, dayRows]) => dayRows.some((row) => row.attendanceRecordId)).length,
    }
  }, [rows, rowsByDate])

  const lateRows = useMemo(() => rows
    .filter((row) => Boolean(row.attendanceRecordId) && row.lateMinutes > 0)
    .sort((a, b) => a.workDate.localeCompare(b.workDate) || a.scheduledStart.localeCompare(b.scheduledStart)), [rows])

  const { lastDay } = monthBounds(month)
  const [yearNumber, monthNumber] = month.split('-').map(Number)
  // Lịch bắt đầu Thứ Hai: getUTCDay() trả 0=CN nên dồn CN về cuối hàng.
  const leadingBlanks = (new Date(Date.UTC(yearNumber, monthNumber - 1, 1)).getUTCDay() + 6) % 7
  const dayCells = Array.from({ length: lastDay }, (_, index) => {
    const dateKey = `${month}-${String(index + 1).padStart(2, '0')}`
    const dayRows = rowsByDate.get(dateKey) || []
    const hours = dayRows.reduce((sum, row) => sum + row.totalHours, 0)
    const hasRecord = dayRows.some((row) => row.attendanceRecordId)
    const working = dayRows.some((row) => row.status === 'working')
    const absent = !hasRecord && dayRows.some((row) => row.status === 'absent')
    const scheduled = !hasRecord && !absent && dayRows.length > 0
    const tone = working ? 'working' : hasRecord ? 'worked' : absent ? 'absent' : scheduled ? 'scheduled' : 'empty'
    return { dateKey, day: index + 1, dayRows, hours, tone }
  })

  const selectedRows = rowsByDate.get(selectedDate) || []
  const selectedInMonth = selectedDate.startsWith(month)

  function changeMonth(amount: number) {
    const nextMonth = amount === 0 ? todayKey.slice(0, 7) : shiftMonth(month, amount)
    setMonth(nextMonth)
    setSelectedDate(nextMonth === todayKey.slice(0, 7) ? todayKey : `${nextMonth}-01`)
  }

  return (
    <div className="page tsheet-page">
      <header className="tsheet-head">
        <div>
          <span className="eyebrow dark">XEM CÔNG</span>
          <h1>Công của tôi · {monthNumber}/{yearNumber}</h1>
          <p>Bấm vào từng ngày để xem giờ vào, giờ ra và tổng giờ làm của ngày đó.</p>
        </div>
        <div className="tsheet-month-nav" aria-label="Chọn tháng">
          <button type="button" onClick={() => changeMonth(-1)} aria-label="Tháng trước">‹</button>
          <button type="button" className={month === todayKey.slice(0, 7) ? 'active' : ''} onClick={() => changeMonth(0)}>Tháng này</button>
          <button type="button" onClick={() => changeMonth(1)} aria-label="Tháng sau">›</button>
        </div>
      </header>

      {error && <div className="feedback-bar">{error}<button onClick={() => { setError(''); void load() }}>Thử lại</button></div>}

      <div className="tsheet-summary">
        <article><small>Tổng giờ</small><strong>{formatHours(summary.totalHours)}</strong></article>
        <article><small>Ngày có làm</small><strong>{summary.daysWorked}</strong></article>
        <article><small>Ngày công</small><strong>{summary.workDays}</strong></article>
        <article><small>Số ca</small><strong>{summary.shifts}</strong></article>
        {(user.role === 'staff' || user.role === 'shift_leader') && (
          <article className={kpiReward.reward > 0 ? 'earned' : ''}>
            <small>Thưởng KPI</small>
            <strong>{formatMoney(kpiReward.reward)}</strong>
            <span>Thưởng ngày/tuần đã đạt</span>
          </article>
        )}
        <button
          type="button"
          className={summary.late ? 'tsheet-summary-late warn' : 'tsheet-summary-late'}
          disabled={!summary.late}
          aria-expanded={showLateDetails}
          aria-controls="tsheet-late-details"
          onClick={() => setShowLateDetails((visible) => !visible)}
        >
          <small>Đi trễ</small>
          <strong>{summary.late}</strong>
          <span>{summary.late ? 'Bấm xem chi tiết' : 'Không có lượt trễ'}</span>
        </button>
      </div>

      {showLateDetails && summary.late > 0 && (
        <section id="tsheet-late-details" className="tsheet-late-details" aria-label="Chi tiết các lượt đi trễ">
          <header>
            <div><strong>Chi tiết đi trễ</strong><small>{lateRows.length} lượt trong tháng {monthNumber}/{yearNumber}</small></div>
            <button type="button" onClick={() => setShowLateDetails(false)} aria-label="Đóng chi tiết đi trễ">×</button>
          </header>
          <div className="tsheet-late-list">
            {lateRows.map((row) => (
              <article key={`late-${row.registrationId}-${row.attendanceRecordId}`}>
                <div>
                  <strong>{formatWorkDate(row.workDate)}</strong>
                  <small>Ca {row.scheduledStart}–{row.scheduledEnd}</small>
                </div>
                <div>
                  <span>Check-in <b>{formatClock(row.checkInTime)}</b></span>
                  <strong>Trễ {row.lateMinutes} phút</strong>
                </div>
              </article>
            ))}
          </div>
        </section>
      )}

      {loading ? (
        <p className="tsheet-loading">Đang tải công tháng {monthNumber}/{yearNumber}…</p>
      ) : (
        <section className="tsheet-calendar" aria-label={`Lịch công tháng ${monthNumber}/${yearNumber}`}>
          <div className="tsheet-weekdays">
            {WEEKDAY_LABELS.map((label) => <span key={label}>{label}</span>)}
          </div>
          <div className="tsheet-grid">
            {Array.from({ length: leadingBlanks }, (_, index) => <span key={`blank-${index}`} className="tsheet-blank" />)}
            {dayCells.map((cell) => (
              <button
                type="button"
                key={cell.dateKey}
                className={[
                  'tsheet-day',
                  `tone-${cell.tone}`,
                  cell.dateKey === selectedDate ? 'selected' : '',
                  cell.dateKey === todayKey ? 'today' : '',
                ].filter(Boolean).join(' ')}
                onClick={() => setSelectedDate(cell.dateKey)}
                aria-pressed={cell.dateKey === selectedDate}
              >
                <b>{cell.day}</b>
                {cell.tone === 'worked' && <small>{formatHours(cell.hours)}</small>}
                {cell.tone === 'working' && <small>đang làm</small>}
                {cell.tone === 'scheduled' && <small>có lịch</small>}
                {cell.tone === 'absent' && <small>vắng</small>}
              </button>
            ))}
          </div>
          <div className="tsheet-legend">
            <span className="tone-worked">Đã làm (kèm số giờ)</span>
            <span className="tone-working">Đang trong ca</span>
            <span className="tone-scheduled">Có lịch</span>
            <span className="tone-absent">Vắng</span>
          </div>
        </section>
      )}

      {!loading && (
        <section className="tsheet-detail" aria-label="Chi tiết ngày đã chọn">
          <h2>
            {selectedInMonth
              ? `Ngày ${selectedDate.slice(8)}/${selectedDate.slice(5, 7)}`
              : 'Chọn một ngày trên lịch'}
          </h2>
          {selectedInMonth && !selectedRows.length && <p className="empty-copy">Ngày này không có ca đăng ký hoặc chấm công.</p>}
          {selectedInMonth && selectedRows.map((row) => (
            <article key={`${row.registrationId}-${row.attendanceRecordId || 'scheduled'}`} className={`tsheet-shift status-${row.status}`}>
              <header>
                <strong>Ca {row.scheduledStart}–{row.scheduledEnd}</strong>
                <span className={`tsheet-status status-${row.status}`}>{DAY_STATUS_LABELS[row.status]}</span>
              </header>
              <div className="tsheet-shift-times">
                <span><small>Vào</small><b>{formatClock(row.checkInTime)}</b></span>
                <span><small>Ra</small><b>{formatClock(row.checkOutTime)}</b></span>
                <span><small>Tổng giờ</small><b>{row.totalHours > 0 ? formatHours(row.totalHours) : '—'}</b></span>
              </div>
              {row.lateMinutes > 0 && <p className="tsheet-late">Đi trễ {row.lateMinutes} phút so với giờ vào ca.</p>}
              {row.note && <p className="tsheet-note">{row.note}</p>}
            </article>
          ))}
        </section>
      )}
    </div>
  )
}

function formatMoney(value: number) {
  return `${Math.round(value).toLocaleString('vi-VN')}đ`
}
