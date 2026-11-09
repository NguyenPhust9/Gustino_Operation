import { isMissingTable, userHeaders } from './core'
import { configuredProductPrice } from './constants'
import { shouldUseLanApi, supabase } from './supabase'
import type { AppUser, BagAllocation, CommissionRule, EmploymentType, Role } from '../types'
import type { SalesReceipt } from './salesReceipts'

export const DEFAULT_REVENUE_TARGET = 2000000
export const DEFAULT_COMMISSION_RATE = 2

export type KpiPositionKey = 'pg_part_time' | 'pg_full_time' | 'shift_leader'

export interface PositionKpiFormula {
  branchId: string
  position: KpiPositionKey
  weekdayTarget: number
  weekendTarget: number
  monthlyTarget: number
}

const STANDARD_MONTH_WEEKDAYS = 20
const STANDARD_MONTH_WEEKENDS = 6

export const POSITION_KPI_FORMULAS: PositionKpiFormula[] = [
  { branchId: 'gold-coast', position: 'pg_part_time', weekdayTarget: 500000, weekendTarget: 650000, monthlyTarget: 13900000 },
  { branchId: 'gold-coast', position: 'pg_full_time', weekdayTarget: 1000000, weekendTarget: 1300000, monthlyTarget: 27800000 },
  { branchId: 'gold-coast', position: 'shift_leader', weekdayTarget: 300000, weekendTarget: 390000, monthlyTarget: 8340000 },
  { branchId: 'lotte-vt', position: 'pg_part_time', weekdayTarget: 600000, weekendTarget: 780000, monthlyTarget: 16680000 },
  { branchId: 'lotte-vt', position: 'pg_full_time', weekdayTarget: 1200000, weekendTarget: 1560000, monthlyTarget: 33360000 },
  { branchId: 'lotte-vt', position: 'shift_leader', weekdayTarget: 360000, weekendTarget: 468000, monthlyTarget: 10008000 },
  { branchId: 'lotte-2310', position: 'pg_part_time', weekdayTarget: 400000, weekendTarget: 550000, monthlyTarget: 11300000 },
  { branchId: 'lotte-2310', position: 'pg_full_time', weekdayTarget: 800000, weekendTarget: 1100000, monthlyTarget: 22600000 },
  { branchId: 'lotte-2310', position: 'shift_leader', weekdayTarget: 240000, weekendTarget: 330000, monthlyTarget: 6780000 },
]

export const BRANCH_MONTHLY_KPI_TOTALS: Record<string, number> = {
  'gold-coast': 127880000,
  'lotte-vt': 153456000,
  'lotte-2310': 58760000,
}

export function positionKpiKey(role?: Role, employmentType?: EmploymentType, positionTitle = ''): KpiPositionKey {
  const title = positionTitle.toLocaleLowerCase('vi')
  if (role === 'shift_leader' || employmentType === 'leader' || title.includes('ca trưởng') || title.includes('ca phó')) {
    return 'shift_leader'
  }
  if (employmentType === 'full_time' || title.includes('full')) return 'pg_full_time'
  return 'pg_part_time'
}

export function positionKpiFormula(
  branchId: string,
  role?: Role,
  employmentType?: EmploymentType,
  positionTitle = '',
) {
  const position = positionKpiKey(role, employmentType, positionTitle)
  return POSITION_KPI_FORMULAS.find((item) => item.branchId === branchId && item.position === position)
    || POSITION_KPI_FORMULAS.find((item) => item.branchId === 'gold-coast' && item.position === position)
}

export function employeePeriodRevenueTarget(
  branchId: string,
  role?: Role,
  employmentType?: EmploymentType,
  positionTitle = '',
  from?: string,
  to?: string,
) {
  const formula = positionKpiFormula(branchId, role, employmentType, positionTitle)
  if (!formula) return DEFAULT_REVENUE_TARGET
  if (!from || !to) return formula.monthlyTarget
  if (isFullCalendarMonth(from, to)) return formula.monthlyTarget
  let total = 0
  for (const date of dateRange(from, to)) {
    total += isWeekend(date) ? formula.weekendTarget : formula.weekdayTarget
  }
  return total || formula.monthlyTarget
}

