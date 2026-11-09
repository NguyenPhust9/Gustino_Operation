import { useEffect, useState, type ReactNode } from 'react'
import { useRef } from 'react'
import { canOpenAdminConsole, canUseAdmin, canUseKitchen, canUseManagement, canUseOperations, canUseSales, displayUserName, roleLabel } from '../lib/access'
import { toggleLang, useLang } from '../lib/i18n'
import { heartbeatActiveUser } from '../lib/activeUsers'
import {
  fetchAttendanceRecords,
  fetchOwnOpenAttendanceRecords,
  fetchShiftRegistrations,
  findAttendanceRecordForRegistration,
  isCheckInDue,
  isCheckOutDue,
  switchActiveBranch,
  withAttendanceReadDeadline,
} from '../lib/attendance'
import { branchName, useConfiguredBranches } from '../lib/branches'
import { addLocalDateKeyDays, localDateKey } from '../lib/dates'
import { burstGuard } from '../lib/browser'
import { shouldUseLanApi, supabase, uniqueChannelName } from '../lib/supabase'
import { ATTENDANCE_OUTBOX_EVENT, inspectAttendanceOutbox } from '../lib/attendanceOutbox'
import { pendingHandoverReportForToday, REPORT_PENDING_EVENT, type HandoverReportRequest } from '../lib/handoverReportRequest'
import { canReceivePayslip, fetchOwnPublishedPayslips, PAYSLIP_VIEWED_EVENT, type PayrollEntry } from '../lib/payroll'
import type { AppUser } from '../types'
import { AppFooter } from './AppFooter'

export type Page =
  | 'launcher'
  | 'dashboard'
  | 'today'
  | 'sales'
  | 'my-records'
  | 'my-timesheet'
  | 'my-payslips'
  | 'messages'
  | 'report-archive'
  | 'restaurant'
  | 'report'
  | 'inventory'
  | 'handover'
  | 'orders'
  | 'attendance'
  | 'management'
  | 'manager-revenue'
  | 'manager-business'
  | 'manager-inventory'
  | 'manager-attendance'
  | 'manager-payroll'
  | 'manager-requests'
  | 'admin-accounts'
  | 'control'
  | 'gustino-analyst'
  | 'kitchen'

export type InventoryTab = 'overview' | 'inbound' | 'processing_out' | 'count'

interface Props {
  user: AppUser
  page: Page
  currentSection?: string
  onNavigate: (page: Page, section?: string) => void
  onLogout: () => void
  children: ReactNode
}

interface NavItem {
  id: Page
  label: string
  shortLabel?: string
  icon: ReactNode
  section?: string
  canShow: (user: AppUser) => boolean
}

const ADMIN_NAV: NavItem[] = [
  { id: 'management', section: 'overview', label: 'Tổng quan', icon: <IconDashboard />, canShow: () => true },
  { id: 'gustino-analyst', label: 'Gustino Analyst', icon: <IconChart />, canShow: (user) => user.role === 'admin' },
  { id: 'management', section: 'revenue', label: 'Doanh thu', icon: <IconChart />, canShow: () => true },
  // Admin không đặt hàng — chỉ theo dõi/lọc/xuất đơn của các chi nhánh ở mục Đặt hàng
  // trong trang Quản trị, nên mục này trỏ vào đó thay vì trang đặt hàng của chi nhánh.
  { id: 'management', section: 'requests', label: 'Đơn hàng', icon: <IconClipboard />, canShow: () => true },
  { id: 'management', section: 'inventory', label: 'Kho hàng', icon: <IconBox />, canShow: () => true },
  { id: 'management', section: 'accounts', label: 'Nhân sự', icon: <IconUsers />, canShow: (user) => canUseAdmin(user.role) },
  { id: 'management', section: 'attendance', label: 'Chấm công', icon: <IconClock />, canShow: (user) => canUseAdmin(user.role) },
  { id: 'attendance', label: 'Lịch đăng ký ca', icon: <IconClock />, canShow: (user) => canUseAdmin(user.role) },
  { id: 'management', section: 'commission', label: 'Thi đua nhân viên', icon: <IconChart />, canShow: (user) => canUseAdmin(user.role) },
  { id: 'report-archive', label: 'Báo cáo', icon: <IconReport />, canShow: (user) => canUseAdmin(user.role) },
  { id: 'manager-payroll', label: 'Phiếu lương', icon: <IconPayroll />, canShow: (user) => canUseAdmin(user.role) },
  { id: 'messages', label: 'Tin nhắn', icon: <IconClipboard />, canShow: () => true },
  { id: 'control', label: 'Cài đặt', icon: <IconSettings />, canShow: (user) => canUseAdmin(user.role) },
]

