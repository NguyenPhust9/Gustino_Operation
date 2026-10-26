import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import {
  buildAttendanceReport,
  buildAttendanceDetailRows,
  createEmployeeAccount,
  deleteAttendanceRecordByAdmin,
  deleteEmployeeAccount,
  deleteEmptyShiftRegistrationByAdmin,
  fetchAttendanceRecords,
  fetchEmployees,
  fetchShiftRegistrations,
  createAttendanceReadContext,
  fetchWorkShifts,
  ensureDefaultWorkShifts,
  isAttendanceAutoClosedError,
  permittedBranchIds,
  resetEmployeePassword,
  updateAttendanceRecordByAdmin,
  updateEmployeeDetails,
  updateEmployeeCrmDetails,
  updateEmployeeRole,
} from '../lib/attendance'
import { formatDecimalHoursAsDuration, formatWorkDurationBetween } from '../lib/workDuration'
import { canOpenAdminConsole, employeePositionLabel, isBranchlessRole, isReadOnlyConsoleRole, roleLabel } from '../lib/access'
import { useLang } from '../lib/i18n'
import { PRODUCTS, getPackingOptionsByOutput, getProducts, productById } from '../lib/constants'
import { branchName as configuredBranchName, syncConfiguredBranchRows, useConfiguredBranches, writeConfiguredBranchRows, type ConfigBranch } from '../lib/branches'
import { burstGuard, downloadBlob, shareOrDownloadBlob } from '../lib/browser'
import { calculateStock, ensureOperationDay, fetchInventoryReports, fetchMovements, fetchReportSnapshots, stockAdjustmentDeltas, sumStockAdjustments, type StockAdjustment } from '../lib/store'
import { QUANTITY_DECIMALS, formatStockAmount } from '../lib/inventoryEntry'
import { supabase, uniqueChannelName } from '../lib/supabase'
import { fetchBagAllocations, fetchBagShiftSessions, reopenBagShift } from '../lib/shiftLedger'
import { buildShiftLeaderReceiptSources, buildShiftLeaderRevenueRows } from '../lib/shiftCompetition'
import { buildEmployeeCompetitionRevenueSources } from '../lib/competitionDrilldown'
import {
  buildCompetitionAttendanceMetrics,
  competitionDateKeys,
  competitionDayMatches,
  filterCompetitionAttendanceRecords,
  type CompetitionDayType,
} from '../lib/competitionFairness'
import {
  SALES_CAPACITY_METRICS,
  buildEmployeeSalesCapacity,
  salesCapacityMetricLabel,
  type SalesCapacityMetric,
  type SalesCapacityRow,
  type SalesCapacitySummary,
} from '../lib/employeeSalesCapacity'
import { buildKpiEvidenceWorkbook, type KpiEvidenceSourceRow } from '../lib/kpiEvidenceWorkbook'
import { buildDailyKpiWorkbook } from '../lib/kpiDailyWorkbook'
import { DEFAULT_COMMISSION_RATE, DEFAULT_REVENUE_TARGET, dailyKpiBonus, employeeKpiKey, employeePeriodRevenueTarget, kpiRank, loadEmployeeRevenueTargets, fetchCommissionRules, fetchEmployeeKpiTargets, productSaleValues, saveCommissionRule, saveEmployeeRevenueTarget, soldBagQuantity, summarizeEmployeeBagSales, weeklyKpiBonus } from '../lib/commission'
import { buildDailyRevenueRows } from '../lib/revenue'
import { fetchSalesReceiptsRange, type SalesReceipt } from '../lib/salesReceipts'
import { emailToUsername, validateUsername } from '../lib/authIdentity'
import { fetchSupplyRequests, formatSupplyRequestDelivery, type SupplyRequest, type SupplyRequestStatus } from '../lib/supplyRequests'
import { fetchActiveUsers } from '../lib/activeUsers'
import { AttendanceAdjustmentArchive } from '../components/AttendanceAdjustmentArchive'
import { AttendancePage } from './AttendancePage'
import { Pagination } from '../components/admin/Pagination'
import { DateTime24Field } from '../components/Time24Field'
import { fetchAttendanceAdjustments } from '../lib/attendanceAdjustments'
import { isStockManagedProduct } from '../lib/warehouseScope'
import { BranchesPage } from './admin/BranchesPage'
import { DashboardPage } from './admin/DashboardPage'
import { EmployeesPage } from './admin/EmployeesPage'
import type {
  ActiveUserSession,
  AppUser,
  AttendanceAdjustmentRequest,
  AttendanceRecord,
  BagAllocation,
  BagShiftSession,
  Branch,
  EmployeeProfile,
  EmploymentStatus,
  EmploymentType,
  InventoryReport,
  Product,
  ReportSnapshot,
  Role,
  ShiftRegistration,
  StockMovement,
  WorkShift,
} from '../types'
import type { Page } from '../components/AppShell'

export type AdminSection = 'overview' | 'attendance' | 'commission' | 'inventory' | 'requests' | 'accounts' | 'revenue'
type EmployeeProfileRoute = 'overview' | 'attendance' | 'sales' | 'account'
type BranchProfileRoute = 'overview' | 'revenue' | 'employees' | 'attendance' | 'inventory' | 'requests'