export function kpiRank(progress: number) {
  if (progress >= 120) return 'S+'
  if (progress >= 100) return 'A'
  if (progress >= 85) return 'B'
  if (progress >= 70) return 'C'
  return 'D'
}

export function dailyKpiBonus(
  progress: number,
  role?: Role,
  employmentType?: EmploymentType,
  positionTitle = '',
) {
  const position = positionKpiKey(role, employmentType, positionTitle)
  if (position === 'shift_leader') return progress >= 100 ? 30000 : 0
  if (progress >= 110) return 40000
  if (progress >= 100) return 20000
  return 0
}

export function monthlyKpiBonus(
  progress: number,
  role?: Role,
  employmentType?: EmploymentType,
  positionTitle = '',
) {
  const position = positionKpiKey(role, employmentType, positionTitle)
  const isLeader = position === 'shift_leader' && positionTitle.toLocaleLowerCase('vi').includes('trưởng')
  const fullTimeOrDeputy = position === 'pg_full_time' || position === 'shift_leader'
  if (!fullTimeOrDeputy || progress < 80) return 0
  const leaderTiers = [
    [120, 5000000],
    [110, 4000000],
    [100, 3000000],
    [90, 2000000],
    [80, 1000000],
  ] as const
  const staffTiers = [
    [120, 2500000],
    [110, 2000000],
    [100, 1500000],
    [90, 1000000],
    [80, 500000],
  ] as const
  const tiers = isLeader ? leaderTiers : staffTiers
  return tiers.find(([threshold]) => progress >= threshold)?.[1] || 0
}

export function weeklyKpiBonus(achievedDays: number, perfectWeekDays: number) {
  if (perfectWeekDays >= 6) return 200000
  if (achievedDays >= 5) return 100000
  return 0
}

export interface PersonalKpiRewardSummary {
  revenue: number
  dailyBonus: number
  weeklyBonus: number
  reward: number
  achievedDays: number
}

/**
 * Tính đúng phần đang hiển thị ở cột "Thưởng KPI": thưởng ngày + thưởng tuần,
 * không cộng thưởng tháng. Dữ liệu luôn được khóa lại theo chính tài khoản để
 * cả LAN (trả dữ liệu chi nhánh) và Supabase (RLS trả dữ liệu cá nhân) cho cùng kết quả.
 */