// SUP MT (giám sát thị trường) đi cùng bộ mục với admin để đối chiếu số liệu toàn
// hệ thống, chỉ khác là mọi thao tác ghi bị khóa trong ManagementPage. Hai mục cuối
// là việc của chính họ: chấm công và xem bảng công cá nhân.
const SUPMT_NAV: NavItem[] = [
  { id: 'management', section: 'revenue', label: 'Doanh thu', icon: <IconChart />, canShow: () => true },
  { id: 'management', section: 'overview', label: 'Tổng quan', icon: <IconDashboard />, canShow: () => true },
  { id: 'management', section: 'attendance', label: 'Chấm công NV', shortLabel: 'Công NV', icon: <IconClock />, canShow: () => true },
  { id: 'management', section: 'commission', label: 'Thi đua nhân viên', shortLabel: 'Thi đua', icon: <IconChart />, canShow: () => true },
  { id: 'management', section: 'inventory', label: 'Kho hàng', icon: <IconBox />, canShow: () => true },
  { id: 'management', section: 'requests', label: 'Đơn hàng', icon: <IconClipboard />, canShow: () => true },
  { id: 'management', section: 'accounts', label: 'Nhân sự', icon: <IconUsers />, canShow: () => true },
  { id: 'attendance', label: 'Chấm công của tôi', shortLabel: 'Chấm công', icon: <IconUsers />, canShow: () => true },
  { id: 'my-timesheet', label: 'Xem công', shortLabel: 'Công', icon: <IconClock />, canShow: () => true },
]

const MANAGER_NAV: NavItem[] = [
  { id: 'dashboard', label: 'Doanh thu', icon: <IconDashboard />, canShow: () => true },
  { id: 'manager-business', label: 'Kinh doanh', icon: <IconChart />, canShow: () => true },
  { id: 'manager-inventory', label: 'Kho', icon: <IconBox />, canShow: () => true },
  { id: 'report-archive', label: 'Báo cáo ngày', icon: <IconReport />, canShow: (user) => canUseManagement(user.role) },
]

const NAV_ITEMS: NavItem[] = [
  {
    id: 'management',
    label: 'Tổng hợp',
    icon: <IconChart />,
    canShow: (user) => canUseManagement(user.role),
  },
  {
    id: 'today',
    label: 'Hôm nay',
    icon: <IconCalendar />,
    canShow: (user) => canUseOperations(user.role) || Boolean(user.canRoamBranches),
  },
  {
    id: 'sales',
    label: 'Bán hàng',
    icon: <IconShoppingBag />,
    canShow: (user) => canUseSales(user.role) || Boolean(user.canRoamBranches),
  },
  {
    id: 'my-records',
    label: 'Lịch sử & báo cáo',
    shortLabel: 'Lịch sử',
    icon: <IconHistory />,
    canShow: (user) => user.role === 'staff' || user.role === 'shift_leader' || Boolean(user.canRoamBranches),
  },
  {
    id: 'my-timesheet',
    label: 'Xem công',
    shortLabel: 'Công',
    icon: <IconClock />,
    canShow: (user) => user.role === 'staff' || user.role === 'shift_leader' || user.role === 'supmt' || Boolean(user.canRoamBranches),
  },
  {
    id: 'handover',
    label: 'Bàn giao ca',
    icon: <IconHandover />,
    canShow: (user) => canUseOperations(user.role) || Boolean(user.canRoamBranches),
  },
  {
    id: 'inventory',
    label: 'Kho hàng',
    icon: <IconBox />,
    canShow: (user) => canUseOperations(user.role) || Boolean(user.canRoamBranches),
  },
  {
    id: 'orders',
    label: 'Đặt hàng',
    icon: <IconClipboard />,
    canShow: (user) => canUseOperations(user.role) || Boolean(user.canRoamBranches),
  },
  {
    id: 'attendance',
    label: 'Chấm công',
    icon: <IconUsers />,
    canShow: (user) => (user.role !== 'kitchen' && user.role !== 'cashier') || Boolean(user.canRoamBranches),
  },
  {
    id: 'my-payslips',
    label: 'Lương',
    shortLabel: 'Lương',
    icon: <IconPayroll />,
    canShow: (user) => canReceivePayslip(user.role),
  },
  {
    id: 'kitchen',
    label: 'Đặt bếp',
    icon: <IconKitchen />,
    canShow: (user) => canUseKitchen(user.role),
  },
]

const OPERATION_GUIDE_ITEMS: Array<{
  id: Page
  label: string
  shortLabel: string
  icon: string
  canShow: (user: AppUser) => boolean
}> = [
  { id: 'today', label: 'Hôm nay', shortLabel: 'Tổng quan', icon: '1', canShow: (user) => canUseOperations(user.role) },
  { id: 'inventory', label: 'Kho & rang', shortLabel: 'Kho', icon: '2', canShow: (user) => canUseOperations(user.role) },
  { id: 'sales', label: 'Bán hàng', shortLabel: 'Bán', icon: '3', canShow: (user) => canUseOperations(user.role) || canUseSales(user.role) },
  { id: 'handover', label: 'Bàn giao ca', shortLabel: 'Bàn giao', icon: '4', canShow: (user) => canUseOperations(user.role) },
]