function adminRouteFromHash() {
  const parts = window.location.hash.replace(/^#\/?/, '').split('/')
  const kind = parts[1]
  const id = decodeURIComponent(parts[2] || '')
  const detail = parts[3] || 'overview'
  const employeeTabs: EmployeeProfileRoute[] = ['overview', 'attendance', 'sales', 'account']
  const branchTabs: BranchProfileRoute[] = ['overview', 'revenue', 'employees', 'attendance', 'inventory', 'requests']
  return {
    directory: kind === 'branches' ? 'branches' as const : 'employees' as const,
    employeeId: kind === 'employees' ? id : '',
    branchId: kind === 'branches' ? id : '',
    employeeTab: employeeTabs.includes(detail as EmployeeProfileRoute) ? detail as EmployeeProfileRoute : 'overview',
    branchTab: branchTabs.includes(detail as BranchProfileRoute) ? detail as BranchProfileRoute : 'overview',
  }
}

function navigateAdminHash(path: string) {
  const nextHash = `#${path}`
  if (window.location.hash !== nextHash) window.location.hash = nextHash
}

/**
 * Cột số lượng kho trong Excel.
 *
 * KHÔNG dùng lại `'0.####'`: trong mã định dạng của Excel, dấu chấm thập phân được in
 * NGUYÊN VĂN, còn `#` sau nó không in gì khi số không có phần lẻ — nên 148 hiện ra
 * "148." và 0 hiện ra "0." (lỗi bảng "TỔNG HỢP KHO" tháng 7/2026). `General` hiện số
 * nguyên là "148", số lẻ là "240.1879"; giá trị được làm tròn 4 số lẻ khi ghi để
 * không lòi đuôi dấu phẩy động (0.30000000000000004) hay ký hiệu khoa học.
 */
const INVENTORY_EXCEL_QUANTITY_FORMAT = 'General'
const INVENTORY_EXCEL_INTEGER_FORMAT = '0'
// Đúng bằng độ chính xác của `stock_movements.quantity` numeric(14,3) — số lẻ
// thứ tư chỉ có thể là rác dấu phẩy động khi cộng dồn, không phải dữ liệu thật.
const INVENTORY_EXCEL_QUANTITY_DECIMALS = QUANTITY_DECIMALS

/** Đặt định dạng + làm tròn cho các cột số lượng của một sheet. */
function applyInventoryQuantityFormat(sheet: import('exceljs').Worksheet, keys: string[]) {
  for (const key of keys) {
    const column = sheet.getColumn(key)
    column.numFmt = INVENTORY_EXCEL_QUANTITY_FORMAT
    // `eachCell` là optional trong type của exceljs (cột rỗng chưa có ô nào).
    column.eachCell?.({ includeEmpty: false }, (cell, rowNumber) => {
      if (rowNumber === 1) return
      if (typeof cell.value === 'number' && Number.isFinite(cell.value)) {
        cell.value = Number(cell.value.toFixed(INVENTORY_EXCEL_QUANTITY_DECIMALS))
      }
    })
  }
}

// Tab lọc trạng thái của màn Đặt hàng (admin chỉ xem, không đổi trạng thái đơn).
const SUPPLY_STATUS_TABS: Array<{ id: 'all' | SupplyRequestStatus; label: string }> = [
  { id: 'all', label: 'Tất cả' },
  { id: 'pending', label: 'Chờ duyệt' },
  { id: 'acknowledged', label: 'Đã nhận' },
  { id: 'fulfilled', label: 'Hoàn thành' },
  { id: 'cancelled', label: 'Đã hủy' },
]

const ADMIN_SECTIONS: Array<{ id: AdminSection; icon: string }> = [
  { id: 'revenue', icon: '₫' },
  { id: 'overview', icon: '▤' },
  { id: 'attendance', icon: '◉' },
  { id: 'commission', icon: '★' },
  { id: 'inventory', icon: '▦' },
  { id: 'requests', icon: '↑' },
  { id: 'accounts', icon: '⊕' },
]

const ADMIN_TEXT = {
  vi: {
    navLabel: 'CHỨC NĂNG',
    sections: {
      revenue: 'Doanh thu',
      overview: 'Tổng quan',
      attendance: 'Chấm công',
      commission: 'Thi đua nhân viên',
      inventory: 'Báo cáo kho',
      requests: 'Đặt hàng',
      accounts: 'Nhân sự',
    },
    branch: 'Chi nhánh',
    employee: 'Nhân viên',
    from: 'Từ ngày',
    to: 'Đến ngày',
    allBranches: 'Tất cả chi nhánh',
    allEmployees: 'Tất cả nhân viên',
    today: 'Hôm nay',
    thisMonth: 'Tháng này',
    previousMonth: 'Tháng trước',
    shiftsDone: 'Ca đã làm',
    hours: 'Giờ công',
    lowStock: 'Cảnh báo tồn kho',
    orderRequests: 'Yêu cầu đặt hàng',
    shiftsHint: 'Tổng số ca có chấm công trong kỳ',
    hoursHint: 'nhân viên có dữ liệu',
    activeHint: 'nhân viên đang làm việc',
    requestsHint: 'yêu cầu trong kỳ',
    archiveEyebrow: 'LƯU TRỮ',
    archiveTitle: 'Lịch sử báo cáo đã lưu',
    archiveCount: 'hồ sơ',
    noArchive: 'Chưa có báo cáo được lưu trong khoảng thời gian này.',
    wasteEyebrow: 'HAO HỤT',
    wasteTitle: 'Sản phẩm hao hụt',
    wasteCount: 'mặt hàng',
    noWaste: 'Không ghi nhận hao hụt trong kỳ.',
  },
  en: {
    navLabel: 'CHỨC NĂNG',
    sections: {
      revenue: 'Doanh thu',
      overview: 'Tổng quan',
      attendance: 'Chấm công',
      commission: 'Thi đua nhân viên',
      inventory: 'Báo cáo kho',
      requests: 'Đặt hàng',
      accounts: 'Nhân sự',
    },
    branch: 'Chi nhánh',
    employee: 'Nhân viên',
    from: 'Từ ngày',
    to: 'Đến ngày',
    allBranches: 'Tất cả chi nhánh',
    allEmployees: 'Tất cả nhân viên',
    today: 'Hôm nay',
    thisMonth: 'Tháng này',
    previousMonth: 'Tháng trước',
    shiftsDone: 'Ca đã làm',
    hours: 'Giờ công',
    lowStock: 'Cảnh báo tồn kho',
    orderRequests: 'Yêu cầu đặt hàng',
    shiftsHint: 'Tổng số ca có chấm công trong kỳ',
    hoursHint: 'nhân viên có dữ liệu',
    activeHint: 'nhân viên đang làm việc',
    requestsHint: 'yêu cầu trong kỳ',
    archiveEyebrow: 'LƯU TRỮ',
    archiveTitle: 'Lịch sử báo cáo đã lưu',
    archiveCount: 'hồ sơ',
    noArchive: 'Chưa có báo cáo được lưu trong khoảng thời gian này.',
    wasteEyebrow: 'HAO HỤT',
    wasteTitle: 'Sản phẩm hao hụt',
    wasteCount: 'mặt hàng',
    noWaste: 'Không ghi nhận hao hụt trong kỳ.',
  },
} as const

const ADMIN_TEXT_EN = {
  navLabel: 'FUNCTIONS',
  sections: {
    revenue: 'Revenue',
    overview: 'Overview',
    attendance: 'Attendance',
    commission: 'Employee competition',
    inventory: 'Inventory Report',
    requests: 'Orders',
    accounts: 'People',
  },
  branch: 'Branch',
  employee: 'Employee',
  from: 'From',
  to: 'To',
  allBranches: 'All branches',
  allEmployees: 'All employees',
  today: 'Today',
  thisMonth: 'This month',
  previousMonth: 'Previous month',
  shiftsDone: 'Completed shifts',
  hours: 'Work hours',
  lowStock: 'Low stock alerts',
  orderRequests: 'Order requests',
  shiftsHint: 'Total checked-in shifts in this period',
  hoursHint: 'employees with data',
  activeHint: 'active employees',
  requestsHint: 'requests in this period',
  archiveEyebrow: 'ARCHIVE',
  archiveTitle: 'Saved reports',
  archiveCount: 'records',
  noArchive: 'No saved reports in this date range.',
  wasteEyebrow: 'WASTE',
  wasteTitle: 'Product waste',
  wasteCount: 'items',
  noWaste: 'No waste recorded in this period.',
}

const ROLE_OPTIONS: Array<{ value: Role; label: string }> = [
  { value: 'kitchen', label: 'Bếp' },
  { value: 'cashier', label: 'Thu ngân POS' },
  { value: 'staff', label: 'Nhân viên' },
  { value: 'shift_leader', label: 'Ca trưởng' },
  { value: 'supmt', label: 'Giám sát (SUP MT)' },
  { value: 'manager', label: 'Quản lý' },
]

// Chỉ nhân sự vận hành bán hàng được tính KPI/lương doanh số.
// Manager/admin/kitchen là vai trò giám sát hoặc hỗ trợ, không tham gia KPI bán hàng.
const PAYROLL_ROLES: Role[] = ['shift_leader', 'staff']
const ATTENDANCE_EDIT_PAGE_SIZE = 20
type CompetitionRoleFilter = 'all' | 'staff' | 'shift_leader'

/**
 * Màn Thi đua trước đây bày 5 danh sách của CÙNG một nhóm người (poster, bảng
 * phân loại, danh sách năng suất, thẻ thưởng KPI, bảng KPI theo ngày) — mỗi cái
 * lại xếp theo một tiêu chí khác nên quản lý không biết tin bảng nào. Nay chỉ
 * còn MỘT bảng; muốn đổi cách xếp thì bấm đúng cột, không đẻ thêm danh sách.
 */
type CompetitionSortKey = 'revenue' | 'capacity' | 'progress' | 'reward'

type DailyEmployeeKpiRow = ReturnType<typeof buildDailyEmployeeKpiRows>[number]

const COMPETITION_SORT_OPTIONS: Array<{ id: CompetitionSortKey; label: string; hint: string }> = [
  { id: 'revenue', label: 'Doanh thu', hint: 'Tổng tiền bán ra trong kỳ đang xem.' },
  { id: 'capacity', label: 'Năng suất', hint: 'Trung bình một ca (hoặc một giờ công) bán được bao nhiêu.' },
  { id: 'progress', label: '% KPI', hint: 'Tỷ lệ đạt so với chỉ tiêu doanh thu của kỳ.' },
  { id: 'reward', label: 'Thưởng KPI', hint: 'Tiền thưởng ngày/tuần đã đạt ngưỡng.' },
]

const COMPETITION_TOP_ROWS = 10

function lastDayOfMonth(period: string) {
  const [year, month] = period.split('-').map(Number)
  return `${period}-${String(new Date(year, month, 0).getDate()).padStart(2, '0')}`
}

function competitionDayTypeLabel(filter: CompetitionDayType) {
  if (filter === 'weekday') return 'Ngày thường (Thứ Hai–Thứ Sáu)'
  if (filter === 'weekend') return 'Cuối tuần (Thứ Bảy–Chủ Nhật)'
  return 'Tất cả ngày'
}

function cleanNonNegativeIntegerInput(value: string) {
  return value.replace(/[^\d]/g, '')
}

function nonNegativeFilterNumber(value: string, fallback: number) {
  if (!value.trim()) return fallback
  const parsed = Number(value)
  return Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : fallback
}

type ManagementDataKey = 'employees' | 'shifts' | 'registrations' | 'records' | 'adjustments' | 'movements'
  | 'inventoryReports' | 'allocations' | 'sessions' | 'requests' | 'snapshots' | 'receipts'

const ALL_MANAGEMENT_DATA: ManagementDataKey[] = [
  'employees', 'shifts', 'registrations', 'records', 'adjustments', 'movements',
  'inventoryReports', 'allocations', 'sessions', 'requests', 'snapshots', 'receipts',
]

function managementDataNeeds(section: AdminSection, focused: boolean) {
  if (section === 'overview') return new Set<ManagementDataKey>(ALL_MANAGEMENT_DATA)
  const bySection: Record<AdminSection, ManagementDataKey[]> = {
    overview: ALL_MANAGEMENT_DATA,
    revenue: ['employees', 'movements', 'allocations', 'snapshots', 'receipts'],
    attendance: ['employees', 'shifts', 'registrations', 'records', 'adjustments'],
    commission: ['employees', 'shifts', 'registrations', 'records', 'allocations', 'sessions', 'receipts'],
    inventory: ['employees', 'movements', 'inventoryReports', 'sessions', 'receipts'],
    requests: ['employees', 'requests'],
    accounts: ['employees', 'records', 'adjustments', 'movements', 'requests', 'receipts'],
  }
  return new Set<ManagementDataKey>(bySection[section])
}

function managementRealtimeTables(section: AdminSection, focused: boolean) {
  if (section === 'overview') return [
    'sales_receipts', 'sales_receipt_items', 'shift_registrations', 'attendance_records',
    'bag_allocations', 'bag_shift_sessions', 'stock_movements', 'operation_days',
    'inventory_reports', 'supply_requests', 'report_snapshots', 'attendance_adjustment_requests',
  ]
  const bySection: Record<AdminSection, string[]> = {
    overview: [],
    revenue: ['sales_receipts', 'sales_receipt_items', 'bag_allocations', 'bag_shift_sessions', 'stock_movements', 'operation_days', 'report_snapshots'],
    attendance: ['shift_registrations', 'attendance_records', 'attendance_adjustment_requests'],
    commission: ['sales_receipts', 'sales_receipt_items', 'shift_registrations', 'attendance_records', 'bag_allocations', 'bag_shift_sessions'],
    inventory: ['stock_movements', 'operation_days', 'inventory_reports', 'bag_shift_sessions', 'sales_receipts', 'sales_receipt_items'],
    requests: ['supply_requests'],
    accounts: ['sales_receipts', 'sales_receipt_items', 'attendance_records', 'attendance_adjustment_requests', 'stock_movements', 'supply_requests'],
  }
  return bySection[section]
}

export function ManagementPage({ user, initialSection, focused = false, onNavigate }: { user: AppUser; initialSection?: AdminSection; focused?: boolean; onNavigate?: (page: Page) => void }) {
  const lang = useLang()
  const text = lang === 'en' ? ADMIN_TEXT_EN : ADMIN_TEXT.vi
  // SUP MT xem đúng bộ dữ liệu của admin nhưng KHÔNG có nút ghi nào. Cờ này chỉ ẩn
  // giao diện; RLS mới là lớp chặn thật (xem `20260808_supmt_readonly_access.sql`).
  const readOnly = isReadOnlyConsoleRole(user.role)
  const branches = useConfiguredBranches({ user })
  const initialRange = monthRange()
  const [activeSection, setActiveSection] = useState<AdminSection>(initialSection || 'overview')
  useEffect(() => {
    if (!initialSection) return
    setActiveSection(initialSection)
  }, [initialSection])
  const [employees, setEmployees] = useState<EmployeeProfile[]>([])
  const [shifts, setShifts] = useState<WorkShift[]>([])
  const [registrations, setRegistrations] = useState<ShiftRegistration[]>([])
  const [records, setRecords] = useState<AttendanceRecord[]>([])
  const [attendanceAdjustments, setAttendanceAdjustments] = useState<AttendanceAdjustmentRequest[]>([])
  const [movements, setMovements] = useState<StockMovement[]>([])
  const [inventoryReports, setInventoryReports] = useState<InventoryReport[]>([])
  const [bagAllocations, setBagAllocations] = useState<BagAllocation[]>([])
  const [bagSessions, setBagSessions] = useState<BagShiftSession[]>([])
  const [supplyRequests, setSupplyRequests] = useState<SupplyRequest[]>([])
  const [reportSnapshots, setReportSnapshots] = useState<ReportSnapshot[]>([])
  const [salesReceipts, setSalesReceipts] = useState<SalesReceipt[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [feedback, setFeedback] = useState('')
  const [exportBusy, setExportBusy] = useState('')
  const [branchId, setBranchId] = useState('')
  const [employeeId, setEmployeeId] = useState('')
  const [from, setFrom] = useState(initialRange.from)
  const [to, setTo] = useState(initialRange.to)
  const rankingPeriod = from.slice(0, 7)
  const rankingMonthFrom = `${rankingPeriod}-01`
  const rankingMonthTo = lastDayOfMonth(rankingPeriod)
  const todayKey = localDateKey()
  const attendanceDateMax = activeSection === 'attendance' ? todayKey : undefined
  const currentMonthKey = todayKey.slice(0, 7)
  const attendanceCorrectionMonth = from.slice(0, 7)
  const [attendanceListMode, setAttendanceListMode] = useState<'date' | 'employee'>('date')
  const [attendanceListDate, setAttendanceListDate] = useState(todayKey)
  const [attendanceListBranchId, setAttendanceListBranchId] = useState('')
  const [attendanceListEmployeeId, setAttendanceListEmployeeId] = useState('')
  const [attendanceEmployeeSearch, setAttendanceEmployeeSearch] = useState('')
  const [attendanceListPage, setAttendanceListPage] = useState(1)
  const [competitionRankingMode, setCompetitionRankingMode] = useState<'daily' | 'monthly' | 'leaders'>('daily')
  const [competitionDate, setCompetitionDate] = useState(todayKey)
  const [competitionRoleFilter, setCompetitionRoleFilter] = useState<CompetitionRoleFilter>('all')
  const [competitionDayType, setCompetitionDayType] = useState<CompetitionDayType>('all')
  const [competitionMinShifts, setCompetitionMinShifts] = useState('')
  const [competitionMaxShifts, setCompetitionMaxShifts] = useState('')
  const [capacityMetric, setCapacityMetric] = useState<SalesCapacityMetric>('revenuePerDay')
  const [competitionSort, setCompetitionSort] = useState<CompetitionSortKey>('revenue')
  const [competitionShowAll, setCompetitionShowAll] = useState(false)
  const [competitionPosterOpen, setCompetitionPosterOpen] = useState(false)
  const [savingRoleId, setSavingRoleId] = useState('')
  const [accountBusyId, setAccountBusyId] = useState('')
  const [pendingDeleteId, setPendingDeleteId] = useState('')
  const [branchDeletingId, setBranchDeletingId] = useState('')
  const [employeeDrafts, setEmployeeDrafts] = useState<Record<string, {
    branchId: string
    employmentType: EmploymentType
    positionTitle: string
    avatarUrl: string
  }>>({})
  const [commissionRuleDrafts, setCommissionRuleDrafts] = useState<Record<string, { targetRevenue: string; commissionRate: string }>>({})
  const [employeeKpiDrafts, setEmployeeKpiDrafts] = useState<Record<string, string>>(() =>
    Object.fromEntries(Object.entries(loadEmployeeRevenueTargets()).map(([key, value]) => [key, String(value)])),
  )
  const commissionRuleTimers = useRef<Record<string, number>>({})
  const competitionPosterRef = useRef<HTMLDivElement>(null)
  const [savingEmployeeDetailsId, setSavingEmployeeDetailsId] = useState('')
  const [accountName, setAccountName] = useState('')
  const [accountUsername, setAccountUsername] = useState('')
  const [accountPassword, setAccountPassword] = useState('')
  const [accountBranchId, setAccountBranchId] = useState(user.branchId)
  const [accountRole, setAccountRole] = useState<Exclude<Role, 'admin'>>('staff')
  const [accountEmploymentType, setAccountEmploymentType] = useState<EmploymentType>('part_time')
  const [accountPositionTitle, setAccountPositionTitle] = useState('Part-time')
  const initialAdminRoute = adminRouteFromHash()
  const [crmEmployeeId, setCrmEmployeeId] = useState(initialAdminRoute.employeeId)
  const [crmBranchId, setCrmBranchId] = useState(initialAdminRoute.branchId)
  const [accountsDirectory, setAccountsDirectory] = useState<'employees' | 'branches'>(initialAdminRoute.directory)
  const [branchProfileTab, setBranchProfileTab] = useState<BranchProfileRoute>(initialAdminRoute.branchTab)
  const [employeeProfileTab, setEmployeeProfileTab] = useState<EmployeeProfileRoute>(initialAdminRoute.employeeTab)
  const [showCreateAccount, setShowCreateAccount] = useState(false)
  const [showCreateBranch, setShowCreateBranch] = useState(false)
  const [branchDraft, setBranchDraft] = useState({ id: '', name: '', address: '', manager: '' })
  const [employeeCrmDraft, setEmployeeCrmDraft] = useState({
    employmentStatus: 'working' as EmploymentStatus,
    employmentStartDate: '',
    probationEndDate: '',
    employmentEndDate: '',
    employmentNote: '',
  })
  const [employeeCrmSaving, setEmployeeCrmSaving] = useState(false)
  const [temporaryCredential, setTemporaryCredential] = useState<{ username: string; password: string } | null>(null)
  const [supplyStatusFilter, setSupplyStatusFilter] = useState<'all' | SupplyRequestStatus>('all')
  const [inventoryDetailBranchId, setInventoryDetailBranchId] = useState('')
  // Màn Quản trị › Kho: trước đây đổ THẲNG mọi SKU, mọi ca và mọi phiếu trong kỳ
  // ra màn hình. Với 3 chi nhánh × 30 ngày là hàng nghìn dòng DOM — mở màn là
  // giật, mà thứ quản lý cần tìm (hàng sắp hết, ca lệch số) lại nằm lẫn ở giữa.
  const [inventorySkuSearch, setInventorySkuSearch] = useState('')
  const [inventoryStockFilter, setInventoryStockFilter] = useState<'all' | 'attention' | 'out'>('all')
  const [inventoryShiftOnlyIssues, setInventoryShiftOnlyIssues] = useState(true)
  const [inventoryLedgerType, setInventoryLedgerType] = useState<'all' | StockMovement['type']>('all')
  const [inventoryLedgerSearch, setInventoryLedgerSearch] = useState('')
  const [inventoryLedgerPage, setInventoryLedgerPage] = useState(1)
  const [inventoryLedgerPageSize, setInventoryLedgerPageSize] = useState(50)
  const [adminShiftActionId, setAdminShiftActionId] = useState('')
  const [activeUsers, setActiveUsers] = useState<ActiveUserSession[]>([])
  const [attendanceEdit, setAttendanceEdit] = useState<{
    recordId: string
    employeeName: string
    checkInTime: string
    checkOutTime: string
    reason: string
  } | null>(null)
  const [attendanceEditSaving, setAttendanceEditSaving] = useState(false)
  const [attendanceDelete, setAttendanceDelete] = useState<{
    kind: 'record' | 'empty-registration'
    recordId: string | null
    registrationId: string
    employeeName: string
    workDate: string
    reason: string
  } | null>(null)
  const [attendanceDeleteSaving, setAttendanceDeleteSaving] = useState(false)
  const [showScheduleManagement, setShowScheduleManagement] = useState(false)
  const managementRefreshInFlightRef = useRef<Promise<void> | null>(null)
  const managementRefreshQueuedRef = useRef(false)
  const managementRefreshContextRef = useRef({ activeSection, focused, from, to, rankingMonthFrom, rankingMonthTo })
  managementRefreshContextRef.current = { activeSection, focused, from, to, rankingMonthFrom, rankingMonthTo }

  useEffect(() => {
    const syncAdminRoute = () => {
      const route = adminRouteFromHash()
      setCrmEmployeeId(route.employeeId)
      setCrmBranchId(route.branchId)
      setAccountsDirectory(route.directory)
      setEmployeeProfileTab(route.employeeTab)
      setBranchProfileTab(route.branchTab)
    }
    window.addEventListener('hashchange', syncAdminRoute)
    return () => window.removeEventListener('hashchange', syncAdminRoute)
  }, [])

  useEffect(() => {
    if (loading || error || !crmEmployeeId) return
    if (employees.some((employee) => employee.id === crmEmployeeId)) return
    setCrmEmployeeId('')
    setEmployeeProfileTab('overview')
    navigateAdminHash('/admin/employees')
  }, [loading, error, crmEmployeeId, employees])

  async function refresh(showLoading = true) {
    if (managementRefreshInFlightRef.current) {
      managementRefreshQueuedRef.current = true
      return managementRefreshInFlightRef.current
    }
    if (showLoading) setLoading(true)
    const run = (async () => {
      try {
      const readContext = createAttendanceReadContext()
      const managedBranchIds = permittedBranchIds(user)
      const refreshContext = managementRefreshContextRef.current
      const dataNeeds = managementDataNeeds(refreshContext.activeSection, refreshContext.focused)
      const revenueWarnings: string[] = []
      const revenueSafe = async <T,>(label: string, request: Promise<T>, fallback: T) => {
        if (refreshContext.activeSection !== 'revenue') return request
        try { return await request } catch { revenueWarnings.push(label); return fallback }
      }
      const receiptFrom = refreshContext.from < refreshContext.rankingMonthFrom ? refreshContext.from : refreshContext.rankingMonthFrom
      const receiptTo = refreshContext.to > refreshContext.rankingMonthTo ? refreshContext.to : refreshContext.rankingMonthTo
      const [
        nextEmployees,
        nextShifts,
        nextRegistrations,
        nextRecords,
        nextAttendanceAdjustments,
        nextMovements,
        nextInventoryReports,
        nextBagAllocations,
        nextBagSessions,
        nextSupplyRequests,
        nextReportSnapshots,
        nextSalesReceipts,
      ] = await Promise.all([
        dataNeeds.has('employees') ? revenueSafe('nhân viên', fetchEmployees(user, { includeInactive: true, readContext }), employees) : Promise.resolve(employees),
        dataNeeds.has('shifts') ? fetchWorkShifts(user, readContext) : Promise.resolve(shifts),
        dataNeeds.has('registrations') ? fetchShiftRegistrations(user, { from: receiptFrom, to: receiptTo, readContext }) : Promise.resolve(registrations),
        dataNeeds.has('records') ? fetchAttendanceRecords(user, { from: receiptFrom, to: receiptTo, readContext }) : Promise.resolve(records),
        dataNeeds.has('adjustments') ? fetchAttendanceAdjustments(user, { from: receiptFrom, to: receiptTo }) : Promise.resolve(attendanceAdjustments),
        dataNeeds.has('movements') ? revenueSafe('kho hàng', Promise.all(managedBranchIds.map((id) => fetchMovements(id, user))).then((items) => items.flat()), movements) : Promise.resolve(movements),
        dataNeeds.has('inventoryReports') ? Promise.all(managedBranchIds.map((id) => fetchInventoryReports(id, user))).then((items) => items.flat()) : Promise.resolve(inventoryReports),
        dataNeeds.has('allocations') ? revenueSafe('phát túi', Promise.all(managedBranchIds.map((id) => fetchBagAllocations(user, { branchId: id }))).then((items) => items.flat()), bagAllocations) : Promise.resolve(bagAllocations),
        dataNeeds.has('sessions') ? Promise.all(managedBranchIds.map((id) => fetchBagShiftSessions(user, { branchId: id, from: receiptFrom, to: receiptTo }))).then((items) => items.flat()) : Promise.resolve(bagSessions),
        dataNeeds.has('requests') ? fetchSupplyRequests(user, managedBranchIds) : Promise.resolve(supplyRequests),
        dataNeeds.has('snapshots') ? revenueSafe('báo cáo ca', Promise.all(managedBranchIds.map((id) => fetchReportSnapshots(id, user))).then((items) => items.flat()), reportSnapshots) : Promise.resolve(reportSnapshots),
        dataNeeds.has('receipts') ? fetchSalesReceiptsRange(user, { branchIds: managedBranchIds, from: receiptFrom, to: receiptTo }) : Promise.resolve(salesReceipts),
      ])
      setEmployees(nextEmployees)
      setShifts(nextShifts)
      setRegistrations(nextRegistrations)
      setRecords(nextRecords)
      setAttendanceAdjustments(nextAttendanceAdjustments)
      setMovements(nextMovements)
      setInventoryReports(nextInventoryReports)
      setBagAllocations(nextBagAllocations)
      setBagSessions(nextBagSessions)
      setSupplyRequests(nextSupplyRequests)
      setReportSnapshots(nextReportSnapshots)
      setSalesReceipts(nextSalesReceipts)
      setError(revenueWarnings.length ? `Doanh thu POS đã tải; chưa tải được dữ liệu phụ: ${revenueWarnings.join(', ')}.` : '')
      } catch (reason) {
        if (showLoading) setError(reason instanceof Error ? reason.message : 'Không thể tải dữ liệu quản lý.')
      } finally {
        if (showLoading) setLoading(false)
      }
    })()
    managementRefreshInFlightRef.current = run
    try {
      await run
    } finally {
      managementRefreshInFlightRef.current = null
      if (managementRefreshQueuedRef.current) {
        managementRefreshQueuedRef.current = false
        void refresh(false)
      }
    }
  }

  useEffect(() => { void refresh(true) }, [user.id, from, to, activeSection, focused])

  useEffect(() => {
    if (activeSection !== 'attendance') return
    if (from > todayKey) setFrom(todayKey)
    if (to > todayKey) setTo(todayKey)
  }, [activeSection, from, to, todayKey])

  useEffect(() => {
    const fallbackDate = todayKey >= from && todayKey <= to ? todayKey : to
    setAttendanceListDate((current) => current >= from && current <= to ? current : fallbackDate)
    setAttendanceListPage(1)
    setAttendanceEdit(null)
    setAttendanceDelete(null)
    setCompetitionDate((current) => current >= from && current <= to ? current : fallbackDate)
  }, [from, to])

  useEffect(() => {
    setAttendanceListBranchId(branchId)
    setAttendanceListEmployeeId('')
    setAttendanceEmployeeSearch('')
    setAttendanceListPage(1)
    setAttendanceEdit(null)
    setAttendanceDelete(null)
  }, [branchId])

  useEffect(() => {
    if (user.role !== 'admin' || (focused && activeSection !== 'accounts')) return
    let active = true
    const loadActiveUsers = () => {
      void fetchActiveUsers(user).then((items) => {
        if (active) setActiveUsers(items)
      }).catch((reason) => {
        // Presence is optional background context. Reconciliation keeps retrying
        // without replacing the user's workspace with a recurring warning.
        void reason
      })
    }
    loadActiveUsers()
    const timer = window.setInterval(loadActiveUsers, 30000)
    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [user.id, user.role, activeSection, focused])

  useEffect(() => {
    const refreshWhenActive = () => void refresh(false)
    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') refreshWhenActive()
    }
    const timer = window.setInterval(refreshWhenActive, 30000)
    window.addEventListener('focus', refreshWhenActive)
    document.addEventListener('visibilitychange', refreshWhenVisible)
    const client = user.authToken ? null : supabase
    if (!client) {
      return () => {
        window.clearInterval(timer)
        window.removeEventListener('focus', refreshWhenActive)
        document.removeEventListener('visibilitychange', refreshWhenVisible)
      }
    }
    const channel = client.channel(uniqueChannelName(`admin-live:${user.id}`))
    const reloadSoon = burstGuard(() => void refresh(false), 400)
    managementRealtimeTables(activeSection, focused).forEach((table) => {
      channel.on('postgres_changes', { event: '*', schema: 'public', table }, reloadSoon)
    })
    channel.subscribe()
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('focus', refreshWhenActive)
      document.removeEventListener('visibilitychange', refreshWhenVisible)
      reloadSoon.cancel()
      void client.removeChannel(channel)
    }
  }, [user.id, user.authToken, from, to, activeSection, focused])

  useEffect(() => {
    let active = true
    const managedBranchIds = permittedBranchIds(user)
    void fetchEmployeeKpiTargets(user, managedBranchIds).then((targets) => {
      if (!active) return
      setEmployeeKpiDrafts(Object.fromEntries(targets.map((target) => [
          employeeKpiKey(target.branchId, target.employeeKey),
          String(target.targetRevenue),
        ])))
    }).catch(() => undefined)
    return () => { active = false }
  }, [user.id, user.branchId])

  const branchIds = permittedBranchIds(user)
  const visibleBranches = branches.filter((branch) => branchIds.includes(branch.id))
  const selectedBranches = visibleBranches.filter((branch) => !branchId || branch.id === branchId)
  const validBranchIds = new Set(visibleBranches.map((branch) => branch.id))
  const filteredEmployees = employees.filter((employee) =>
    employee.active !== false
    && (!employee.branchId || validBranchIds.has(employee.branchId) || employee.role === 'admin' || employee.role === 'manager' || employee.role === 'kitchen')
    && (!branchId || employee.branchId === branchId || employee.role === 'admin' || employee.role === 'manager' || employee.role === 'kitchen')
    && (!employeeId || employee.id === employeeId),
  )
  const payrollProfileCandidates = employees.filter((employee) =>
    PAYROLL_ROLES.includes(employee.role)
    && Boolean(employee.branchId)
    && validBranchIds.has(employee.branchId || '')
    && (!branchId || employee.branchId === branchId)
    && (!employeeId || employee.id === employeeId)
  )
  // Danh sách tài khoản phải giữ cả hồ sơ inactive để Admin nhìn thấy username
  // vẫn đang tồn tại trong Auth và có thể xóa dứt điểm. Các báo cáo bên trên vẫn
  // dùng filteredEmployees nên không đưa nhân sự inactive vào số liệu vận hành.
  const accountEmployees = employees.filter((employee) =>
    (!employee.branchId || validBranchIds.has(employee.branchId) || employee.role === 'admin' || employee.role === 'manager' || employee.role === 'kitchen')
    && (!branchId || employee.branchId === branchId || employee.role === 'admin' || employee.role === 'manager' || employee.role === 'kitchen')
    && (!employeeId || employee.id === employeeId)
    && (employee.hasLoginAccount !== false || Boolean(employee.email)),
  )
  const unassignedEmployeeReceipts = salesReceipts.filter((receipt) => {
    if (receipt.businessDate < from || receipt.businessDate > to) return false
    if (receipt.sellerId) return !accountEmployees.some((employee) => employee.id === receipt.sellerId)
    const matches = accountEmployees.filter((employee) =>
      employee.branchId === receipt.branchId
      && normalizeName(employee.name) === normalizeName(receipt.sellerName),
    )
    return matches.length !== 1
  })
  const rangeRegistrations = registrations.filter((item) =>
    (!branchId || item.branchId === branchId)
    && (!employeeId || item.userId === employeeId)
    && item.workDate >= from && item.workDate <= to,
  )
  const rangeRecords = records.filter((item) => {
    const date = localDateKey(new Date(item.checkInTime))
    return (!branchId || item.branchId === branchId)
      && (!employeeId || item.userId === employeeId)
      && date >= from && date <= to
  })
  const rangeAttendanceAdjustments = attendanceAdjustments.filter((item) =>
    (!branchId || item.branchId === branchId)
    && (!employeeId || item.userId === employeeId)
    && item.workDate >= from
    && item.workDate <= to,
  )
  const graceByShift = useMemo(
    () => new Map(shifts.map((shift) => [shift.id, shift.graceMinutes])),
    [shifts],
  )
  const allAttendanceRows = useMemo(
    () => {
      const registeredKeys = new Set(rangeRegistrations.filter((item) => item.status !== 'rejected').map((item) => `${item.userId}|${item.branchId}`))
      return buildAttendanceReport(rangeRegistrations, rangeRecords, graceByShift)
        .filter((row) => registeredKeys.has(`${row.userId}|${row.branchId}`))
    },
    [rangeRegistrations, rangeRecords, graceByShift],
  )
  const payrollEmployees = useMemo(
    () => buildPayrollEmployeeList(payrollProfileCandidates, allAttendanceRows),
    [payrollProfileCandidates, allAttendanceRows],
  )
  const payrollEmployeeIds = useMemo(
    () => new Set(payrollEmployees.map((employee) => employee.id)),
    [payrollEmployees],
  )
  const payrollEmployeeNames = useMemo(
    () => new Set(payrollEmployees.map((employee) => `${employee.branchId}|${normalizeName(employee.name)}`)),
    [payrollEmployees],
  )
  const attendanceRows = useMemo(
    () => allAttendanceRows.filter((row) =>
      payrollEmployeeIds.has(row.userId)
      || payrollEmployeeNames.has(`${row.branchId}|${normalizeName(row.employeeName)}`),
    ),
    [allAttendanceRows, payrollEmployeeIds, payrollEmployeeNames],
  )
  const allAttendanceDetailRows = useMemo(
    () => buildAttendanceDetailRows(rangeRegistrations, rangeRecords, graceByShift, rangeAttendanceAdjustments)
      .filter((row) => rangeRegistrations.some((registration) => registration.id === row.registrationId)),
    [rangeRegistrations, rangeRecords, graceByShift, rangeAttendanceAdjustments],
  )
  const attendanceDetailRows = useMemo(
    () => allAttendanceDetailRows.filter((row) =>
      payrollEmployeeIds.has(row.userId)
      || payrollEmployeeNames.has(`${row.branchId}|${normalizeName(row.employeeName)}`),
    ),
    [allAttendanceDetailRows, payrollEmployeeIds, payrollEmployeeNames],
  )
  const attendanceListRows = useMemo(
    () => buildAttendanceDetailRows(rangeRegistrations, rangeRecords, graceByShift, rangeAttendanceAdjustments),
    [rangeRegistrations, rangeRecords, graceByShift, rangeAttendanceAdjustments],
  )
  const attendanceAutoCloseErrors = useMemo(
    () => attendanceListRows.filter((row) => isAttendanceAutoClosedError(row.checkOutAddress)),
    [attendanceListRows],
  )
  const attendanceListBranchOptions = visibleBranches.slice().sort((a, b) => a.name.localeCompare(b.name, 'vi'))
  const attendanceListEmployeeOptions = useMemo(() => {
    const byEmployee = new Map<string, { id: string; name: string; branchId: string }>()
    attendanceListRows.forEach((row) => {
      if (attendanceListBranchId && row.branchId !== attendanceListBranchId) return
      if (!row.userId || byEmployee.has(row.userId)) return
      byEmployee.set(row.userId, { id: row.userId, name: row.employeeName, branchId: row.branchId })
    })
    return Array.from(byEmployee.values()).sort((a, b) => a.name.localeCompare(b.name, 'vi'))
  }, [attendanceListRows, attendanceListBranchId])
  const attendanceEmployeeSearchKey = normalizeName(attendanceEmployeeSearch)
  const attendanceListVisibleEmployeeOptions = useMemo(() => (
    attendanceEmployeeSearchKey
      ? attendanceListEmployeeOptions.filter((employee) =>
        normalizeName(`${employee.name} ${branchName(employee.branchId)}`).includes(attendanceEmployeeSearchKey),
      )
      : attendanceListEmployeeOptions
  ), [attendanceListEmployeeOptions, attendanceEmployeeSearchKey])
  const attendanceListFilteredRows = useMemo(() => {
    const branchRows = attendanceListRows.filter((row) =>
      !attendanceListBranchId || row.branchId === attendanceListBranchId,
    )
    const modeRows = attendanceListMode === 'date'
      ? branchRows.filter((row) => row.workDate === attendanceListDate)
      : attendanceListEmployeeId
        ? branchRows.filter((row) => row.userId === attendanceListEmployeeId)
        : attendanceEmployeeSearchKey
          ? branchRows
          : []
    const scopedRows = attendanceEmployeeSearchKey
      ? modeRows.filter((row) =>
        normalizeName(row.employeeName).includes(attendanceEmployeeSearchKey)
        || normalizeName(branchName(row.branchId)).includes(attendanceEmployeeSearchKey),
      )
      : modeRows
    return scopedRows.slice().sort((a, b) =>
      b.workDate.localeCompare(a.workDate)
      || a.employeeName.localeCompare(b.employeeName, 'vi')
      || a.scheduledStart.localeCompare(b.scheduledStart),
    )
  }, [attendanceListRows, attendanceListMode, attendanceListDate, attendanceListBranchId, attendanceListEmployeeId, attendanceEmployeeSearchKey])
  const attendanceListTotalPages = Math.max(1, Math.ceil(attendanceListFilteredRows.length / ATTENDANCE_EDIT_PAGE_SIZE))
  const attendanceListSafePage = Math.min(attendanceListPage, attendanceListTotalPages)
  const attendanceListPageStart = (attendanceListSafePage - 1) * ATTENDANCE_EDIT_PAGE_SIZE
  const attendanceListPageRows = attendanceListFilteredRows.slice(
    attendanceListPageStart,
    attendanceListPageStart + ATTENDANCE_EDIT_PAGE_SIZE,
  )
  const rangeMovements = movements.filter((item) =>
    (!branchId || item.branchId === branchId) && item.shiftDate >= from && item.shiftDate <= to,
  )
  const stockRows = useMemo(
    () => buildInventoryRows(movements, selectedBranches.map((branch) => branch.id), from, to),
    [movements, branchId, from, to],
  )
  const inventoryLedgerRows = useMemo(
    () => rangeMovements.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [rangeMovements],
  )
  /**
   * Sổ phát sinh kho: lọc theo loại phiếu + tìm theo tên/SKU/ghi chú, rồi PHÂN
   * TRANG. Bản cũ render mọi phiếu trong kỳ (một chi nhánh ~90 phiếu/ngày) nên
   * chọn khoảng một tháng là vài nghìn dòng DOM dựng cùng lúc.
   */
  const inventoryLedgerFilteredRows = useMemo(() => {
    const needle = normalizeName(inventoryLedgerSearch)
    return inventoryLedgerRows.filter((row) => {
      if (inventoryLedgerType !== 'all' && row.type !== inventoryLedgerType) return false
      if (!needle) return true
      const product = productById(row.productId)
      return normalizeName(`${product?.name || row.productId} ${product?.sku || ''} ${row.note || ''}`).includes(needle)
    })
  }, [inventoryLedgerRows, inventoryLedgerType, inventoryLedgerSearch])
  const inventoryLedgerTotalPages = Math.max(1, Math.ceil(inventoryLedgerFilteredRows.length / inventoryLedgerPageSize))
  const inventoryLedgerSafePage = Math.min(Math.max(inventoryLedgerPage, 1), inventoryLedgerTotalPages)
  const inventoryLedgerByDay = useMemo(() => {
    const start = (inventoryLedgerSafePage - 1) * inventoryLedgerPageSize
    const map = new Map<string, StockMovement[]>()
    inventoryLedgerFilteredRows
      .slice(start, start + inventoryLedgerPageSize)
      .forEach((row) => { map.set(row.shiftDate, [...(map.get(row.shiftDate) || []), row]) })
    return Array.from(map.entries()).sort((a, b) => b[0].localeCompare(a[0]))
  }, [inventoryLedgerFilteredRows, inventoryLedgerSafePage, inventoryLedgerPageSize])
  const inventoryLedgerTypeCounts = useMemo(() => {
    const counts = new Map<StockMovement['type'], number>()
    inventoryLedgerRows.forEach((row) => counts.set(row.type, (counts.get(row.type) || 0) + 1))
    return counts
  }, [inventoryLedgerRows])
  /**
   * Tồn kho hiển thị ở màn Quản trị › Kho — CÙNG một luật với màn Kho của ca
   * trưởng (`lib/warehouseScope.ts`): chỉ nguyên liệu + bao bì đang bật.
   *
   * Thành phẩm bị loại vì nó dùng trong ngày, không để dồn qua nhiều ngày; giữ
   * lại chỉ tạo ra những dòng vô nghĩa kiểu "Thành phẩm hạt dẻ nướng −6,23 kg".
   * POS vẫn trừ kho thành phẩm như cũ — `calculateStock` không đổi, đây chỉ là
   * lớp hiển thị. Lọc ở ĐÂY là đủ cho cả bảng trên màn lẫn sheet Excel.
   */
  const currentStockRows = useMemo(
    () => selectedBranches.flatMap((branch) =>
      calculateStock(movements.filter((item) => item.branchId === branch.id))
        .filter((line) => isStockManagedProduct(line.product))
        .map((line) => ({ ...line, branchId: branch.id })),
    ),
    [movements, branchId],
  )
  const lowStockRows = currentStockRows.filter((line) => line.expected <= line.product.lowStock)
  const periodInventoryReports = inventoryReports.filter((report) =>
    (!branchId || report.branchId === branchId) && report.reportDate >= from && report.reportDate <= to,
  )
  const totalHours = attendanceRows.reduce((sum, row) => sum + row.totalHours, 0)
  const totalShifts = attendanceRows.reduce((sum, row) => sum + row.totalShifts, 0)
  const activeNow = records.filter((record) => !record.checkOutTime && (!branchId || record.branchId === branchId)).length
  const wasteRows = buildWasteRows(rangeMovements)
  const overviewBillRows = useMemo(
    () => salesReceipts
      .filter((receipt) =>
        receipt.businessDate >= from
        && receipt.businessDate <= to
        && (!branchId || receipt.branchId === branchId),
      )
      .slice()
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id)),
    [salesReceipts, branchId, from, to],
  )
  const inventorySaleOutMovements = movements
    .filter((item) =>
      item.type === 'sale_out'
      && item.shiftDate >= from
      && item.shiftDate <= to
      && validBranchIds.has(item.branchId)
      && (!branchId || item.branchId === branchId),
    )
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  const inventoryDailyOutboundRows = buildDailyOutboundRows(inventorySaleOutMovements)
  const inventoryDailyOutboundSummary = summarizeInventoryQuantities(
    inventoryDailyOutboundRows.map((row) => ({ quantity: row.quantity, unit: row.unit })),
  )
  const inventoryDailyOutboundDocumentCount = new Set(
    inventorySaleOutMovements.map((item) => item.documentId || item.id),
  ).size
  const inventoryShiftReconciliationRows = buildShiftInventoryReconciliation(
    bagSessions,
    salesReceipts,
    movements,
    from,
    to,
    validBranchIds,
    branchId,
  )
  const inventoryShiftPosSummary = summarizeInventoryQuantities(
    inventoryShiftReconciliationRows.flatMap((row) => row.posNativeQuantities),
    'Chưa có POS',
  )
  const inventoryShiftOfficialOutSummary = summarizeInventoryQuantities(
    inventoryShiftReconciliationRows.flatMap((row) =>
      row.lines
        .filter((line) => line.officialOut !== null)
        .map((line) => ({ quantity: line.officialOut || 0, unit: line.unit })),
    ),
    inventoryShiftReconciliationRows.some((row) => row.status === 'open') ? 'Chờ bàn giao' : 'Không phát sinh',
  )
  const inventoryClosedShiftCount = inventoryShiftReconciliationRows.filter((row) => row.status === 'closed').length
  const branchInventorySummaries = selectedBranches.map((branch) => {
    const stockLines = currentStockRows.filter((line) => line.branchId === branch.id)
    const lowCount = stockLines.filter((line) => line.expected <= line.product.lowStock && Math.abs(line.expected) > 0.0001).length
    const branchStockRows = stockRows.filter((row) => row.branchId === branch.id)
    const wasteMovements = rangeMovements.filter((item) => item.branchId === branch.id && item.type === 'waste')
    const lossQty = wasteMovements.reduce((sum, item) => sum + item.quantity, 0)
    const lossSource = wasteMovements.reduce((sum, item) => sum + (item.sourceQuantity || 0), 0)
    const lossRate = lossSource > 0 ? (lossQty / lossSource) * 100 : 0
    const topLoss = branchStockRows.filter((row) => row.waste > 0).sort((a, b) => b.waste - a.waste).slice(0, 3)
    const stockSummary = summarizeInventoryQuantities(
      stockLines.filter((line) => line.expected > 0.0001).map((line) => ({ quantity: line.expected, unit: line.product.unit })),
      'Không có tồn',
    )
    const inboundSummary = summarizeInventoryQuantities(
      branchStockRows.filter((row) => row.inbound > 0).map((row) => ({ quantity: row.inbound, unit: row.product.unit })),
    )
    const outboundSummary = summarizeInventoryQuantities(
      branchStockRows.filter((row) => row.outbound > 0).map((row) => ({ quantity: row.outbound, unit: row.product.unit })),
    )
    const lossSummary = summarizeInventoryQuantities(
      branchStockRows.filter((row) => row.waste > 0).map((row) => ({ quantity: row.waste, unit: row.product.unit })),
    )
    // Phần sổ được sửa tay trong kỳ — chính là chênh lệch mà cột Nhập/Xuất không
    // giải thích được. Không hiện ra thì bảng kho trông như tự nhảy số.
    const adjustSummary = summarizeInventoryQuantities(
      branchStockRows.filter((row) => Math.abs(row.adjust) > 0.0005).map((row) => ({ quantity: row.adjust, unit: row.product.unit })),
      'Không sửa tồn',
    )
    const branchShiftRows = inventoryShiftReconciliationRows.filter((row) => row.branchId === branch.id)
    const dailyPosSummary = summarizeInventoryQuantities(
      branchShiftRows
        .flatMap((row) => row.posNativeQuantities)
        .map((row) => ({ quantity: row.quantity, unit: row.unit })),
      'Chưa có POS',
    )
    return {
      branch,
      lowCount,
      lossQty,
      lossRate,
      topLoss,
      stockLines,
      stockSummary,
      inboundSummary,
      outboundSummary,
      lossSummary,
      adjustSummary,
      dailyPosSummary,
    }
  })
  const inventoryDetailSummary = branchInventorySummaries.find(({ branch }) => branch.id === inventoryDetailBranchId) || null
  const inventoryOverview = {
    branches: selectedBranches.length,
    stockedSkus: currentStockRows.filter((line) => line.expected > 0.0001).length,
    lowSkus: lowStockRows.filter((line) => Math.abs(line.expected) > 0.0001).length,
    movements: rangeMovements.length,
  }
  /**
   * Bảng tồn của một chi nhánh: xếp theo MỨC ĐỘ CẦN XỬ LÝ (hết → sắp hết → còn
   * hàng) thay vì theo tên. Quản lý mở màn này để biết phải đặt hàng gì, không
   * phải để tra từ điển — bản cũ sắp theo alphabet nên mặt hàng đã hết nằm lẫn
   * đâu đó giữa 30 dòng. Kèm ô tìm không dấu và 3 chip lọc.
   */
  const inventoryStockLines = useMemo(() => {
    if (!inventoryDetailSummary) return []
    const needle = normalizeName(inventorySkuSearch)
    const severity = (line: { expected: number; product: Product }) =>
      line.expected <= 0.0001 ? 0 : line.expected <= line.product.lowStock ? 1 : 2
    return inventoryDetailSummary.stockLines
      .filter((line) => {
        if (needle && !normalizeName(`${line.product.name} ${line.product.sku}`).includes(needle)) return false
        if (inventoryStockFilter === 'out') return line.expected <= 0.0001
        if (inventoryStockFilter === 'attention') return line.expected <= line.product.lowStock
        return true
      })
      .slice()
      .sort((a, b) => severity(a) - severity(b) || a.product.name.localeCompare(b.product.name, 'vi'))
  }, [inventoryDetailSummary, inventorySkuSearch, inventoryStockFilter])
  const inventoryStockOutCount = inventoryDetailSummary
    ? inventoryDetailSummary.stockLines.filter((line) => line.expected <= 0.0001).length
    : 0
  // Ca "cần xem": chưa bàn giao, hoặc đã bàn giao mà số kho lệch so với POS.
  const inventoryShiftIssueRows = inventoryShiftReconciliationRows.filter((row) =>
    row.status === 'open' || row.lines.some((line) => line.difference !== null && Math.abs(line.difference) > 0.0005),
  )
  const inventoryShiftVisibleRows = inventoryShiftOnlyIssues && inventoryShiftIssueRows.length
    ? inventoryShiftIssueRows
    : inventoryShiftReconciliationRows
  // `commissionRows` (bộ thẻ thưởng KPI theo bộ lọc đầu trang) đã bị gỡ 07/08/2026:
  // nó lặp lại đúng nhóm người của bảng xếp hạng nhưng lấy KHOẢNG NGÀY khác nên
  // hai khối cạnh nhau hiện hai con số khác nhau cho cùng một nhân viên.
  const dailyKpiRows = useMemo(
    () => buildDailyEmployeeKpiRows(
      bagAllocations.filter((item) => {
        const date = allocationReportDate(item)
        return soldBagQuantity(item) > 0 && date >= from && date <= to && (!branchId || item.branchId === branchId)
      }),
      salesReceipts.filter((receipt) => receipt.businessDate >= from && receipt.businessDate <= to && (!branchId || receipt.branchId === branchId)),
      payrollEmployees,
      attendanceDetailRows,
      from,
      to,
    ),
    [bagAllocations, salesReceipts, payrollEmployees, attendanceDetailRows, branchId, from, to],
  )
  const monthlyDailyKpiRows = useMemo(
    () => buildDailyEmployeeKpiRows(
      bagAllocations.filter((item) => {
        const date = allocationReportDate(item)
        return date >= rankingMonthFrom
          && date <= rankingMonthTo
          && competitionDayMatches(date, competitionDayType)
          && (!branchId || item.branchId === branchId)
      }),
      salesReceipts.filter((receipt) =>
        receipt.businessDate >= rankingMonthFrom
        && receipt.businessDate <= rankingMonthTo
        && competitionDayMatches(receipt.businessDate, competitionDayType)
        && (!branchId || receipt.branchId === branchId),
      ),
      payrollEmployees,
      attendanceDetailRows,
      rankingMonthFrom,
      rankingMonthTo,
    ),
    [bagAllocations, salesReceipts, payrollEmployees, attendanceDetailRows, branchId, rankingMonthFrom, rankingMonthTo, competitionDayType],
  )
  const monthlyCompetitionRows = useMemo(() => {
    const includedDates = competitionDayType === 'all'
      ? undefined
      : competitionDateKeys(rankingMonthFrom, rankingMonthTo, competitionDayType)
    const rows = buildCommissionRows(
      bagAllocations.filter((item) => {
        const date = allocationReportDate(item)
        return soldBagQuantity(item) > 0
          && date >= rankingMonthFrom && date <= rankingMonthTo
          && competitionDayMatches(date, competitionDayType)
          && (!branchId || item.branchId === branchId)
      }),
      payrollEmployees,
      [],
      salesReceipts.filter((receipt) =>
        receipt.businessDate >= rankingMonthFrom
        && receipt.businessDate <= rankingMonthTo
        && competitionDayMatches(receipt.businessDate, competitionDayType)
        && (!branchId || receipt.branchId === branchId),
      ),
      commissionRuleDrafts,
      employeeKpiDrafts,
      rankingMonthFrom,
      rankingMonthTo,
      includedDates,
    )
    const checkedInRecords = filterCompetitionAttendanceRecords(records, registrations, {
      from: rankingMonthFrom,
      to: rankingMonthTo,
      dayType: competitionDayType,
      branchId,
    })
    return buildCompetitionRows(rows, checkedInRecords, payrollEmployees, registrations)
  }, [bagAllocations, payrollEmployees, salesReceipts, registrations, records, commissionRuleDrafts, employeeKpiDrafts, branchId, rankingMonthFrom, rankingMonthTo, competitionDayType])
  const dailyCompetitionRows = useMemo(() => {
    const dateIncluded = competitionDayMatches(competitionDate, competitionDayType)
    const includedDates = competitionDayType === 'all' ? undefined : dateIncluded ? [competitionDate] : []
    const rows = buildCommissionRows(
      bagAllocations.filter((item) => dateIncluded && allocationReportDate(item) === competitionDate && (!branchId || item.branchId === branchId)),
      payrollEmployees,
      [],
      salesReceipts.filter((receipt) => dateIncluded && receipt.businessDate === competitionDate && (!branchId || receipt.branchId === branchId)),
      commissionRuleDrafts,
      employeeKpiDrafts,
      competitionDate,
      competitionDate,
      includedDates,
    )
    const checkedInRecords = dateIncluded
      ? filterCompetitionAttendanceRecords(records, registrations, {
          from: competitionDate,
          to: competitionDate,
          dayType: competitionDayType,
          branchId,
        })
      : []
    return buildCompetitionRows(rows, checkedInRecords, payrollEmployees, registrations)
  }, [bagAllocations, payrollEmployees, salesReceipts, registrations, records, commissionRuleDrafts, employeeKpiDrafts, branchId, competitionDate, competitionDayType])
  const leaderCompetitionRows = useMemo(() => {
    return buildShiftLeaderRevenueRows(
      bagSessions.filter((session) => competitionDayMatches(session.businessDate, competitionDayType)),
      salesReceipts,
      {
      branchIds: selectedBranches.map((branch) => branch.id),
      from: rankingMonthFrom,
      to: rankingMonthTo,
      targetForSession: (session) => {
        const profile = employees.find((employee) =>
          employee.branchId === session.branchId
          && (employee.id === session.leaderId || normalizeName(employee.name) === normalizeName(session.leaderName)),
        )
        return employeePeriodRevenueTarget(
          session.branchId,
          profile?.role || 'shift_leader',
          profile?.employmentType || 'leader',
          profile?.positionTitle || 'Ca trưởng',
          session.businessDate,
          session.businessDate,
        )
      },
    })
      .filter((row) => row.revenue > 0)
      .map((row) => {
        const profile = employees.find((employee) =>
          employee.branchId === row.branchId
          && (employee.id === row.leaderKey || normalizeName(employee.name) === normalizeName(row.leaderName)),
        )
        // Ca trưởng không có bản ghi chấm công trong bảng này, nên ngày/tháng
        // lấy từ chính sổ ca: một ca trưởng trực 2 ca trong ngày vẫn là 1 ngày.
        const leaderDays = new Set<string>()
        bagSessions.forEach((session) => {
          if (session.branchId !== row.branchId) return
          if (session.businessDate < rankingMonthFrom || session.businessDate > rankingMonthTo) return
          if (!competitionDayMatches(session.businessDate, competitionDayType)) return
          const sameLeader = session.leaderId === row.leaderKey
            || normalizeName(session.leaderName) === normalizeName(row.leaderName)
          if (sameLeader) leaderDays.add(session.businessDate)
        })
        return {
          employeeKey: profile?.id || row.leaderKey,
          employeeName: profile?.name || row.leaderName,
          branchId: row.branchId,
          avatarUrl: profile?.avatarUrl,
          soldQuantity: row.soldQuantity,
          revenue: row.revenue,
          commission: 0,
          totalHours: 0,
          shiftCount: row.shiftCount,
          dayCount: leaderDays.size,
          monthCount: new Set(Array.from(leaderDays, (date) => date.slice(0, 7))).size,
          role: 'shift_leader' as Role,
          targetRevenue: row.targetRevenue,
          progress: row.progress,
          rank: kpiRank(row.progress),
          score: Math.round(row.revenue / 10000 + row.progress),
          detail: `${row.shiftCount} ca · ${row.achievedShiftCount} ca đạt KPI`,
        }
      })
  }, [bagSessions, salesReceipts, employees, branchId, rankingMonthFrom, rankingMonthTo, selectedBranches.length, competitionDayType])
  const competitionBaseRows = competitionRankingMode === 'daily'
    ? dailyCompetitionRows
    : competitionRankingMode === 'monthly'
      ? monthlyCompetitionRows
      : leaderCompetitionRows
  const effectiveCompetitionRole = competitionRankingMode === 'leaders' ? 'shift_leader' : competitionRoleFilter
  const minimumCompetitionShifts = nonNegativeFilterNumber(competitionMinShifts, 0)
  const maximumCompetitionShifts = nonNegativeFilterNumber(competitionMaxShifts, Number.POSITIVE_INFINITY)
  const competitionFilteredRows = competitionBaseRows.filter((row) =>
    (effectiveCompetitionRole === 'all' || row.role === effectiveCompetitionRole)
    && row.shiftCount >= minimumCompetitionShifts
    && row.shiftCount <= maximumCompetitionShifts,
  )
  // Năng suất bán trung bình dùng ĐÚNG tập nhân sự của bảng xếp hạng đang xem
  // (cùng phân loại, vai trò, loại ngày, khoảng số ca) để hai bảng không đá nhau.
  // Bảng ca trưởng không có giờ công nên chỉ số theo giờ tự quay về theo ca.
  // Thi đua "Theo ngày" chỉ có đúng một ngày trong kỳ ⇒ trung bình/tháng không
  // nói lên gì, tự quay về trung bình/ngày thay vì hiện một con số vô nghĩa.
  const capacityHasMonths = competitionFilteredRows.some((row) => row.monthCount > 0)
    && competitionRankingMode !== 'daily'
  const effectiveCapacityMetric: SalesCapacityMetric = capacityMetric === 'revenuePerMonth' && !capacityHasMonths
    ? 'revenuePerDay'
    : capacityMetric
  const salesCapacity = buildEmployeeSalesCapacity(competitionFilteredRows, effectiveCapacityMetric)
  // Năng suất được ghép THẲNG vào bảng xếp hạng (một dòng = một người) thay vì
  // dựng thêm một danh sách thứ hai của cùng nhóm người.
  const competitionCapacityByKey = useMemo(() => {
    const map = new Map<string, SalesCapacityRow>()
    salesCapacity.rows.forEach((row) => map.set(`${row.branchId}-${row.employeeKey}`, row))
    return map
  }, [salesCapacity])
  const competitionSortedRows = useMemo(() => {
    // 'revenue' giữ nguyên thứ tự gốc của buildCompetitionRows (doanh thu →
    // tiến độ → số lượng → giờ công → tên) để không đổi ngữ nghĩa xếp hạng cũ.
    if (competitionSort === 'revenue') return competitionFilteredRows
    const valueOf = (row: typeof competitionFilteredRows[number]) => {
      if (competitionSort === 'progress') return row.progress
      if (competitionSort === 'reward') return row.commission
      return competitionCapacityByKey.get(`${row.branchId}-${row.employeeKey}`)?.value || 0
    }
    return competitionFilteredRows.slice().sort((a, b) =>
      valueOf(b) - valueOf(a) || b.revenue - a.revenue || a.employeeName.localeCompare(b.employeeName, 'vi'),
    )
  }, [competitionFilteredRows, competitionSort, competitionCapacityByKey])
  const competitionRankingRows = competitionShowAll
    ? competitionSortedRows
    : competitionSortedRows.slice(0, COMPETITION_TOP_ROWS)
  const competitionAchievedCount = competitionFilteredRows.filter((row) => row.progress >= 100).length
  const competitionTotalRevenue = competitionFilteredRows.reduce((sum, row) => sum + row.revenue, 0)
  const competitionTotalReward = competitionFilteredRows.reduce((sum, row) => sum + row.commission, 0)
  const competitionExportRows = (competitionRankingMode === 'leaders' ? leaderCompetitionRows : monthlyCompetitionRows)
    .filter((row) =>
      (effectiveCompetitionRole === 'all' || row.role === effectiveCompetitionRole)
      && row.shiftCount >= minimumCompetitionShifts
      && row.shiftCount <= maximumCompetitionShifts,
    )
  // Ảnh thi đua ăn ĐÚNG bộ lọc đang hiển thị. Bản cũ chụp `monthlyCompetitionRows`
  // thô nên ảnh gửi Zalo có cả người mà bảng trên màn hình đã lọc bỏ.
  const competitionPosterRows = competitionExportRows
  const competitionRangeFrom = competitionRankingMode === 'daily' ? competitionDate : rankingMonthFrom
  const competitionRangeTo = competitionRankingMode === 'daily' ? competitionDate : rankingMonthTo
  /**
   * KPI từng ngày giờ nằm TRONG dòng của chính người đó (bấm mở ra), không còn
   * là một bảng riêng ở cuối màn — bảng cũ trộn mọi nhân viên × mọi ngày nên
   * đọc một người phải tự dò bằng mắt qua hàng trăm dòng.
   */
  const competitionDailyKpiByKey = useMemo(() => {
    const map = new Map<string, DailyEmployeeKpiRow[]>()
    monthlyDailyKpiRows
      .filter((row) => row.date >= competitionRangeFrom && row.date <= competitionRangeTo)
      .forEach((row) => {
        const key = `${row.branchId}-${row.employeeKey}`
        map.set(key, [...(map.get(key) || []), row])
      })
    map.forEach((rows) => rows.sort((a, b) => a.date.localeCompare(b.date)))
    return map
  }, [monthlyDailyKpiRows, competitionRangeFrom, competitionRangeTo])
  const competitionEvidenceAllocations = useMemo(
    () => bagAllocations.filter((item) => competitionDayMatches(allocationReportDate(item), competitionDayType)),
    [bagAllocations, competitionDayType],
  )
  const competitionEvidenceReceipts = useMemo(
    () => salesReceipts.filter((receipt) => competitionDayMatches(receipt.businessDate, competitionDayType)),
    [salesReceipts, competitionDayType],
  )
  const competitionEvidenceSessions = useMemo(
    () => bagSessions.filter((session) => competitionDayMatches(session.businessDate, competitionDayType)),
    [bagSessions, competitionDayType],
  )
  const competitionRankingBaseTitle = competitionRankingMode === 'daily'
    ? `Nhân viên theo ngày ${formatDate(competitionDate)}`
    : competitionRankingMode === 'monthly'
      ? `Nhân viên theo tháng ${rankingPeriod}`
      : `Ca trưởng theo tháng ${rankingPeriod}`
  const competitionRankingTitle = competitionDayType === 'all'
    ? competitionRankingBaseTitle
    : `${competitionRankingBaseTitle} · ${competitionDayTypeLabel(competitionDayType)}`
  const businessProductRows = useMemo(
    () => buildBusinessProductRows(salesReceipts, bagAllocations, {
      branchIds: selectedBranches.map((branch) => branch.id),
      from,
      to,
    }),
    [salesReceipts, bagAllocations, branchId, from, to, selectedBranches.length],
  )
  const pendingRequests = supplyRequests.filter((r) => r.status === 'pending').length

  const periodSnapshots = (() => {
    const sorted = reportSnapshots
      .filter((snap) =>
        (!branchId || snap.branchId === branchId)
        && snap.reportDate >= from
        && snap.reportDate <= to,
      )
      .sort((a, b) => b.reportDate.localeCompare(a.reportDate) || b.createdAt.localeCompare(a.createdAt))
    const latestByDay = new Map<string, ReportSnapshot>()
    sorted.forEach((snap) => {
      const key = `${snap.branchId}|${snap.reportDate}`
      if (!latestByDay.has(key)) latestByDay.set(key, snap)
    })
    return Array.from(latestByDay.values())
  })()
  const periodRevenueRows = buildDailyRevenueRows(reportSnapshots, bagAllocations, movements, { branchId, from, to, receipts: salesReceipts })
  const adminRevenueTrendRows = buildAdminDailyTrendRows(periodRevenueRows, { from, to })
  const adminRevenueArea = buildAdminAreaChart(adminRevenueTrendRows, Math.max(...adminRevenueTrendRows.map((row) => row.revenue), 1))
  function setQuickRange(kind: 'today' | 'month' | 'previousMonth') {
    const range = kind === 'today' ? { from: localDateKey(), to: localDateKey() }
      : kind === 'month' ? monthRange()
        : monthRange(-1)
    setFrom(range.from)
    setTo(range.to)
  }

  function setAttendanceCorrectionMonth(month: string) {
    if (!/^\d{4}-\d{2}$/.test(month) || month > currentMonthKey) return
    const monthEnd = lastDayOfMonth(month)
    const preferredDay = Number(attendanceListDate.slice(8, 10)) || 1
    const lastDay = Number(monthEnd.slice(8, 10))
    const candidateDate = `${month}-${String(Math.min(preferredDay, lastDay)).padStart(2, '0')}`
    const selectedDate = candidateDate > todayKey ? todayKey : candidateDate
    setFrom(`${month}-01`)
    setTo(lastDayOfMonth(month))
    setAttendanceListDate(selectedDate)
    setAttendanceListPage(1)
    setAttendanceEdit(null)
    setAttendanceDelete(null)
  }

  function moveAttendanceCorrectionMonth(amount: number) {
    setAttendanceCorrectionMonth(shiftMonthKey(attendanceCorrectionMonth, amount))
  }

  async function changeRole(employee: EmployeeProfile, role: Role) {
    setSavingRoleId(employee.id)
    try {
      await updateEmployeeRole(user, employee.id, role)
      setEmployees((items) => items.map((item) => item.id === employee.id ? { ...item, role } : item))
      setFeedback(`Đã cập nhật ${employee.name} thành ${roleLabel(role)}.`)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Không thể cập nhật phân quyền.')
    } finally {
      setSavingRoleId('')
    }
  }

  async function createAccount(event: React.FormEvent) {
    event.preventDefault()
    setAccountBusyId('create')
    try {
      const username = validateUsername(accountUsername)
      if (accountPassword.length < 6) throw new Error('Mật khẩu cần ít nhất 6 ký tự.')
      const employee = await createEmployeeAccount(user, {
        name: accountName.trim(),
        username,
        branchId: isBranchlessRole(accountRole) ? undefined : accountBranchId,
        role: accountRole,
        employmentType: accountEmploymentType,
        positionTitle: accountPositionTitle.trim(),
        password: accountPassword,
      })
      setEmployees((items) => [employee, ...items])
      setTemporaryCredential({ username, password: accountPassword })
      setAccountName('')
      setAccountUsername('')
      setAccountPassword('')
      setAccountRole('staff')
      setAccountEmploymentType('part_time')
      setAccountPositionTitle('Part-time')
      setShowCreateAccount(false)
      setFeedback(`Đã tạo tài khoản và mật khẩu cho ${employee.name}.`)
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : 'Không thể tạo tài khoản.'
      setError(message)
    } finally {
      setAccountBusyId('')
    }
  }

  async function resetPassword(employee: EmployeeProfile) {
    const newPassword = window.prompt(`Nhập mật khẩu mới cho ${employee.name} (ít nhất 6 ký tự):`)
    if (newPassword === null) return
    if (newPassword.length < 6) {
      setError('Mật khẩu cần ít nhất 6 ký tự.')
      return
    }
    setAccountBusyId(employee.id)
    try {
      await resetEmployeePassword(user, employee.id, newPassword)
      setTemporaryCredential({ username: emailToUsername(employee.email) || employee.id, password: newPassword })
      setFeedback(`Đã đặt lại mật khẩu cho ${employee.name}.`)
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : 'Không thể đặt lại mật khẩu.'
      setError(message)
    } finally {
      setAccountBusyId('')
    }
  }

  async function removeAccount(employee: EmployeeProfile) {
    if (pendingDeleteId !== employee.id) {
      setPendingDeleteId(employee.id)
      setFeedback(`Bấm “Xác nhận xóa” lần nữa để xóa hẳn tài khoản ${employee.name}. Lịch, chấm công và lương liên quan sẽ bị xóa; hóa đơn vẫn được giữ để đối soát nhưng không còn gắn tài khoản này.`)
      return
    }
    setAccountBusyId(employee.id)
    try {
      await deleteEmployeeAccount(user, employee.id)
      setEmployees((items) => items.filter((item) => item.id !== employee.id))
      if (employeeId === employee.id) setEmployeeId('')
      if (crmEmployeeId === employee.id) {
        setCrmEmployeeId('')
        navigateAdminHash('/admin/employees')
      }
      setPendingDeleteId('')
      setFeedback(`Đã xóa hẳn tài khoản ${employee.name}.`)
      await refresh(false)
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : 'Không thể xóa tài khoản.'
      setError(message)
    } finally {
      setAccountBusyId('')
    }
  }

  function employeeDraft(employee: EmployeeProfile) {
    return employeeDrafts[employee.id] || {
      branchId: employee.branchId || user.branchId,
      employmentType: employee.employmentType || (employee.role === 'shift_leader' ? 'leader' : 'part_time'),
      positionTitle: employee.positionTitle || roleLabel(employee.role),
      avatarUrl: employee.avatarUrl || '',
    }
  }

  function updateEmployeeDraft(employee: EmployeeProfile, patch: Partial<ReturnType<typeof employeeDraft>>) {
    setEmployeeDrafts((items) => ({
      ...items,
      [employee.id]: { ...employeeDraft(employee), ...patch },
    }))
  }

  function openEmployeeCrm(employee: EmployeeProfile) {
    navigateAdminHash(`/admin/employees/${encodeURIComponent(employee.id)}/overview`)
    setCrmBranchId('')
    setCrmEmployeeId(employee.id)
    setEmployeeProfileTab('overview')
  }

  useEffect(() => {
    if (!crmEmployeeId) return
    const employee = employees.find((item) => item.id === crmEmployeeId)
    if (!employee) return
    setEmployeeCrmDraft({
      employmentStatus: employee.employmentStatus || (employee.active === false ? 'ended' : 'working'),
      employmentStartDate: employee.employmentStartDate || '',
      probationEndDate: employee.probationEndDate || '',
      employmentEndDate: employee.employmentEndDate || '',
      employmentNote: employee.employmentNote || '',
    })
  }, [crmEmployeeId, employees, user.id])

  async function saveEmployeeCrm(employee: EmployeeProfile) {
    setEmployeeCrmSaving(true)
    setError('')
    setFeedback('')
    try {
      const updated = await updateEmployeeCrmDetails(user, employee.id, employeeCrmDraft)
      setEmployees((items) => items.map((item) => item.id === employee.id ? { ...item, ...updated } : item))
      setFeedback(`Đã cập nhật trạng thái việc làm của ${employee.name}.`)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Không thể cập nhật trạng thái việc làm.')
    } finally {
      setEmployeeCrmSaving(false)
    }
  }

  async function createBranchFromCrm(event: React.FormEvent) {
    event.preventDefault()
    const name = branchDraft.name.trim()
    const id = (branchDraft.id || name)
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
    if (!id || !name) return
    const branch: ConfigBranch = {
      id,
      name,
      address: branchDraft.address.trim(),
      manager: branchDraft.manager.trim(),
      active: true,
      source: 'custom',
    }
    const next: ConfigBranch[] = [
      branch,
      ...branches.filter((item) => item.id !== id).map((item) => ({
        ...item,
        address: 'address' in item ? String(item.address || '') : '',
        manager: 'manager' in item ? String(item.manager || '') : '',
        active: 'active' in item ? item.active !== false : true,
        source: 'source' in item && item.source === 'custom' ? 'custom' as const : 'system' as const,
      })),
    ]
    try {
      await syncConfiguredBranchRows(user, next)
      writeConfiguredBranchRows(next)
      await ensureDefaultWorkShifts(user, branch)
      setBranchDraft({ id: '', name: '', address: '', manager: '' })
      setShowCreateBranch(false)
      setFeedback(`Đã tạo chi nhánh ${name} và khung ca mặc định.`)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Không thể tạo chi nhánh.')
    }
  }

  async function removeBranchFromOperations(branchToRemove: Branch) {
    if (user.role !== 'admin') {
      setError('Chỉ Admin hệ thống được xóa chi nhánh khỏi danh sách hoạt động.')
      return
    }
    const confirmed = window.confirm(
      `Xóa chi nhánh “${branchToRemove.name}” khỏi danh sách hoạt động?\n\n`
      + 'Dữ liệu bán hàng, kho, chấm công, lương và báo cáo cũ vẫn được giữ nguyên. Chi nhánh có thể được mở lại sau.',
    )
    if (!confirmed) return
    const next = branches.map((branch) => ({
      ...branch,
      address: 'address' in branch ? String(branch.address || '') : '',
      manager: 'manager' in branch ? String(branch.manager || '') : '',
      active: branch.id === branchToRemove.id ? false : ('active' in branch ? branch.active !== false : true),
      source: 'source' in branch && branch.source === 'custom' ? 'custom' as const : 'system' as const,
    }))
    setBranchDeletingId(branchToRemove.id)
    setError('')
    try {
      await syncConfiguredBranchRows(user, next)
      writeConfiguredBranchRows(next)
      if (branchId === branchToRemove.id) setBranchId('')
      setFeedback(`Đã xóa chi nhánh ${branchToRemove.name} khỏi danh sách hoạt động. Dữ liệu lịch sử vẫn được giữ nguyên.`)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Không thể xóa chi nhánh khỏi danh sách hoạt động.')
    } finally {
      setBranchDeletingId('')
    }
  }

  async function saveEmployeeDetails(employee: EmployeeProfile) {
    const draft = employeeDraft(employee)
    setSavingEmployeeDetailsId(employee.id)
    setError('')
    setFeedback('')
    try {
      const updated = await updateEmployeeDetails(user, employee.id, {
        ...draft,
        branchId: employee.role === 'manager' || employee.role === 'kitchen' ? undefined : draft.branchId,
      })
      if (updated.id === user.id) dispatchCurrentUserProfile(user, updated)
      setEmployees((items) => items.map((item) => item.id === employee.id ? { ...item, ...updated } : item))
      setEmployeeDrafts((items) => {
        const next = { ...items }
        delete next[employee.id]
        return next
      })
      setFeedback(`Đã cập nhật hồ sơ làm việc của ${employee.name}.`)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Không thể cập nhật hồ sơ nhân viên.')
    } finally {
      setSavingEmployeeDetailsId('')
    }
  }

  async function updateEmployeeAvatar(employee: EmployeeProfile, file: File | undefined) {
    if (!file) return
    if (!file.type.startsWith('image/')) {
      setError('Vui lòng chọn file ảnh đại diện.')
      return
    }
    if (file.size > 8000000) {
      setError('Ảnh đại diện quá lớn. Hãy chọn ảnh dưới 8MB.')
      return
    }
    setSavingEmployeeDetailsId(employee.id)
    try {
      const avatarUrl = await fileToAvatarDataUrl(file)
      updateEmployeeDraft(employee, { avatarUrl })
      const updated = await updateEmployeeDetails(user, employee.id, { avatarUrl })
      if (updated.id === user.id) dispatchCurrentUserProfile(user, updated)
      setEmployees((items) => items.map((item) => item.id === employee.id ? { ...item, ...updated } : item))
      setEmployeeDrafts((items) => {
        const next = { ...items }
        delete next[employee.id]
        return next
      })
      setFeedback(`Đã cập nhật ảnh đại diện của ${employee.name}.`)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Không thể lưu ảnh đại diện.')
    } finally {
      setSavingEmployeeDetailsId('')
    }
  }

  const rangeSupplyRequests = supplyRequests.filter((req) => {
    const date = req.createdAt.slice(0, 10)
    return (!branchId || req.branchId === branchId)
      && (!employeeId || req.requestedBy === employeeId)
      && date >= from && date <= to
  })
  // Phân loại đơn đặt hàng: lọc theo trạng thái rồi gom theo chi nhánh. Danh sách và Excel
  // dùng CHUNG một tập đã lọc để cái nhìn trên màn hình khớp đúng file xuất ra.
  const supplyStatusCounts = {
    all: rangeSupplyRequests.length,
    pending: rangeSupplyRequests.filter((req) => req.status === 'pending').length,
    acknowledged: rangeSupplyRequests.filter((req) => req.status === 'acknowledged').length,
    fulfilled: rangeSupplyRequests.filter((req) => req.status === 'fulfilled').length,
    cancelled: rangeSupplyRequests.filter((req) => req.status === 'cancelled').length,
  }
  const filteredSupplyRequests = rangeSupplyRequests.filter((req) =>
    supplyStatusFilter === 'all' || req.status === supplyStatusFilter)
  // Gom theo chính branchId có trong dữ liệu (không lấy từ danh sách chi nhánh) để đơn của
  // chi nhánh đã đổi tên/ngừng hoạt động vẫn hiện thay vì bị rơi mất.
  const supplyRequestsByBranch = Array.from(new Set(filteredSupplyRequests.map((req) => req.branchId)))
    .sort((a, b) => branchName(a).localeCompare(branchName(b), 'vi'))
    .map((id) => ({
      branchId: id,
      requests: filteredSupplyRequests.filter((req) => req.branchId === id),
    }))

  async function runExport(kind: string, emptyMessage: string, task: () => void | Promise<void>, successMessage: string) {
    if (exportBusy) return
    if (emptyMessage) {
      setFeedback(emptyMessage)
      return
    }
    setExportBusy(kind)
    setError('')
    try {
      await task()
      setFeedback(successMessage)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Không thể xuất dữ liệu.')
    } finally {
      setExportBusy('')
    }
  }

  async function exportCompetitionImage() {
    const target = competitionPosterRef.current
    if (!target) return
    if (!competitionPosterRows.length) {
      setFeedback('Chưa có dữ liệu thi đua để xuất ảnh.')
      return
    }
    setExportBusy('competition-image')
    setError('')
    try {
      const { default: html2canvas } = await import('html2canvas')
      const canvas = await html2canvas(target, {
        scale: 2,
        backgroundColor: '#f8faf4',
        useCORS: true,
        logging: false,
      })
      const link = document.createElement('a')
      link.download = `thi-dua-nhan-vien-${from}-${to}.jpg`
      link.href = canvas.toDataURL('image/jpeg', 0.95)
      link.click()
      setFeedback('Đã xuất ảnh infographic thi đua nhân viên.')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Không thể xuất ảnh thi đua.')
    } finally {
      setExportBusy('')
    }
  }

  async function exportKpiEvidenceExcel() {
    const exportMode = competitionRankingMode === 'leaders' ? 'leaders' : 'monthly'
    const sourcesByRow = buildCompetitionSourcesByRow(
      competitionExportRows,
      exportMode,
      rankingMonthFrom,
      rankingMonthTo,
      competitionEvidenceAllocations,
      competitionEvidenceSessions,
      competitionEvidenceReceipts,
    )
    const sourceRows: KpiEvidenceSourceRow[] = competitionExportRows.flatMap((row) =>
      (sourcesByRow.get(competitionRowKey(row)) || []).map((source) => ({
        businessDate: source.businessDate,
        employeeKey: row.employeeKey,
        employeeName: row.employeeName,
        branchId: row.branchId,
        branchName: branchName(row.branchId),
        roleLabel: roleLabel(row.role),
        sourceType: source.kind === 'receipt' ? 'Hóa đơn POS' : 'Phiếu giao túi',
        sourceId: source.id,
        sourceCode: source.sourceCode,
        shiftLabel: source.shiftLabel,
        detail: source.detail,
        meta: source.meta,
        quantity: source.soldQuantity,
        revenue: source.revenue,
        createdAt: source.createdAt,
      })),
    )
    const exportedEmployeeKeys = new Set(competitionExportRows.map((row) => competitionRowKey(row)))
    const workbook = await buildKpiEvidenceWorkbook({
      title: `THI ĐUA NHÂN VIÊN · ${formatDate(rankingMonthFrom)} - ${formatDate(rankingMonthTo)}`,
      generatedAt: new Date(),
      filters: [
        { label: 'Phân loại', value: competitionRankingMode === 'leaders' ? 'Ca trưởng theo tháng' : 'Nhân viên theo tháng + chi tiết ngày' },
        { label: 'Kỳ dữ liệu', value: `${formatDate(rankingMonthFrom)} - ${formatDate(rankingMonthTo)}` },
        { label: 'Chi nhánh', value: branchId ? branchName(branchId) : 'Toàn hệ thống' },
        { label: 'Nhân sự toàn cục', value: employeeId ? employees.find((employee) => employee.id === employeeId)?.name || employeeId : 'Tất cả' },
        { label: 'Vai trò thi đua', value: effectiveCompetitionRole === 'all' ? 'Tất cả' : roleLabel(effectiveCompetitionRole) },
        { label: 'Loại ngày', value: competitionDayTypeLabel(competitionDayType) },
        { label: 'Số ca tối thiểu', value: competitionMinShifts || 'Không giới hạn' },
        { label: 'Số ca tối đa', value: competitionMaxShifts || 'Không giới hạn' },
        { label: 'Thời điểm xuất', value: formatDateTime(new Date().toISOString()) },
      ],
      summaryRows: competitionExportRows.map((row) => ({
        employeeKey: row.employeeKey,
        employeeName: row.employeeName,
        branchId: row.branchId,
        branchName: branchName(row.branchId),
        roleLabel: roleLabel(row.role),
        shiftCount: row.shiftCount,
        soldQuantity: row.soldQuantity,
        revenue: row.revenue,
        targetRevenue: row.targetRevenue,
        progress: row.progress,
        rank: row.rank,
        reward: row.commission,
      })),
      dailyRows: competitionRankingMode === 'leaders' ? [] : monthlyDailyKpiRows
        .filter((row) => exportedEmployeeKeys.has(competitionRowKey(row)))
        .map((row) => ({ ...row, branchName: branchName(row.branchId) })),
      sourceRows,
    })
    await saveWorkbook(workbook, `thi-dua-bang-chung-${competitionRankingMode}-${rankingMonthFrom}-${rankingMonthTo}.xlsx`)
  }

  async function exportDailyKpiExcel() {
    const workbook = await buildDailyKpiWorkbook({
      from,
      to,
      branchLabel: branchId ? branchName(branchId) : 'Toàn hệ thống',
      employeeLabel: employeeId ? employees.find((employee) => employee.id === employeeId)?.name || employeeId : 'Tất cả nhân viên',
      generatedAt: new Date(),
      rows: dailyKpiRows.map((row) => ({ ...row, branchName: branchName(row.branchId) })),
    })
    await saveWorkbook(workbook, `kpi-thuong-theo-ngay-${from}-${to}.xlsx`)
  }

  async function exportAttendance() {
    const ExcelJS = await import('exceljs')
    const workbook = new ExcelJS.Workbook()
    // File công xuất theo đúng bộ lọc chi nhánh/nhân viên/khoảng ngày đang chọn
    // trên màn hình (chọn một chi nhánh thì file chỉ có chi nhánh đó — chủ đích).
    const exportSummaryRows = attendanceRows
    const exportDetailRows = attendanceDetailRows
    // Màn Chấm công KHÔNG tải hóa đơn/phát túi (managementDataNeeds không có
    // 'receipts'/'allocations' cho section này) nên state ở đây rỗng — trước đây
    // các sheet KPI/doanh thu xuất ra trắng trơn. Lấy dữ liệu THẬT ngay lúc bấm
    // xuất, đúng khoảng ngày + chi nhánh đang lọc.
    const exportBranchScope = branchId ? [branchId] : permittedBranchIds(user)
    const [freshReceipts, freshAllocationLists] = await Promise.all([
      fetchSalesReceiptsRange(user, { branchIds: exportBranchScope, from, to }),
      Promise.all(exportBranchScope.map((id) => fetchBagAllocations(user, { branchId: id }).catch(() => [] as BagAllocation[]))),
    ])
    const exportReceipts = freshReceipts.filter((receipt) =>
      receipt.businessDate >= from && receipt.businessDate <= to && (!branchId || receipt.branchId === branchId),
    )
    const exportAllocations = freshAllocationLists.flat().filter((item) => {
      const date = allocationReportDate(item)
      return date >= from && date <= to && (!branchId || item.branchId === branchId)
    })
    const exportCommissionRows = buildCommissionRows(
      exportAllocations.filter((item) => soldBagQuantity(item) > 0),
      payrollEmployees,
      exportSummaryRows,
      exportReceipts,
      commissionRuleDrafts,
      employeeKpiDrafts,
      from,
      to,
    )
    const exportDailyKpiRows = buildDailyEmployeeKpiRows(
      exportAllocations.filter((item) => soldBagQuantity(item) > 0),
      exportReceipts,
      payrollEmployees,
      exportDetailRows,
      from,
      to,
    )
    const positionByUser = new Map<string, string>()
    const positionByName = new Map<string, string>()
    employees.forEach((employee) => {
      const label = employeePositionLabel(employee)
      if (employee.id) positionByUser.set(employee.id, label)
      positionByName.set(`${employee.branchId}|${normalizeName(employee.name)}`, label)
    })
    const resolvePosition = (userId: string, branchId: string, name: string) =>
      positionByUser.get(userId) || positionByName.get(`${branchId}|${normalizeName(name)}`) || ''
    const detailSheet = workbook.addWorksheet('Chi tiết chấm công')
    detailSheet.columns = attendanceDetailColumns()
    for (const row of exportDetailRows) {
      await addAttendanceDetailRow(detailSheet, row, resolvePosition(row.userId, row.branchId, row.employeeName))
    }
    styleSheet(detailSheet, `CHI TIẾT CHẤM CÔNG ${formatDate(from)} - ${formatDate(to)}`)

    const summarySheet = workbook.addWorksheet('Tổng hợp')
    summarySheet.columns = [
      { header: 'Nhân viên', key: 'employeeName', width: 26 },
      { header: 'Vị trí', key: 'position', width: 16 },
      { header: 'Chi nhánh', key: 'branch', width: 25 },
      { header: 'Tổng ca', key: 'totalShifts', width: 11 },
      { header: 'Tổng giờ (thập phân)', key: 'totalHours', width: 20 },
      { header: 'Ngày công', key: 'workDays', width: 12 },
      { header: 'Đi trễ', key: 'lateCount', width: 10 },
      { header: 'Vắng', key: 'absentCount', width: 10 },
      { header: 'Quên checkout', key: 'missingCheckoutCount', width: 16 },
    ]
    exportSummaryRows.forEach((row) => summarySheet.addRow({ ...row, position: resolvePosition(row.userId, row.branchId, row.employeeName), branch: branchName(row.branchId) }))
    styleSheet(summarySheet, `TỔNG HỢP CHẤM CÔNG ${formatDate(from)} - ${formatDate(to)}`)

    const commissionSheet = workbook.addWorksheet('KPI doanh thu')
    commissionSheet.columns = [
      { header: 'Nhân viên', key: 'employeeName', width: 26 },
      { header: 'Chi nhánh', key: 'branch', width: 24 },
      { header: 'Giờ công (thập phân)', key: 'totalHours', width: 21 },
      { header: 'Doanh thu', key: 'revenue', width: 16 },
      { header: 'KPI doanh thu', key: 'targetQuantity', width: 16 },
      { header: 'Tỷ lệ đạt (%)', key: 'progress', width: 14 },
      { header: 'Xếp hạng', key: 'rank', width: 12 },
      { header: 'Đạt KPI', key: 'achieved', width: 12 },
      { header: 'Thưởng ngày', key: 'dailyBonus', width: 16 },
      { header: 'Thưởng tuần', key: 'weeklyBonus', width: 16 },
      { header: 'Thưởng tháng', key: 'monthlyBonus', width: 16 },
      { header: 'Tổng thưởng KPI', key: 'commission', width: 18 },
    ]
    exportCommissionRows.forEach((row) => commissionSheet.addRow({
      ...row,
      branch: branchName(row.branchId),
      achieved: row.achieved ? 'Đạt' : 'Chưa đạt',
    }))
    styleSheet(commissionSheet, `KPI DOANH THU ${formatDate(from)} - ${formatDate(to)}`)

    // Bảng KPI theo ngày đổ vào file công, sheet riêng, GOM THEO TÊN nhân viên:
    // mỗi người liệt kê từng ngày (kèm tháng) bán bao nhiêu, đạt KPI bao nhiêu %,
    // thưởng ngày bao nhiêu, rồi chốt một dòng TỔNG in đậm — kế toán dò theo tên.
    const kpiByNameSheet = workbook.addWorksheet('KPI theo tên từng ngày')
    kpiByNameSheet.columns = [
      { header: 'Nhân viên', key: 'employeeName', width: 26 },
      { header: 'Vị trí', key: 'position', width: 15 },
      { header: 'Chi nhánh', key: 'branch', width: 22 },
      { header: 'Tháng', key: 'month', width: 10 },
      { header: 'Ngày', key: 'date', width: 13 },
      { header: 'Giờ công (thập phân)', key: 'totalHours', width: 20 },
      { header: 'SL bán', key: 'soldQuantity', width: 10 },
      { header: 'Doanh thu ngày', key: 'revenue', width: 16 },
      { header: 'KPI ngày', key: 'targetRevenue', width: 14 },
      { header: '% đạt', key: 'progress', width: 10 },
      { header: 'Hạng', key: 'rank', width: 8 },
      { header: 'Thưởng ngày', key: 'dailyBonus', width: 14 },
    ]
    const kpiByNameRows = [...exportDailyKpiRows].sort((a, b) =>
      a.employeeName.localeCompare(b.employeeName, 'vi')
      || branchName(a.branchId).localeCompare(branchName(b.branchId), 'vi')
      || a.date.localeCompare(b.date))
    const kpiNameGroups = new Map<string, typeof kpiByNameRows>()
    kpiByNameRows.forEach((row) => {
      const key = `${normalizeName(row.employeeName)}|${row.branchId}`
      kpiNameGroups.set(key, [...(kpiNameGroups.get(key) || []), row])
    })
    kpiNameGroups.forEach((rows) => {
      rows.forEach((row) => kpiByNameSheet.addRow({
        employeeName: row.employeeName,
        position: row.positionTitle,
        branch: branchName(row.branchId),
        month: formatMonthLabel(row.date.slice(0, 7)),
        date: formatDate(row.date),
        totalHours: row.totalHours,
        soldQuantity: row.soldQuantity,
        revenue: row.revenue,
        targetRevenue: row.targetRevenue,
        progress: row.progress,
        rank: row.rank,
        dailyBonus: row.dailyBonus,
      }))
      const totalRow = kpiByNameSheet.addRow({
        employeeName: `TỔNG · ${rows[0].employeeName}`,
        branch: branchName(rows[0].branchId),
        totalHours: Number(rows.reduce((sum, row) => sum + row.totalHours, 0).toFixed(2)),
        soldQuantity: rows.reduce((sum, row) => sum + row.soldQuantity, 0),
        revenue: rows.reduce((sum, row) => sum + row.revenue, 0),
        progress: `${rows.filter((row) => row.progress >= 100).length} ngày đạt`,
        dailyBonus: rows.reduce((sum, row) => sum + row.dailyBonus, 0),
      })
      totalRow.font = { bold: true }
    })
    styleSheet(kpiByNameSheet, `KPI TỪNG NHÂN VIÊN THEO NGÀY ${formatDate(from)} - ${formatDate(to)}`)

    // Nhật ký doanh thu hóa đơn theo ngày (giữ nguyên cho kế toán đối chiếu).
    const dailyRevenueSheet = workbook.addWorksheet('Doanh thu NV theo ngày')
    dailyRevenueSheet.columns = [
      { header: 'Nhân viên', key: 'employeeName', width: 26 },
      { header: 'Chi nhánh', key: 'branch', width: 24 },
      { header: 'Tháng', key: 'month', width: 10 },
      { header: 'Ngày', key: 'date', width: 14 },
      { header: 'Số hóa đơn', key: 'receipts', width: 12 },
      { header: 'SL bán', key: 'quantity', width: 12 },
      { header: 'Doanh thu', key: 'revenue', width: 16 },
    ]
    const dailyRevenueRows = buildDailyEmployeeRevenueRows(exportReceipts, from, to, '')
      .sort((a, b) => a.employeeName.localeCompare(b.employeeName, 'vi')
        || branchName(a.branchId).localeCompare(branchName(b.branchId), 'vi')
        || a.date.localeCompare(b.date))
    const revenueGroups = new Map<string, typeof dailyRevenueRows>()
    dailyRevenueRows.forEach((row) => {
      const key = `${normalizeName(row.employeeName)}|${row.branchId}`
      revenueGroups.set(key, [...(revenueGroups.get(key) || []), row])
    })
    revenueGroups.forEach((rows) => {
      rows.forEach((row) => dailyRevenueSheet.addRow({
        employeeName: row.employeeName,
        branch: branchName(row.branchId),
        month: formatMonthLabel(row.date.slice(0, 7)),
        date: formatDate(row.date),
        receipts: row.receipts,
        quantity: row.quantity,
        revenue: row.revenue,
      }))
      const totalRow = dailyRevenueSheet.addRow({
        employeeName: `TỔNG · ${rows[0].employeeName}`,
        branch: branchName(rows[0].branchId),
        receipts: rows.reduce((sum, row) => sum + row.receipts, 0),
        quantity: rows.reduce((sum, row) => sum + row.quantity, 0),
        revenue: rows.reduce((sum, row) => sum + row.revenue, 0),
      })
      totalRow.font = { bold: true }
    })
    styleSheet(dailyRevenueSheet, `DOANH THU TỪNG NHÂN VIÊN THEO NGÀY ${formatDate(from)} - ${formatDate(to)}`)

    const exportBranchIds = Array.from(new Set([
      ...exportSummaryRows.map((row) => row.branchId),
      ...exportDetailRows.map((row) => row.branchId),
    ])).sort((a, b) => branchName(a).localeCompare(branchName(b), 'vi'))
    const usedSheetNames = new Set(workbook.worksheets.map((sheet) => sheet.name))
    for (const id of exportBranchIds) {
      const branchSheet = workbook.addWorksheet(uniqueSheetName(branchName(id), usedSheetNames))
      branchSheet.columns = attendanceDetailColumns()
      for (const row of exportDetailRows.filter((item) => item.branchId === id)) {
        await addAttendanceDetailRow(branchSheet, row, resolvePosition(row.userId, row.branchId, row.employeeName))
      }
      styleSheet(branchSheet, `CHẤM CÔNG ${branchName(id)} ${formatDate(from)} - ${formatDate(to)}`)
    }

    await saveWorkbook(workbook, `bang-cham-cong-${from}-${to}.xlsx`)
  }

  async function exportInventory() {
    const ExcelJS = await import('exceljs')
    const workbook = new ExcelJS.Workbook()
    workbook.creator = 'Gustino Operations'
    workbook.created = new Date()

    const summarySheet = workbook.addWorksheet('Tổng hợp kho')
    summarySheet.columns = [
      { header: 'Chi nhánh', key: 'branch', width: 25 },
      { header: 'Sản phẩm', key: 'product', width: 30 },
      { header: 'SKU', key: 'sku', width: 17 },
      { header: 'ĐVT', key: 'unit', width: 10 },
      { header: 'Tồn đầu kỳ', key: 'opening', width: 14 },
      { header: 'Nhập / tăng', key: 'inbound', width: 14 },
      { header: 'Xuất / giảm', key: 'outbound', width: 14 },
      { header: 'Hao hụt', key: 'waste', width: 12 },
      { header: 'Điều chỉnh kiểm kê', key: 'adjust', width: 18 },
      { header: 'Tồn cuối kỳ', key: 'closing', width: 14 },
    ]
    stockRows.forEach((row) => summarySheet.addRow({
      branch: branchName(row.branchId),
      product: row.product.name,
      sku: row.product.sku,
      unit: row.product.unit,
      opening: row.opening,
      inbound: row.inbound,
      outbound: row.outbound,
      waste: row.waste,
      adjust: row.adjust,
      closing: row.closing,
    }))
    applyInventoryQuantityFormat(summarySheet, ['opening', 'inbound', 'outbound', 'waste', 'adjust', 'closing'])
    styleSheet(summarySheet, `TỔNG HỢP KHO ${formatDate(from)} - ${formatDate(to)}`)

    const shiftReconciliationSheet = workbook.addWorksheet('Đối chiếu ca')
    shiftReconciliationSheet.columns = [
      { header: 'Ngày', key: 'date', width: 13 },
      { header: 'Chi nhánh', key: 'branch', width: 25 },
      { header: 'Ca', key: 'shift', width: 9 },
      { header: 'Trạng thái', key: 'status', width: 18 },
      { header: 'Bắt đầu', key: 'startedAt', width: 20 },
      { header: 'Kết thúc', key: 'endedAt', width: 20 },
      { header: 'Sản phẩm nguồn', key: 'product', width: 30 },
      { header: 'SKU', key: 'sku', width: 17 },
      { header: 'ĐVT', key: 'unit', width: 10 },
      { header: 'Tồn đầu', key: 'opening', width: 13 },
      { header: 'Nhập thêm', key: 'additions', width: 13 },
      { header: 'Sửa tồn trong ca', key: 'adjust', width: 17 },
      { header: 'POS quy đổi', key: 'posEquivalent', width: 15 },
      { header: 'Hao hụt', key: 'waste', width: 12 },
      { header: 'Tồn bàn giao', key: 'closing', width: 16 },
      { header: 'Out chính thức', key: 'officialOut', width: 16 },
      { header: 'Chênh lệch', key: 'difference', width: 14 },
      { header: 'POS nguyên đơn vị', key: 'posNative', width: 25 },
      { header: 'Số hóa đơn', key: 'receipts', width: 12 },
      { header: 'Doanh thu POS', key: 'revenue', width: 17 },
      { header: 'Ghi chú', key: 'note', width: 38 },
    ]
    inventoryShiftReconciliationRows.forEach((shift) => {
      shift.lines.forEach((line) => shiftReconciliationSheet.addRow({
        date: formatDate(shift.businessDate),
        branch: branchName(shift.branchId),
        shift: `Ca ${shift.sequence}`,
        status: shift.status === 'open' ? 'Đang mở · tạm tính' : 'Đã bàn giao',
        startedAt: formatDateTime(shift.startedAt),
        endedAt: shift.endedAt ? formatDateTime(shift.endedAt) : '',
        product: line.productName,
        sku: line.sku,
        unit: line.unit,
        opening: line.opening,
        additions: line.additions,
        adjust: line.adjust,
        posEquivalent: line.posEquivalent,
        waste: line.waste,
        closing: line.closing,
        officialOut: line.officialOut,
        difference: line.difference,
        posNative: shift.posNativeSummary,
        receipts: shift.receiptCount,
        revenue: shift.posRevenue,
        note: line.trackedByHandover
          ? shift.status === 'open' ? 'Chờ tồn bàn giao cuối ca' : ''
          : 'SKU nguồn chưa nằm trong tồn bàn giao của ca',
      }))
    })
    applyInventoryQuantityFormat(shiftReconciliationSheet, ['opening', 'additions', 'adjust', 'posEquivalent', 'waste', 'closing', 'officialOut', 'difference'])
    shiftReconciliationSheet.getColumn('revenue').numFmt = INVENTORY_EXCEL_INTEGER_FORMAT
    styleSheet(shiftReconciliationSheet, `ĐỐI CHIẾU XUẤT BÁN THEO CA ${formatDate(from)} - ${formatDate(to)}`)

    const dailyOutboundSheet = workbook.addWorksheet('Xuất bán trong kỳ')
    dailyOutboundSheet.columns = [
      { header: 'Ngày', key: 'date', width: 13 },
      { header: 'Giờ ghi', key: 'time', width: 20 },
      { header: 'Chi nhánh', key: 'branch', width: 25 },
      { header: 'Số phiếu', key: 'document', width: 23 },
      { header: 'Sản phẩm', key: 'product', width: 30 },
      { header: 'SKU', key: 'sku', width: 17 },
      { header: 'Số lượng xuất bán', key: 'quantity', width: 19 },
      { header: 'ĐVT', key: 'unit', width: 10 },
      { header: 'Người ghi', key: 'creator', width: 24 },
      { header: 'Ghi chú', key: 'note', width: 42 },
    ]
    inventorySaleOutMovements.forEach((movement) => {
      const product = productById(movement.productId)
      const creator = employees.find((employee) => employee.id === movement.createdBy)
      dailyOutboundSheet.addRow({
        date: formatDate(movement.shiftDate),
        time: formatDateTime(movement.createdAt),
        branch: branchName(movement.branchId),
        document: movement.documentId || movement.id,
        product: product?.name || movement.productId,
        sku: product?.sku || '-',
        quantity: movement.quantity,
        unit: product?.unit || 'đơn vị',
        creator: creator?.name || movement.createdBy || '-',
        note: movement.note || '-',
      })
    })
    applyInventoryQuantityFormat(dailyOutboundSheet, ['quantity'])
    styleSheet(dailyOutboundSheet, `XUẤT KHO ĐỂ BÁN ${formatDate(from)} - ${formatDate(to)}`)

    const ledgerSheet = workbook.addWorksheet('Nhật ký kho')
    ledgerSheet.columns = [
      { header: 'Ngày kho', key: 'date', width: 13 },
      { header: 'Thời điểm ghi', key: 'createdAt', width: 20 },
      { header: 'Chi nhánh', key: 'branch', width: 25 },
      { header: 'Loại phát sinh', key: 'type', width: 18 },
      { header: 'Số phiếu', key: 'document', width: 23 },
      { header: 'Sản phẩm', key: 'product', width: 30 },
      { header: 'SKU', key: 'sku', width: 17 },
      { header: 'Số lượng', key: 'quantity', width: 14 },
      { header: 'ĐVT', key: 'unit', width: 10 },
      { header: 'Sản phẩm nguồn', key: 'sourceProduct', width: 28 },
      { header: 'SL nguồn', key: 'sourceQuantity', width: 14 },
      { header: 'Khối lượng đo (kg)', key: 'measuredWeightKg', width: 20 },
      { header: 'Người ghi', key: 'creator', width: 24 },
      { header: 'Ghi chú', key: 'note', width: 42 },
    ]
    inventoryLedgerRows.forEach((movement) => {
      const product = productById(movement.productId)
      const sourceProduct = movement.sourceProductId ? productById(movement.sourceProductId) : undefined
      const creator = employees.find((employee) => employee.id === movement.createdBy)
      ledgerSheet.addRow({
        date: formatDate(movement.shiftDate),
        createdAt: formatDateTime(movement.createdAt),
        branch: branchName(movement.branchId),
        type: MOVEMENT_LABELS[movement.type],
        document: movement.documentId || movement.id,
        product: product?.name || movement.productId,
        sku: product?.sku || '-',
        quantity: movement.quantity,
        unit: product?.unit || 'đơn vị',
        sourceProduct: sourceProduct?.name || movement.sourceProductId || '-',
        sourceQuantity: movement.sourceQuantity ?? null,
        measuredWeightKg: movement.measuredWeightKg ?? null,
        creator: creator?.name || movement.createdBy || '-',
        note: movement.note || '-',
      })
    })
    applyInventoryQuantityFormat(ledgerSheet, ['quantity', 'sourceQuantity', 'measuredWeightKg'])
    styleSheet(ledgerSheet, `NHẬT KÝ KHO ${formatDate(from)} - ${formatDate(to)}`)

    const currentStockSheet = workbook.addWorksheet('Tồn hiện tại')
    currentStockSheet.columns = [
      { header: 'Chi nhánh', key: 'branch', width: 25 },
      { header: 'Sản phẩm', key: 'product', width: 30 },
      { header: 'SKU', key: 'sku', width: 17 },
      { header: 'Danh mục', key: 'category', width: 16 },
      { header: 'Tồn hiện tại', key: 'quantity', width: 16 },
      { header: 'ĐVT', key: 'unit', width: 10 },
      { header: 'Trạng thái', key: 'status', width: 16 },
    ]
    currentStockRows
      .slice()
      .sort((a, b) => branchName(a.branchId).localeCompare(branchName(b.branchId), 'vi') || a.product.name.localeCompare(b.product.name, 'vi'))
      .forEach((line) => currentStockSheet.addRow({
        branch: branchName(line.branchId),
        product: line.product.name,
        sku: line.product.sku,
        category: inventoryCategoryLabel(line.product.category),
        quantity: line.expected,
        unit: line.product.unit,
        status: line.expected <= 0.0001 ? 'Hết hàng' : line.expected <= line.product.lowStock ? 'Sắp hết' : 'Ổn định',
      }))
    applyInventoryQuantityFormat(currentStockSheet, ['quantity'])
    styleSheet(currentStockSheet, 'TỒN KHO HIỆN TẠI THEO CHI NHÁNH')

    const countSheet = workbook.addWorksheet('Phiếu kiểm kê')
    countSheet.columns = [
      { header: 'Ngày kiểm kê', key: 'date', width: 15 },
      { header: 'Chi nhánh', key: 'branch', width: 25 },
      { header: 'Số phiếu', key: 'reportNo', width: 16 },
      { header: 'Ca', key: 'shift', width: 13 },
      { header: 'Khu vực', key: 'location', width: 28 },
      { header: 'Người lập', key: 'reporter', width: 24 },
      { header: 'Sản phẩm', key: 'product', width: 30 },
      { header: 'SKU', key: 'sku', width: 17 },
      { header: 'Kho đông', key: 'freezer', width: 13 },
      { header: 'Kho phòng', key: 'stockRoom', width: 13 },
      { header: 'Cần đặt', key: 'orderNeeded', width: 13 },
      { header: 'ĐVT', key: 'unit', width: 10 },
      { header: 'Lý do lệch', key: 'varianceReason', width: 32 },
      { header: 'Ghi chú', key: 'note', width: 36 },
    ]
    periodInventoryReports.forEach((report) => {
      report.lines.forEach((line) => {
        const product = productById(line.productId)
        countSheet.addRow({
          date: formatDate(report.reportDate),
          branch: branchName(report.branchId),
          reportNo: report.reportNo,
          shift: report.shift,
          location: report.location,
          reporter: report.reporter,
          product: product?.name || line.productId,
          sku: product?.sku || '-',
          freezer: line.freezerQty,
          stockRoom: line.stockRoomQty,
          orderNeeded: line.orderNeeded,
          unit: product?.unit || 'đơn vị',
          varianceReason: line.varianceReason || '-',
          note: line.note || '-',
        })
      })
    })
    applyInventoryQuantityFormat(countSheet, ['freezer', 'stockRoom', 'orderNeeded'])
    styleSheet(countSheet, `PHIẾU KIỂM KÊ ${formatDate(from)} - ${formatDate(to)}`)

    await saveWorkbook(workbook, `bao-cao-kho-${from}-${to}.xlsx`)
  }

  async function exportSupplyReportExcel() {
    const ExcelJS = await import('exceljs')
    const workbook = new ExcelJS.Workbook()
    const sheet = workbook.addWorksheet('Danh sách đặt hàng')
    sheet.columns = [
      { header: 'Ngày đặt', key: 'createdAt', width: 20 },
      { header: 'Ngày nhận', key: 'delivery', width: 22 },
      { header: 'Chi nhánh', key: 'branch', width: 26 },
      { header: 'Người đặt', key: 'requester', width: 24 },
      { header: 'Món hàng', key: 'product', width: 32 },
      { header: 'Số lượng', key: 'quantity', width: 13 },
      { header: 'ĐVT', key: 'unit', width: 10 },
      { header: 'Trạng thái', key: 'status', width: 18 },
      { header: 'Ghi chú', key: 'note', width: 38 },
    ]
    rangeSupplyRequests.forEach((req) => sheet.addRow({
      createdAt: formatDateTime(req.createdAt),
      delivery: req.requestedDeliveryDate
        ? `${formatDate(req.requestedDeliveryDate)} · ${req.requestedDeliveryPeriod || '-'}`
        : '-',
      branch: branchName(req.branchId),
      requester: req.requestedByName,
      product: req.productName,
      quantity: req.quantity,
      unit: req.unit,
      status: supplyStatusLabel(req.status),
      note: req.note || '',
    }))
    applyInventoryQuantityFormat(sheet, ['quantity'])
    styleSheet(sheet, `DANH SÁCH ĐẶT HÀNG ${formatDate(from)} - ${formatDate(to)}`)
    await saveWorkbook(workbook, `danh-sach-dat-hang-${from}-${to}.xlsx`)
  }

  function updateCommissionRuleDraft(branchId: string, patch: Partial<{ targetRevenue: string; commissionRate: string }>) {
    setCommissionRuleDrafts((drafts) => {
      const base = drafts[branchId] || {
        targetRevenue: String(DEFAULT_REVENUE_TARGET),
        commissionRate: String(DEFAULT_COMMISSION_RATE),
      }
      const nextDraft = { ...base, ...patch }
      window.clearTimeout(commissionRuleTimers.current[branchId])
      commissionRuleTimers.current[branchId] = window.setTimeout(() => {
        void saveCommissionRule(user, {
          branchId,
          targetQuantity: parseMoney(nextDraft.targetRevenue) || DEFAULT_REVENUE_TARGET,
          commissionPerUnit: parsePercent(nextDraft.commissionRate) || DEFAULT_COMMISSION_RATE,
        }).then(() => {
          setFeedback(`Đã lưu KPI doanh số cho ${branchName(branchId)}.`)
        }).catch((error) => {
          setError(error instanceof Error ? error.message : 'Không thể lưu KPI doanh số.')
        })
      }, 600)
      return { ...drafts, [branchId]: nextDraft }
    })
  }

  async function saveAttendanceCorrection(event: React.FormEvent) {
    event.preventDefault()
    if (!attendanceEdit || attendanceEditSaving) return
    setAttendanceEditSaving(true)
    try {
      await updateAttendanceRecordByAdmin(user, {
        recordId: attendanceEdit.recordId,
        checkInTime: attendanceEdit.checkInTime,
        checkOutTime: attendanceEdit.checkOutTime,
        reason: attendanceEdit.reason,
      })
      await refresh(false)
      setAttendanceEdit(null)
      setFeedback('Đã chỉnh công và đồng bộ lại bảng công, bảng lương.')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Không thể chỉnh công cho nhân viên.')
    } finally {
      setAttendanceEditSaving(false)
    }
  }

  async function reopenShiftsFromAdmin(rows: Array<{ sessionId: string; branchId: string; businessDate: string; sequence: number }>) {
    if (user.role !== 'admin' || !rows.length || adminShiftActionId) return
    const sessionRows = rows
      .map((row) => bagSessions.find((session) => session.id === row.sessionId))
      .filter((session): session is BagShiftSession => Boolean(session && session.status === 'closed'))
    if (!sessionRows.length) return
    if (sessionRows.some((session) => session.businessDate !== todayKey)) {
      setError('Chỉ có thể mở lại ca của ngày hôm nay. Ca ngày cũ cần xử lý theo quy trình quản trị ngày vận hành.')
      return
    }
    const branchId = sessionRows[0].branchId
    const businessDate = sessionRows[0].businessDate
    const label = sessionRows.map((session) => shiftLabel(session.sequence)).join(' và ')
    const reason = window.prompt(
      `Mở lại ${label} tại ${branchName(branchId)} ngày ${formatDate(businessDate)}?\n\n`
        + 'Hệ thống sẽ hoàn tác phiếu kiểm kê/kho do lần chốt tạo ra, giữ nguyên hóa đơn và dữ liệu gốc. Nhập lý do:',
      'Admin cần chỉnh lại số liệu chốt ca',
    )
    if (reason === null || reason.trim().length < 3) {
      if (reason !== null) setError('Lý do mở lại ca cần ít nhất 3 ký tự.')
      return
    }
    setAdminShiftActionId(sessionRows.map((session) => session.id).join('|'))
    setError('')
    try {
      const scopedUser = { ...user, branchId }
      await ensureOperationDay(scopedUser, businessDate, { allowAutoOpen: true, reopenClosed: true })
      for (const session of sessionRows) await reopenBagShift(scopedUser, session, reason.trim())
      await refresh(false)
      setFeedback(`Đã mở lại ${label}. Có thể chỉnh dữ liệu rồi chốt lại ca.`)
    } catch (reasonError) {
      setError(reasonError instanceof Error ? reasonError.message : 'Không thể mở lại ca đã chọn.')
    } finally {
      setAdminShiftActionId('')
    }
  }

  async function saveAttendanceDeletion(event: React.FormEvent) {
    event.preventDefault()
    if (!attendanceDelete || attendanceDeleteSaving) return
    setAttendanceDeleteSaving(true)
    try {
      if (attendanceDelete.kind === 'empty-registration') {
        await deleteEmptyShiftRegistrationByAdmin(user, {
          registrationId: attendanceDelete.registrationId,
          reason: attendanceDelete.reason,
        })
      } else {
        if (!attendanceDelete.recordId) throw new Error('Thiếu bản ghi chấm công cần xóa.')
        await deleteAttendanceRecordByAdmin(user, {
          recordId: attendanceDelete.recordId,
          reason: attendanceDelete.reason,
        })
      }
      await refresh(false)
      setAttendanceDelete(null)
      setFeedback(attendanceDelete.kind === 'empty-registration'
        ? `Đã xóa dòng đăng ký ca chưa chấm công của ${attendanceDelete.employeeName} ngày ${formatDate(attendanceDelete.workDate)}. Không có dữ liệu chấm công hay lương nào bị ảnh hưởng.`
        : `Đã xóa ca của ${attendanceDelete.employeeName} ngày ${formatDate(attendanceDelete.workDate)} và đồng bộ lại bảng lương.`)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Không thể xóa dòng đã chọn.')
    } finally {
      setAttendanceDeleteSaving(false)
    }
  }

  function selectAttendanceListMode(mode: 'date' | 'employee') {
    setAttendanceListMode(mode)
    setAttendanceListPage(1)
    setAttendanceEdit(null)
    setAttendanceDelete(null)
  }

  function selectAttendanceListBranch(nextBranchId: string) {
    if (nextBranchId === attendanceListBranchId) return
    setAttendanceListBranchId(nextBranchId)
    setAttendanceListEmployeeId('')
    setAttendanceListPage(1)
    setAttendanceEdit(null)
    setAttendanceDelete(null)
  }

  function beginAttendanceCorrection(row: (typeof attendanceListRows)[number], revealTarget = false) {
    if (!row.attendanceRecordId) return
    const targetRows = revealTarget
      ? attendanceListRows.filter((item) => item.workDate === row.workDate && item.branchId === row.branchId)
      : attendanceListFilteredRows
    const targetIndex = Math.max(0, targetRows.findIndex((item) => item.attendanceRecordId === row.attendanceRecordId))
    if (revealTarget) {
      setAttendanceListMode('date')
      setAttendanceListDate(row.workDate)
      setAttendanceListBranchId(row.branchId)
      setAttendanceListEmployeeId('')
      setAttendanceEmployeeSearch('')
    }
    setAttendanceListPage(Math.floor(targetIndex / ATTENDANCE_EDIT_PAGE_SIZE) + 1)
    setAttendanceDelete(null)
    setAttendanceEdit({
      recordId: row.attendanceRecordId,
      employeeName: row.employeeName,
      checkInTime: toDateTimeLocalValue(row.checkInTime)
        || attendanceScheduledDateTimeLocal(row.workDate, row.scheduledStart),
      checkOutTime: toDateTimeLocalValue(row.checkOutTime)
        || attendanceScheduledDateTimeLocal(row.workDate, row.scheduledEnd, row.scheduledEnd <= row.scheduledStart),
      reason: '',
    })
    window.requestAnimationFrame(() => document.getElementById('attendance-detail-list')?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
  }

  return (
    <div className="page admin-page">
      <div className="admin-filter-bar admin-date-filters">
          <label>{text.branch}
            <select value={branchId} onChange={(event) => { setBranchId(event.target.value); setEmployeeId('') }}>
              <option value="">{text.allBranches}</option>
              {visibleBranches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
            </select>
          </label>
          <label>{text.from}<input type="date" value={from} max={attendanceDateMax} onChange={(event) => setFrom(attendanceDateMax && event.target.value > attendanceDateMax ? attendanceDateMax : event.target.value)} /></label>
          <label>{text.to}<input type="date" value={to} min={from} max={attendanceDateMax} onChange={(event) => setTo(attendanceDateMax && event.target.value > attendanceDateMax ? attendanceDateMax : event.target.value)} /></label>
          <div className="admin-quick-ranges">
            <button onClick={() => setQuickRange('today')}>{text.today}</button>
            <button onClick={() => setQuickRange('month')}>{text.thisMonth}</button>
            <button onClick={() => setQuickRange('previousMonth')}>{text.previousMonth}</button>
          </div>
      </div>

      {readOnly && <div className="feedback-bar">Chế độ giám sát (SUP MT): chỉ xem và xuất báo cáo, mọi thao tác chỉnh sửa dữ liệu đều do Admin thực hiện.</div>}
      {error && <div className="feedback-bar">{error}<button onClick={() => setError('')}>×</button></div>}
      {feedback && <div className="feedback-bar success">{feedback}<button onClick={() => setFeedback('')}>×</button></div>}

      {/* Layout 2 cột: nav trái + nội dung phải */}
      <div className={`admin-layout${focused ? ' focused-management-layout' : ''}`}>
        {/* Nội dung theo section */}
        <div className="admin-section-content">
          {/* ===== DOANH THU ===== */}
          {activeSection === 'revenue' && (
            <>
              {/* Overview card: CukCuk Tổng quan style */}
              {(() => {
                const grandTotal = periodRevenueRows.reduce((sum, s) => sum + s.revenue, 0)
                const fmtMoney = (n: number) => n >= 1000000 ? `${(n / 1000000).toFixed(1)} tr` : n.toLocaleString('vi-VN') + 'đ'
                return (
                  <div className="rev-overview-card">
                    <div className="rev-overview-head">
                      <span className="rev-overview-label">Doanh thu toàn chuỗi</span>
                      <span className="rev-overview-amount">{fmtMoney(grandTotal)}</span>
                      <span className="rev-overview-sub">{periodRevenueRows.length} ngày có doanh thu · {selectedBranches.length} chi nhánh</span>
                    </div>
                    <div className="rev-branch-list">{selectedBranches.map((branch) => {
                      const snaps = periodRevenueRows.filter((s) => s.branchId === branch.id)
                      const rev = snaps.reduce((sum, s) => sum + s.revenue, 0)
                      const sold = snaps.reduce((sum, s) => sum + s.totalSold, 0)
                      return (
                        <div key={branch.id} className="rev-branch-row">
                          <span className="rbn-name">{/^\d+$/.test(branch.name.trim()) ? `Chi nhánh ${branch.name}` : branch.name}</span>
                          <div className="rbn-right">
                            <span className="rbn-amount">{fmtMoney(rev)}</span>
                            <span className="rbn-meta">{snaps.length} ngày · {sold} sản phẩm</span>
                          </div>
                        </div>
                      )
                    })}</div>
                  </div>
                )
              })()}
              <BusinessProductCharts rows={businessProductRows} />
              <section className="erp-workspace-panel admin-revenue-chart-card">
                <div className="section-title">
                  <div><span className="eyebrow dark">BIỂU ĐỒ DOANH THU</span><h2>Xu hướng theo bộ lọc</h2></div>
                  <span className="date-chip">{formatMoney(adminRevenueTrendRows.reduce((sum, row) => sum + row.revenue, 0))}</span>
                </div>
                <div className="admin-revenue-area-chart">
                  <svg viewBox="0 0 360 160" role="img" aria-label="Bieu do doanh thu theo ngay">
                    <defs>
                      <linearGradient id="adminRevenueFill" x1="0" x2="0" y1="0" y2="1">
                        <stop offset="0%" stopColor="#a8d12d" stopOpacity=".44" />
                        <stop offset="100%" stopColor="#1688d8" stopOpacity=".08" />
                      </linearGradient>
                    </defs>
                    <polygon points={adminRevenueArea.fillPoints} fill="url(#adminRevenueFill)" />
                    <polyline points={adminRevenueArea.linePoints} fill="none" stroke="#1688d8" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  <div className="admin-revenue-axis">
                    {adminRevenueTrendRows.filter((_, index) => index === 0 || index === Math.floor(adminRevenueTrendRows.length / 2) || index === adminRevenueTrendRows.length - 1).map((row) => (
                      <span key={row.date}>{formatDate(row.date)}</span>
                    ))}
                  </div>
                </div>
              </section>
              <section className="erp-workspace-panel erp-revenue-ledger">
                <div className="section-title">
                  <div><span className="eyebrow dark">DOANH THU THEO NGÀY</span><h2>Tất cả chi nhánh</h2></div>
                  <span className="date-chip">{periodRevenueRows.length} ngày có doanh thu</span>
                </div>
                <div className="admin-data-table-scroll">
                  <table className="admin-data-table erp-revenue-table">
                    <thead><tr><th>Ngày</th><th>Chi nhánh</th><th className="num">Sản phẩm</th><th className="num">Doanh thu</th><th className="num">Năng suất</th><th className="num">KPI</th><th>Xếp loại</th><th>Trạng thái</th></tr></thead>
                    <tbody>{periodRevenueRows.map((snap) => (
                      <tr key={snap.id}>
                        <td>{formatDate(snap.reportDate)}</td>
                        <td>{branchName(snap.branchId)}</td>
                        <td className="num">{snap.totalSold || 0}</td>
                        <td className="num"><strong>{snap.revenue.toLocaleString('vi-VN')}đ</strong></td>
                        <td className="num">{snap.salesRate !== undefined ? `${snap.salesRate}%` : '—'}</td>
                        <td className="num">{snap.kpi !== undefined ? `${snap.kpi}%` : '—'}</td>
                        <td>{snap.grade || '—'}</td>
                        <td><span className={`admin-status-badge ${snap.source === 'report' ? 'working' : 'probation'}`}>{snap.source === 'report' ? 'Đã chốt' : 'Tạm tính'}</span></td>
                      </tr>
                    ))}</tbody>
                  </table>
                  {!periodRevenueRows.length && (
                    <p className="empty-copy">Chưa có báo cáo doanh thu trong khoảng thời gian này. Báo cáo sẽ xuất hiện sau khi ca trưởng bấm “Chốt báo cáo” cuối ngày.</p>
                  )}
                </div>
              </section>
            </>
          )}

          {/* ===== TỔNG QUAN ===== */}
          {activeSection === 'overview' && (
            <DashboardPage
              from={from}
              to={to}
              branchCount={visibleBranches.length}
              revenue={periodRevenueRows.reduce((sum, row) => sum + row.revenue, 0)}
              employeeCount={employees.filter((employee) => employee.active !== false).length}
              activeUsers={activeUsers}
              showActiveUsers={user.role === 'admin'}
              recentBills={overviewBillRows}
              wasteRows={wasteRows}
              branchName={branchName}
            />
          )}

          {/* ===== CHẤM CÔNG ===== */}
          {activeSection === 'attendance' && (
            <>
            <section className="erp-workspace-panel admin-report-section">
              <div className="section-title">
                <div>
                  <span className="eyebrow dark">BẢNG CHẤM CÔNG</span>
                  <h2>Chấm công theo ngày, tháng</h2>
                  <p>File Excel xuất theo đúng bộ lọc chi nhánh và khoảng ngày đang chọn — muốn đủ mọi chi nhánh, chọn "Tất cả chi nhánh" trước khi xuất.</p>
                </div>
                <div className="section-title-actions">
                  <button type="button" className="secondary-button" onClick={() => setShowScheduleManagement((value) => !value)}>
                    {showScheduleManagement ? 'Đóng lịch đăng ký ca' : 'Xem và sửa lịch đăng ký ca'}
                  </button>
                  <button
                    type="button"
                    className="primary-button"
                    onClick={() => void runExport(
                      'attendance',
                      attendanceRows.length ? '' : 'Chưa có dữ liệu chấm công trong bộ lọc hiện tại để xuất Excel.',
                      exportAttendance,
                      'Đã xuất Excel bảng chấm công.',
                    )}
                    disabled={exportBusy === 'attendance'}
                  >{exportBusy === 'attendance' ? 'Đang xuất…' : 'Xuất Excel'}</button>
                </div>
              </div>
              <div className="table-scroll">
                <table className="data-table attendance-data-table">
                  <thead>
                    <tr>
                      <th>Nhân viên</th>
                      <th>Chi nhánh</th>
                      <th>Tổng ca</th>
                      <th>Tổng giờ</th>
                      <th>Ngày công</th>
                      <th>Đi trễ</th>
                      <th>Vắng</th>
                      <th>Quên checkout</th>
                    </tr>
                  </thead>
                  <tbody>
                    {attendanceRows.map((row) => (
                      <tr key={`${row.userId}-${row.branchId}`}>
                        <td><strong>{row.employeeName}</strong></td>
                        <td>{branchName(row.branchId)}</td>
                        <td>{row.totalShifts}</td>
                        <td>{formatDecimalHoursAsDuration(row.totalHours)}</td>
                        <td>{row.workDays}</td>
                        <td className={row.lateCount ? 'warn' : ''}>{row.lateCount}</td>
                        <td className={row.absentCount ? 'warn' : ''}>{row.absentCount}</td>
                        <td className={row.missingCheckoutCount ? 'warn' : ''}>{row.missingCheckoutCount}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {!attendanceRows.length && <p className="empty-copy">Không có dữ liệu chấm công trong khoảng đã chọn.</p>}
            </section>

            {showScheduleManagement && (
              <section className="admin-embedded-schedule">
                <AttendancePage user={user} movements={[]} onNavigate={onNavigate || (() => undefined)} />
              </section>
            )}

            <section className="erp-workspace-panel attendance-error-section">
              <div className="section-title">
                <div>
                  <span className="eyebrow dark">LỖI CHẤM CÔNG TỰ ĐÓNG</span>
                  <h2>Ca qua ngày cần Admin rà soát</h2>
                  <p>Hệ thống đã tự đóng theo giờ tan ca để nhân viên không bị treo ca. Sau khi Admin lưu chỉnh công, dòng này sẽ rời danh sách và lịch sử chỉnh sửa vẫn được giữ.</p>
                </div>
                <span className="date-chip">{attendanceAutoCloseErrors.length} lỗi</span>
              </div>
              <div className="table-scroll">
                <table className="data-table attendance-error-table">
                  <thead>
                    <tr>
                      <th>Ngày</th>
                      <th>Nhân viên</th>
                      <th>Chi nhánh</th>
                      <th>Giờ ca</th>
                      <th>Check-in</th>
                      <th>Hệ thống tự out</th>
                      <th>Trạng thái</th>
                      <th>Xử lý</th>
                    </tr>
                  </thead>
                  <tbody>
                    {attendanceAutoCloseErrors.map((row) => (
                      <tr key={`attendance-error-${row.attendanceRecordId || row.registrationId}`}>
                        <td>{formatDate(row.workDate)}</td>
                        <td><strong>{row.employeeName}</strong></td>
                        <td>{branchName(row.branchId)}</td>
                        <td>{row.scheduledStart}–{row.scheduledEnd}</td>
                        <td>{row.checkInTime ? formatDateTime(row.checkInTime) : 'Chưa có'}</td>
                        <td>{row.checkOutTime ? formatDateTime(row.checkOutTime) : 'Chưa đóng'}</td>
                        <td><span className="attendance-state absent">Cần rà soát</span></td>
                        <td>
                          {user.role === 'admin' && row.attendanceRecordId
                            ? <button type="button" className="mini-button attendance-edit-button" onClick={() => beginAttendanceCorrection(row, true)}>Chỉnh công ngay</button>
                            : <span className="attendance-no-record">Chỉ Admin được chỉnh</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {!attendanceAutoCloseErrors.length && <p className="empty-copy">Không có ca tự đóng nào cần rà soát trong khoảng ngày đã chọn.</p>}
            </section>

            <section className="erp-workspace-panel attendance-detail-section">
              <div className="section-title">
                <div className="attendance-cute-heading">
                  <img className="attendance-cute-mascot" src="/mascots/capy-loading-2.png" alt="" aria-hidden="true" />
                  <div>
                    <span className="eyebrow dark">DANH SÁCH CÔNG</span>
                    <h2>Từng ca đã ghi nhận</h2>
                    <p>Tìm theo tên, chọn đúng ngày để chỉnh hoặc xóa ca tạo nhầm. Mọi thay đổi đều được lưu lịch sử và đồng bộ bảng lương.</p>
                  </div>
                </div>
                <span className="date-chip">{attendanceListFilteredRows.length} ca</span>
              </div>
              <div className="attendance-correction-filters">
                <div className="attendance-month-picker">
                  <button type="button" onClick={() => moveAttendanceCorrectionMonth(-1)} aria-label="Mở tháng chấm công trước">← Tháng trước</button>
                  <label>Tháng cần chỉnh
                    <input
                      type="month"
                      value={attendanceCorrectionMonth}
                      max={currentMonthKey}
                      onChange={(event) => setAttendanceCorrectionMonth(event.target.value)}
                    />
                  </label>
                  <button
                    type="button"
                    onClick={() => moveAttendanceCorrectionMonth(1)}
                    disabled={attendanceCorrectionMonth >= currentMonthKey}
                    aria-label="Mở tháng chấm công sau"
                  >Tháng sau →</button>
                </div>
                <div className="attendance-correction-mode" aria-label="Cách lọc danh sách công">
                  <button
                    type="button"
                    className={attendanceListMode === 'date' ? 'active' : ''}
                    aria-pressed={attendanceListMode === 'date'}
                    onClick={() => selectAttendanceListMode('date')}
                  >Theo ngày</button>
                  <button
                    type="button"
                    className={attendanceListMode === 'employee' ? 'active' : ''}
                    aria-pressed={attendanceListMode === 'employee'}
                    onClick={() => selectAttendanceListMode('employee')}
                  >Theo nhân viên</button>
                </div>
                <label>Chi nhánh cần chỉnh
                  <select
                    value={attendanceListBranchId}
                    onChange={(event) => selectAttendanceListBranch(event.target.value)}
                  >
                    <option value="">Tất cả chi nhánh</option>
                    {attendanceListBranchOptions.map((branch) => (
                      <option key={branch.id} value={branch.id}>{branch.name}</option>
                    ))}
                  </select>
                </label>
                <label className="attendance-employee-search">Tìm nhân viên
                  <input
                    type="search"
                    value={attendanceEmployeeSearch}
                    placeholder="Tìm tên nhân viên, có thể nhập không dấu…"
                    onChange={(event) => {
                      setAttendanceEmployeeSearch(event.target.value)
                      setAttendanceListEmployeeId('')
                      setAttendanceListPage(1)
                      setAttendanceEdit(null)
                      setAttendanceDelete(null)
                    }}
                  />
                </label>
                {attendanceListMode === 'date' ? (
                  <label>Ngày cần chỉnh
                    <input
                      type="date"
                      min={from}
                      max={to}
                      value={attendanceListDate}
                      onChange={(event) => {
                        if (!event.target.value) return
                        setAttendanceListDate(event.target.value)
                        setAttendanceListPage(1)
                        setAttendanceEdit(null)
                        setAttendanceDelete(null)
                      }}
                      required
                    />
                  </label>
                ) : (
                  <label>Nhân viên cần chỉnh
                    <select
                      value={attendanceListEmployeeId}
                      onChange={(event) => {
                        setAttendanceListEmployeeId(event.target.value)
                        setAttendanceListPage(1)
                        setAttendanceEdit(null)
                        setAttendanceDelete(null)
                      }}
                    >
                      <option value="">Chọn nhân viên</option>
                      {attendanceListVisibleEmployeeOptions.map((employee) => (
                        <option key={employee.id} value={employee.id}>
                          {employee.name} · {branchName(employee.branchId)}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <div className="attendance-correction-filter-summary">
                  <strong>{attendanceListFilteredRows.length}</strong>
                  <span>ca phù hợp</span>
                  <small>
                    {attendanceListBranchId ? branchName(attendanceListBranchId) : 'Tất cả chi nhánh'} · {' '}
                    {attendanceListMode === 'date' ? formatDate(attendanceListDate) : `${formatDate(from)}–${formatDate(to)}`}
                  </small>
                </div>
              </div>
              <div className="attendance-detail-list" id="attendance-detail-list">
                {attendanceListPageRows.map((row) => (
                  <article key={`${row.registrationId}-${row.attendanceRecordId || 'scheduled'}`}>
                    <div className="attendance-detail-date">
                      <strong>{formatDate(row.workDate)}</strong>
                      <small>{row.scheduledStart}–{row.scheduledEnd || '—'}</small>
                    </div>
                    <div className="attendance-detail-person">
                      <strong>{row.employeeName}</strong>
                      <small>{branchName(row.branchId)}</small>
                    </div>
                    <div className="attendance-detail-clock">
                      <span><small>Vào thực tế</small><b>{row.checkInTime ? formatDateTime(row.checkInTime) : 'Chưa có'}</b></span>
                      <span><small>Ra thực tế</small><b>{row.checkOutTime ? formatDateTime(row.checkOutTime) : 'Chưa có'}</b></span>
                    </div>
                    <div className="attendance-detail-result">
                      <span className={`attendance-state ${row.status}`}>{attendanceDetailStatus(row.status)}</span>
                      <strong>{formatWorkDurationBetween(row.checkInTime, row.checkOutTime)}</strong>
                    </div>
                    {!readOnly && (row.attendanceRecordId ? (
                      <div className="attendance-record-actions">
                        <button
                          type="button"
                          className="mini-button attendance-edit-button"
                          onClick={() => beginAttendanceCorrection(row)}
                        >Chỉnh công</button>
                        <button
                          type="button"
                          className="mini-button attendance-delete-button"
                          onClick={() => {
                            setAttendanceEdit(null)
                            setAttendanceDelete({
                              kind: 'record',
                              recordId: row.attendanceRecordId!,
                              registrationId: row.registrationId,
                              employeeName: row.employeeName,
                              workDate: row.workDate,
                              reason: '',
                            })
                          }}
                        >Xóa ca</button>
                      </div>
                    ) : (
                      <div className="attendance-record-actions">
                        <span className="attendance-no-record">Chưa có bản ghi</span>
                        <button
                          type="button"
                          className="mini-button attendance-delete-button"
                          onClick={() => {
                            setAttendanceEdit(null)
                            setAttendanceDelete({
                              kind: 'empty-registration',
                              recordId: null,
                              registrationId: row.registrationId,
                              employeeName: row.employeeName,
                              workDate: row.workDate,
                              reason: '',
                            })
                          }}
                        >Xóa dòng</button>
                      </div>
                    ))}

                    {row.note && (
                      <div className="attendance-detail-note">
                        <strong>Ghi chú bảng công</strong>
                        <span>{row.note}</span>
                      </div>
                    )}

                    {attendanceEdit && attendanceEdit.recordId === row.attendanceRecordId && (
                      <form className="attendance-correction-form" onSubmit={saveAttendanceCorrection}>
                        <div>
                          <strong>Chỉnh công · {attendanceEdit.employeeName}</strong>
                          <small>Mọi thay đổi được lưu lịch sử và đồng bộ vào bảng lương.</small>
                          <button
                            type="button"
                            className="attendance-use-schedule"
                            onClick={() => setAttendanceEdit((current) => current ? {
                              ...current,
                              checkInTime: attendanceScheduledDateTimeLocal(row.workDate, row.scheduledStart),
                              checkOutTime: attendanceScheduledDateTimeLocal(row.workDate, row.scheduledEnd, row.scheduledEnd <= row.scheduledStart),
                            } : current)}
                          >Dùng giờ theo ca {row.scheduledStart}–{row.scheduledEnd}</button>
                        </div>
                        <DateTime24Field label="Giờ vào" value={attendanceEdit.checkInTime} onChange={(value) => setAttendanceEdit((current) => current ? { ...current, checkInTime: value } : current)} />
                        <DateTime24Field label="Giờ ra" value={attendanceEdit.checkOutTime} onChange={(value) => setAttendanceEdit((current) => current ? { ...current, checkOutTime: value } : current)} />
                        <label className="attendance-correction-reason">Lý do điều chỉnh
                          <input value={attendanceEdit.reason} minLength={3} onChange={(event) => setAttendanceEdit((current) => current ? { ...current, reason: event.target.value } : current)} placeholder="Ví dụ: thiết bị lỗi không ghi nhận đúng giờ" required />
                        </label>
                        <div className="attendance-correction-actions">
                          <button type="button" className="secondary-button" onClick={() => setAttendanceEdit(null)} disabled={attendanceEditSaving}>Hủy</button>
                          <button type="submit" className="primary-button" disabled={attendanceEditSaving}>{attendanceEditSaving ? 'Đang lưu…' : 'Lưu & đồng bộ'}</button>
                        </div>
                      </form>
                    )}

                    {attendanceDelete && attendanceDelete.registrationId === row.registrationId && (
                      <form className="attendance-delete-confirm" onSubmit={saveAttendanceDeletion}>
                        <div>
                          <strong>{attendanceDelete.kind === 'empty-registration' ? 'Xóa dòng' : 'Xóa ca'} · {attendanceDelete.employeeName}</strong>
                          <small>
                            {attendanceDelete.kind === 'empty-registration'
                              ? `Ngày ${formatDate(attendanceDelete.workDate)} · Chỉ xóa đăng ký ca chưa có bản ghi chấm công; nhân viên, bảng công và lương không bị ảnh hưởng.`
                              : `Ngày ${formatDate(attendanceDelete.workDate)} · Chỉ bản ghi này bị xóa; lịch đăng ký ca vẫn được giữ lại.`}
                          </small>
                        </div>
                        <label>Lý do xóa
                          <input
                            value={attendanceDelete.reason}
                            minLength={3}
                            onChange={(event) => setAttendanceDelete((current) => current ? { ...current, reason: event.target.value } : current)}
                            placeholder="Ví dụ: tạo nhầm nhân viên hoặc nhầm ngày"
                            required
                            autoFocus
                          />
                        </label>
                        <div className="attendance-delete-actions">
                          <button type="button" className="secondary-button" onClick={() => setAttendanceDelete(null)} disabled={attendanceDeleteSaving}>Giữ lại</button>
                          <button type="submit" className="attendance-delete-confirm-button" disabled={attendanceDeleteSaving}>
                            {attendanceDeleteSaving ? 'Đang xóa…' : attendanceDelete.kind === 'empty-registration' ? 'Xác nhận xóa dòng' : 'Xác nhận xóa ca'}
                          </button>
                        </div>
                      </form>
                    )}
                  </article>
                ))}
                {!attendanceListPageRows.length && (
                  <p className="empty-copy">
                    {attendanceListMode === 'employee' && !attendanceListEmployeeId && !attendanceEmployeeSearchKey
                      ? 'Tìm tên hoặc chọn một nhân viên để xem các ca trong khoảng ngày phía trên.'
                      : 'Không có ca nào phù hợp với lựa chọn hiện tại.'}
                  </p>
                )}
              </div>
              {attendanceListFilteredRows.length > ATTENDANCE_EDIT_PAGE_SIZE && (
                <div className="attendance-correction-pagination" aria-label="Phân trang danh sách công">
                  <button
                    type="button"
                    className="secondary-button"
                    disabled={attendanceListSafePage <= 1}
                    onClick={() => { setAttendanceListPage((current) => Math.max(1, current - 1)); setAttendanceEdit(null) }}
                  >← Trang trước</button>
                  <span>
                    <strong>Trang {attendanceListSafePage}/{attendanceListTotalPages}</strong>
                    <small>
                      Ca {attendanceListPageStart + 1}–{Math.min(attendanceListPageStart + ATTENDANCE_EDIT_PAGE_SIZE, attendanceListFilteredRows.length)} / {attendanceListFilteredRows.length}
                    </small>
                  </span>
                  <button
                    type="button"
                    className="secondary-button"
                    disabled={attendanceListSafePage >= attendanceListTotalPages}
                    onClick={() => { setAttendanceListPage((current) => Math.min(attendanceListTotalPages, current + 1)); setAttendanceEdit(null) }}
                  >Trang sau →</button>
                </div>
              )}
            </section>
            </>
          )}

          {/* Biểu mẫu bổ sung công + nút chốt giờ ra trong component này đã tự khóa theo
              `user.role === 'admin'`, nên vai trò chỉ xem chỉ thấy chứng từ và nút xuất CSV. */}
          {activeSection === 'attendance' && <AttendanceAdjustmentArchive user={user} />}

          {/* ===== KPI DOANH THU ===== */}
          {activeSection === 'commission' && (
            <section className="erp-workspace-panel commission-section">
              <div className="section-title">
                <div><span className="eyebrow dark">KPI & XẾP HẠNG</span><h2>Thi đua nhân viên</h2></div>
                <div className="section-actions">
                  <span className="date-chip">{competitionAchievedCount}/{competitionFilteredRows.length} đạt KPI</span>
                  <button
                    type="button"
                    className="secondary-button"
                    disabled={exportBusy === 'kpi-evidence'}
                    onClick={() => void runExport(
                      'kpi-evidence',
                      competitionExportRows.length ? '' : 'Chưa có dữ liệu thi đua trong tháng phù hợp bộ lọc để xuất Excel.',
                      exportKpiEvidenceExcel,
                      'Đã xuất Excel KPI kèm bằng chứng nguồn doanh thu.',
                    )}
                  >{exportBusy === 'kpi-evidence' ? 'Đang xuất Excel…' : 'Xuất Excel ngày & tháng'}</button>
                  <button
                    type="button"
                    className="secondary-button"
                    disabled={exportBusy === 'kpi-daily'}
                    // Khác biệt duy nhất còn phải nói ra: file này theo khoảng ngày ĐẦU
                    // TRANG, không theo kỳ thi đua. Để ở tooltip thay vì một đoạn văn.
                    title={`Xuất theo khoảng ngày ở đầu trang: ${formatDate(from)} — ${formatDate(to)}`}
                    onClick={() => void runExport(
                      'kpi-daily',
                      dailyKpiRows.length ? '' : 'Chưa có dữ liệu KPI theo ngày trong bộ lọc hiện tại để xuất Excel.',
                      exportDailyKpiExcel,
                      'Đã xuất Excel KPI theo ngày gồm doanh thu và tiền thưởng.',
                    )}
                  >{exportBusy === 'kpi-daily' ? 'Đang xuất Excel…' : 'Xuất Excel KPI theo ngày'}</button>
                  <button type="button" className="secondary-button" disabled={exportBusy === 'competition-image'} onClick={() => void exportCompetitionImage()}>
                    {exportBusy === 'competition-image' ? 'Đang xuất…' : 'Xuất ảnh thi đua'}
                  </button>
                </div>
              </div>
              <div className="competition-ranking-toolbar">
                <div>
                  <span className="eyebrow dark">BẢNG XẾP HẠNG</span>
                  <h3>Phân loại thi đua</h3>
                </div>
                <div className="competition-ranking-controls">
                  <label>Phân loại
                    <select
                      aria-label="Phân loại bảng thi đua"
                      value={competitionRankingMode}
                      onChange={(event) => setCompetitionRankingMode(event.target.value as 'daily' | 'monthly' | 'leaders')}
                    >
                      <option value="daily">Theo ngày</option>
                      <option value="monthly">Theo tháng</option>
                      <option value="leaders">Ca trưởng theo tháng</option>
                    </select>
                  </label>
                  {competitionRankingMode === 'daily' && <label>Ngày xem
                    <input
                      type="date"
                      min={from}
                      max={to}
                      value={competitionDate}
                      onChange={(event) => { if (event.target.value) setCompetitionDate(event.target.value) }}
                    />
                  </label>}
                  <label>Vai trò
                    <select
                      aria-label="Vai trò thi đua"
                      value={effectiveCompetitionRole}
                      disabled={competitionRankingMode === 'leaders'}
                      onChange={(event) => setCompetitionRoleFilter(event.target.value as CompetitionRoleFilter)}
                    >
                      <option value="all">Tất cả</option>
                      <option value="staff">Nhân viên bán hàng</option>
                      <option value="shift_leader">Ca trưởng</option>
                    </select>
                  </label>
                  <label>Loại ngày
                    <select
                      aria-label="Loại ngày thi đua"
                      value={competitionDayType}
                      onChange={(event) => setCompetitionDayType(event.target.value as CompetitionDayType)}
                    >
                      <option value="all">Tất cả ngày</option>
                      <option value="weekday">Ngày thường</option>
                      <option value="weekend">Cuối tuần</option>
                    </select>
                  </label>
                  <label className="competition-shift-range">{competitionRankingMode === 'leaders' ? 'Ca vận hành' : 'Ca có check-in'}
                    <span>
                      <input
                        type="number"
                        min="0"
                        step="1"
                        inputMode="numeric"
                        aria-label="Số ca tối thiểu"
                        placeholder="Từ"
                        value={competitionMinShifts}
                        onChange={(event) => setCompetitionMinShifts(cleanNonNegativeIntegerInput(event.target.value))}
                      />
                      <input
                        type="number"
                        min="0"
                        step="1"
                        inputMode="numeric"
                        aria-label="Số ca tối đa"
                        placeholder="Đến"
                        value={competitionMaxShifts}
                        onChange={(event) => setCompetitionMaxShifts(cleanNonNegativeIntegerInput(event.target.value))}
                      />
                    </span>
                  </label>
                  <button
                    type="button"
                    className="competition-filter-reset"
                    onClick={() => {
                      setCompetitionRoleFilter('all')
                      setCompetitionDayType('all')
                      setCompetitionMinShifts('')
                      setCompetitionMaxShifts('')
                    }}
                  >Xóa lọc so sánh</button>
                </div>
              </div>

              {/* Một dải số duy nhất cho cả màn — trước đây có 3 dải tổng khác kỳ nhau. */}
              <div className="competition-overview" aria-label={`Tổng hợp thi đua ${competitionRankingTitle}`}>
                <article>
                  <span>Doanh thu kỳ</span>
                  <strong>{formatMoney(competitionTotalRevenue)}</strong>
                  <small>{formatNumber(salesCapacity.totalSoldQuantity)} sản phẩm · {competitionFilteredRows.length} nhân sự có doanh thu</small>
                </article>
                <article className={competitionAchievedCount ? 'good' : ''}>
                  <span>Đạt KPI</span>
                  <strong>{competitionAchievedCount}/{competitionFilteredRows.length}</strong>
                  <small>Từ 100% chỉ tiêu doanh thu của kỳ</small>
                </article>
                <article>
                  <span>{salesCapacityMetricLabel(effectiveCapacityMetric)} — trung bình đội</span>
                  <strong>{formatCapacityValue(effectiveCapacityMetric, salesCapacity.teamAverage)}</strong>
                  <small>{effectiveCapacityMetric === 'revenuePerMonth'
                    ? `${formatNumber(salesCapacity.totalMonths)} lượt tháng có đi làm`
                    : `${formatNumber(salesCapacity.totalDays)} ngày công`}</small>
                </article>
                <article className="total">
                  <span>Thưởng KPI</span>
                  <strong>{competitionRankingMode === 'leaders' ? '—' : formatMoney(competitionTotalReward)}</strong>
                  <small>{competitionRankingMode === 'leaders'
                    ? 'Bảng ca trưởng xếp doanh thu ca, không phát sinh thưởng cá nhân'
                    : 'Chỉ phát sinh khi đạt ngưỡng KPI ngày/tuần'}</small>
                </article>
              </div>

              <CompetitionClassificationTable
                title={competitionRankingTitle}
                rows={competitionRankingRows}
                totalRows={competitionFilteredRows.length}
                showAll={competitionShowAll}
                onToggleShowAll={() => setCompetitionShowAll((current) => !current)}
                sort={competitionSort}
                onSortChange={setCompetitionSort}
                showReward={competitionRankingMode !== 'leaders'}
                mode={competitionRankingMode}
                from={competitionRangeFrom}
                to={competitionRangeTo}
                allocations={competitionEvidenceAllocations}
                sessions={competitionEvidenceSessions}
                receipts={competitionEvidenceReceipts}
                capacityByKey={competitionCapacityByKey}
                capacityMetric={effectiveCapacityMetric}
                teamAverage={salesCapacity.teamAverage}
                dailyKpiByKey={competitionDailyKpiByKey}
              />

              <EmployeeSalesCapacityBoard
                summary={salesCapacity}
                metric={effectiveCapacityMetric}
                onMetricChange={setCapacityMetric}
                hasMonths={capacityHasMonths}
                scopeLabel={competitionRankingTitle}
              />

              {/* Poster chỉ để xuất ảnh gửi Zalo. Khi thu gọn nó vẫn phải NẰM
                  TRONG DOM và có kích thước thật thì html2canvas mới chụp được,
                  nên đẩy ra ngoài khung nhìn thay vì display:none. */}
              <div className="competition-poster-toggle">
                <div>
                  <strong>Ảnh thi đua (gửi Zalo)</strong>
                  <small>TOP 10 tháng {rankingPeriod}</small>
                </div>
                <button type="button" onClick={() => setCompetitionPosterOpen((current) => !current)} aria-expanded={competitionPosterOpen}>
                  {competitionPosterOpen ? 'Ẩn xem trước' : 'Xem trước ảnh'}
                </button>
              </div>
              <div className={`competition-poster-stage${competitionPosterOpen ? ' is-open' : ''}`} aria-hidden={!competitionPosterOpen}>
                <EmployeeCompetitionPoster
                  posterRef={competitionPosterRef}
                  rows={competitionPosterRows}
                  from={rankingMonthFrom}
                  to={rankingMonthTo}
                  branchLabel={branchId ? branchName(branchId) : 'Toàn hệ thống'}
                />
              </div>

            </section>
          )}

          {/* ===== BÁO CÁO KHO ===== */}
          {activeSection === 'inventory' && (
            <section className="erp-workspace-panel admin-report-section">
              <div className="section-title">
                <div><span className="eyebrow dark">BÁO CÁO KHO</span><h2>Nhập, xuất, hao hụt và tồn kho trong kỳ</h2></div>
                <button
                  type="button"
                  className="primary-button"
                  onClick={() => void runExport(
                    'inventory',
                    stockRows.length ? '' : 'Chưa có dữ liệu kho trong bộ lọc hiện tại để xuất Excel.',
                    exportInventory,
                    'Đã xuất Excel báo cáo kho.',
                  )}
                  disabled={exportBusy === 'inventory'}
                >{exportBusy === 'inventory' ? 'Đang xuất…' : 'Xuất Excel'}</button>
              </div>
              <div className="admin-inventory-overview">
                <div className="admin-inventory-overview-copy">
                  <span>TỔNG QUAN KHO</span>
                  <strong>{branchId ? branchName(branchId) : `${inventoryOverview.branches} chi nhánh`}</strong>
                  <small>{formatDate(from)} — {formatDate(to)} · dữ liệu tự đồng bộ</small>
                </div>
                <article><span>SKU đang có tồn</span><b>{inventoryOverview.stockedSkus}</b><small>Tồn hiện tại lớn hơn 0</small></article>
                <article className={inventoryOverview.lowSkus ? 'warning' : 'good'}><span>Cần chú ý</span><b>{inventoryOverview.lowSkus}</b><small>SKU chạm ngưỡng sắp hết</small></article>
                <article><span>Phát sinh trong kỳ</span><b>{inventoryOverview.movements}</b><small>Dòng nhập, xuất, kiểm kê, hao hụt</small></article>
              </div>
              <div className="inventory-branch-section">
                <div className="inventory-branch-section-head">
                  <div>
                    <span className="eyebrow dark">KHO THEO CHI NHÁNH</span>
                    <h3>Tình trạng tồn và luân chuyển hàng hóa</h3>
                    <p>Mỗi chi nhánh một dòng — bấm để mở tồn từng SKU ngay bên dưới.</p>
                  </div>
                  <span className="inventory-branch-count">{branchInventorySummaries.length} điểm bán</span>
                </div>

                {/* 07/08/2026: bỏ lưới thẻ cao 200px (mỗi chi nhánh một khối) —
                    cùng luật với màn Kho ca trưởng ở §51: dòng, không dùng card. */}
                <div className="admin-stock-branches" role="table" aria-label="Kho theo chi nhánh">
                  <div className="admin-stock-branch-head" role="row">
                    <span>Chi nhánh</span>
                    <span>Tồn hiện tại</span>
                    <span>Nhập trong kỳ</span>
                    <span>POS bán trong kỳ</span>
                    <span>Cảnh báo</span>
                    <span />
                  </div>
                  {branchInventorySummaries.map(({ branch, lowCount, lossRate, stockLines, stockSummary, inboundSummary, dailyPosSummary }) => {
                    const isSelected = inventoryDetailBranchId === branch.id
                    const stockedCount = stockLines.filter((line) => line.expected > 0.0001).length
                    const outCount = stockLines.filter((line) => line.expected <= 0.0001).length
                    return (
                      <button
                        type="button"
                        className={`admin-stock-branch-row${isSelected ? ' selected' : ''}`}
                        key={branch.id}
                        role="row"
                        aria-expanded={isSelected}
                        aria-controls="inventory-branch-detail-panel"
                        onClick={() => setInventoryDetailBranchId((current) => current === branch.id ? '' : branch.id)}
                      >
                        <span data-label="Chi nhánh" role="cell" className="admin-stock-branch-name">
                          <strong>{branch.name}</strong>
                          <small>{stockedCount} SKU đang có tồn{outCount ? ` · ${outCount} SKU đã hết` : ''}</small>
                        </span>
                        <span data-label="Tồn hiện tại" role="cell"><b>{stockSummary}</b></span>
                        <span data-label="Nhập trong kỳ" role="cell"><b>{inboundSummary}</b></span>
                        <span data-label="POS bán trong kỳ" role="cell"><b>{dailyPosSummary}</b></span>
                        <span data-label="Cảnh báo" role="cell" className="admin-stock-branch-flags">
                          <i className={`inventory-health ${lowCount ? 'warning' : 'good'}`}>{lowCount ? `${lowCount} SKU sắp hết` : 'Tồn ổn định'}</i>
                          <i className={`inventory-health ${lossRate > 12 ? 'danger' : lossRate > 7 ? 'warning' : 'good'}`}>Hao hụt {formatInventoryDecimal(lossRate, 1)}%</i>
                        </span>
                        <span role="cell" className="admin-stock-branch-action">{isSelected ? 'Thu gọn' : 'Xem chi tiết'}</span>
                      </button>
                    )
                  })}
                  {!branchInventorySummaries.length && <p className="empty-copy">Chưa có chi nhánh nào để hiển thị.</p>}
                </div>

                {inventoryDetailSummary && (
                  <section className="inventory-branch-detail-shell" id="inventory-branch-detail-panel" aria-live="polite">
                    <header className="inventory-branch-detail-head">
                      <div>
                        <span className="eyebrow dark">CHI TIẾT TỒN KHO</span>
                        <h3>{inventoryDetailSummary.branch.name}</h3>
                        <p>Mỗi số lượng luôn kèm đúng đơn vị kg, g hoặc cái; không cộng lẫn các đơn vị.</p>
                      </div>
                      <button type="button" className="inventory-detail-close" onClick={() => setInventoryDetailBranchId('')} aria-label="Đóng chi tiết chi nhánh">×</button>
                    </header>

                    <div className="inventory-branch-detail-metrics">
                      <div><span>Tồn hiện tại</span><b>{inventoryDetailSummary.stockSummary}</b></div>
                      <div className={inventoryDetailSummary.lowCount ? 'warning' : ''}><span>SKU sắp hết</span><b>{inventoryDetailSummary.lowCount} SKU</b></div>
                      <div><span>Nhập trong kỳ</span><b>{inventoryDetailSummary.inboundSummary}</b></div>
                      <div><span>Xuất trong kỳ</span><b>{inventoryDetailSummary.outboundSummary}</b></div>
                      <div className={inventoryDetailSummary.lossQty ? 'danger' : ''}><span>Hao hụt</span><b>{inventoryDetailSummary.lossSummary}</b></div>
                      <div><span>Sửa tồn trong kỳ</span><b>{inventoryDetailSummary.adjustSummary}</b></div>
                    </div>

                    {/* Tìm không dấu + 3 chip lọc. Dòng nào cần xử lý được đẩy
                        lên đầu (hết → sắp hết → còn hàng), xem `inventoryStockLines`. */}
                    <div className="admin-stock-filterbar">
                      <label className="admin-stock-search">
                        <span aria-hidden="true">⌕</span>
                        <input
                          value={inventorySkuSearch}
                          onChange={(event) => setInventorySkuSearch(event.target.value)}
                          placeholder="Tìm tên hoặc mã SKU (không cần dấu)"
                          aria-label="Tìm mặt hàng trong kho chi nhánh"
                        />
                      </label>
                      <div className="admin-stock-chips" role="group" aria-label="Lọc trạng thái tồn">
                        {([
                          ['all', `Tất cả (${inventoryDetailSummary.stockLines.length})`],
                          ['attention', `Cần chú ý (${inventoryDetailSummary.lowCount})`],
                          ['out', `Đã hết (${inventoryStockOutCount})`],
                        ] as const).map(([id, label]) => (
                          <button
                            key={id}
                            type="button"
                            className={inventoryStockFilter === id ? 'is-active' : ''}
                            aria-pressed={inventoryStockFilter === id}
                            onClick={() => setInventoryStockFilter(id)}
                          >{label}</button>
                        ))}
                      </div>
                    </div>

                    <div className="inventory-branch-detail-content">
                      <div className="inventory-stock-table" role="table" aria-label={`Tồn kho ${inventoryDetailSummary.branch.name}`}>
                        <div className="inventory-stock-head" role="row">
                          <span>Sản phẩm / SKU</span>
                          <span>Tồn hiện tại</span>
                          <span>Trạng thái</span>
                        </div>
                        {inventoryStockLines.map((line) => {
                          const isOut = line.expected <= 0.0001
                          const isLow = !isOut && line.expected <= line.product.lowStock
                          return (
                            <article className={`inventory-stock-row${isOut ? ' out' : isLow ? ' warning' : ''}`} role="row" key={line.product.id}>
                              <span className="inventory-stock-product" role="cell"><strong>{line.product.name}</strong><small>{line.product.sku}</small></span>
                              <span className="inventory-stock-value" role="cell"><b>{formatInventoryQuantity(line.expected, line.product.unit)}</b></span>
                              <span role="cell"><b className={`inventory-stock-status ${isOut ? 'out' : isLow ? 'warning' : 'good'}`}>{isOut ? 'Hết hàng' : isLow ? 'Sắp hết' : 'Ổn định'}</b></span>
                            </article>
                          )
                        })}
                        {!inventoryStockLines.length && <p className="empty-copy">Không có mặt hàng nào khớp bộ lọc hiện tại.</p>}
                      </div>

                      <aside className="inventory-loss-panel">
                        <span className="eyebrow dark">Hao hụt cần chú ý</span>
                        <strong>{formatInventoryDecimal(inventoryDetailSummary.lossRate, 1)}%</strong>
                        <small>Tỷ lệ hao hụt trong khoảng ngày đã chọn</small>
                        <div className="inventory-loss-progress" aria-hidden="true"><span style={{ width: `${Math.min(inventoryDetailSummary.lossRate, 100)}%` }} /></div>
                        {inventoryDetailSummary.topLoss.length > 0 ? (
                          <ul>
                            {inventoryDetailSummary.topLoss.map((row) => (
                              <li key={row.product.id}><span><b>{row.product.name}</b><small>{row.product.sku}</small></span><strong>{formatInventoryQuantity(row.waste, row.product.unit)}</strong></li>
                            ))}
                          </ul>
                        ) : <p>Chưa ghi nhận hao hụt trong kỳ.</p>}
                      </aside>
                    </div>
                  </section>
                )}
              </div>
              <section className="inventory-shift-reconciliation">
                <header className="inventory-shift-reconciliation-head">
                  <div>
                    <span className="eyebrow dark">ĐỐI CHIẾU THEO CA</span>
                    <h3>Xuất bán và tồn bàn giao</h3>
                    <p>Out chính thức = Tồn đầu + Nhập thêm − Tồn bàn giao − Hao hụt. POS chỉ dùng để đối chiếu, không trừ kho lần hai.</p>
                  </div>
                  <div className="inventory-shift-period-fields">
                    <label>Từ ngày
                      <input type="date" max={to} value={from} onChange={(event) => { if (event.target.value) setFrom(event.target.value) }} required />
                    </label>
                    <label>Đến ngày
                      <input type="date" min={from} value={to} onChange={(event) => { if (event.target.value) setTo(event.target.value) }} required />
                    </label>
                  </div>
                </header>
                <div className="inventory-shift-reconciliation-summary">
                  <span><small>Ca đã bàn giao</small><strong>{inventoryClosedShiftCount}/{inventoryShiftReconciliationRows.length} ca</strong></span>
                  <span><small>Ca cần xem</small><strong>{inventoryShiftIssueRows.length} ca</strong></span>
                  <span><small>POS đã bán</small><strong>{inventoryShiftPosSummary}</strong></span>
                  <span><small>Out chính thức</small><strong>{inventoryShiftOfficialOutSummary}</strong></span>
                  <span><small>Phiếu xuất riêng</small><strong>{inventoryDailyOutboundDocumentCount} phiếu · {inventoryDailyOutboundSummary}</strong></span>
                </div>
                {/* Mặc định chỉ hiện ca ĐANG MỞ hoặc ca có SKU lệch — chọn một
                    tháng là hàng trăm ca, mà ca khớp số thì không cần đọc. */}
                {inventoryShiftIssueRows.length > 0 && inventoryShiftIssueRows.length < inventoryShiftReconciliationRows.length && (
                  <div className="admin-stock-chips" role="group" aria-label="Lọc ca đối chiếu">
                    <button
                      type="button"
                      className={inventoryShiftOnlyIssues ? 'is-active' : ''}
                      aria-pressed={inventoryShiftOnlyIssues}
                      onClick={() => setInventoryShiftOnlyIssues(true)}
                    >Ca cần xem ({inventoryShiftIssueRows.length})</button>
                    <button
                      type="button"
                      className={!inventoryShiftOnlyIssues ? 'is-active' : ''}
                      aria-pressed={!inventoryShiftOnlyIssues}
                      onClick={() => setInventoryShiftOnlyIssues(false)}
                    >Tất cả ({inventoryShiftReconciliationRows.length})</button>
                  </div>
                )}
                <div className="inventory-shift-reconciliation-table" role="table" aria-label={`Đối chiếu xuất bán theo ca từ ${formatDate(from)} đến ${formatDate(to)}`}>
                  <div className="inventory-shift-reconciliation-table-head" role="row">
                    <span>Chi nhánh / ca</span>
                    <span>Trạng thái</span>
                    <span>Tồn đầu</span>
                    <span>Nhập thêm</span>
                    <span>POS đã bán</span>
                    <span>Hao hụt</span>
                    <span>Tồn bàn giao</span>
                    <span>Out chính thức</span>
                    <span>Chênh lệch</span>
                  </div>
                  {inventoryShiftVisibleRows.map((row) => (
                    <article className={`inventory-shift-reconciliation-row ${row.status}`} role="row" key={row.sessionId}>
                      <span data-label="Chi nhánh / ca" role="cell">
                        <strong>{branchName(row.branchId)}</strong>
                        <small>{formatDate(row.businessDate)} · Ca {row.sequence} · {formatShiftTime(row.startedAt, row.endedAt)}</small>
                      </span>
                      <span data-label="Trạng thái" role="cell">
                        <b className={`inventory-shift-status ${row.status}`}>
                          {row.status === 'open' ? 'Ca đang mở · POS tạm tính' : 'Đã bàn giao'}
                        </b>
                        <small>{row.receiptCount} hóa đơn · {formatMoney(row.posRevenue)}</small>
                      </span>
                      <span data-label="Tồn đầu" role="cell"><b>{row.openingSummary}</b></span>
                      <span data-label="Nhập thêm" role="cell"><b>{row.additionSummary}</b></span>
                      <span data-label="POS đã bán" role="cell"><b>{row.posNativeSummary}</b><small>{row.posEquivalentSummary}</small></span>
                      <span data-label="Hao hụt" role="cell"><b>{row.wasteSummary}</b></span>
                      <span data-label="Tồn bàn giao" role="cell"><b>{row.closingSummary}</b></span>
                      <span data-label="Out chính thức" role="cell"><b>{row.officialOutSummary}</b></span>
                      <span data-label="Chênh lệch" role="cell"><b className={row.differenceTone}>{row.differenceLabel}</b></span>
                      {user.role === 'admin' && row.status === 'closed' && (
                        <div data-label="Thao tác" className="inventory-shift-admin-actions" role="cell">
                          <button
                            type="button"
                            className="mini-button"
                            disabled={Boolean(adminShiftActionId) || row.businessDate !== todayKey}
                            title={row.businessDate === todayKey ? 'Hoàn tác chốt ca để chỉnh sửa rồi chốt lại' : 'Chỉ hỗ trợ ca của ngày hôm nay'}
                            onClick={() => void reopenShiftsFromAdmin([row])}
                          >
                            {adminShiftActionId === row.sessionId ? 'Đang mở…' : 'Mở lại ca'}
                          </button>
                          {row.sequence === 1 && inventoryShiftReconciliationRows.some((other) =>
                            other.branchId === row.branchId
                            && other.businessDate === row.businessDate
                            && other.sequence === 2
                            && other.status === 'closed',
                          ) && (
                            <button
                              type="button"
                              className="mini-button"
                              disabled={Boolean(adminShiftActionId) || row.businessDate !== todayKey}
                              title="Hoàn tác cả Ca 1 và Ca 2 để chỉnh sửa lại"
                              onClick={() => void reopenShiftsFromAdmin([
                                row,
                                inventoryShiftReconciliationRows.find((other) =>
                                  other.branchId === row.branchId
                                  && other.businessDate === row.businessDate
                                  && other.sequence === 2,
                                )!,
                              ])}
                            >Mở lại cả 2 ca</button>
                          )}
                        </div>
                      )}
                      <details className="inventory-shift-reconciliation-details">
                        <summary>Chi tiết đối chiếu theo SKU</summary>
                        <div className="inventory-shift-reconciliation-lines">
                          <div className="inventory-shift-reconciliation-line head">
                            <span>Sản phẩm nguồn</span><span>Tồn đầu</span><span>Nhập thêm</span><span>Sửa tồn</span><span>POS quy đổi</span>
                            <span>Hao hụt</span><span>Tồn cuối</span><span>Out</span><span>Lệch</span>
                          </div>
                          {row.lines.map((line) => (
                            <div className="inventory-shift-reconciliation-line" key={line.productId}>
                              <span data-label="Sản phẩm nguồn"><strong>{line.productName}</strong><small>{line.sku}</small></span>
                              <span data-label="Tồn đầu">{formatInventoryQuantity(line.opening, line.unit)}</span>
                              <span data-label="Nhập thêm">{formatInventoryQuantity(line.additions, line.unit)}</span>
                              <span data-label="Sửa tồn">{line.adjust ? formatInventoryDelta(line.adjust, line.unit) : '—'}</span>
                              <span data-label="POS quy đổi">{formatInventoryQuantity(line.posEquivalent, line.unit)}</span>
                              <span data-label="Hao hụt">{formatInventoryQuantity(line.waste, line.unit)}</span>
                              <span data-label="Tồn cuối">{line.closing === null ? 'Chưa bàn giao' : formatInventoryQuantity(line.closing, line.unit)}</span>
                              <span data-label="Out">{line.officialOut === null ? 'Chưa chốt' : formatInventoryQuantity(line.officialOut, line.unit)}</span>
                              <span data-label="Lệch">{line.difference === null ? 'Chưa đối chiếu' : formatInventoryQuantity(line.difference, line.unit)}</span>
                            </div>
                          ))}
                        </div>
                      </details>
                    </article>
                  ))}
                  {!inventoryShiftReconciliationRows.length && <p className="empty-copy">Không có ca vận hành trong khoảng ngày và chi nhánh đã chọn.</p>}
                </div>
              </section>
              {canOpenAdminConsole(user.role) && <>
              {/* Sổ phát sinh kho: lọc theo loại phiếu + tìm không dấu + phân trang.
                  Bản cũ đổ thẳng mọi phiếu của kỳ ra một khối duy nhất. */}
              <div className="admin-ledger-filterbar">
                <label className="admin-stock-search">
                  <span aria-hidden="true">⌕</span>
                  <input
                    value={inventoryLedgerSearch}
                    onChange={(event) => { setInventoryLedgerSearch(event.target.value); setInventoryLedgerPage(1) }}
                    placeholder="Tìm mặt hàng, SKU hoặc ghi chú phiếu"
                    aria-label="Tìm trong sổ phát sinh kho"
                  />
                </label>
                <div className="admin-stock-chips" role="group" aria-label="Lọc loại phiếu kho">
                  <button
                    type="button"
                    className={inventoryLedgerType === 'all' ? 'is-active' : ''}
                    aria-pressed={inventoryLedgerType === 'all'}
                    onClick={() => { setInventoryLedgerType('all'); setInventoryLedgerPage(1) }}
                  >Tất cả ({inventoryLedgerRows.length})</button>
                  {(Object.keys(MOVEMENT_LABELS) as Array<StockMovement['type']>)
                    .filter((type) => (inventoryLedgerTypeCounts.get(type) || 0) > 0)
                    .map((type) => (
                      <button
                        key={type}
                        type="button"
                        className={inventoryLedgerType === type ? 'is-active' : ''}
                        aria-pressed={inventoryLedgerType === type}
                        onClick={() => { setInventoryLedgerType(type); setInventoryLedgerPage(1) }}
                      >{MOVEMENT_LABELS[type]} ({inventoryLedgerTypeCounts.get(type)})</button>
                    ))}
                </div>
              </div>
              <div className="admin-inventory-ledger" role="table" aria-label="Danh sách phát sinh kho">
                <div className="admin-inventory-ledger-head" role="row">
                  <span>Ngày</span>
                  <span>Chi nhánh</span>
                  <span>Loại</span>
                  <span>Thành phẩm / SKU</span>
                  <span>Số lượng</span>
                  <span>Người nhập</span>
                  <span>Ghi chú</span>
                </div>
                {inventoryLedgerByDay.map(([date, rows], index) => (
                  <details className="admin-ledger-day" key={date} open={index === 0}>
                    <summary>
                      <span><strong>{formatDate(date)}</strong><small>{rows.length} phát sinh kho</small></span>
                      <span className="admin-ledger-day-count">{new Set(rows.map((row) => row.branchId)).size} chi nhánh</span>
                    </summary>
                    {rows.map((movement) => {
                      const product = productById(movement.productId)
                      const creator = employees.find((employee) => employee.id === movement.createdBy)
                      return (
                        <article className="admin-inventory-ledger-row" role="row" key={movement.id}>
                          <span data-label="Ngày"><strong>{formatDate(movement.shiftDate)}</strong><small>{formatDateTime(movement.createdAt)}</small></span>
                          <span data-label="Chi nhánh">{branchName(movement.branchId)}</span>
                          <span data-label="Loại"><b className={`inventory-movement-chip ${movement.type}`}>{MOVEMENT_LABELS[movement.type]}</b></span>
                          <span data-label="Thành phẩm / SKU"><strong>{product?.name || movement.productId}</strong><small>{product?.sku || '-'}</small></span>
                          <span data-label="Số lượng"><b>{formatInventoryQuantity(movement.quantity, product?.unit || 'đơn vị')}</b></span>
                          <span data-label="Người nhập">{creator?.name || movement.createdBy || '-'}</span>
                          <span data-label="Ghi chú">{movement.note || '-'}</span>
                        </article>
                      )
                    })}
                  </details>
                ))}
                {!inventoryLedgerFilteredRows.length && <p className="empty-copy">
                  {inventoryLedgerRows.length
                    ? 'Không có phiếu kho nào khớp bộ lọc hiện tại.'
                    : 'Không có phát sinh kho trong khoảng đã chọn.'}
                </p>}
              </div>
              {inventoryLedgerFilteredRows.length > 0 && <Pagination
                total={inventoryLedgerFilteredRows.length}
                page={inventoryLedgerSafePage}
                pageSize={inventoryLedgerPageSize}
                pageSizeOptions={[25, 50, 100]}
                onPageChange={setInventoryLedgerPage}
                onPageSizeChange={(size) => { setInventoryLedgerPageSize(size); setInventoryLedgerPage(1) }}
              />}
              </>}
            </section>
          )}

          {/* ===== ĐẶT HÀNG ===== */}
          {activeSection === 'requests' && (
            <section className="erp-workspace-panel admin-requests-workspace">
              <div className="section-title">
                <div><span className="eyebrow dark">YÊU CẦU NHẬP HÀNG</span><h2>Đơn đặt hàng từ các chi nhánh</h2></div>
                <div className="section-actions">
                  <button
                    type="button"
                    className="primary-button"
                    onClick={() => void runExport(
                      'supply',
                      filteredSupplyRequests.length ? '' : 'Chưa có yêu cầu đặt hàng trong bộ lọc hiện tại để xuất Excel.',
                      exportSupplyReportExcel,
                      'Đã xuất Excel danh sách đặt hàng.',
                    )}
                    disabled={exportBusy === 'supply'}
                  >{exportBusy === 'supply' ? 'Đang xuất…' : 'Xuất Excel'}</button>
                  <span className="date-chip">{pendingRequests} chờ duyệt</span>
                </div>
              </div>
              <p className="admin-readonly-note">Admin chỉ theo dõi, lọc và xuất danh sách; không đặt hàng hoặc đổi trạng thái đơn tại màn này. Đơn do ca trưởng tại chi nhánh gửi lên.</p>
              {/* Lọc theo chi nhánh và khoảng ngày dùng chung thanh lọc ở đầu trang Quản trị.
                  Tab dưới đây lọc thêm theo trạng thái; danh sách và Excel dùng CHUNG một tập đã lọc. */}
              <nav className="supply-status-tabs" aria-label="Lọc theo trạng thái đơn">
                {SUPPLY_STATUS_TABS.map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    className={supplyStatusFilter === tab.id ? 'active' : ''}
                    onClick={() => setSupplyStatusFilter(tab.id)}
                  >{tab.label}<b>{supplyStatusCounts[tab.id]}</b></button>
                ))}
              </nav>
              <div className="supply-branch-groups">
                {supplyRequestsByBranch.map((group) => (
                  <details className="supply-branch-group" key={group.branchId} open>
                    <summary>
                      <span><strong>{branchName(group.branchId) || group.branchId}</strong><small>{group.requests.length} đơn</small></span>
                      <b>{group.requests.filter((req) => req.status === 'pending').length || '✓'}</b>
                    </summary>
                    <div className="supply-request-list">
                      {group.requests.map((req) => (
                        <div key={req.id} className={`supply-request-item${req.status === 'pending' ? ' pending' : ''}`}>
                          <span className="supply-request-icon">↑</span>
                          <span>
                            <strong>{req.productName} · {formatNumber(req.quantity)} {req.unit}</strong>
                            <small>{req.requestedByName} · {formatDate(req.createdAt.slice(0, 10))}{req.note ? ` · "${req.note}"` : ''}</small>
                          </span>
                          <span className="supply-request-tail">
                            <span className={`supply-status-badge ${req.status}`}>{supplyStatusLabel(req.status)}</span>
                          </span>
                        </div>
                      ))}
                    </div>
                  </details>
                ))}
                {!filteredSupplyRequests.length && <p className="empty-copy">Chưa có yêu cầu đặt hàng nào khớp bộ lọc hiện tại.</p>}
              </div>
            </section>
          )}

          {/* ===== NHÂN SỰ ===== */}
          {activeSection === 'accounts' && (
            <section className="section-card admin-accounts" style={{ marginTop: 0 }}>
              <div className="section-title">
                <div><h2>Nhân sự & Chi nhánh</h2></div>
                <span className="date-chip">{accountEmployees.length} tài khoản</span>
              </div>
              {!crmEmployeeId && !crmBranchId && <nav className="admin-module-route-switch" aria-label="Module nhân sự và chi nhánh">
                <button type="button" className={accountsDirectory === 'employees' ? 'active' : ''} onClick={() => navigateAdminHash('/admin/employees')}>Nhân viên</button>
                <button type="button" className={accountsDirectory === 'branches' ? 'active' : ''} onClick={() => navigateAdminHash('/admin/branches')}>Chi nhánh</button>
              </nav>}
              {!crmEmployeeId && !crmBranchId && accountsDirectory === 'branches' && (
                <BranchesPage
                  branches={visibleBranches}
                  employees={accountEmployees}
                  receipts={salesReceipts}
                  from={from}
                  to={to}
                  loading={loading}
                  createOpen={showCreateBranch}
                  deletingId={branchDeletingId}
                  onToggleCreate={readOnly ? undefined : () => setShowCreateBranch((current) => !current)}
                  onOpenBranch={(branch) => {
                    navigateAdminHash(`/admin/branches/${encodeURIComponent(branch.id)}/overview`)
                    setCrmBranchId(branch.id)
                    setCrmEmployeeId('')
                    setBranchProfileTab('overview')
                  }}
                  onDeleteBranch={user.role === 'admin' ? (branch) => void removeBranchFromOperations(branch) : undefined}
                />
              )}
              {!crmEmployeeId && !crmBranchId && accountsDirectory === 'branches' && showCreateBranch && !readOnly && (
                <div className="admin-crm-create-panel">
                  <div className="admin-crm-subtitle"><strong>Tạo hồ sơ chi nhánh</strong><small>Chi nhánh mới sẽ có sẵn khung ca mặc định.</small></div>
                  <form className="admin-crm-branch-form" onSubmit={createBranchFromCrm}>
                    <label>Mã chi nhánh<input value={branchDraft.id} onChange={(event) => setBranchDraft({ ...branchDraft, id: event.target.value })} placeholder="Tự tạo từ tên nếu để trống" /></label>
                    <label>Tên chi nhánh<input value={branchDraft.name} onChange={(event) => setBranchDraft({ ...branchDraft, name: event.target.value })} required /></label>
                    <label>Địa chỉ<input value={branchDraft.address} onChange={(event) => setBranchDraft({ ...branchDraft, address: event.target.value })} /></label>
                    <label>Quản lý phụ trách<input value={branchDraft.manager} onChange={(event) => setBranchDraft({ ...branchDraft, manager: event.target.value })} /></label>
                    <button className="primary-button">Tạo chi nhánh</button>
                  </form>
                </div>
              )}
              {crmBranchId && (() => {
                const branch = visibleBranches.find((item) => item.id === crmBranchId) as ConfigBranch | undefined
                const branchEmployees = accountEmployees.filter((employee) => employee.branchId === crmBranchId)
                const branchReceipts = salesReceipts.filter((receipt) =>
                  receipt.branchId === crmBranchId && receipt.businessDate >= from && receipt.businessDate <= to,
                )
                const branchRecords = records.filter((record) => {
                  const date = localDateKey(new Date(record.checkInTime))
                  return record.branchId === crmBranchId && date >= from && date <= to
                })
                const branchMovements = movements.filter((movement) =>
                  movement.branchId === crmBranchId && movement.shiftDate >= from && movement.shiftDate <= to,
                )
                const branchRequests = supplyRequests.filter((request) =>
                  request.branchId === crmBranchId && request.createdAt.slice(0, 10) >= from && request.createdAt.slice(0, 10) <= to,
                )
                const revenueByDate = Array.from(new Set(branchReceipts.map((receipt) => receipt.businessDate))).sort().map((date) => ({
                  date,
                  revenue: branchReceipts.filter((receipt) => receipt.businessDate === date).reduce((sum, receipt) => sum + receipt.totalAmount, 0),
                }))
                const maxRevenue = Math.max(1, ...revenueByDate.map((item) => item.revenue))
                return (
                  <div className="admin-crm-detail admin-crm-page">
                    <div className="admin-crm-detail-head">
                      <button className="admin-crm-back" type="button" onClick={() => navigateAdminHash('/admin/branches')}>← Quay lại danh bạ</button>
                      <div><small>HỒ SƠ CHI NHÁNH</small><h3>{branch?.name}</h3><p>{branch?.address || 'Chưa cập nhật địa chỉ'} · {branch?.manager || 'Chưa gán quản lý phụ trách'}</p></div>
                    </div>
                    <div className="admin-crm-metrics">
                      <article><span>Nhân sự</span><strong>{branchEmployees.length}</strong><small>{branchEmployees.filter((item) => item.active !== false).length} đang hoạt động</small></article>
                      <article><span>Doanh thu kỳ này</span><strong>{formatMoney(branchReceipts.reduce((sum, receipt) => sum + receipt.totalAmount, 0))}</strong><small>{branchReceipts.length} hóa đơn</small></article>
                      <article><span>Khoảng dữ liệu</span><strong>{from}</strong><small>đến {to}</small></article>
                    </div>
                    <nav className="admin-employee-tabs admin-branch-tabs" aria-label="Chức năng hồ sơ chi nhánh">
                      {([
                        ['overview', 'Tổng quan'],
                        ['revenue', 'Doanh thu'],
                        ['employees', 'Nhân sự'],
                        ['attendance', 'Chấm công'],
                        ['inventory', 'Kho'],
                        ['requests', 'Đơn hàng'],
                      ] as const).map(([id, label]) => (
                        <button type="button" key={id} className={branchProfileTab === id ? 'active' : ''} onClick={() => navigateAdminHash(`/admin/branches/${encodeURIComponent(crmBranchId)}/${id}`)}>{label}</button>
                      ))}
                    </nav>
                    {(branchProfileTab === 'overview' || branchProfileTab === 'revenue') && <div className="admin-crm-chart">
                      {revenueByDate.length ? revenueByDate.map((item) => (
                        <span key={item.date} title={`${item.date}: ${formatMoney(item.revenue)}`}>
                          <i style={{ height: `${Math.max(8, item.revenue / maxRevenue * 100)}%` }} />
                          <small>{item.date.slice(8)}</small>
                        </span>
                      )) : <p>Chưa có doanh thu trong kỳ.</p>}
                    </div>}
                    {branchProfileTab === 'revenue' && <div className="admin-crm-sales-list admin-branch-tab-list">
                      {branchReceipts.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((receipt) => (
                        <article key={receipt.id}>
                          <span><b>{receipt.code}</b><small>{formatDate(receipt.businessDate)} · {receipt.sellerName || 'Chưa có nhân viên bán'}</small></span>
                          <span><strong>{formatMoney(receipt.totalAmount)}</strong><small>{formatNumber(receipt.totalQuantity)} sản phẩm</small></span>
                        </article>
                      ))}
                      {!branchReceipts.length && <p className="empty-copy">Chưa có hóa đơn trong kỳ này.</p>}
                    </div>}
                    {(branchProfileTab === 'overview' || branchProfileTab === 'employees') && <>
                    <div className="admin-crm-subtitle"><strong>Nhân sự tại chi nhánh</strong></div>
                    <div className="admin-crm-people admin-crm-people-list">
                      {branchEmployees.map((employee) => (
                        <button type="button" key={employee.id} onClick={() => {
                          openEmployeeCrm(employee)
                        }}>
                          <span className="admin-avatar">
                            {employee.avatarUrl ? <img src={employee.avatarUrl} alt="" /> : employee.name.slice(0, 1).toUpperCase()}
                          </span>
                          <span><b>{employee.name}</b><small>{employee.positionTitle || roleLabel(employee.role)} · @{emailToUsername(employee.email) || employee.id}</small></span>
                          <em>{employee.active === false ? 'Ngừng hoạt động' : 'Đang hoạt động'}</em>
                          <i>→</i>
                        </button>
                      ))}
                    </div>
                    </>}
                    {branchProfileTab === 'attendance' && <div className="admin-crm-sales-list admin-branch-tab-list">
                      {branchRecords.slice().sort((a, b) => b.checkInTime.localeCompare(a.checkInTime)).map((record) => (
                        <article key={record.id}>
                          <span><b>{record.userName}</b><small>{formatDate(localDateKey(new Date(record.checkInTime)))}</small></span>
                          <span><strong>{new Date(record.checkInTime).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })} → {record.checkOutTime ? new Date(record.checkOutTime).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }) : 'Chưa chấm ra'}</strong></span>
                        </article>
                      ))}
                      {!branchRecords.length && <p className="empty-copy">Chưa có dữ liệu chấm công trong kỳ này.</p>}
                    </div>}
                    {branchProfileTab === 'inventory' && <div className="admin-crm-sales-list admin-branch-tab-list">
                      {branchMovements.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((movement) => (
                        <article key={movement.id}>
                          <span><b>{productById(movement.productId)?.name || movement.productId}</b><small>{formatDate(movement.shiftDate)} · {movement.type}</small></span>
                          <span><strong>{formatNumber(movement.quantity)}</strong><small>{movement.note || 'Không có ghi chú'}</small></span>
                        </article>
                      ))}
                      {!branchMovements.length && <p className="empty-copy">Chưa có biến động kho trong kỳ này.</p>}
                    </div>}
                    {branchProfileTab === 'requests' && <div className="admin-crm-sales-list admin-branch-tab-list">
                      {branchRequests.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((request) => (
                        <article key={request.id}>
                          <span><b>{request.productName}</b><small>{formatDate(request.createdAt.slice(0, 10))} · {request.requestedByName}</small></span>
                          <span><strong>{formatNumber(request.quantity)} {request.unit}</strong><small>{supplyStatusLabel(request.status)}</small></span>
                        </article>
                      ))}
                      {!branchRequests.length && <p className="empty-copy">Chưa có đơn hàng trong kỳ này.</p>}
                    </div>}
                  </div>
                )
              })()}
              {crmEmployeeId && (() => {
                const employee = accountEmployees.find((item) => item.id === crmEmployeeId)
                if (!employee) return (
                  <div className="admin-crm-missing-employee section-card">
                    <strong>{loading ? 'Đang đồng bộ danh sách nhân sự…' : 'Hồ sơ nhân viên này không còn tồn tại.'}</strong>
                    <p>Quay lại danh sách để tiếp tục quản lý nhân sự.</p>
                    <button type="button" className="secondary-button" onClick={() => navigateAdminHash('/admin/employees')}>Quay lại danh sách nhân sự</button>
                  </div>
                )
                const employeeReceipts = salesReceipts.filter((receipt) =>
                  (receipt.sellerId === employee.id
                    || (!receipt.sellerId
                      && receipt.branchId === employee.branchId
                      && normalizeName(receipt.sellerName) === normalizeName(employee.name)))
                  && receipt.businessDate >= from && receipt.businessDate <= to,
                )
                const employeeRecords = records.filter((record) =>
                  record.userId === employee.id
                  && localDateKey(new Date(record.checkInTime)) >= from
                  && localDateKey(new Date(record.checkInTime)) <= to,
                )
                const revenue = employeeReceipts.reduce((sum, receipt) => sum + receipt.totalAmount, 0)
                const employeeDailyRevenue = buildEmployeeDailyRevenueRows(employeeReceipts)
                const maxEmployeeDailyRevenue = Math.max(1, ...employeeDailyRevenue.map((row) => row.revenue))
                const hours = employeeRecords.reduce((sum, record) => sum + Math.max(
                  0,
                  ((record.checkOutTime ? new Date(record.checkOutTime).getTime() : Date.now()) - new Date(record.checkInTime).getTime()) / 36e5,
                ), 0)
                return (
                  <div className="admin-crm-detail employee admin-crm-page">
                    <div className="admin-crm-detail-head">
                      <button className="admin-crm-back" type="button" onClick={() => navigateAdminHash('/admin/employees')}>← Quay lại danh sách nhân sự</button>
                      <div className="admin-crm-employee-identity">
                        <span className="admin-avatar large">
                          {employeeDraft(employee).avatarUrl ? <img src={employeeDraft(employee).avatarUrl} alt="" /> : employee.name.slice(0, 1).toUpperCase()}
                        </span>
                        <div><small>HỒ SƠ NHÂN VIÊN</small><h3>{employee.name}</h3><p>{branchName(employee.branchId)} · {employee.positionTitle || roleLabel(employee.role)}</p></div>
                      </div>
                    </div>
                    <div className="admin-crm-metrics">
                      <article><span>Tình trạng</span><strong>{employeeCrmDraft.employmentStatus === 'probation' ? 'Thử việc' : employeeCrmDraft.employmentStatus === 'ended' ? 'Nghỉ việc' : 'Đang làm việc'}</strong><small>{employee.active === false ? 'Tài khoản đã vô hiệu hóa' : 'Tài khoản đang hoạt động'}</small></article>
                      <article><span>Doanh thu kỳ này</span><strong>{formatMoney(revenue)}</strong><small>{employeeReceipts.length} hóa đơn</small></article>
                      <article><span>Giờ công kỳ này</span><strong>{formatNumber(hours)}</strong><small>{employeeRecords.length} lượt chấm công</small></article>
                      <article><span>Tài khoản</span><strong>@{emailToUsername(employee.email) || employee.id}</strong><small>{roleLabel(employee.role)}</small></article>
                    </div>
                    <nav className="admin-employee-tabs" aria-label="Chức năng hồ sơ nhân viên">
                      {([
                        ['overview', 'Tổng quan'],
                        ['attendance', 'Chấm công'],
                        ['sales', 'Doanh số'],
                        // Tab Tài khoản chỉ chứa thao tác ghi (đổi vai trò, đặt lại mật khẩu, xóa)
                        // nên vai trò chỉ xem không có tab này.
                        ...(readOnly ? [] : [['account', 'Tài khoản'] as const]),
                      ] as const).map(([id, label]) => (
                        <button type="button" key={id} className={employeeProfileTab === id ? 'active' : ''} onClick={() => navigateAdminHash(`/admin/employees/${encodeURIComponent(crmEmployeeId)}/${id}`)}>{label}</button>
                      ))}
                    </nav>
                    {employeeProfileTab === 'overview' && !readOnly && <div className="admin-crm-profile-grid single">
                      <section className="admin-crm-profile-panel">
                        <div className="admin-crm-subtitle"><strong>Thông tin công việc</strong><small>Cập nhật hồ sơ của nhân viên này.</small></div>
                        <div className="employee-profile-editor">
                          {isBranchlessRole(employee.role) ? (
                            <label>Phạm vi<input value="Tất cả chi nhánh" disabled /></label>
                          ) : (
                            <label>Chi nhánh
                              <select value={employeeDraft(employee).branchId} disabled={employee.active === false || savingEmployeeDetailsId === employee.id} onChange={(event) => updateEmployeeDraft(employee, { branchId: event.target.value })}>
                                {visibleBranches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
                              </select>
                            </label>
                          )}
                          <label>Nhóm ca
                            <select
                              value={employeeDraft(employee).employmentType}
                              disabled={employee.active === false || savingEmployeeDetailsId === employee.id}
                              onChange={(event) => {
                                const employmentType = event.target.value as EmploymentType
                                updateEmployeeDraft(employee, {
                                  employmentType,
                                  positionTitle: employmentType === 'leader' ? 'Ca trưởng' : employmentType === 'full_time' ? 'Full-time' : 'Part-time',
                                })
                              }}
                            >
                              <option value="leader">Ca trưởng / Ca phó</option>
                              <option value="full_time">Full-time</option>
                              <option value="part_time">Part-time</option>
                            </select>
                          </label>
                          <label>Vị trí<input value={employeeDraft(employee).positionTitle} disabled={employee.active === false || savingEmployeeDetailsId === employee.id} onChange={(event) => updateEmployeeDraft(employee, { positionTitle: event.target.value })} /></label>
                          <label>Ảnh đại diện<input type="file" accept="image/*" disabled={employee.active === false || savingEmployeeDetailsId === employee.id} onChange={(event) => void updateEmployeeAvatar(employee, event.target.files?.[0])} /></label>
                          <button type="button" className="primary-button" disabled={employee.active === false || savingEmployeeDetailsId === employee.id} onClick={() => void saveEmployeeDetails(employee)}>
                            {savingEmployeeDetailsId === employee.id ? 'Đang lưu…' : 'Lưu hồ sơ'}
                          </button>
                        </div>
                      </section>
                    </div>}
                    {/* Vai trò chỉ xem không có biểu mẫu sửa hồ sơ, nhưng vẫn cần thấy
                        thông tin công việc để đối chiếu bảng công/doanh số. */}
                    {employeeProfileTab === 'overview' && readOnly && <div className="admin-crm-profile-grid single">
                      <section className="admin-crm-profile-panel">
                        <div className="admin-crm-subtitle"><strong>Thông tin công việc</strong><small>Chế độ chỉ xem.</small></div>
                        <div className="admin-crm-metrics">
                          <article><span>Chi nhánh</span><strong>{isBranchlessRole(employee.role) ? 'Tất cả chi nhánh' : branchName(employee.branchId)}</strong><small>{roleLabel(employee.role, lang)}</small></article>
                          <article><span>Nhóm ca</span><strong>{employeePositionLabel(employee)}</strong><small>{employee.employmentType || '—'}</small></article>
                          <article><span>Ngày bắt đầu</span><strong>{employee.employmentStartDate ? formatDate(employee.employmentStartDate) : '—'}</strong><small>{employee.probationEndDate ? `Hết thử việc ${formatDate(employee.probationEndDate)}` : 'Chưa ghi nhận thử việc'}</small></article>
                          <article><span>Ghi chú quản lý</span><strong>{employee.employmentNote ? '' : '—'}</strong><small>{employee.employmentNote || 'Không có'}</small></article>
                        </div>
                      </section>
                    </div>}
                    {employeeProfileTab === 'account' && !readOnly && <div className="admin-crm-profile-grid single">
                      <section className="admin-crm-profile-panel">
                        <div className="admin-crm-subtitle"><strong>Tài khoản & bảo mật</strong><small>Các thao tác chỉ áp dụng cho nhân viên này.</small></div>
                        <div className="admin-crm-account-actions">
                          <label>Vai trò
                            <select aria-label={`Vai trò của ${employee.name}`} value={employee.role === 'admin' ? 'manager' : employee.role} disabled={savingRoleId === employee.id || employee.active === false} onChange={(event) => void changeRole(employee, event.target.value as Role)}>
                              {ROLE_OPTIONS.map((role) => <option key={role.value} value={role.value}>{roleLabel(role.value, lang)}</option>)}
                            </select>
                          </label>
                          <button type="button" disabled={accountBusyId === employee.id || employee.active === false} onClick={() => void resetPassword(employee)}>Đặt lại mật khẩu</button>
                          <button type="button" className={pendingDeleteId === employee.id ? 'danger-button compact confirming' : 'danger-button compact'} disabled={accountBusyId === employee.id || employee.id === user.id} onClick={() => void removeAccount(employee)}>
                            {employee.id === user.id ? 'Tài khoản đang dùng' : pendingDeleteId === employee.id ? 'Xác nhận xóa' : 'Xóa nhân viên'}
                          </button>
                        </div>
                      </section>
                    </div>}
                    {employeeProfileTab === 'overview' && !readOnly && <div className="admin-crm-history-grid single">
                      <section className="admin-crm-profile-panel">
                        <div className="admin-crm-subtitle"><strong>Tình trạng lao động</strong></div>
                        <div className="admin-crm-lifecycle-form">
                          <label>Trạng thái
                            <select value={employeeCrmDraft.employmentStatus} onChange={(event) => setEmployeeCrmDraft({ ...employeeCrmDraft, employmentStatus: event.target.value as EmploymentStatus })}>
                              <option value="probation">Thử việc</option>
                              <option value="working">Đang làm việc</option>
                              <option value="ended">Nghỉ việc</option>
                            </select>
                          </label>
                          <label>Ngày bắt đầu<input type="date" value={employeeCrmDraft.employmentStartDate} onChange={(event) => setEmployeeCrmDraft({ ...employeeCrmDraft, employmentStartDate: event.target.value })} /></label>
                          <label>Kết thúc thử việc<input type="date" value={employeeCrmDraft.probationEndDate} onChange={(event) => setEmployeeCrmDraft({ ...employeeCrmDraft, probationEndDate: event.target.value })} /></label>
                          {employeeCrmDraft.employmentStatus === 'ended' && <label>Ngày nghỉ việc<input type="date" required value={employeeCrmDraft.employmentEndDate} onChange={(event) => setEmployeeCrmDraft({ ...employeeCrmDraft, employmentEndDate: event.target.value })} /></label>}
                          <label className="wide">Ghi chú quản lý<textarea value={employeeCrmDraft.employmentNote} maxLength={2000} onChange={(event) => setEmployeeCrmDraft({ ...employeeCrmDraft, employmentNote: event.target.value })} /></label>
                          <button type="button" className="primary-button" disabled={employeeCrmSaving} onClick={() => void saveEmployeeCrm(employee)}>{employeeCrmSaving ? 'Đang lưu…' : 'Lưu trạng thái việc làm'}</button>
                        </div>
                      </section>
                    </div>}
                    {employeeProfileTab === 'attendance' && <section className="admin-crm-profile-panel admin-crm-sales-history">
                      <div className="admin-crm-subtitle"><strong>Chấm công</strong><small>{from} → {to}</small></div>
                      <div className="admin-crm-sales-summary">
                        <span><small>Tổng giờ</small><strong>{formatNumber(hours)}</strong></span>
                        <span><small>Lượt chấm công</small><strong>{employeeRecords.length}</strong></span>
                        <span><small>Thiếu giờ ra</small><strong>{employeeRecords.filter((record) => !record.checkOutTime).length}</strong></span>
                      </div>
                      <div className="admin-crm-sales-list">
                        {employeeRecords.slice().sort((a, b) => b.checkInTime.localeCompare(a.checkInTime)).map((record) => (
                          <article key={record.id}>
                            <span><b>{formatDate(localDateKey(new Date(record.checkInTime)))}</b><small>{branchName(record.branchId)}</small></span>
                            <span><strong>{new Date(record.checkInTime).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })} → {record.checkOutTime ? new Date(record.checkOutTime).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }) : 'Chưa chấm ra'}</strong></span>
                          </article>
                        ))}
                        {!employeeRecords.length && <p className="empty-copy">Chưa có dữ liệu chấm công trong kỳ này.</p>}
                      </div>
                    </section>}
                    {employeeProfileTab === 'sales' && <section className="admin-crm-profile-panel admin-crm-sales-history">
                      <div className="admin-crm-subtitle"><strong>Doanh thu theo ngày</strong><small>{from} → {to}</small></div>
                      <div className="admin-crm-sales-summary">
                        <span><small>Doanh thu</small><strong>{formatMoney(revenue)}</strong></span>
                        <span><small>Hóa đơn</small><strong>{employeeReceipts.length}</strong></span>
                        <span><small>Sản phẩm</small><strong>{formatNumber(employeeReceipts.reduce((sum, receipt) => sum + receipt.totalQuantity, 0))}</strong></span>
                      </div>
                      {employeeDailyRevenue.length > 0 && <div className="admin-employee-daily-revenue-chart" aria-label="Biểu đồ doanh thu nhân viên theo ngày">
                        {employeeDailyRevenue.slice().reverse().map((row) => (
                          <span key={row.date} title={`${formatDate(row.date)}: ${formatMoney(row.revenue)}`}>
                            <i style={{ height: `${Math.max(6, row.revenue / maxEmployeeDailyRevenue * 100)}%` }} />
                            <small>{row.date.slice(8, 10)}/{row.date.slice(5, 7)}</small>
                          </span>
                        ))}
                      </div>}
                      <div className="table-scroll">
                        <table className="admin-data-table admin-employee-daily-revenue-table">
                          <thead><tr><th>Ngày</th><th className="num">Hóa đơn</th><th className="num">Sản phẩm</th><th className="num">Doanh thu</th><th className="num">TB / hóa đơn</th></tr></thead>
                          <tbody>{employeeDailyRevenue.map((row) => (
                            <tr key={row.date}>
                              <td><strong>{formatDate(row.date)}</strong></td>
                              <td className="num">{row.receipts}</td>
                              <td className="num">{formatNumber(row.quantity)}</td>
                              <td className="num"><strong>{formatMoney(row.revenue)}</strong></td>
                              <td className="num">{formatMoney(row.revenue / Math.max(1, row.receipts))}</td>
                            </tr>
                          ))}</tbody>
                        </table>
                      </div>
                      {!employeeDailyRevenue.length && <p className="empty-copy">Không có doanh thu POS được ghi nhận cho nhân viên trong kỳ này.</p>}
                    </section>}
                  </div>
                )
              })()}
              {!crmEmployeeId && !crmBranchId && accountsDirectory === 'employees' && (
                <EmployeesPage
                  employees={accountEmployees}
                  branches={visibleBranches}
                  loading={loading}
                  createOpen={showCreateAccount}
                  onToggleCreate={readOnly ? undefined : () => setShowCreateAccount((current) => !current)}
                  onOpenEmployee={openEmployeeCrm}
                />
              )}
              {!crmEmployeeId && !crmBranchId && accountsDirectory === 'employees' && showCreateAccount && !readOnly && <div className="admin-crm-create-panel">
                <div className="admin-crm-subtitle"><strong>Tạo hồ sơ nhân viên</strong><small>Thông tin đăng nhập và công việc ban đầu.</small></div>
                <form className="employee-account-form" onSubmit={createAccount}>
                <label>Họ tên<input value={accountName} onChange={(event) => setAccountName(event.target.value)} placeholder="Nguyễn Văn A" required /></label>
                <label>Tên đăng nhập<input value={accountUsername} onChange={(event) => setAccountUsername(event.target.value)} placeholder="Ví dụ: ngoc, quanly" autoCapitalize="none" required /></label>
                <label>Mật khẩu<input type="password" minLength={6} value={accountPassword} onChange={(event) => setAccountPassword(event.target.value)} placeholder="Quản lý tự đặt" required /></label>
                {isBranchlessRole(accountRole) ? (
                  <label>Phạm vi
                    <input value="Tất cả chi nhánh" disabled />
                  </label>
                ) : (
                  <label>Chi nhánh
                    <select value={accountBranchId} onChange={(event) => setAccountBranchId(event.target.value)}>
                      {visibleBranches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
                    </select>
                  </label>
                )}
                <label>Vai trò
                  <select value={accountRole} onChange={(event) => {
                    const role = event.target.value as Exclude<Role, 'admin'>
                    setAccountRole(role)
                    if (role === 'kitchen') {
                      setAccountEmploymentType('part_time')
                      setAccountPositionTitle('Bếp')
                    }
                    if (role === 'manager') {
                      setAccountEmploymentType('leader')
                      setAccountPositionTitle('Quản lý')
                    }
                    if (role === 'shift_leader') {
                      setAccountEmploymentType('leader')
                      setAccountPositionTitle('Ca trưởng')
                    }
                  }}>
                    {ROLE_OPTIONS.map((role) => <option key={role.value} value={role.value}>{roleLabel(role.value, lang)}</option>)}
                  </select>
                </label>
                <label>Nhóm ca
                  <select value={accountEmploymentType} onChange={(event) => {
                    const type = event.target.value as EmploymentType
                    setAccountEmploymentType(type)
                    setAccountPositionTitle(type === 'leader' ? 'Ca trưởng' : type === 'full_time' ? 'Full-time' : 'Part-time')
                    if (accountRole !== 'manager' && accountRole !== 'kitchen' && accountRole !== 'cashier') setAccountRole(type === 'leader' ? 'shift_leader' : 'staff')
                  }}>
                    <option value="leader">Ca trưởng / Ca phó</option>
                    <option value="full_time">Full-time</option>
                    <option value="part_time">Part-time</option>
                  </select>
                </label>
                <label>Vị trí<input value={accountPositionTitle} onChange={(event) => setAccountPositionTitle(event.target.value)} placeholder="Ca phó, Full-time…" required /></label>
                <button className="primary-button" disabled={accountBusyId === 'create'}>
                  {accountBusyId === 'create' ? 'Đang tạo…' : '+ Tạo tài khoản'}
                </button>
                </form>
                <p className="password-safety-note">Admin hệ thống tự đặt mật khẩu cho nhân viên. Mật khẩu được Supabase mã hóa và không thể xem lại sau khi đóng khung thông tin.</p>
              </div>}
              {!crmEmployeeId && !crmBranchId && accountsDirectory === 'employees' && temporaryCredential && (
                <div className="temporary-credential" role="status">
                  <span><strong>Thông tin đăng nhập</strong><small>Hãy sao chép và gửi trực tiếp cho nhân viên. Khung này sẽ mất khi tải lại trang.</small></span>
                  <code>{temporaryCredential.username}</code>
                  <code>{temporaryCredential.password}</code>
                  <button type="button" onClick={() => {
                    void navigator.clipboard.writeText(`Tên đăng nhập: ${temporaryCredential.username}\nMật khẩu: ${temporaryCredential.password}`)
                    setFeedback('Đã sao chép thông tin đăng nhập.')
                  }}>Sao chép</button>
                  <button type="button" onClick={() => setTemporaryCredential(null)}>Đóng</button>
                </div>
              )}
              {!crmEmployeeId && !crmBranchId && accountsDirectory === 'employees' && Boolean(unassignedEmployeeReceipts.length) && (
                <section className="admin-unassigned-sales">
                  <div className="admin-crm-subtitle">
                    <strong>Doanh số chưa phân bổ</strong>
                    <span>{unassignedEmployeeReceipts.length} hóa đơn · {formatMoney(unassignedEmployeeReceipts.reduce((sum, receipt) => sum + receipt.totalAmount, 0))}</span>
                  </div>
                  <div className="admin-crm-sales-list">
                    {unassignedEmployeeReceipts.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((receipt) => (
                      <article key={receipt.id}>
                        <span><b>{receipt.code}</b><small>{formatDate(receipt.businessDate)} · {branchName(receipt.branchId)}</small></span>
                        <span><strong>{formatMoney(receipt.totalAmount)}</strong><small>{receipt.sellerName || 'Chưa có nhân viên bán'}</small></span>
                      </article>
                    ))}
                  </div>
                </section>
              )}
            </section>
          )}

        </div>
      </div>
    </div>
  )
}

const BUSINESS_CHART_COLORS = ['#c7e9f1', '#ffd6de', '#d8efd3', '#ffe8b8', '#d9d0ff', '#cde7ff']

interface BusinessProductRow {
  productId: string
  productName: string
  quantity: number
  revenue: number
}

function BusinessProductCharts({ rows }: { rows: BusinessProductRow[] }) {
  const topRows = rows.slice(0, 6)
  const maxRevenue = Math.max(1, ...topRows.map((row) => row.revenue))
  const totalRevenue = topRows.reduce((sum, row) => sum + row.revenue, 0)
  if (!topRows.length) {
    return (
      <section className="section-card business-product-charts empty">
        <div className="section-title">
          <div><span className="eyebrow dark">MẶT HÀNG</span><h2>Món bán chạy nhất</h2></div>
        </div>
        <p className="empty-copy">Chưa có hóa đơn POS trong bộ lọc này.</p>
      </section>
    )
  }
  let cursor = 0
  const pieStops = topRows.map((row, index) => {
    const start = cursor
    const size = row.revenue / Math.max(totalRevenue, 1) * 100
    cursor += size
    return `${BUSINESS_CHART_COLORS[index % BUSINESS_CHART_COLORS.length]} ${start}% ${cursor}%`
  }).join(', ')
  return (
    <section className="section-card business-product-charts">
      <div className="business-product-bars">
        <div className="section-title">
          <div><span className="eyebrow dark">MẶT HÀNG</span><h2>Món bán chạy nhất</h2></div>
          <span className="date-chip">{formatMoney(totalRevenue)}</span>
        </div>
        {topRows.map((row, index) => (
          <article key={row.productId}>
            <span className="business-product-swatch" style={{ background: BUSINESS_CHART_COLORS[index % BUSINESS_CHART_COLORS.length] }} />
            <div>
              <div className="business-product-line">
                <strong>{row.productName}</strong>
                <b>{formatMoney(row.revenue)}</b>
              </div>
              <i><em style={{ width: `${Math.max(8, row.revenue / maxRevenue * 100)}%`, background: BUSINESS_CHART_COLORS[index % BUSINESS_CHART_COLORS.length] }} /></i>
              <small>{formatNumber(row.quantity)} đơn vị bán</small>
            </div>
          </article>
        ))}
      </div>
      <div className="business-product-pie">
        <div className="section-title">
          <div><span className="eyebrow dark">TỶ TRỌNG</span><h2>Doanh thu theo món</h2></div>
        </div>
        <div className="business-product-donut" style={{ background: `conic-gradient(${pieStops})` }}>
          <span>{topRows.length}</span>
          <small>món</small>
        </div>
        <div className="business-product-legend">
          {topRows.map((row, index) => (
            <span key={row.productId}>
              <i style={{ background: BUSINESS_CHART_COLORS[index % BUSINESS_CHART_COLORS.length] }} />
              {row.productName}
            </span>
          ))}
        </div>
      </div>
    </section>
  )
}

function EmployeeRevenueChart({ rows }: { rows: ReturnType<typeof buildCompetitionRows> }) {
  const topRows = rows.filter((row) => row.revenue > 0).slice(0, 6)
  const maxRevenue = Math.max(1, ...topRows.map((row) => row.revenue))
  const totalRevenue = topRows.reduce((sum, row) => sum + row.revenue, 0)
  if (!topRows.length) return null
  return (
    <div className="employee-revenue-chart">
      <header>
        <div><span className="eyebrow dark">BIỂU ĐỒ NHÂN VIÊN</span><h3>Cơ cấu doanh thu</h3></div>
        <strong>{formatMoney(totalRevenue)}</strong>
      </header>
      <div className="employee-revenue-bars">
        {topRows.map((row, index) => (
          <article key={`${row.branchId}-${row.employeeKey}`}>
            <span className={`leaderboard-rank rank-${index + 1}`}>{index + 1}</span>
            <div>
              <div className="employee-revenue-line">
                <strong>{row.employeeName}</strong>
                <b>{formatMoney(row.revenue)}</b>
              </div>
              <i><em style={{ width: `${Math.max(6, row.revenue / maxRevenue * 100)}%` }} /></i>
            </div>
          </article>
        ))}
      </div>
    </div>
  )
}

/**
 * BẢNG XẾP HẠNG THI ĐUA — bảng DUY NHẤT của màn.
 *
 * Trước bản này màn Thi đua có 5 danh sách của cùng nhóm người: poster, bảng
 * phân loại, danh sách năng suất, thẻ thưởng KPI, bảng KPI × ngày. Mỗi cái xếp
 * theo một tiêu chí và lấy một KHOẢNG NGÀY khác nhau (poster + phân loại theo kỳ
 * thi đua, thẻ thưởng + KPI ngày theo bộ lọc đầu trang) nên hai bảng cạnh nhau
 * hiện hai con số khác nhau cho cùng một người.
 *
 * Nay: một dòng = một người, muốn đổi cách xếp thì bấm cột (`sort`), muốn xem
 * sâu thì mở dòng ra — thẻ "Nguồn doanh thu" (hóa đơn/phiếu túi) và thẻ "KPI
 * theo ngày" (chỉ của người đó). Không đẻ thêm danh sách nào ở ngoài.
 */
function CompetitionClassificationTable({
  title,
  rows,
  totalRows,
  showAll,
  onToggleShowAll,
  sort,
  onSortChange,
  showReward,
  mode,
  from,
  to,
  allocations,
  sessions,
  receipts,
  capacityByKey,
  capacityMetric,
  teamAverage,
  dailyKpiByKey,
}: {
  title: string
  rows: CompetitionClassificationRow[]
  totalRows: number
  showAll: boolean
  onToggleShowAll: () => void
  sort: CompetitionSortKey
  onSortChange: (sort: CompetitionSortKey) => void
  showReward: boolean
  mode: 'daily' | 'monthly' | 'leaders'
  from: string
  to: string
  allocations: BagAllocation[]
  sessions: BagShiftSession[]
  receipts: SalesReceipt[]
  capacityByKey: Map<string, SalesCapacityRow>
  capacityMetric: SalesCapacityMetric
  teamAverage: number
  dailyKpiByKey: Map<string, DailyEmployeeKpiRow[]>
}) {
  const [expandedRowKey, setExpandedRowKey] = useState<string | null>(null)
  const [detailTab, setDetailTab] = useState<'sources' | 'days'>('sources')
  useEffect(() => setExpandedRowKey(null), [title])
  const sourcesByRow = useMemo(
    () => buildCompetitionSourcesByRow(rows, mode, from, to, allocations, sessions, receipts),
    [allocations, from, mode, receipts, rows, sessions, to],
  )

  return <section className={`competition-classification-table${showReward ? ' with-reward' : ''}`} aria-label={title}>
    <div className="competition-classification-title">
      <div>
        <h3>{title} · Xếp hạng doanh thu</h3>
      </div>
      <small>{totalRows} người có doanh thu</small>
    </div>
    <div className="competition-sort-bar" role="group" aria-label="Sắp xếp bảng thi đua">
      <span>Xếp theo</span>
      {COMPETITION_SORT_OPTIONS
        .filter((option) => option.id !== 'reward' || showReward)
        .map((option) => (
          <button
            key={option.id}
            type="button"
            className={sort === option.id ? 'is-active' : ''}
            aria-pressed={sort === option.id}
            title={option.hint}
            onClick={() => onSortChange(option.id)}
          >{option.label}</button>
        ))}
    </div>
    <div className="competition-classification-head" role="row">
      <span>Hạng</span>
      <span>Nhân sự</span>
      <span>Chi nhánh</span>
      <span>Kết quả</span>
      <span>Doanh thu</span>
      <span>{salesCapacityMetricLabel(capacityMetric)}</span>
      <span>Xếp loại KPI</span>
      {showReward && <span>Thưởng KPI</span>}
    </div>
    {rows.map((row, index) => {
      const rowKey = competitionRowKey(row)
      const expanded = expandedRowKey === rowKey
      const sources = sourcesByRow.get(rowKey) || []
      const dayRows = dailyKpiByKey.get(rowKey) || []
      const sourceRevenue = sources.reduce((sum, source) => sum + source.revenue, 0)
      const detailId = `competition-detail-${rowKey.replace(/[^a-zA-Z0-9_-]/g, '-')}`
      const capacity = capacityByKey.get(rowKey)
      const aboveTeam = !!capacity?.measured && teamAverage > 0 && capacity.value >= teamAverage
      return <Fragment key={rowKey}>
        <div className={`competition-classification-row${expanded ? ' is-expanded' : ''}`} role="row">
          <span data-label="Hạng" role="cell"><b className={`leaderboard-rank rank-${index + 1}`}>{index + 1}</b></span>
          <span data-label="Nhân sự" role="cell" className="competition-classification-person">
            <i className="employee-top-avatar">{row.avatarUrl ? <img src={row.avatarUrl} alt="" /> : row.employeeName.slice(0, 1).toUpperCase()}</i>
            <strong>{row.employeeName}</strong>
          </span>
          <span data-label="Chi nhánh" role="cell">{branchName(row.branchId)}</span>
          <span data-label="Kết quả" role="cell" className="competition-classification-result">
            <span>
              {row.detail || `${formatNumber(row.soldQuantity)} sản phẩm`}
              <small>
                {mode === 'leaders' ? `${formatNumber(row.shiftCount)} ca vận hành` : `${formatNumber(row.shiftCount)} ca có check-in`}
                {row.dayCount > 0 ? ` · ${formatNumber(row.dayCount)} ngày` : ''}
              </small>
            </span>
            <button
              type="button"
              className="competition-drilldown-trigger"
              aria-expanded={expanded}
              aria-controls={detailId}
              onClick={() => {
                setDetailTab('sources')
                setExpandedRowKey(expanded ? null : rowKey)
              }}
            >{expanded ? 'Thu gọn chi tiết' : `Xem chi tiết (${sources.length} nguồn · ${dayRows.length} ngày)`}</button>
          </span>
          <span data-label="Doanh thu" role="cell"><b>{formatMoney(row.revenue)}</b></span>
          <span
            data-label={salesCapacityMetricLabel(capacityMetric)}
            role="cell"
            className={`competition-classification-capacity${!capacity?.measured ? '' : aboveTeam ? ' up' : ' down'}`}
          >
            <b>{capacity?.measured ? formatCapacityValue(capacityMetric, capacity.value) : '—'}</b>
            <small>{!capacity?.measured
              ? 'Chưa có ngày công để tính trung bình'
              : teamAverage > 0
                ? `${capacity.teamRatio >= 100 ? '+' : '−'}${formatNumber(Math.abs(capacity.teamRatio - 100))}% so với TB đội`
                : 'Chưa đủ dữ liệu so sánh'}</small>
          </span>
          <span data-label="Xếp loại KPI" role="cell"><b>{row.rank}</b><small>{formatNumber(row.progress)}%</small></span>
          {showReward && <span data-label="Thưởng KPI" role="cell" className={`competition-classification-reward${row.commission > 0 ? ' earned' : ''}`}>
            <b>{formatMoney(row.commission)}</b>
            <small>{row.commission > 0 ? 'Đã đạt thưởng ngày/tuần' : 'Chưa đạt ngưỡng ngày/tuần'}</small>
          </span>}
        </div>
        {expanded && <div id={detailId} className="competition-drilldown-panel" role="region" aria-label={`Chi tiết của ${row.employeeName}`}>
          <header>
            <div>
              <span className="eyebrow dark">CHI TIẾT MỘT NGƯỜI</span>
              <h4>{row.employeeName} · {formatDate(from)}{to !== from ? ` - ${formatDate(to)}` : ''}</h4>
            </div>
            <div className="competition-drilldown-totals">
              <span><small>Số nguồn</small><b>{formatNumber(sources.length)}</b></span>
              <span><small>Đối chiếu</small><b>{formatMoney(sourceRevenue)}</b></span>
            </div>
          </header>
          <div className="competition-drilldown-tabs" role="tablist" aria-label={`Chi tiết ${row.employeeName}`}>
            <button
              type="button"
              role="tab"
              aria-selected={detailTab === 'sources'}
              className={detailTab === 'sources' ? 'is-active' : ''}
              onClick={() => setDetailTab('sources')}
            >Nguồn doanh thu ({sources.length})</button>
            <button
              type="button"
              role="tab"
              aria-selected={detailTab === 'days'}
              className={detailTab === 'days' ? 'is-active' : ''}
              onClick={() => setDetailTab('days')}
            >KPI theo ngày ({dayRows.length})</button>
          </div>
          {detailTab === 'sources' ? <>
            {Math.abs(sourceRevenue - row.revenue) > 1 && <p className="competition-drilldown-warning">
              Tổng nguồn đang lệch {formatMoney(Math.abs(sourceRevenue - row.revenue))} so với bảng xếp hạng. Vui lòng kiểm tra dữ liệu chưa gắn nhân sự hoặc ca.
            </p>}
            <div className="competition-drilldown-list">
              {sources.map((source) => <article key={`${source.kind}-${source.id}`}>
                <span className={`competition-source-kind ${source.kind}`}>{source.kind === 'receipt' ? 'Hóa đơn' : 'Giao túi'}</span>
                <div>
                  <strong>{source.heading}</strong>
                  <p>{source.detail}</p>
                  <small>{formatDate(source.businessDate)} · {formatDateTime(source.createdAt)} · {source.meta}</small>
                </div>
                <span><small>Số lượng</small><b>{formatNumber(source.soldQuantity)}</b></span>
                <span><small>Doanh thu</small><b>{formatMoney(source.revenue)}</b></span>
              </article>)}
              {!sources.length && <p className="empty-copy">Chưa tìm thấy nguồn doanh thu khớp nhân sự và kỳ đang xem.</p>}
            </div>
          </> : <div className="competition-day-table" role="table" aria-label={`KPI theo ngày của ${row.employeeName}`}>
            <div className="competition-day-row head" role="row">
              <span>Ngày</span><span>Giờ công</span><span>SL bán</span><span>Doanh thu</span><span>KPI ngày</span><span>% đạt</span><span>Hạng</span><span>Thưởng ngày</span>
            </div>
            {dayRows.map((day) => (
              <div className="competition-day-row" role="row" key={`${day.date}-${day.branchId}-${day.employeeKey}`}>
                <span data-label="Ngày" role="cell"><b>{formatDate(day.date)}</b></span>
                <span data-label="Giờ công" role="cell">{formatDecimalHoursAsDuration(day.totalHours)}</span>
                <span data-label="SL bán" role="cell">{formatNumber(day.soldQuantity)}</span>
                <span data-label="Doanh thu" role="cell"><b>{formatMoney(day.revenue)}</b></span>
                <span data-label="KPI ngày" role="cell">{formatMoney(day.targetRevenue)}</span>
                <span data-label="% đạt" role="cell" className={day.progress >= 100 ? 'ok' : day.progress >= 80 ? 'amber' : 'warn'}>{formatNumber(day.progress)}%</span>
                <span data-label="Hạng" role="cell">{day.rank}</span>
                <span data-label="Thưởng ngày" role="cell">{formatMoney(day.dailyBonus)}</span>
              </div>
            ))}
            {!dayRows.length && <p className="empty-copy">{mode === 'leaders'
              ? 'Bảng ca trưởng xếp doanh thu ca nên không có KPI cá nhân theo ngày.'
              : 'Chưa có ngày nào phát sinh KPI trong kỳ đang xem.'}</p>}
          </div>}
        </div>}
      </Fragment>
    })}
    {!rows.length && <p className="empty-copy">Chưa có doanh thu phù hợp với phân loại và ngày đã chọn.</p>}
    {totalRows > COMPETITION_TOP_ROWS && <div className="competition-classification-more">
      <button type="button" onClick={onToggleShowAll}>
        {showAll ? `Chỉ hiện ${COMPETITION_TOP_ROWS} người dẫn đầu` : `Xem tất cả ${totalRows} người`}
      </button>
    </div>}
  </section>
}

interface CompetitionDrilldownDisplaySource {
  id: string
  kind: 'allocation' | 'receipt'
  businessDate: string
  createdAt: string
  soldQuantity: number
  revenue: number
  heading: string
  sourceCode: string
  shiftLabel: string
  detail: string
  meta: string
}

type CompetitionClassificationRow = ReturnType<typeof buildCompetitionRows>[number] & { detail?: string }

function buildCompetitionSourcesByRow(
  rows: CompetitionClassificationRow[],
  mode: 'daily' | 'monthly' | 'leaders',
  from: string,
  to: string,
  allocations: BagAllocation[],
  sessions: BagShiftSession[],
  receipts: SalesReceipt[],
) {
  const result = new Map<string, CompetitionDrilldownDisplaySource[]>()
  if (mode === 'leaders') {
    const leaderSources = buildShiftLeaderReceiptSources(sessions, receipts, {
      branchIds: Array.from(new Set(rows.map((row) => row.branchId))),
      from,
      to,
    })
    rows.forEach((row) => {
      const sources = leaderSources
        .filter((source) => source.branchId === row.branchId && (
          source.leaderKey === row.employeeKey
          || normalizeName(source.leaderName) === normalizeName(row.employeeName)
        ))
        .map((source) => ({
          id: `${source.sessionId}-${source.receipt.id}`,
          kind: 'receipt' as const,
          businessDate: source.businessDate,
          createdAt: source.receipt.createdAt,
          soldQuantity: source.receipt.totalQuantity,
          revenue: source.receipt.totalAmount,
          heading: source.receipt.code || 'Hóa đơn POS',
          sourceCode: source.receipt.code || '',
          shiftLabel: `Ca ${source.sessionSequence}`,
          detail: `Ca ${source.sessionSequence} · ${receiptLineSummary(source.receipt.lines)}`,
          meta: source.receipt.sellerName,
        }))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))
      result.set(competitionRowKey(row), sources)
    })
    return result
  }

  rows.forEach((row) => {
    const sources = buildEmployeeCompetitionRevenueSources(allocations, receipts, {
      branchId: row.branchId,
      employeeId: row.employeeKey,
      employeeName: row.employeeName,
      from,
      to,
    }).map((source): CompetitionDrilldownDisplaySource => source.kind === 'allocation'
      ? {
          id: source.id,
          kind: 'allocation',
          businessDate: source.businessDate,
          createdAt: source.createdAt,
          soldQuantity: source.soldQuantity,
          revenue: source.revenue,
          heading: 'Phiếu giao túi đã chốt',
          sourceCode: '',
          shiftLabel: '',
          detail: productById(source.allocation.productId)?.name || source.allocation.productId,
          meta: 'Phiếu giao túi đã chốt',
        }
      : {
          id: source.id,
          kind: 'receipt',
          businessDate: source.businessDate,
          createdAt: source.createdAt,
          soldQuantity: source.soldQuantity,
          revenue: source.revenue,
          heading: source.receipt.code || 'Hóa đơn POS',
          sourceCode: source.receipt.code || '',
          shiftLabel: '',
          detail: receiptLineSummary(source.directLines),
          meta: 'Bán trực tiếp',
        })
    result.set(competitionRowKey(row), sources)
  })
  return result
}

function competitionRowKey(row: { branchId: string; employeeKey: string }) {
  return `${row.branchId}-${row.employeeKey}`
}

function receiptLineSummary(lines: SalesReceipt['lines']) {
  return lines.length
    ? lines.map((line) => `${formatNumber(line.quantity)} × ${line.productName}`).join(', ')
    : 'Hóa đơn không có dòng sản phẩm'
}

function formatCapacityValue(metric: SalesCapacityMetric, value: number) {
  return metric === 'quantityPerDay' ? `${formatNumber(value)} sản phẩm` : formatMoney(value)
}

/**
 * Bảng thi đua xếp theo TỔNG doanh thu nên người làm nhiều ngày luôn đứng trên.
 * Khối này trả lời câu hỏi khác: "một NGÀY (hoặc một THÁNG) của người này bán
 * được bao nhiêu" — biểu đồ so sánh với mốc trung bình của cả đội.
 *
 * 07/08/2026: khối này TỪNG có thêm 4 thẻ tổng và một danh sách đầy đủ, tức là
 * liệt kê lại đúng nhóm người của bảng xếp hạng ngay bên trên. Số tổng đã dời
 * lên dải `competition-overview`, số từng người đã thành CỘT trong bảng xếp
 * hạng — ở đây chỉ giữ phần mà bảng không làm được: nhìn phát thấy ai trên/dưới
 * mốc trung bình. ĐỪNG thêm lại danh sách vào đây.
 */
function EmployeeSalesCapacityBoard({
  summary,
  metric,
  onMetricChange,
  hasMonths,
  scopeLabel,
}: {
  summary: SalesCapacitySummary
  metric: SalesCapacityMetric
  onMetricChange: (metric: SalesCapacityMetric) => void
  hasMonths: boolean
  scopeLabel: string
}) {
  const chartRows = summary.measuredRows.slice(0, 8)
  const chartMax = Math.max(summary.bestValue, summary.teamAverage, 1)
  const averageMarker = Math.min(100, summary.teamAverage / chartMax * 100)
  const aboveAverage = summary.measuredRows.filter((row) => row.value >= summary.teamAverage).length

  return <section className="capacity-board" aria-label="Khả năng bán trung bình của nhân viên">
    <div className="capacity-board-head">
      <div>
        <span className="eyebrow dark">NĂNG SUẤT BÁN HÀNG</span>
        <h3>Khả năng bán trung bình của một nhân viên</h3>
        <p>{scopeLabel}</p>
      </div>
      <div className="capacity-metric-switch" role="group" aria-label="Chỉ số năng suất">
        {SALES_CAPACITY_METRICS.map((item) => {
          const disabled = item.perMonth && !hasMonths
          return <button
            key={item.id}
            type="button"
            className={metric === item.id ? 'is-active' : ''}
            aria-pressed={metric === item.id}
            disabled={disabled}
            title={disabled ? 'Kỳ đang xem chỉ có một ngày nên chưa tính được trung bình theo tháng.' : item.hint}
            onClick={() => onMetricChange(item.id)}
          >{item.label}</button>
        })}
      </div>
    </div>

    {!summary.measuredRows.length
      ? <p className="empty-copy">Chưa có nhân sự nào vừa có doanh thu vừa có ca ghi nhận trong bộ lọc này.</p>
      : <>
        <div className="capacity-chart">
          <header>
            <div>
              <span className="eyebrow dark">BIỂU ĐỒ SO SÁNH</span>
              <h4>{salesCapacityMetricLabel(metric)} theo nhân viên</h4>
            </div>
            <span className="capacity-average-legend">Trung bình đội <b>{formatCapacityValue(metric, summary.teamAverage)}</b></span>
          </header>
          <div className="capacity-chart-rows">
            {chartRows.map((row, index) => (
              <article
                key={`${row.branchId}-${row.employeeKey}`}
                className={row.value >= summary.teamAverage ? 'above' : 'below'}
              >
                <span className={`leaderboard-rank rank-${index + 1}`}>{index + 1}</span>
                <div>
                  <div className="capacity-chart-line">
                    <strong title={row.employeeName}>{row.employeeName}</strong>
                    <b>{formatCapacityValue(metric, row.value)}</b>
                  </div>
                  <i className="capacity-track">
                    <em style={{ width: `${Math.max(4, Math.min(100, row.value / chartMax * 100))}%` }} />
                    <span className="capacity-average-mark" style={{ left: `${averageMarker}%` }} aria-hidden="true" />
                  </i>
                </div>
              </article>
            ))}
          </div>
          <p className="capacity-chart-note">
            Vạch đứt = trung bình đội · {aboveAverage}/{summary.measuredRows.length} người trên mức
          </p>
        </div>
      </>}
  </section>
}

function EmployeeCompetitionPoster({
  posterRef,
  rows,
  from,
  to,
  branchLabel,
}: {
  posterRef: { current: HTMLDivElement | null }
  rows: ReturnType<typeof buildCompetitionRows>
  from: string
  to: string
  branchLabel: string
}) {
  const rankedRows = rows.filter((row) => row.revenue > 0).slice(0, 10)
  const topRows = rankedRows.slice(0, 3)
  const totalRevenue = rows.reduce((sum, row) => sum + row.revenue, 0)
  const totalSold = rows.reduce((sum, row) => sum + row.soldQuantity, 0)
  const achievedCount = rows.filter((row) => row.progress >= 100).length
  return (
    <div className="competition-poster-wrap" aria-hidden={!rankedRows.length}>
      <div className="competition-poster" ref={posterRef}>
        <header>
          <div>
            <span>TOP 10 NHÂN VIÊN THEO THÁNG</span>
            <h3>Thi đua nhân viên bán hàng</h3>
            <p>{branchLabel} · {formatDate(from)} - {formatDate(to)}</p>
          </div>
          <strong>{achievedCount}/{Math.max(1, rows.length)} đạt KPI</strong>
        </header>
        <section className="competition-poster-kpis">
          <div><span>Doanh thu</span><b>{formatMoney(totalRevenue)}</b></div>
          <div><span>Sản phẩm bán</span><b>{formatNumber(totalSold)}</b></div>
          <div><span>Nhân viên</span><b>{formatNumber(rows.length)}</b></div>
        </section>
        <section className="competition-podium">
          {topRows.map((row, index) => (
            <article className={`place-${index + 1}`} key={`${row.branchId}-${row.employeeKey}`}>
              <small>Hạng {index + 1}</small>
              <strong>{row.employeeName}</strong>
              <span>{branchName(row.branchId)}</span>
              <b>{formatMoney(row.revenue)}</b>
              <em>{formatNumber(row.progress)}% KPI · {row.rank}</em>
            </article>
          ))}
        </section>
        <section className="competition-poster-list">
          {rankedRows.map((row, index) => (
            <article key={`${row.branchId}-${row.employeeKey}`}>
              <span>{index + 1}</span>
              <span className="competition-list-avatar">
                {row.avatarUrl ? <img src={row.avatarUrl} alt="" /> : row.employeeName.slice(0, 1).toUpperCase()}
              </span>
              <div>
                <strong>{row.employeeName}</strong>
                <small>{branchName(row.branchId)} · {formatNumber(row.soldQuantity)} sản phẩm</small>
              </div>
              <b>{formatMoney(row.revenue)}</b>
            </article>
          ))}
          {!rankedRows.length && <p>Chưa có dữ liệu thi đua trong bộ lọc này.</p>}
        </section>
      </div>
    </div>
  )
}

function buildBusinessProductRows(
  receipts: SalesReceipt[],
  allocations: BagAllocation[],
  filters: { branchIds: string[]; from: string; to: string },
): BusinessProductRow[] {
  const branchSet = new Set(filters.branchIds)
  const rows = new Map<string, BusinessProductRow>()
  const scopedReceipts = receipts.filter((receipt) =>
    branchSet.has(receipt.branchId)
    && receipt.businessDate >= filters.from
    && receipt.businessDate <= filters.to,
  )
  const receiptLines = scopedReceipts.flatMap((receipt) => receipt.lines)
  if (receiptLines.length) {
    for (const line of receiptLines) {
      const productId = line.productId || line.productName
      const product = PRODUCTS.find((item) => item.id === line.productId)
      const current = rows.get(productId) || {
        productId,
        productName: product?.name || line.productName || productId,
        quantity: 0,
        revenue: 0,
      }
      current.quantity += Number(line.quantity) || 0
      current.revenue += Number(line.total) || 0
      rows.set(productId, current)
    }
  } else {
    for (const allocation of allocations) {
      const date = allocationReportDate(allocation)
      if (!branchSet.has(allocation.branchId) || date < filters.from || date > filters.to) continue
      const quantity = soldBagQuantity(allocation)
      if (quantity <= 0) continue
      const product = PRODUCTS.find((item) => item.id === allocation.productId)
      const values = productSaleValues(allocation.productId, quantity)
      const current = rows.get(allocation.productId) || {
        productId: allocation.productId,
        productName: product?.name || allocation.productId,
        quantity: 0,
        revenue: 0,
      }
      current.quantity += quantity
      current.revenue += values.revenue
      rows.set(allocation.productId, current)
    }
  }
  return Array.from(rows.values())
    .filter((row) => row.quantity > 0 || row.revenue > 0)
    .sort((a, b) => b.revenue - a.revenue || b.quantity - a.quantity || a.productName.localeCompare(b.productName, 'vi'))
}

function buildPayrollEmployeeList(
  profileCandidates: EmployeeProfile[],
  attendanceRows: ReturnType<typeof buildAttendanceReport>,
) {
  const output = new Map<string, EmployeeProfile>()
  const attendanceIds = new Set(attendanceRows.map((row) => row.userId))
  const attendanceNameKeys = new Set(attendanceRows.map((row) => `${row.branchId}|${normalizeName(row.employeeName)}`))
  const add = (employee: EmployeeProfile) => {
    if (!employee.branchId || !PAYROLL_ROLES.includes(employee.role)) return
    output.set(employee.id, employee)
  }

  profileCandidates.forEach((employee) => {
    const hasAttendance = attendanceIds.has(employee.id)
      || attendanceNameKeys.has(`${employee.branchId}|${normalizeName(employee.name)}`)
    if (employee.active !== false || hasAttendance) add(employee)
  })

  attendanceRows.forEach((row) => {
    if (output.has(row.userId)) return
    const profile = profileCandidates.find((employee) =>
      employee.id === row.userId
      || (employee.branchId === row.branchId && normalizeName(employee.name) === normalizeName(row.employeeName)),
    )
    if (profile) {
      add(profile)
      return
    }
    output.set(row.userId, {
      id: row.userId,
      name: row.employeeName,
      role: 'staff',
      branchId: row.branchId,
      active: true,
      employmentType: 'part_time',
      positionTitle: 'Nhân viên',
    })
  })

  return Array.from(output.values())
}

function buildDailyEmployeeKpiRows(
  allocations: BagAllocation[],
  receipts: SalesReceipt[],
  employees: EmployeeProfile[],
  detailRows: ReturnType<typeof buildAttendanceDetailRows>,
  from: string,
  to: string,
) {
  const rows = new Map<string, {
    date: string
    branchId: string
    employeeKey: string
    employeeName: string
    role: Role
    employmentType?: EmploymentType
    positionTitle: string
    totalHours: number
    soldQuantity: number
    revenue: number
    targetRevenue: number
    progress: number
    rank: string
    dailyBonus: number
  }>()

  const addRevenue = (
    date: string,
    branchId: string,
    employee: EmployeeProfile,
    fallbackName: string,
    soldQuantity: number,
    revenue: number,
  ) => {
    const employeeKey = employee.id
    const key = `${date}|${branchId}|${employeeKey}`
    const current = rows.get(key) || {
      date,
      branchId,
      employeeKey,
      employeeName: employee.name || fallbackName,
      role: employee.role,
      employmentType: employee.employmentType,
      positionTitle: employee.positionTitle || roleLabel(employee.role),
      totalHours: 0,
      soldQuantity: 0,
      revenue: 0,
      targetRevenue: employeePeriodRevenueTarget(
        branchId,
        employee.role,
        employee.employmentType,
        employee.positionTitle,
        date,
        date,
      ) || DEFAULT_REVENUE_TARGET,
      progress: 0,
      rank: 'D',
      dailyBonus: 0,
    }
    current.soldQuantity += soldQuantity
    current.revenue += revenue
    rows.set(key, current)
  }

  allocations.forEach((allocation) => {
    const date = allocationReportDate(allocation)
    if (date < from || date > to) return
    const employee = allocation.employeeId
      ? employees.find((item) => item.id === allocation.employeeId)
      : employees.find((item) => item.branchId === allocation.branchId && normalizeName(item.name) === normalizeName(allocation.employeeName))
    if (!employee?.branchId || employee.branchId !== allocation.branchId || !PAYROLL_ROLES.includes(employee.role)) return
    const soldQuantity = soldBagQuantity(allocation)
    const values = productSaleValues(allocation.productId, soldQuantity)
    addRevenue(date, allocation.branchId, employee, allocation.employeeName, soldQuantity, values.revenue)
  })

  receipts.forEach((receipt) => {
    const directLines = receipt.lines.filter((line) => !line.allocationId)
    if (!directLines.length) return
    const employee = receipt.sellerId
      ? employees.find((item) => item.id === receipt.sellerId)
      : employees.find((item) => item.branchId === receipt.branchId && normalizeName(item.name) === normalizeName(receipt.sellerName))
    if (!employee?.branchId || employee.branchId !== receipt.branchId || !PAYROLL_ROLES.includes(employee.role)) return
    addRevenue(
      receipt.businessDate,
      receipt.branchId,
      employee,
      receipt.sellerName,
      directLines.reduce((sum, line) => sum + line.quantity, 0),
      directLines.reduce((sum, line) => sum + line.total, 0),
    )
  })

  rows.forEach((row) => {
    const hours = detailRows
      .filter((item) =>
        item.branchId === row.branchId
        && item.workDate === row.date
        && (item.userId === row.employeeKey || normalizeName(item.employeeName) === normalizeName(row.employeeName)),
      )
      .reduce((sum, item) => sum + item.totalHours, 0)
    row.totalHours = Number(hours.toFixed(2))
    row.progress = row.targetRevenue > 0 ? Math.min(200, row.revenue / row.targetRevenue * 100) : 0
    row.rank = kpiRank(row.progress)
    row.dailyBonus = dailyKpiBonus(row.progress, row.role, row.employmentType, row.positionTitle)
  })

  return Array.from(rows.values())
    .sort((a, b) => b.date.localeCompare(a.date) || branchName(a.branchId).localeCompare(branchName(b.branchId), 'vi') || b.revenue - a.revenue)
}

function buildCompetitionRows(
  commissionRows: ReturnType<typeof buildCommissionRows>,
  attendanceRecords: AttendanceRecord[],
  employees: EmployeeProfile[],
  registrations: ShiftRegistration[] = [],
) {
  const rows = new Map<string, {
    employeeKey: string
    employeeName: string
    branchId: string
    avatarUrl?: string
    soldQuantity: number
    revenue: number
    commission: number
    totalHours: number
    shiftCount: number
    dayCount: number
    monthCount: number
    role: Role
    targetRevenue: number
    progress: number
    rank: string
    score: number
  }>()
  const employeeFor = (branchId: string, employeeKey: string, employeeName: string) => employees.find((employee) =>
    employee.branchId === branchId
    && (employee.id === employeeKey || normalizeName(employee.name) === normalizeName(employeeName))
  )
  for (const attendance of buildCompetitionAttendanceMetrics(attendanceRecords, registrations)) {
    const employee = employeeFor(attendance.branchId, attendance.employeeKey, attendance.employeeName)
    const key = `${attendance.branchId}-${attendance.employeeKey}`
    const existing = rows.get(key)
    rows.set(key, {
      employeeKey: attendance.employeeKey,
      employeeName: employee?.name || attendance.employeeName,
      branchId: attendance.branchId,
      avatarUrl: employee?.avatarUrl,
      soldQuantity: existing?.soldQuantity || 0,
      revenue: existing?.revenue || 0,
      commission: existing?.commission || 0,
      totalHours: attendance.totalHours,
      shiftCount: attendance.shiftCount,
      dayCount: attendance.dayCount,
      monthCount: attendance.monthCount,
      role: employee?.role || 'staff',
      targetRevenue: existing?.targetRevenue || 0,
      progress: existing?.progress || 0,
      rank: existing?.rank || 'D',
      score: Math.round(attendance.totalHours),
    })
  }
  for (const row of commissionRows) {
    const employee = employeeFor(row.branchId, row.employeeKey, row.employeeName)
    const employeeKey = employee?.id || row.employeeKey
    const key = `${row.branchId}-${employeeKey}`
    const existing = rows.get(key)
    rows.set(key, {
      employeeKey,
      employeeName: employee?.name || row.employeeName,
      branchId: row.branchId,
      avatarUrl: employee?.avatarUrl || existing?.avatarUrl,
      soldQuantity: row.soldQuantity,
      revenue: row.revenue,
      commission: row.commission,
      totalHours: existing?.totalHours || 0,
      shiftCount: existing?.shiftCount || 0,
      dayCount: existing?.dayCount || 0,
      monthCount: existing?.monthCount || 0,
      role: employee?.role || 'staff',
      targetRevenue: row.targetQuantity,
      progress: row.progress,
      rank: row.rank,
      score: Math.round(row.revenue / 10000 + row.progress + (existing?.totalHours || 0) / 2),
    })
  }
  return Array.from(rows.values())
    .filter((row) => row.revenue > 0)
    .sort((a, b) =>
      b.revenue - a.revenue
      || b.progress - a.progress
      || b.soldQuantity - a.soldQuantity
      || b.totalHours - a.totalHours
      || a.employeeName.localeCompare(b.employeeName, 'vi'),
    )
}

/**
 * Số lượng kho ở màn quản trị PHẢI đọc y hệt màn Kho của ca trưởng: cùng 3 chữ
 * số lẻ như `stock_movements.quantity` numeric(14,3), cùng cách viết số tiếng
 * Việt. Bản cũ tự làm tròn riêng (4 số lẻ cho kg, 2 cho đơn vị khác, dấu nhóm
 * hàng nghìn đổi thành khoảng trắng) nên cùng một tồn mà hai màn ra hai con số.
 */
function formatInventoryQuantity(value: number, unit: string) {
  return formatStockAmount(value, unit)
}

/** Điều chỉnh tồn phải thấy rõ dấu: "+2,5 kg" khác hẳn "−2,5 kg". */
function formatInventoryDelta(value: number, unit: string) {
  return `${value > 0 ? '+' : ''}${formatStockAmount(value, unit)}`
}

function formatInventoryDecimal(value: number, maximumFractionDigits: number) {
  return new Intl.NumberFormat('vi-VN', {
    minimumFractionDigits: 0,
    maximumFractionDigits,
  }).format(value).replace(/\./g, ' ')
}

function summarizeInventoryQuantities(items: Array<{ quantity: number; unit: string }>, emptyLabel = 'Không phát sinh') {
  const totals = new Map<string, number>()
  items.forEach(({ quantity, unit }) => {
    if (!Number.isFinite(quantity)) return
    const normalizedUnit = unit.trim() || 'đơn vị'
    totals.set(normalizedUnit, (totals.get(normalizedUnit) || 0) + quantity)
  })
  const summaries = Array.from(totals.entries())
    .filter(([, quantity]) => Math.abs(quantity) > 0.00005)
    .sort(([unitA], [unitB]) => unitA === 'kg' ? -1 : unitB === 'kg' ? 1 : unitA.localeCompare(unitB, 'vi'))
    .map(([unit, quantity]) => formatInventoryQuantity(quantity, unit))
  return summaries.length ? summaries.join(' · ') : emptyLabel
}

function formatShiftTime(startedAt: string, endedAt?: string) {
  const time = (value: string) => new Date(value).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })
  return `${time(startedAt)} – ${endedAt ? time(endedAt) : 'đang làm'}`
}

function shiftLabel(sequence: number) {
  if (sequence === 1) return 'Ca sáng'
  if (sequence === 2) return 'Ca tối'
  return `Ca ${sequence}`
}

function buildShiftInventoryReconciliation(
  sessions: BagShiftSession[],
  receipts: SalesReceipt[],
  movements: StockMovement[],
  fromDate: string,
  toDate: string,
  validBranchIds: Set<string>,
  selectedBranchId: string,
) {
  const packingBySource = getPackingOptionsByOutput()
  const sourceBySaleProduct = new Map<string, { sourceProductId: string; sourceQuantity: number }>()
  Object.entries(packingBySource).forEach(([sourceProductId, options]) => {
    options.forEach((option) => sourceBySaleProduct.set(option.productId, {
      sourceProductId,
      sourceQuantity: option.sourceQuantity,
    }))
  })
  const additionTypes = new Set<StockMovement['type']>(['opening', 'inbound', 'processing_in', 'packing_in', 'adjustment'])
  // Điều chỉnh tồn phải tính theo TỪNG chi nhánh (tồn cộng dồn của cùng một SKU
  // ở hai chi nhánh là hai sổ khác nhau) và chỉ tính MỘT lần cho cả bảng.
  const movementsByBranch = new Map<string, StockMovement[]>()
  for (const movement of movements) {
    const bucket = movementsByBranch.get(movement.branchId)
    if (bucket) bucket.push(movement)
    else movementsByBranch.set(movement.branchId, [movement])
  }
  const adjustmentsByBranch = new Map<string, StockAdjustment[]>()
  for (const [branchId, rows] of movementsByBranch) adjustmentsByBranch.set(branchId, stockAdjustmentDeltas(rows))

  return sessions
    .filter((session) =>
      session.businessDate >= fromDate
      && session.businessDate <= toDate
      && validBranchIds.has(session.branchId)
      && (!selectedBranchId || session.branchId === selectedBranchId),
    )
    .slice()
    .sort((a, b) => b.businessDate.localeCompare(a.businessDate) || a.branchId.localeCompare(b.branchId) || a.sequence - b.sequence)
    .map((session) => {
      const startMs = Date.parse(session.startedAt)
      const endMs = session.endedAt ? Date.parse(session.endedAt) : Number.POSITIVE_INFINITY
      const sessionReceipts = receipts.filter((receipt) => {
        if (receipt.branchId !== session.branchId || receipt.businessDate !== session.businessDate) return false
        if (receipt.createdAt < session.startedAt) return false
        if (session.endedAt && receipt.createdAt > session.endedAt) return false
        return true
      })
      const sessionMovements = movements.filter((movement) => {
        if (movement.branchId !== session.branchId || movement.shiftDate !== session.businessDate) return false
        const movementMs = Date.parse(movement.createdAt)
        return Number.isFinite(movementMs) && movementMs >= startMs && movementMs <= endMs
      })
      // Phiếu sửa tồn ghi GIỮA ca. Loại phiếu kiểm đếm cuối ca (`documentId` =
      // id phiên) vì số của nó chính là `closing` — cộng vào đây là tự triệt
      // tiêu đúng phần lệch mà bảng này sinh ra để soi.
      const sessionAdjustments = (adjustmentsByBranch.get(session.branchId) || []).filter((item) => {
        if (item.movement.shiftDate !== session.businessDate) return false
        if (item.movement.documentId === session.id) return false
        const stampMs = Date.parse(item.movement.createdAt)
        return Number.isFinite(stampMs) && stampMs >= startMs && stampMs <= endMs
      })
      const openingBalances = session.openingBalances || {}
      const closingBalances = session.closingBalances || {}
      const trackedProductIds = new Set([...Object.keys(openingBalances), ...Object.keys(closingBalances)])
      const posBySource = new Map<string, number>()
      const posNativeQuantities: Array<{ quantity: number; unit: string }> = []
      const untrackedPosProducts = new Set<string>()

      sessionReceipts.forEach((receipt) => {
        receipt.lines.forEach((line) => {
          const saleProduct = productById(line.productId)
          posNativeQuantities.push({ quantity: line.quantity, unit: saleProduct?.unit || 'sản phẩm' })
          const conversion = sourceBySaleProduct.get(line.productId)
          const sourceProductId = conversion?.sourceProductId || (trackedProductIds.has(line.productId) ? line.productId : '')
          if (!sourceProductId) {
            untrackedPosProducts.add(line.productId)
            return
          }
          const sourceQuantity = conversion?.sourceQuantity || 1
          posBySource.set(sourceProductId, (posBySource.get(sourceProductId) || 0) + line.quantity * sourceQuantity)
        })
      })

      const productIds = new Set([...trackedProductIds, ...posBySource.keys()])
      const isOfficial = session.status === 'closed' && Boolean(session.closingBalances)
      const lines = Array.from(productIds)
        .map((productId) => {
          const product = productById(productId)
          const trackedByHandover = trackedProductIds.has(productId)
          const opening = Number(openingBalances[productId] || 0)
          const additions = sessionMovements
            .filter((movement) => movement.productId === productId && additionTypes.has(movement.type))
            .reduce((sum, movement) => sum + movement.quantity, 0)
          const waste = sessionMovements
            .filter((movement) => movement.productId === productId && movement.type === 'waste' && !movement.sourceProductId)
            .reduce((sum, movement) => sum + movement.quantity, 0)
          const closing = isOfficial && trackedByHandover ? Number(closingBalances[productId] || 0) : null
          const posEquivalent = posBySource.get(productId) || 0
          // Sửa tồn giữa ca là một khoản tăng/giảm THẬT của sổ, không phải hàng
          // bán ra. Thiếu nó thì "Out chính thức" gánh luôn phần chênh và bảng
          // báo lệch POS oan đúng bằng số đã sửa.
          const adjust = sessionAdjustments
            .filter((item) => item.movement.productId === productId)
            .reduce((sum, item) => sum + item.delta, 0)
          const officialOut = closing === null ? null : opening + additions + adjust - closing - waste
          const difference = officialOut === null ? null : officialOut - posEquivalent
          return {
            productId,
            productName: product?.name || productId,
            sku: product?.sku || '-',
            unit: product?.unit || 'đơn vị',
            trackedByHandover,
            opening,
            additions,
            adjust,
            posEquivalent,
            waste,
            closing,
            officialOut,
            difference,
          }
        })
        .sort((a, b) => a.productName.localeCompare(b.productName, 'vi'))

      const comparableLines = lines.filter((line) => line.difference !== null)
      const differenceRows = comparableLines
        .filter((line) => Math.abs(line.difference || 0) > 0.00005)
        .map((line) => ({ quantity: line.difference || 0, unit: line.unit }))
      const untrackedCount = lines.filter((line) => !line.trackedByHandover && line.posEquivalent > 0).length + untrackedPosProducts.size
      let differenceLabel = session.status === 'open'
        ? 'Chưa đối chiếu'
        : comparableLines.length
          ? summarizeInventoryQuantities(differenceRows, 'Khớp POS')
          : 'Chưa đủ dữ liệu'
      if (session.status === 'closed' && untrackedCount > 0) {
        differenceLabel += ` · ${untrackedCount} SKU chưa bàn giao`
      }
      const hasDifference = differenceRows.length > 0 || untrackedCount > 0

      return {
        sessionId: session.id,
        branchId: session.branchId,
        businessDate: session.businessDate,
        sequence: session.sequence,
        status: session.status,
        startedAt: session.startedAt,
        endedAt: session.endedAt,
        receiptCount: sessionReceipts.length,
        posRevenue: sessionReceipts.reduce((sum, receipt) => sum + receipt.totalAmount, 0),
        posNativeQuantities,
        posNativeSummary: summarizeInventoryQuantities(posNativeQuantities, 'Chưa có POS'),
        posEquivalentSummary: `Quy đổi: ${summarizeInventoryQuantities(
          lines.filter((line) => line.posEquivalent > 0).map((line) => ({ quantity: line.posEquivalent, unit: line.unit })),
          'chưa có SKU quy đổi',
        )}`,
        openingSummary: summarizeInventoryQuantities(
          lines.filter((line) => line.trackedByHandover).map((line) => ({ quantity: line.opening, unit: line.unit })),
          '0',
        ),
        additionSummary: summarizeInventoryQuantities(
          lines.filter((line) => line.trackedByHandover).map((line) => ({ quantity: line.additions, unit: line.unit })),
        ),
        wasteSummary: summarizeInventoryQuantities(
          lines.filter((line) => line.trackedByHandover).map((line) => ({ quantity: line.waste, unit: line.unit })),
        ),
        closingSummary: isOfficial
          ? summarizeInventoryQuantities(
              lines.filter((line) => line.closing !== null).map((line) => ({ quantity: line.closing || 0, unit: line.unit })),
              '0',
            )
          : 'Chưa bàn giao',
        officialOutSummary: isOfficial
          ? summarizeInventoryQuantities(
              lines.filter((line) => line.officialOut !== null).map((line) => ({ quantity: line.officialOut || 0, unit: line.unit })),
              '0',
            )
          : 'Chưa chốt ca',
        differenceLabel,
        differenceTone: session.status === 'open' ? 'pending' : hasDifference ? 'danger' : 'good',
        lines,
      }
    })
}

function buildDailyOutboundRows(movements: StockMovement[]) {
  const grouped = new Map<string, {
    branchId: string
    productId: string
    productName: string
    sku: string
    unit: string
    quantity: number
    documentIds: Set<string>
    createdByIds: Set<string>
    notes: Set<string>
    lastCreatedAt: string
  }>()
  movements.forEach((movement) => {
    const product = productById(movement.productId)
    const key = `${movement.branchId}|${movement.productId}`
    const current = grouped.get(key) || {
      branchId: movement.branchId,
      productId: movement.productId,
      productName: product?.name || movement.productId,
      sku: product?.sku || '-',
      unit: product?.unit || 'đơn vị',
      quantity: 0,
      documentIds: new Set<string>(),
      createdByIds: new Set<string>(),
      notes: new Set<string>(),
      lastCreatedAt: movement.createdAt,
    }
    current.quantity += movement.quantity
    current.documentIds.add(movement.documentId || movement.id)
    if (movement.createdBy) current.createdByIds.add(movement.createdBy)
    if (movement.note) current.notes.add(movement.note)
    if (movement.createdAt > current.lastCreatedAt) current.lastCreatedAt = movement.createdAt
    grouped.set(key, current)
  })
  return Array.from(grouped.values())
    .map((row) => ({
      ...row,
      documentIds: Array.from(row.documentIds),
      createdByIds: Array.from(row.createdByIds),
      notes: Array.from(row.notes),
    }))
    .sort((a, b) => a.branchId.localeCompare(b.branchId) || a.productName.localeCompare(b.productName, 'vi'))
}

function inventoryCategoryLabel(category: Product['category']) {
  if (category === 'raw') return 'Nguyên liệu'
  if (category === 'finished') return 'Thành phẩm'
  return 'Bao bì'
}

/**
 * Sổ kho theo kỳ. Phải có cột ĐIỀU CHỈNH: phiếu kiểm kê / sửa tồn ghi movement
 * `count` — nó đặt lại tồn nên có mặt trong `opening`/`closing`, nhưng không
 * thuộc cột Nhập lẫn cột Xuất. Thiếu cột này thì sau mỗi lần ca trưởng sửa tồn,
 * "Tồn đầu + Nhập − Xuất − Hao" không ra "Tồn cuối" và bảng trông như sai số.
 */
function buildInventoryRows(movements: StockMovement[], branchIds: string[], from: string, to: string) {
  return branchIds.flatMap((branchId) => {
    const branchMovements = movements.filter((item) => item.branchId === branchId)
    const openingStock = new Map(calculateStock(branchMovements.filter((item) => item.shiftDate < from)).map((line) => [line.product.id, line.expected]))
    const closingStock = new Map(calculateStock(branchMovements.filter((item) => item.shiftDate <= to)).map((line) => [line.product.id, line.expected]))
    const period = branchMovements.filter((item) => item.shiftDate >= from && item.shiftDate <= to)
    // Delta tính trên TOÀN BỘ lịch sử chi nhánh (hiệu so với tồn cộng dồn ngay
    // trước phiếu), lọc về kỳ đang xem sau.
    const adjustments = stockAdjustmentDeltas(branchMovements)
    return getProducts().map((product) => {
      const rows = period.filter((item) => item.productId === product.id)
      const inbound = rows.filter((item) => ['opening', 'inbound', 'processing_in', 'packing_in'].includes(item.type))
        .reduce((sum, item) => sum + item.quantity, 0)
        + rows.filter((item) => item.type === 'adjustment' && item.quantity > 0).reduce((sum, item) => sum + item.quantity, 0)
      const outbound = rows.filter((item) => ['processing_out', 'packing_out', 'sale_out'].includes(item.type))
        .reduce((sum, item) => sum + item.quantity, 0)
      const waste = rows.filter((item) => item.type === 'waste').reduce((sum, item) => sum + item.quantity, 0)
      const adjust = sumStockAdjustments(adjustments, { productId: product.id, from, to })
      return {
        branchId,
        product,
        opening: openingStock.get(product.id) || 0,
        inbound,
        outbound,
        waste,
        adjust,
        closing: closingStock.get(product.id) || 0,
      }
    }).filter((row) => row.opening || row.inbound || row.outbound || row.waste || row.adjust || row.closing)
  })
}

function buildWasteRows(movements: StockMovement[]) {
  const rows = new Map<string, {
    branchId: string
    productId: string
    productName: string
    unit: string
    quantity: number
    count: number
  }>()
  for (const movement of movements.filter((item) => item.type === 'waste')) {
    const product = productById(movement.productId)
    if (!product) continue
    const key = `${movement.branchId}|${movement.productId}`
    const current = rows.get(key) || {
      branchId: movement.branchId,
      productId: movement.productId,
      productName: product.name,
      unit: product.unit,
      quantity: 0,
      count: 0,
    }
    current.quantity += movement.quantity
    current.count += 1
    rows.set(key, current)
  }
  return Array.from(rows.values()).sort((a, b) => b.quantity - a.quantity)
}

function buildAdminDailyTrendRows(rows: Array<{ reportDate: string; revenue: number }>, range: { from: string; to: string }) {
  const byDate = new Map<string, number>()
  rows.forEach((row) => byDate.set(row.reportDate, (byDate.get(row.reportDate) || 0) + row.revenue))
  const output: Array<{ date: string; revenue: number }> = []
  const cursor = new Date(`${range.from}T00:00:00`)
  const end = new Date(`${range.to}T00:00:00`)
  while (cursor <= end && output.length < 31) {
    const date = localDateKey(cursor)
    output.push({ date, revenue: byDate.get(date) || 0 })
    cursor.setDate(cursor.getDate() + 1)
  }
  return output
}

function buildAdminAreaChart(rows: Array<{ date: string; revenue: number }>, maxRevenue: number) {
  const width = 360
  const padX = 12
  const baseY = 142
  const plotHeight = 124
  const points = rows.map((row, index) => {
    const x = rows.length <= 1 ? width / 2 : padX + index * ((width - padX * 2) / (rows.length - 1))
    const y = baseY - (row.revenue / Math.max(maxRevenue, 1)) * plotHeight
    return `${Math.round(x * 10) / 10},${Math.round(y * 10) / 10}`
  })
  const linePoints = points.join(' ')
  const fillPoints = points.length ? `${padX},${baseY} ${linePoints} ${width - padX},${baseY}` : `${padX},${baseY} ${width - padX},${baseY}`
  return { linePoints, fillPoints }
}

// Gom doanh thu POS theo (ngày × nhân viên × chi nhánh) trong khoảng đã lọc.
function buildDailyEmployeeRevenueRows(receipts: SalesReceipt[], from: string, to: string, branchId: string) {
  const map = new Map<string, { date: string; branchId: string; employeeName: string; receipts: number; quantity: number; revenue: number }>()
  receipts
    .filter((receipt) => receipt.businessDate >= from && receipt.businessDate <= to && (!branchId || receipt.branchId === branchId))
    .forEach((receipt) => {
      const sellerKey = receipt.sellerId || receipt.sellerKey || normalizeName(receipt.sellerName)
      const key = `${receipt.businessDate}|${receipt.branchId}|${sellerKey}`
      const row = map.get(key) || { date: receipt.businessDate, branchId: receipt.branchId, employeeName: receipt.sellerName, receipts: 0, quantity: 0, revenue: 0 }
      row.receipts += 1
      row.quantity += receipt.totalQuantity
      row.revenue += receipt.totalAmount
      map.set(key, row)
    })
  return Array.from(map.values()).sort((a, b) => b.date.localeCompare(a.date) || b.revenue - a.revenue)
}

function buildEmployeeDailyRevenueRows(receipts: SalesReceipt[]) {
  const rows = new Map<string, { date: string; receipts: number; quantity: number; revenue: number }>()
  receipts.forEach((receipt) => {
    const current = rows.get(receipt.businessDate) || {
      date: receipt.businessDate,
      receipts: 0,
      quantity: 0,
      revenue: 0,
    }
    current.receipts += 1
    current.quantity += receipt.totalQuantity
    current.revenue += receipt.totalAmount
    rows.set(receipt.businessDate, current)
  })
  return Array.from(rows.values()).sort((a, b) => b.date.localeCompare(a.date))
}

function buildCommissionRows(
  allocations: BagAllocation[],
  employees: EmployeeProfile[],
  attendanceRows: ReturnType<typeof buildAttendanceReport>,
  receipts: SalesReceipt[],
  ruleDrafts: Record<string, { targetRevenue: string; commissionRate: string }>,
  employeeKpiDrafts: Record<string, string>,
  from: string,
  to: string,
  includedDates?: string[],
) {
  const allocationsByDate = new Map<string, BagAllocation[]>()
  allocations.forEach((allocation) => {
    const date = allocationReportDate(allocation)
    allocationsByDate.set(date, [...(allocationsByDate.get(date) || []), allocation])
  })
  const rows = new Map<string, ReturnType<typeof summarizeEmployeeBagSales>[number] & {
    achievedDays: number
    maxDailySold: number
    dailyBonus: number
    weeklyBonus: number
    monthlyBonus: number
    rank: string
  }>()
  const dailyPerformance = new Map<string, {
    date: string
    branchId: string
    employee: EmployeeProfile
    soldQuantity: number
    revenue: number
  }>()
  const addDailyPerformance = (
    date: string,
    branchId: string,
    employee: EmployeeProfile,
    soldQuantity: number,
    revenue: number,
  ) => {
    const key = `${date}|${branchId}|${employee.id}`
    const current = dailyPerformance.get(key) || { date, branchId, employee, soldQuantity: 0, revenue: 0 }
    current.soldQuantity += soldQuantity
    current.revenue += revenue
    dailyPerformance.set(key, current)
  }

  allocationsByDate.forEach((dayAllocations) => {
    summarizeEmployeeBagSales(dayAllocations).forEach((dayRow) => {
      const employee = dayRow.employeeId
        ? employees.find((item) => item.id === dayRow.employeeId)
        : employees.find((item) => item.branchId === dayRow.branchId && normalizeName(item.name) === normalizeName(dayRow.employeeName))
      if (!employee?.branchId || employee.branchId !== dayRow.branchId || !PAYROLL_ROLES.includes(employee.role)) return
      const date = dayAllocations[0] ? allocationReportDate(dayAllocations[0]) : from
      const key = `${dayRow.branchId}|${employee.id}`
      const current = rows.get(key) || {
        ...dayRow,
        employeeKey: employee.id,
        employeeId: employee.id,
        employeeName: employee.name || dayRow.employeeName,
        soldQuantity: 0,
        revenue: 0,
        commissionBase: 0,
        commission: 0,
        achieved: false,
        achievedDays: 0,
        maxDailySold: 0,
        dailyBonus: 0,
        weeklyBonus: 0,
        monthlyBonus: 0,
        rank: 'D',
      }
      current.soldQuantity += dayRow.soldQuantity
      current.revenue += dayRow.revenue
      current.commissionBase += dayRow.commissionBase
      rows.set(key, current)
      addDailyPerformance(date, dayRow.branchId, employee, dayRow.soldQuantity, dayRow.revenue)
    })
  })

  receipts.forEach((receipt) => {
    const directLines = receipt.lines.filter((line) => !line.allocationId)
    if (!directLines.length) return
    const employee = receipt.sellerId
      ? employees.find((item) => item.id === receipt.sellerId)
      : employees.find((item) => item.branchId === receipt.branchId && normalizeName(item.name) === normalizeName(receipt.sellerName))
    if (!employee?.branchId || employee.branchId !== receipt.branchId || !PAYROLL_ROLES.includes(employee.role)) return
    const date = receipt.businessDate
    const soldQuantity = directLines.reduce((sum, line) => sum + line.quantity, 0)
    const revenue = directLines.reduce((sum, line) => sum + line.total, 0)
    const key = `${receipt.branchId}|${employee.id}`
    const current = rows.get(key) || {
      employeeKey: employee.id,
      employeeId: employee.id,
      employeeName: employee.name || receipt.sellerName,
      branchId: receipt.branchId,
      soldQuantity: 0,
      revenue: 0,
      commissionBase: 0,
      commission: 0,
      achieved: false,
      achievedDays: 0,
      maxDailySold: 0,
      dailyBonus: 0,
      weeklyBonus: 0,
      monthlyBonus: 0,
      rank: 'D',
    }
    current.soldQuantity += soldQuantity
    current.revenue += revenue
    current.commissionBase += revenue
    rows.set(key, current)
    addDailyPerformance(date, receipt.branchId, employee, soldQuantity, revenue)
  })

  const weekWins = new Map<string, { rowKey: string; achievedDays: number; perfectDays: number }>()
  dailyPerformance.forEach((day) => {
    const rowKey = `${day.branchId}|${day.employee.id}`
    const row = rows.get(rowKey)
    if (!row) return
    const dayTarget = employeePeriodRevenueTarget(
      day.branchId,
      day.employee.role,
      day.employee.employmentType,
      day.employee.positionTitle,
      day.date,
      day.date,
    )
    const dayProgress = day.revenue / Math.max(1, dayTarget) * 100
    row.dailyBonus += dailyKpiBonus(dayProgress, day.employee.role, day.employee.employmentType, day.employee.positionTitle)
    row.achieved = row.achieved || dayProgress >= 100
    row.achievedDays += dayProgress >= 100 ? 1 : 0
    row.maxDailySold = Math.max(row.maxDailySold, day.soldQuantity)
    const weekKey = `${rowKey}|${weekStart(day.date)}`
    const week = weekWins.get(weekKey) || { rowKey, achievedDays: 0, perfectDays: 0 }
    if (dayProgress >= 100) week.achievedDays += 1
    if (dayProgress >= 100) week.perfectDays += 1
    weekWins.set(weekKey, week)
  })
  weekWins.forEach((week) => {
    const row = rows.get(week.rowKey)
    if (!row) return
    row.weeklyBonus += weeklyKpiBonus(week.achievedDays, week.perfectDays)
  })
  type CommissionOutputRow = ReturnType<typeof summarizeEmployeeBagSales>[number] & {
    achievedDays: number
    maxDailySold: number
    dailyBonus: number
    weeklyBonus: number
    monthlyBonus: number
    rank: string
    employeeKey: string
    employeeName: string
    totalHours: number
    targetQuantity: number
    progress: number
  }
  return Array.from(rows.values()).map((row): CommissionOutputRow | null => {
    const employee = row.employeeId
      ? employees.find((item) => item.id === row.employeeId)
      : employees.find((item) => normalizeName(item.name) === normalizeName(row.employeeName))
    if (!employee?.branchId || employee.branchId !== row.branchId || !PAYROLL_ROLES.includes(employee.role)) return null
    const employeeKey = employee?.id || row.employeeKey
    const attendance = attendanceRows.find((item) =>
      item.branchId === row.branchId
      && (item.userId === employeeKey || normalizeName(item.employeeName) === normalizeName(row.employeeName)),
    )
    const formulaTarget = includedDates
      ? includedDates.reduce((sum, date) => sum + employeePeriodRevenueTarget(
          row.branchId,
          employee?.role,
          employee?.employmentType,
          employee?.positionTitle,
          date,
          date,
        ), 0)
      : employeePeriodRevenueTarget(
          row.branchId,
          employee?.role,
          employee?.employmentType,
          employee?.positionTitle,
          from,
          to,
        )
    const targetRevenue = formulaTarget || DEFAULT_REVENUE_TARGET
    const achieved = row.achievedDays > 0
    const progress = Math.min(200, row.revenue / targetRevenue * 100)
    const monthlyBonus = 0
    const kpiBonus = row.dailyBonus + row.weeklyBonus
    return {
      ...row,
      employeeKey,
      employeeName: employee?.name || row.employeeName,
      totalHours: attendance?.totalHours || 0,
      targetQuantity: targetRevenue,
      achieved,
      dailyBonus: row.dailyBonus,
      weeklyBonus: row.weeklyBonus,
      monthlyBonus,
      commission: kpiBonus,
      progress,
      rank: kpiRank(progress),
    }
  }).filter((row): row is CommissionOutputRow => Boolean(row))
    .sort((a, b) => b.revenue - a.revenue || b.commission - a.commission)
}

function normalizeName(value: string) {
  return value.trim().toLocaleLowerCase('vi').normalize('NFD').replace(/\p{Diacritic}/gu, '')
}

function allocationReportDate(allocation: BagAllocation) {
  return allocation.businessDate || allocation.settledAt?.slice(0, 10) || allocation.issuedAt.slice(0, 10)
}

function weekStart(value: string) {
  const date = new Date(`${value}T00:00:00`)
  const day = date.getDay() || 7
  date.setDate(date.getDate() - day + 1)
  return date.toISOString().slice(0, 10)
}

function styleSheet(sheet: import('exceljs').Worksheet, title: string) {
  sheet.spliceRows(1, 0, [title])
  sheet.mergeCells(1, 1, 1, sheet.columnCount)
  sheet.getCell('A1').font = { bold: true, size: 15, color: { argb: 'FFFFFFFF' } }
  sheet.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF102238' } }
  sheet.getCell('A1').alignment = { horizontal: 'center' }
  sheet.getRow(2).font = { bold: true, color: { argb: 'FFFFFFFF' } }
  sheet.getRow(2).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF789D12' } }
  sheet.views = [{ state: 'frozen', ySplit: 2 }]
  sheet.autoFilter = { from: { row: 2, column: 1 }, to: { row: 2, column: sheet.columnCount } }
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

const adminAttendanceEvidenceUrlCache = new Map<string, Promise<string>>()

async function selfieEvidenceUrl(value?: string) {
  if (!value) return ''
  const cached = adminAttendanceEvidenceUrlCache.get(value)
  if (cached) return cached
  const pending = resolveSelfieEvidenceUrl(value).catch(() => {
    adminAttendanceEvidenceUrlCache.delete(value)
    return ''
  })
  adminAttendanceEvidenceUrlCache.set(value, pending)
  return pending
}

async function resolveSelfieEvidenceUrl(value: string) {
  const path = normalizeAttendanceSelfiePath(value)
  if (/^https?:\/\//i.test(value) && !path) return value
  if (value.startsWith('/')) return `${window.location.origin}${value}`
  if (!supabase) return value
  const storagePath = path || value.replace(/^attendance-selfies\//, '')
  if (isDemoAttendanceSelfiePath(storagePath)) return ''
  try {
    const signed = await supabase.storage.from('attendance-selfies').createSignedUrl(storagePath, 60 * 60 * 24 * 30)
    if (signed.data?.signedUrl) return signed.data.signedUrl
    if (signed.error) return ''
    return supabase.storage.from('attendance-selfies').getPublicUrl(storagePath).data.publicUrl || value
  } catch {
    return ''
  }
}

function isDemoAttendanceSelfiePath(value: string) {
  return /^(demo|sample|mock)[/_-]/i.test(value)
    || /\/(demo|sample|mock)[/_-]/i.test(value)
    || /^demo\//i.test(value)
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

async function saveWorkbook(workbook: import('exceljs').Workbook, name: string) {
  const buffer = await workbook.xlsx.writeBuffer()
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  if (/iPhone|iPad|iPod|Android/i.test(navigator.userAgent) && typeof navigator.share === 'function') {
    await shareOrDownloadBlob(blob, name, { title: name.replace(/\.xlsx$/i, '') })
  } else {
    download(blob, name)
  }
}

function download(blob: Blob, name: string) {
  downloadBlob(blob, name)
}

function dispatchCurrentUserProfile(user: AppUser, updated: EmployeeProfile) {
  window.dispatchEvent(new CustomEvent('gustino:user-profile-updated', {
    detail: {
      id: updated.id,
      name: updated.name,
      email: updated.email || user.email,
      role: updated.role,
      branchId: updated.branchId || user.branchId,
      employmentType: updated.employmentType,
      positionTitle: updated.positionTitle,
      avatarUrl: updated.avatarUrl,
    },
  }))
}

async function fileToAvatarDataUrl(file: File) {
  try {
    const bitmap = await createImageBitmap(file)
    const size = 256
    const scale = Math.min(size / bitmap.width, size / bitmap.height)
    const width = Math.max(1, Math.round(bitmap.width * scale))
    const height = Math.max(1, Math.round(bitmap.height * scale))
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Không thể xử lý ảnh đại diện.')
    context.drawImage(bitmap, 0, 0, width, height)
    bitmap.close?.()
    return canvas.toDataURL('image/jpeg', 0.8)
  } catch {
    return fileToDataUrl(file)
  }
}

function fileToDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

function csvCell(value: string | number) {
  return `"${String(value).replace(/"/g, '""')}"`
}

function cleanMoneyInput(value: string) {
  return value.replace(/[^\d]/g, '')
}

function parseMoney(value: string) {
  return Number(cleanMoneyInput(value)) || 0
}

function parsePercent(value: string) {
  return Number(value.replace(/[^\d.,]/g, '').replace(',', '.')) || 0
}

function formatMoney(value: number) {
  return `${Math.round(value).toLocaleString('vi-VN')}đ`
}

function supplyStatusLabel(status: SupplyRequest['status']) {
  return status === 'pending' ? 'Chờ duyệt'
    : status === 'acknowledged' ? 'Đã nhận'
      : status === 'cancelled' ? 'Đã hủy'
        : 'Hoàn thành'
}

function branchName(id?: string) {
  if (!id) return 'Chưa gán chi nhánh'
  return configuredBranchName(id) || id
}

function formatNumber(value: number) {
  return Number(value.toFixed(2)).toLocaleString('vi-VN')
}

function formatDate(date: string) {
  return new Date(`${date}T00:00:00`).toLocaleDateString('vi-VN')
}
function formatMonthLabel(period: string) {
  const [year, month] = period.split('-')
  return `${month}/${year}`
}
function formatDateTime(date: string) {
  return new Date(date).toLocaleString('vi-VN', { hour12: false })
}
function toDateTimeLocalValue(value?: string) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const offset = date.getTimezoneOffset() * 60000
  return new Date(date.getTime() - offset).toISOString().slice(0, 16)
}

function attendanceScheduledDateTimeLocal(workDate: string, time: string, nextDay = false) {
  const date = nextDay ? addDateKeyDays(workDate, 1) : workDate
  return `${date}T${time.slice(0, 5)}`
}

function addDateKeyDays(dateKey: string, amount: number) {
  const [year, month, day] = dateKey.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day + amount)).toISOString().slice(0, 10)
}
function shiftMonthKey(monthKey: string, amount: number) {
  const [year, month] = monthKey.split('-').map(Number)
  const shifted = new Date(Date.UTC(year, month - 1 + amount, 1))
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, '0')}`
}
function attendanceDetailStatus(status: 'completed' | 'working' | 'absent' | 'scheduled') {
  return ({ completed: 'Đã hoàn thành', working: 'Đang làm', absent: 'Vắng', scheduled: 'Chưa tới ca' })[status]
}

function monthRange(offset = 0) {
  const today = new Date()
  const first = new Date(today.getFullYear(), today.getMonth() + offset, 1)
  const last = new Date(today.getFullYear(), today.getMonth() + offset + 1, 0)
  return { from: localDateKey(first), to: localDateKey(last) }
}

function localDateKey(date = new Date()) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

const MOVEMENT_LABELS: Record<StockMovement['type'], string> = {
  opening: 'Tồn đầu',
  inbound: 'Nhập kho',
  processing_out: 'Xuất sơ chế',
  processing_in: 'Nhập sơ chế',
  packing_out: 'Xuất đóng gói',
  packing_in: 'Nhập thành phẩm',
  sale_out: 'Bán hàng',
  waste: 'Hao hụt',
  adjustment: 'Điều chỉnh',
  count: 'Kiểm kê',
}