export function calculatePersonalKpiReward(
  user: Pick<AppUser, 'id' | 'name' | 'role' | 'branchId' | 'canRoamBranches' | 'employmentType' | 'positionTitle'>,
  allocations: BagAllocation[],
  receipts: SalesReceipt[],
  from: string,
  to: string,
): PersonalKpiRewardSummary {
  const dailyRevenue = new Map<string, number>()
  const matchesName = (value: string) => normalizeName(value) === normalizeName(user.name)
  const inRange = (date: string) => date >= from && date <= to
  const addRevenue = (date: string, revenue: number) => {
    if (!inRange(date) || revenue <= 0) return
    dailyRevenue.set(date, (dailyRevenue.get(date) || 0) + revenue)
  }

  allocations.forEach((allocation) => {
    if (!user.canRoamBranches && allocation.branchId !== user.branchId) return
    if (allocation.employeeId ? allocation.employeeId !== user.id : !matchesName(allocation.employeeName)) return
    const date = allocation.businessDate || allocation.settledAt?.slice(0, 10) || allocation.issuedAt.slice(0, 10)
    const quantity = soldBagQuantity(allocation)
    addRevenue(date, productSaleValues(allocation.productId, quantity).revenue)
  })

  receipts.forEach((receipt) => {
    if (!user.canRoamBranches && receipt.branchId !== user.branchId) return
    if (receipt.sellerId ? receipt.sellerId !== user.id : !matchesName(receipt.sellerName)) return
    // Dòng đã gắn allocation đã được tính ở trên; chỉ cộng POS trực tiếp để
    // không nhân đôi doanh thu, giống hệt bảng Thi đua của quản lý.
    const directRevenue = receipt.lines
      .filter((line) => !line.allocationId)
      .reduce((sum, line) => sum + line.total, 0)
    addRevenue(receipt.businessDate, directRevenue)
  })

  let dailyBonus = 0
  let achievedDays = 0
  const weeks = new Map<string, number>()
  dailyRevenue.forEach((revenue, date) => {
    const target = employeePeriodRevenueTarget(
      user.branchId,
      user.role,
      user.employmentType,
      user.positionTitle,
      date,
      date,
    )
    const progress = revenue / Math.max(1, target) * 100
    dailyBonus += dailyKpiBonus(progress, user.role, user.employmentType, user.positionTitle)
    if (progress >= 100) {
      achievedDays += 1
      const start = weekStart(date)
      weeks.set(start, (weeks.get(start) || 0) + 1)
    }
  })
  let weeklyBonus = 0
  weeks.forEach((days) => { weeklyBonus += weeklyKpiBonus(days, days) })
  return {
    revenue: Array.from(dailyRevenue.values()).reduce((sum, value) => sum + value, 0),
    dailyBonus,
    weeklyBonus,
    reward: dailyBonus + weeklyBonus,
    achievedDays,
  }
}

function weekStart(value: string) {
  const date = new Date(`${value}T00:00:00`)
  const day = date.getDay() || 7
  date.setDate(date.getDate() - day + 1)
  return date.toISOString().slice(0, 10)
}

function isFullCalendarMonth(from: string, to: string) {
  if (from.slice(0, 7) !== to.slice(0, 7) || !from.endsWith('-01')) return false
  const end = new Date(Number(to.slice(0, 4)), Number(to.slice(5, 7)), 0)
  return to === end.toISOString().slice(0, 10)
}

function dateRange(from: string, to: string) {
  const dates: string[] = []
  const cursor = new Date(`${from}T00:00:00`)
  const end = new Date(`${to}T00:00:00`)
  while (cursor <= end) {
    dates.push(cursor.toISOString().slice(0, 10))
    cursor.setDate(cursor.getDate() + 1)
  }
  return dates
}

function isWeekend(date: string) {
  const day = new Date(`${date}T00:00:00`).getDay()
  return day === 0 || day === 6
}

const PRODUCT_PRICES: Record<string, number> = {
  'chestnut-110': 33000,
  'snow-110': 33000,
  'grilled-110': 33000,
  'chestnut-330': 89000,
  'snow-330': 89000,
  'grilled-330': 89000,
  'chestnut-500': 169000,
  'snow-500': 169000,
  'grilled-500': 169000,
  'chestnut-1kg': 330000,
  'snow-1kg': 330000,
  'grilled-1kg': 330000,
  'potato-500': 48000,
  'potato-1kg': 80000,
  'cake-box': 36000,
}

export function commissionPerBag(price: number) {
  if (price < 50000) return 1000
  if (price < 100000) return 2000
  return 3000
}

export function revenueCommission(revenue: number, ratePercent = DEFAULT_COMMISSION_RATE) {
  return Math.round(revenue * Math.max(0, ratePercent) / 100)
}

let employeeKpiCloudReady: boolean | null = supabase ? null : false

export interface EmployeeKpiTarget {
  branchId: string
  employeeKey: string
  employeeId?: string
  employeeName: string
  targetRevenue: number
  updatedAt?: string
}

export function employeeKpiKey(branchId: string, employeeKey: string) {
  return `${branchId}|${employeeKey}`
}

export function loadEmployeeRevenueTargets() {
  return {}
}