const OPERATION_GUIDE_PAGES: Page[] = ['today', 'inventory', 'sales', 'handover']

const EN_NAV_LABELS: Partial<Record<Page, { label: string; shortLabel?: string }>> = {
  dashboard: { label: 'Revenue' },
  'manager-revenue': { label: 'Business' },
  'manager-business': { label: 'Business' },
  'manager-inventory': { label: 'Inventory' },
  attendance: { label: 'Schedule', shortLabel: 'Schedule' },
  'manager-attendance': { label: 'Timesheets', shortLabel: 'Time' },
  'manager-payroll': { label: 'Payslips', shortLabel: 'Payslips' },
  'report-archive': { label: 'Report archive', shortLabel: 'Reports' },
  'manager-requests': { label: 'Orders', shortLabel: 'Orders' },
  'admin-accounts': { label: 'People', shortLabel: 'People' },
  control: { label: 'System Admin', shortLabel: 'Admin' },
  management: { label: 'Overview' },
  'gustino-analyst': { label: 'Gustino Analyst' },
  today: { label: 'Today' },
  sales: { label: 'Sales' },
  'my-records': { label: 'History & reports', shortLabel: 'History' },
  'my-timesheet': { label: 'My timesheet', shortLabel: 'Timesheet' },
  'my-payslips': { label: 'My payslips', shortLabel: 'Payslips' },
  messages: { label: 'Messages', shortLabel: 'Messages' },
  handover: { label: 'Shift handover', shortLabel: 'Handover' },
  inventory: { label: 'Inventory' },
  report: { label: 'Close shift' },
  orders: { label: 'Orders' },
  kitchen: { label: 'Kitchen' },
}