export function employeeRevenueTarget(
  branchId: string,
  employeeKey: string,
  fallback = DEFAULT_REVENUE_TARGET,
  targets: Record<string, number> = loadEmployeeRevenueTargets(),
) {
  return targets[employeeKpiKey(branchId, employeeKey)] || fallback
}

function kpiRowToTarget(row: any): EmployeeKpiTarget {
  return {
    branchId: row.branch_id,
    employeeKey: row.employee_key,
    employeeId: row.employee_id || undefined,
    employeeName: row.employee_name || '',
    targetRevenue: Number(row.target_revenue || DEFAULT_REVENUE_TARGET),
    updatedAt: row.updated_at,
  }
}

function localTargetsToRows(branchIds: string[]) {
  void branchIds
  return [] as EmployeeKpiTarget[]
}

export async function fetchEmployeeKpiTargets(user: AppUser, branchIds: string[]): Promise<EmployeeKpiTarget[]> {
  if (shouldUseLanApi(user)) {
    const query = new URLSearchParams({ branchIds: branchIds.join(',') })
    const response = await fetch(`/api/employee-kpi-targets?${query}`, { headers: userHeaders(user) })
    if (response.ok) return response.json()
    return localTargetsToRows(branchIds)
  }
  if (employeeKpiCloudReady !== false) {
    const { data, error } = await supabase!
      .from('employee_kpi_targets')
      .select('*')
      .in('branch_id', branchIds)
    if (!error) {
      employeeKpiCloudReady = true
      return (data || []).map(kpiRowToTarget)
    }
    if (!isMissingTable(error)) throw error
    employeeKpiCloudReady = false
  }
  return localTargetsToRows(branchIds)
}

export async function saveEmployeeRevenueTarget(user: AppUser, target: EmployeeKpiTarget): Promise<EmployeeKpiTarget> {
  const normalizedTarget = {
    ...target,
    targetRevenue: Math.round(Math.max(0, Number(target.targetRevenue) || 0)),
  }
  if (shouldUseLanApi(user)) {
    const response = await fetch('/api/employee-kpi-targets', {
      method: 'PUT',
      headers: userHeaders(user),
      body: JSON.stringify(normalizedTarget),
    })
    if (!response.ok) throw new Error((await response.json().catch(() => null))?.error || 'Không thể lưu KPI nhân viên.')
    return response.json()
  }
  if (employeeKpiCloudReady !== false) {
    if (normalizedTarget.targetRevenue <= 0) {
      const { error } = await supabase!
        .from('employee_kpi_targets')
        .delete()
        .eq('branch_id', normalizedTarget.branchId)
        .eq('employee_key', normalizedTarget.employeeKey)
      if (!error) {
        employeeKpiCloudReady = true
        return normalizedTarget
      }
    if (!isMissingTable(error)) throw error
    employeeKpiCloudReady = false
    throw new Error('Thiếu bảng employee_kpi_targets trên Supabase, không lưu KPI tạm trên trình duyệt.')
    }
    const { data, error } = await supabase!.from('employee_kpi_targets').upsert({
      branch_id: normalizedTarget.branchId,
      employee_id: normalizedTarget.employeeId || null,
      employee_key: normalizedTarget.employeeKey,
      employee_name: normalizedTarget.employeeName,
      target_revenue: normalizedTarget.targetRevenue,
      updated_by: user.id,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'branch_id,employee_key' }).select().single()
    if (!error) {
      employeeKpiCloudReady = true
      return kpiRowToTarget(data)
    }
    if (!isMissingTable(error)) throw error
    employeeKpiCloudReady = false
  }
  throw new Error('Thiếu bảng employee_kpi_targets trên Supabase, không lưu KPI tạm trên trình duyệt.')
}

export function productSaleValues(productId: string, quantity: number) {
  const price = configuredProductPrice(productId, PRODUCT_PRICES[productId] || 0)
  return {
    price,
    revenue: Math.round(quantity * price),
    commissionBase: Math.round(quantity * commissionPerBag(price)),
  }
}

export function soldBagQuantity(allocation: BagAllocation) {
  if (typeof allocation.soldQuantity === 'number') return Math.max(0, allocation.soldQuantity)
  return allocation.settledAt
    ? Math.max(0, allocation.issuedQuantity - allocation.returnedQuantity - allocation.damagedQuantity)
    : 0
}

export function summarizeEmployeeBagSales(allocations: BagAllocation[]) {
  const rows = new Map<string, {
    employeeKey: string
    employeeId?: string
    employeeName: string
    branchId: string
    soldQuantity: number
    revenue: number
    commissionBase: number
  }>()
  allocations.forEach((allocation) => {
    const employeeKey = allocation.employeeId || normalizeName(allocation.employeeName)
    const key = `${allocation.branchId}|${employeeKey}`
    const current = rows.get(key) || {
      employeeKey,
      employeeId: allocation.employeeId,
      employeeName: allocation.employeeName,
      branchId: allocation.branchId,
      soldQuantity: 0,
      revenue: 0,
      commissionBase: 0,
    }
    const soldQuantity = soldBagQuantity(allocation)
    const values = productSaleValues(allocation.productId, soldQuantity)
    current.soldQuantity += soldQuantity
    current.revenue += values.revenue
    current.commissionBase += values.commissionBase
    rows.set(key, current)
  })
  return Array.from(rows.values()).map((row) => ({
    ...row,
    achieved: row.revenue >= DEFAULT_REVENUE_TARGET,
    commission: row.revenue >= DEFAULT_REVENUE_TARGET ? revenueCommission(row.revenue) : 0,
  }))
}

function normalizeName(value: string) {
  return value.trim().toLocaleLowerCase('vi').normalize('NFD').replace(/\p{Diacritic}/gu, '')
}

export async function fetchCommissionRules(user: AppUser): Promise<CommissionRule[]> {
  if (shouldUseLanApi(user)) {
    const response = await fetch('/api/commission-rules', { headers: userHeaders(user) })
    if (!response.ok) throw new Error('Không thể tải chính sách hoa hồng.')
    return response.json()
  }
  const { data, error } = await supabase!.from('commission_rules').select('*')
  if (error) throw error
  return (data || []).map((row) => ({
    id: row.id,
    branchId: row.branch_id,
    targetQuantity: Number(row.target_quantity || DEFAULT_REVENUE_TARGET),
    commissionPerUnit: Number(row.commission_per_unit || DEFAULT_COMMISSION_RATE),
    updatedAt: row.updated_at,
  }))
}

export async function saveCommissionRule(
  user: AppUser,
  input: Pick<CommissionRule, 'branchId' | 'targetQuantity' | 'commissionPerUnit'>,
) {
  if (!['admin', 'manager'].includes(user.role)) throw new Error('Chỉ Quản lý được đổi chính sách hoa hồng.')
  if (shouldUseLanApi(user)) {
    const response = await fetch('/api/commission-rules', {
      method: 'PUT',
      headers: userHeaders(user),
      body: JSON.stringify(input),
    })
    if (!response.ok) throw new Error((await response.json().catch(() => null))?.error || 'Không thể lưu chính sách hoa hồng.')
    return response.json() as Promise<CommissionRule>
  }
  const { data, error } = await supabase!.from('commission_rules').upsert({
    branch_id: input.branchId,
    target_quantity: input.targetQuantity,
    commission_per_unit: input.commissionPerUnit,
    updated_by: user.id,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'branch_id' }).select().single()
  if (error) throw error
  return {
    id: data.id,
    branchId: data.branch_id,
    targetQuantity: Number(data.target_quantity),
    commissionPerUnit: Number(data.commission_per_unit),
    updatedAt: data.updated_at,
  } satisfies CommissionRule
}