export function AppShell({ user, page, currentSection, onNavigate, onLogout, children }: Props) {
  const lang = useLang()
  const [menuOpen, setMenuOpen] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [sundayReminderDismissed, setSundayReminderDismissed] = useState(false)
  const [attendanceReminderDismissed, setAttendanceReminderDismissed] = useState(false)
  const [attendanceReminder, setAttendanceReminder] = useState<'check-in' | 'check-out' | null>(null)
  const [attendanceReminderDay, setAttendanceReminderDay] = useState('')
  const attendanceReminderRequestRef = useRef(0)
  const [reportPending, setReportPending] = useState<HandoverReportRequest | null>(null)
  const [reportReminderDismissed, setReportReminderDismissed] = useState(false)
  const [payslipNotifications, setPayslipNotifications] = useState<PayrollEntry[]>([])
  const [payslipNotificationOpen, setPayslipNotificationOpen] = useState(false)
  const [switchingBranch, setSwitchingBranch] = useState(false)
  const configuredBranches = useConfiguredBranches({ user })
  const roamingBranches = configuredBranches.filter((branch) => branch.id !== 'central-kitchen')
  const canSwitchBranch = Boolean(user.canRoamBranches) && roamingBranches.length > 0

  async function handleSwitchWorkingBranch(nextBranchId: string) {
    if (!nextBranchId || nextBranchId === user.branchId || switchingBranch) return
    setSwitchingBranch(true)
    try {
      await switchActiveBranch(user, nextBranchId)
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Không thể chuyển chi nhánh làm việc.')
    } finally {
      setSwitchingBranch(false)
    }
  }

  const baseNav = user.role === 'admin'
    ? ADMIN_NAV
    : user.role === 'supmt'
      ? SUPMT_NAV
      : (user.role === 'manager' && !user.canRoamBranches)
        ? MANAGER_NAV
        : NAV_ITEMS
  const visibleNav = baseNav.filter((item) => item.canShow(user)).map((item) => ({
    ...item,
    ...(lang === 'en' ? EN_NAV_LABELS[item.id] : null),
  }))
  const shownName = displayUserName(user)
  const initials = shownName.slice(0, 2).toUpperCase() || 'G'
  const isActive = (item: NavItem) => {
    if (item.id !== page) return false
    if (item.id === 'management' && canOpenAdminConsole(user.role)) {
      return item.section ? currentSection === item.section : !currentSection
    }
    return item.section ? (currentSection || 'revenue') === item.section : true
  }

  useEffect(() => {
    if (!canReceivePayslip(user.role)) {
      setPayslipNotifications([])
      return
    }
    let active = true
    let requestVersion = 0
    const refreshPayslips = () => {
      const version = ++requestVersion
      void fetchOwnPublishedPayslips(user).then((rows) => {
      if (active && version === requestVersion) setPayslipNotifications(rows)
    }).catch(() => undefined)
    }
    const onPayslipViewed = (event: Event) => {
      const detail = (event as CustomEvent<{ entryId: string; viewedAt: string }>).detail
      if (detail?.entryId) setPayslipNotifications((current) => current.map((entry) => entry.id === detail.entryId ? { ...entry, employeeViewedAt: detail.viewedAt } : entry))
      refreshPayslips()
    }
    refreshPayslips()
    const payslipTimer = window.setInterval(refreshPayslips, 30000)
    window.addEventListener(PAYSLIP_VIEWED_EVENT, onPayslipViewed)
    const client = user.authToken ? null : supabase
    const channel = client?.channel(uniqueChannelName(`payslip-notification:${user.id}`))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'payroll_entries', filter: `employee_id=eq.${user.id}` }, refreshPayslips)
      .subscribe()
    return () => {
      active = false
      window.clearInterval(payslipTimer)
      window.removeEventListener(PAYSLIP_VIEWED_EVENT, onPayslipViewed)
      if (client && channel) void client.removeChannel(channel)
    }
  }, [user.id, user.role, user.authToken])

  const unreadPayslips = payslipNotifications.filter((entry) => !entry.employeeViewedAt)
  const orderedPayslipNotifications = [...payslipNotifications].sort((left, right) => {
    const unreadPriority = Number(Boolean(left.employeeViewedAt)) - Number(Boolean(right.employeeViewedAt))
    if (unreadPriority) return unreadPriority
    return String(right.publishedAt || right.period).localeCompare(String(left.publishedAt || left.period))
  })
  const payslipNotification = (
    <div className="payslip-notification">
      <button type="button" className="payslip-notification-button" aria-label={`Thông báo phiếu lương${unreadPayslips.length ? `, ${unreadPayslips.length} chưa xem` : ''}`} aria-expanded={payslipNotificationOpen} onClick={(event) => { event.stopPropagation(); setPayslipNotificationOpen((open) => !open) }}>
        <IconBell />
        {unreadPayslips.length > 0 && <b>{unreadPayslips.length > 9 ? '9+' : unreadPayslips.length}</b>}
      </button>
      {payslipNotificationOpen && <div className="payslip-notification-menu" onClick={(event) => event.stopPropagation()}>
        <header><strong>Thông báo</strong><small>{unreadPayslips.length} chưa xem</small></header>
        {orderedPayslipNotifications.slice(0, 6).map((entry) => <button type="button" key={entry.id || entry.period} className={entry.employeeViewedAt ? 'viewed' : 'unread'} onClick={() => {
          try { sessionStorage.setItem('gustino:selected-payslip-period', entry.period) } catch { /* private mode */ }
          setPayslipNotificationOpen(false)
          onNavigate('my-payslips')
        }}>
          <span aria-hidden="true">▤</span><span><strong>Bạn đã nhận được phiếu lương</strong><small>Phiếu lương tháng {entry.period.slice(5)}/{entry.period.slice(0, 4)} · {entry.employeeViewedAt ? 'Đã xem' : 'Chưa xem'} · Bấm để mở</small></span>
        </button>)}
        {!orderedPayslipNotifications.length && <p>Chưa có thông báo phiếu lương.</p>}
      </div>}
    </div>
  )
  const messageShortcut = user.role !== 'admin' && <button type="button" className="payslip-notification-button message-header-button" aria-label={lang === 'en' ? 'Messages' : 'Tin nhắn'} title={lang === 'en' ? 'Messages' : 'Tin nhắn'} aria-pressed={page === 'messages'} onClick={(event) => {
    event.stopPropagation()
    setMenuOpen(false)
    setSidebarOpen(false)
    setPayslipNotificationOpen(false)
    onNavigate('messages')
  }}><IconMessage /></button>
  const activeLabel = page === 'messages' ? (lang === 'en' ? 'Messages' : 'Tin nhắn') : page === 'my-payslips' ? 'Phiếu lương của tôi' : visibleNav.find(isActive)?.label || 'GUSTINO'
  const navKey = (item: NavItem) => `${item.id}:${item.section || ''}`
  const operationGuide = OPERATION_GUIDE_ITEMS.filter((item) => item.canShow(user))
  const showOperationGuide = false
  const showSundayReminder = new Date().getDay() === 0
    && (user.role === 'staff' || user.role === 'shift_leader')
    && page !== 'attendance'
    && !sundayReminderDismissed
  const showAttendanceReminder = Boolean(attendanceReminder)
    && (user.role === 'staff' || user.role === 'shift_leader')
    && page !== 'attendance'
    && !attendanceReminderDismissed
  // Bàn giao ca xong mà chưa chốt/gửi báo cáo là chuyện hay quên nhất; nhắc ở MỌI
  // trang cho tới khi báo cáo được gửi (cờ localStorage do màn Báo cáo xoá khi xong).
  const showReportReminder = Boolean(reportPending)
    && user.role === 'shift_leader'
    && page !== 'report'
    && !reportReminderDismissed

  useEffect(() => {
    let active = true
    const beat = () => {
      if (!active) return
      void heartbeatActiveUser(user, page).catch(() => null)
    }
    beat()
    const timer = window.setInterval(beat, 30000)
    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [user.id, user.name, user.role, user.branchId, page])

  useEffect(() => {
    if (user.role !== 'staff' && user.role !== 'shift_leader') return
    if (page === 'attendance') {
      setAttendanceReminder(null)
      return
    }
    let active = true
    const refreshReminder = async () => {
      const requestId = ++attendanceReminderRequestRef.current
      const today = localDateKey()
      try {
        // Ngày phải tính LẠI mỗi lượt: máy để app qua đêm sẽ giữ mãi ngày hôm qua
        // và nhắc theo lịch cũ (BUG-113).
        const from = addLocalDateKeyDays(today, -1)
        const now = new Date()
        const [registrations, datedRecords, openRecords, outboxOps] = await Promise.all([
          withAttendanceReadDeadline(
            () => fetchShiftRegistrations(user, { userId: user.id, from, to: today }),
            'ca cần nhắc',
          ),
          withAttendanceReadDeadline(
            () => fetchAttendanceRecords(user, { userId: user.id, from, to: today }),
            'trạng thái chấm công cần nhắc',
          ),
          withAttendanceReadDeadline(
            () => fetchOwnOpenAttendanceRecords(user),
            'phiên chấm công đang mở',
          ),
          // BUG-131: máy IndexedDB lỗi vẫn phải được nhắc chấm công — dùng bản
          // đọc không-throw; op RAM đã biết vẫn được tính là "đang chờ".
          inspectAttendanceOutbox(user.id).then((snapshot) => snapshot.ops),
        ])
        if (!active || requestId !== attendanceReminderRequestRef.current) return
        const records = Array.from(new Map([...datedRecords, ...openRecords].map((record) => [record.id, record])).values())
        const own = registrations.filter((item) => item.userId === user.id && item.status !== 'rejected')
        const hasOwnOpenRecord = records.some((item) => item.userId === user.id && !item.checkOutTime)
        const hasPendingCheckIn = outboxOps.some((item) =>
          item.userId === user.id && item.kind === 'check-in' && item.deliveryState !== 'needs-review',
        )
        // Chỉ giục check-out khi ca SẮP/ĐÃ tan, không giục ngay sau lúc check-in.
        // Quá hạn tự check-out thì cũng thôi giục: lúc đó phải đi đường đơn chỉnh công.
        const openRecord = own.some((item) => {
          const record = findAttendanceRecordForRegistration(records, item)
          return Boolean(record && !record.checkOutTime) && isCheckOutDue(item, now)
        })
        const waitingCheckIn = !hasOwnOpenRecord && !hasPendingCheckIn && own.some((item) =>
          item.workDate === today
          && item.userId === user.id
          && item.status !== 'rejected'
          && !findAttendanceRecordForRegistration(records, item)
          && isCheckInDue(item, now),
        )
        setAttendanceReminderDay(today)
        setAttendanceReminder(openRecord ? 'check-out' : waitingCheckIn ? 'check-in' : null)
      } catch {
        // Không giữ popup cũ khi dữ liệu không còn đáng tin: đặc biệt qua nửa đêm,
        // một nhắc Check-in cũ nguy hiểm hơn việc tạm thời không nhắc.
        if (!active || requestId !== attendanceReminderRequestRef.current) return
        setAttendanceReminderDay(today)
        setAttendanceReminder(null)
      }
    }
    void refreshReminder()
    const timer = window.setInterval(refreshReminder, shouldUseLanApi(user) ? 30000 : 60000)
    const reload = () => void refreshReminder()
    const reloadSoon = burstGuard(reload, 400)
    window.addEventListener('focus', reload)
    window.addEventListener('gustino-attendance-updated', reload)
    window.addEventListener(ATTENDANCE_OUTBOX_EVENT, reload)
    window.addEventListener('storage', reload)
    const client = shouldUseLanApi(user) ? null : supabase
    const channel = client
      ?.channel(uniqueChannelName(`attendance-reminder:${user.id}`))
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'shift_registrations', filter: `user_id=eq.${user.id}`,
      }, reloadSoon)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'attendance_records', filter: `user_id=eq.${user.id}`,
      }, reloadSoon)
      .subscribe()
    return () => {
      active = false
      attendanceReminderRequestRef.current += 1
      reloadSoon.cancel()
      window.clearInterval(timer)
      window.removeEventListener('focus', reload)
      window.removeEventListener('gustino-attendance-updated', reload)
      window.removeEventListener(ATTENDANCE_OUTBOX_EVENT, reload)
      window.removeEventListener('storage', reload)
      if (client && channel) void client.removeChannel(channel)
    }
  }, [user.id, user.role, user.branchId, page])

  useEffect(() => setAttendanceReminderDismissed(false), [attendanceReminder, attendanceReminderDay])

  useEffect(() => {
    if (user.role !== 'shift_leader') {
      setReportPending(null)
      return
    }
    const sync = () => setReportPending(pendingHandoverReportForToday(localDateKey()))
    sync()
    window.addEventListener(REPORT_PENDING_EVENT, sync)
    window.addEventListener('focus', sync)
    window.addEventListener('storage', sync)
    return () => {
      window.removeEventListener(REPORT_PENDING_EVENT, sync)
      window.removeEventListener('focus', sync)
      window.removeEventListener('storage', sync)
    }
  }, [user.role, page])

  useEffect(() => setReportReminderDismissed(false), [reportPending?.shiftId, reportPending?.sequence])

  return (
    <div className={`app-shell${sidebarOpen ? ' mobile-sidebar-open' : ''}${canOpenAdminConsole(user.role) && (page === 'management' || page === 'control' || page === 'gustino-analyst') ? ' management-workspace' : ''}${user.role === 'manager' ? ' legacy-manager-workspace' : ''}${page === 'sales' ? ' pos-workspace' : ''}`} onClick={() => { setMenuOpen(false); setSidebarOpen(false); setPayslipNotificationOpen(false) }}>
      {/* ===== DESKTOP LEFT SIDEBAR ===== */}
      <aside className="app-sidebar" onClick={(event) => event.stopPropagation()}>
        {/* Brand */}
        <div className="sidebar-brand">
          <span className="sidebar-brand-mark"><img src="/gustino-logo.jpg" alt="GUSTINO" /></span>
          <strong className="sidebar-brand-name">GUSTINO</strong>
        </div>

        {canSwitchBranch && (
          <div style={{ padding: '8px 14px 4px' }}>
            <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 4 }}>
              📍 Điểm đang làm việc
            </label>
            <select
              aria-label="Chọn điểm bán đang làm việc"
              value={user.branchId}
              disabled={switchingBranch}
              onChange={(event) => void handleSwitchWorkingBranch(event.target.value)}
              style={{
                width: '100%',
                padding: '8px 10px',
                borderRadius: 10,
                border: '1.5px solid #cbd5e1',
                background: '#f8fafc',
                color: '#0f172a',
                fontSize: 13,
                fontWeight: 700,
                cursor: switchingBranch ? 'wait' : 'pointer',
              }}
            >
              {roamingBranches.map((branch) => (
                <option key={branch.id} value={branch.id}>
                  {branch.name || branchName(branch.id)}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Navigation */}
        <nav className="sidebar-nav">
          {visibleNav.filter((item) => item.id !== 'control').map((item) => (
            <button
              key={navKey(item)}
              className={`sidebar-nav-item${isActive(item) ? ' active' : ''}`}
              onClick={() => { setSidebarOpen(false); onNavigate(item.id, item.section) }}
            >
              <span className="sidebar-nav-icon">{item.icon}</span>
              <span className="sidebar-nav-label">{item.label}</span>
            </button>
          ))}
        </nav>

        {/* Spacer */}
        <div className="sidebar-spacer" />

        <img className="sidebar-capy-decoration" src="/mascots/capy-loading-1.png" alt="" aria-hidden="true" />

        {visibleNav.filter((item) => item.id === 'control').map((item) => (
          <button key={navKey(item)} className={`sidebar-nav-item sidebar-settings${isActive(item) ? ' active' : ''}`} onClick={() => { setSidebarOpen(false); onNavigate(item.id, item.section) }}>
            <span className="sidebar-nav-icon">{item.icon}</span>
            <span className="sidebar-nav-label">{item.label}</span>
          </button>
        ))}

        {/* Logout */}
        <button className="sidebar-logout" onClick={onLogout}>
          <IconLogout />
          Đăng xuất
        </button>
      </aside>

      <header className="crm-desktop-header">
        <div className="crm-header-title"><small>GUSTINO / Quản trị</small><strong>{activeLabel}</strong></div>
        <div className="crm-header-actions">
          {canSwitchBranch && (
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: '#f1f5f9', padding: '4px 10px', borderRadius: 999, border: '1px solid #cbd5e1', fontSize: 12, fontWeight: 600 }}>
              <span aria-hidden="true">📍</span>
              <select
                aria-label="Chi nhánh đang làm việc"
                value={user.branchId}
                disabled={switchingBranch}
                onChange={(event) => void handleSwitchWorkingBranch(event.target.value)}
                style={{ border: 'none', background: 'transparent', fontWeight: 700, fontSize: 12, color: '#0f172a', cursor: 'pointer', outline: 'none' }}
              >
                {roamingBranches.map((branch) => (
                  <option key={branch.id} value={branch.id}>
                    {branch.name || branchName(branch.id)}
                  </option>
                ))}
              </select>
            </label>
          )}
          {messageShortcut}
          {canReceivePayslip(user.role) && payslipNotification}
          <span className="crm-header-avatar">{user.avatarUrl ? <img src={user.avatarUrl} alt="" /> : initials}</span>
          <span className="crm-header-account"><strong>{shownName}</strong><small>{roleLabel(user.role, lang)}</small></span>
        </div>
      </header>

      {/* ===== MOBILE HEADER ===== */}
      <header className="mobile-header">
        <button className="mh-menu-toggle" type="button" onClick={(event) => { event.stopPropagation(); setSidebarOpen((open) => !open) }} aria-label="Mở menu" aria-expanded={sidebarOpen}>
          <IconMenu />
        </button>
        <div className="mh-brand">
          <span className="mh-title">{activeLabel}</span>
          {canSwitchBranch && (
            <select
              aria-label="Chi nhánh đang làm việc"
              value={user.branchId}
              disabled={switchingBranch}
              onClick={(event) => event.stopPropagation()}
              onChange={(event) => void handleSwitchWorkingBranch(event.target.value)}
              style={{
                marginLeft: 6,
                maxWidth: 145,
                padding: '3px 8px',
                borderRadius: 999,
                border: '1px solid #cbd5e1',
                background: '#f8fafc',
                color: '#0f172a',
                fontSize: 11,
                fontWeight: 700,
                textOverflow: 'ellipsis',
              }}
            >
              {roamingBranches.map((branch) => (
                <option key={branch.id} value={branch.id}>
                  📍 {branch.name || branchName(branch.id)}
                </option>
              ))}
            </select>
          )}
        </div>
        <div className="mh-right">
          {messageShortcut}
          {canReceivePayslip(user.role) && payslipNotification}
          <button
            className={`mh-avatar${menuOpen ? ' open' : ''}`}
            onClick={(e) => { e.stopPropagation(); setMenuOpen(!menuOpen) }}
            aria-label="Tài khoản"
            aria-expanded={menuOpen}
          >
            {user.avatarUrl ? <img src={user.avatarUrl} alt="" /> : initials}
          </button>
          {menuOpen && (
            <div className="mh-menu" role="menu" onClick={(e) => e.stopPropagation()}>
              <div className="mh-menu-user">
                <strong>{shownName}</strong>
                <small>{roleLabel(user.role, lang)}</small>
              </div>
              <button className="mh-menu-lang" onClick={toggleLang}>
                {lang === 'en' ? 'Tiếng Việt' : 'English'}
              </button>
              <button className="mh-menu-logout" onClick={onLogout}>
                <IconLogout />
                Đăng xuất
              </button>
            </div>
          )}
        </div>
      </header>
      {sidebarOpen && <button type="button" className="sidebar-drawer-backdrop" aria-label="Đóng menu" onClick={() => setSidebarOpen(false)} />}

      {showOperationGuide && (
        <nav className="operation-guide" aria-label="Quy trình vận hành">
          {operationGuide.map((item) => (
            <button
              key={item.id}
              className={page === item.id ? 'active' : ''}
              onClick={() => onNavigate(item.id)}
              title={item.label}
              aria-current={page === item.id ? 'page' : undefined}
            >
              <span>{item.icon}</span>
              <strong>{item.shortLabel}</strong>
            </button>
          ))}
        </nav>
      )}

      {/* ===== MAIN CONTENT ===== */}
      <main className={`app-main${showOperationGuide ? ' has-operation-guide' : ''}`}>
        {children}
        <AppFooter />
      </main>

      {showAttendanceReminder && (
        <aside className="sunday-shift-popup attendance-check-popup" role="dialog" aria-label="Nhắc chấm công hôm nay">
          <button className="sunday-shift-popup-close" type="button" aria-label="Đóng" onClick={() => setAttendanceReminderDismissed(true)}>×</button>
          <img className="attendance-capybara-image attendance-popup-capybara" src="/mascots/capy-attendance-camera.png" alt="" width="256" height="256" decoding="async" aria-hidden="true" />
          <div>
            <small>CAPY NHẮC CHẤM CÔNG ✨</small>
            <strong>{attendanceReminder === 'check-out' ? 'Bạn chưa check-out ca đang làm' : 'Bạn có ca hôm nay chưa check-in'}</strong>
            <span>{attendanceReminder === 'check-out' ? 'Chụp ảnh cuối ca, lưu GPS rồi check-out nhé.' : 'Mở chấm công, cho phép định vị và chụp ảnh trước khi vào ca.'}</span>
          </div>
          <button type="button" onClick={() => { setAttendanceReminderDismissed(true); onNavigate('attendance') }}>{attendanceReminder === 'check-out' ? 'Đi check-out' : 'Đi check-in'}</button>
        </aside>
      )}

      {showReportReminder && !showAttendanceReminder && (
        <aside className="sunday-shift-popup report-pending-popup" role="dialog" aria-label="Nhắc gửi báo cáo ca">
          <button className="sunday-shift-popup-close" type="button" aria-label="Đóng" onClick={() => setReportReminderDismissed(true)}>×</button>
          <img className="attendance-capybara-image attendance-popup-capybara" src="/mascots/capy-attendance-camera.png" alt="" width="256" height="256" decoding="async" aria-hidden="true" />
          <div>
            <small>CAPY NHẮC GỬI BÁO CÁO ✨</small>
            <strong>{reportPending?.sequence === 2 ? 'Báo cáo Ca tối + Tổng ngày chưa gửi' : 'Báo cáo Ca sáng chưa gửi'}</strong>
            <span>Bạn đã bàn giao ca nhưng chưa chốt &amp; gửi báo cáo lên Zalo. Mở màn Báo cáo để gửi ngay nhé.</span>
          </div>
          <button type="button" onClick={() => { setReportReminderDismissed(true); onNavigate('report') }}>Gửi báo cáo ngay</button>
        </aside>
      )}

      {showSundayReminder && !showAttendanceReminder && !showReportReminder && (
        <aside className="sunday-shift-popup" role="dialog" aria-label="Nhắc đăng ký ca tuần mới">
          <button className="sunday-shift-popup-close" type="button" aria-label="Đóng" onClick={() => setSundayReminderDismissed(true)}>×</button>
          <CapybaraMascot />
          <div>
            <small>CHỈ NHẮC VÀO CHỦ NHẬT</small>
            <strong>Capy nhắc bạn đăng ký ca tuần mới ✨</strong>
            <span>Chọn ca sớm để ca trưởng sắp lịch tuần tới nhé.</span>
          </div>
          <button type="button" onClick={() => { setSundayReminderDismissed(true); onNavigate('attendance') }}>Đăng ký ca</button>
        </aside>
      )}

    </div>
  )
}

function CapybaraMascot() {
  return <span className="capybara-mascot" aria-hidden="true"><i className="capy-ear left" /><i className="capy-ear right" /><i className="capy-eye left" /><i className="capy-eye right" /><i className="capy-nose" /></span>
}

// ===== SVG ICON COMPONENTS =====

function IconChart() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="20" x2="18" y2="10" /><line x1="12" y1="20" x2="12" y2="4" /><line x1="6" y1="20" x2="6" y2="14" />
    </svg>
  )
}

function IconMenu() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M4 6h16M4 12h16M4 18h16" /></svg>
}

function IconDashboard() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 13a8 8 0 1116 0" /><path d="M12 13l4-4" /><path d="M3 21h18" /><path d="M7 17h10" />
    </svg>
  )
}

function IconCalendar() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  )
}

function IconShoppingBag() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z" /><line x1="3" y1="6" x2="21" y2="6" /><path d="M16 10a4 4 0 01-8 0" />
    </svg>
  )
}

function IconHandover() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="17 1 21 5 17 9" /><path d="M3 11V9a4 4 0 014-4h14" /><polyline points="7 23 3 19 7 15" /><path d="M21 13v2a4 4 0 01-4 4H3" />
    </svg>
  )
}

function IconBox() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z" />
      <polyline points="3.27 6.96 12 12.01 20.73 6.96" /><line x1="12" y1="22.08" x2="12" y2="12" />
    </svg>
  )
}

function IconReport() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" />
    </svg>
  )
}

function IconClock() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
    </svg>
  )
}

function IconBell() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8a6 6 0 00-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" /><path d="M10 21h4" /></svg>
}

function IconMessage() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 11.5a8.5 8.5 0 01-8.5 8.5H4l-3 3v-11.5A8.5 8.5 0 019.5 3h3a8.5 8.5 0 018.5 8.5Z" /><path d="M7 9h8M7 13h5" /></svg>
}

function IconClipboard() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M16 4h2a2 2 0 012 2v14a2 2 0 01-2 2H6a2 2 0 01-2-2V6a2 2 0 012-2h2" />
      <rect x="8" y="2" width="8" height="4" rx="1" />
      <line x1="9" y1="11" x2="15" y2="11" /><line x1="9" y1="15" x2="13" y2="15" />
    </svg>
  )
}

function IconHistory() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="1 4 1 10 7 10" /><path d="M3.51 15a9 9 0 1 0 .49-3.16" />
    </svg>
  )
}

function IconUsers() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 00-3-3.87" /><path d="M16 3.13a4 4 0 010 7.75" />
    </svg>
  )
}

function IconPayroll() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M7 8h10" />
      <path d="M7 12h4" />
      <path d="M15 12h2" />
      <path d="M7 16h4" />
      <path d="M15 16h2" />
    </svg>
  )
}

function IconKitchen() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 002-2V2" /><path d="M7 2v20" /><path d="M21 15V2a5 5 0 00-5 5v6c0 1.1.9 2 2 2h3zm0 0v7" />
    </svg>
  )
}

function IconSettings() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09a1.65 1.65 0 00-1-1.51 1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 005 15.08a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09a1.65 1.65 0 001.51-1 1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 008.92 5a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09A1.65 1.65 0 0015 4.6a1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019 8.92a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09A1.65 1.65 0 0019.4 15z" />
    </svg>
  )
}

function IconLogout() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" />
    </svg>
  )
}
