import { shouldUseLanApi, supabase } from './supabase'
import type { AppUser, EmploymentType, Role } from '../types'

export interface PayrollEntry {
  id?: string
  employeeId: string
  branchId: string
  period: string
  baseSalary: number | null
  responsibilityAllowance: number | null
  attendanceAllowance: number | null
  mealTransportAllowance: number | null
  agreedSalary: number | null
  dailyRate: number | null
  workdaySalary: number | null
  overtimeHours: number | null
  kpiBonus: number | null
  netSalary: number | null
  note: string
  publishedAt?: string
  employeeViewedAt?: string
  employeeConfirmedAt?: string
}

export interface PayrollFixedConfig {
  branchId: string
  role: Role
  employmentType?: EmploymentType
  positionTitle?: string
  baseSalary: number
  responsibilityAllowance: number
  attendanceAllowance: number
  mealTransportAllowance: number
}

// Các vai trò nhận phiếu lương. Bếp là vai trò không gán chi nhánh (branch_id = null)
// nên phiếu lương của bếp được gom vào nhóm ảo KITCHEN_PAYROLL_BRANCH.
export const PAYSLIP_EMPLOYEE_ROLES: Role[] = ['shift_leader', 'staff', 'cashier', 'kitchen']
export const KITCHEN_PAYROLL_BRANCH = { id: 'central-kitchen', name: 'Bếp trung tâm' } as const

export function canReceivePayslip(role: Role) {
  return PAYSLIP_EMPLOYEE_ROLES.includes(role)
}

export function payrollBranchId(employee: { role: Role; branchId?: string }) {
  return employee.role === 'kitchen' ? KITCHEN_PAYROLL_BRANCH.id : employee.branchId || ''
}

function assertAdmin(user: AppUser) {
  if (user.role !== 'admin') throw new Error('Chỉ Admin hệ thống được xem và chỉnh phiếu lương.')
}

function missingPayrollColumn(error: unknown) {
  const value = error as { code?: string; message?: string } | null
  return value?.code === '42703' || value?.code === 'PGRST204' || String(value?.message || '').includes('schema cache')
}

function mapEntry(row: any): PayrollEntry {
  const nullableNumber = (value: unknown) => value === null || value === undefined ? null : Number(value)
  return {
    id: row.id,
    employeeId: row.employee_id,
    branchId: row.branch_id,
    period: row.period,
    baseSalary: nullableNumber(row.base_salary),
    responsibilityAllowance: nullableNumber(row.responsibility_allowance),
    attendanceAllowance: nullableNumber(row.attendance_allowance),
    mealTransportAllowance: nullableNumber(row.meal_transport_allowance),
    // `fixed_salary` là cấu hình lương riêng theo tháng của mô hình cũ. Giữ lại
    // làm nguồn tương thích cho "Lương thỏa thuận", không đổi dữ liệu lịch sử.
    agreedSalary: nullableNumber(row.agreed_salary ?? row.fixed_salary),
    dailyRate: nullableNumber(row.daily_rate),
    workdaySalary: nullableNumber(row.workday_salary),
    overtimeHours: nullableNumber(row.overtime_hours),
    kpiBonus: nullableNumber(row.kpi_bonus),
    netSalary: nullableNumber(row.net_salary),
    note: row.note || '',
    publishedAt: row.published_at || undefined,
    employeeViewedAt: row.employee_viewed_at || undefined,
    employeeConfirmedAt: row.employee_confirmed_at || undefined,
  }
}

export async function fetchPayrollEntries(user: AppUser, period: string, branchIds: string[]): Promise<PayrollEntry[]> {
  assertAdmin(user)
  if (!branchIds.length || shouldUseLanApi(user) || !supabase) return []
  const { data, error } = await supabase.from('payroll_entries').select('*').eq('period', period).in('branch_id', branchIds)
  if (error) throw error
  return (data || []).map(mapEntry)
}

export async function fetchPayrollFixedConfigs(user: AppUser, branchIds: string[]): Promise<PayrollFixedConfig[]> {
  assertAdmin(user)
  if (!branchIds.length || shouldUseLanApi(user) || !supabase) return []
  const { data, error } = await supabase.from('payroll_fixed').select('*').eq('active', true).in('branch_id', branchIds)
  if (error) throw error
  return (data || []).map((row: any) => ({
    branchId: row.branch_id,
    role: row.role,
    employmentType: row.employment_type || undefined,
    positionTitle: row.position_title || undefined,
    baseSalary: Number(row.fixed_salary || 0),
    responsibilityAllowance: Number(row.responsibility_allowance || 0),
    attendanceAllowance: Number(row.attendance_allowance || 0),
    mealTransportAllowance: Number(row.lunch_allowance || 0) + Number(row.parking_allowance || 0),
  }))
}

export async function upsertPayrollEntry(user: AppUser, entry: PayrollEntry): Promise<PayrollEntry> {
  assertAdmin(user)
  if (shouldUseLanApi(user) || !supabase) throw new Error('Môi trường LAN chưa có kho dữ liệu phiếu lương đồng bộ.')
  const { data, error } = await supabase.from('payroll_entries').upsert(entryPayload(user, entry), { onConflict: 'employee_id,period' }).select('*').single()
  if (!error) return mapEntry(data)
  if (missingPayrollColumn(error)) throw new Error('Chưa cài migration phiếu lương 20260910 trên Supabase.')
  throw error
}

function entryPayload(user: AppUser, entry: PayrollEntry) {
  return {
    branch_id: entry.branchId,
    employee_id: entry.employeeId,
    period: entry.period,
    base_salary: entry.baseSalary,
    responsibility_allowance: entry.responsibilityAllowance,
    attendance_allowance: entry.attendanceAllowance,
    meal_transport_allowance: entry.mealTransportAllowance,
    agreed_salary: entry.agreedSalary,
    daily_rate: entry.dailyRate,
    workday_salary: entry.workdaySalary,
    overtime_hours: entry.overtimeHours,
    kpi_bonus: entry.kpiBonus,
    net_salary: entry.netSalary,
    // Giữ cột legacy đồng bộ với ý nghĩa gần nhất để màn/phiên bản cũ vẫn đọc được.
    fixed_salary: entry.agreedSalary,
    note: entry.note,
    updated_by: user.id,
    updated_at: new Date().toISOString(),
  }
}

export async function publishPayrollEntries(user: AppUser, entries: PayrollEntry[]): Promise<PayrollEntry[]> {
  assertAdmin(user)
  if (!entries.length) return []
  if (shouldUseLanApi(user) || !supabase) throw new Error('Môi trường LAN chưa có kho dữ liệu phiếu lương đồng bộ.')
  const publishedAt = new Date().toISOString()
  const { data, error } = await supabase.from('payroll_entries').upsert(entries.map((entry) => ({
    ...entryPayload(user, entry),
    published_at: publishedAt,
    published_by: user.id,
    employee_viewed_at: null,
    employee_confirmed_at: null,
  })), { onConflict: 'employee_id,period' }).select('*')
  if (!error) return (data || []).map(mapEntry)
  if (missingPayrollColumn(error)) throw new Error('Chưa cài migration phiếu lương 20260910 trên Supabase.')
  throw error
}

export async function fetchOwnPublishedPayslips(user: AppUser): Promise<PayrollEntry[]> {
  if (!canReceivePayslip(user.role) || shouldUseLanApi(user) || !supabase) return []
  const { data, error } = await supabase.from('payroll_entries')
    .select('*')
    .eq('employee_id', user.id)
    .not('published_at', 'is', null)
    .order('published_at', { ascending: false })
    .limit(24)
  if (!error) return (data || []).map(mapEntry)
  if (missingPayrollColumn(error)) return []
  throw error
}

export const PAYSLIP_VIEWED_EVENT = 'gustino:payslip-viewed'

export async function revokePayrollEntry(user: AppUser, entryId: string): Promise<PayrollEntry> {
  assertAdmin(user)
  if (!entryId) throw new Error('Phiếu lương chưa được lưu.')
  if (shouldUseLanApi(user) || !supabase) throw new Error('Môi trường LAN chưa có kho dữ liệu phiếu lương đồng bộ.')
  const { data, error } = await supabase.from('payroll_entries').update({
    published_at: null,
    published_by: null,
    employee_viewed_at: null,
    employee_confirmed_at: null,
    updated_by: user.id,
    updated_at: new Date().toISOString(),
  }).eq('id', entryId).select('*').single()
  if (error) throw error
  return mapEntry(data)
}

export async function deletePayrollEntry(user: AppUser, entryId: string): Promise<void> {
  assertAdmin(user)
  if (!entryId) throw new Error('Phiếu lương chưa được lưu.')
  if (shouldUseLanApi(user) || !supabase) throw new Error('Môi trường LAN chưa có kho dữ liệu phiếu lương đồng bộ.')
  const { data, error } = await supabase.from('payroll_entries').delete().eq('id', entryId).select('id').single()
  if (error) throw error
  if (!data) throw new Error('Phiếu lương không còn tồn tại.')
}

export async function markOwnPayslipViewed(user: AppUser, entryId: string): Promise<void> {
  if (!entryId || !canReceivePayslip(user.role)) return
  if (shouldUseLanApi(user) || !supabase) return
  const { error } = await supabase.rpc('mark_own_payslip_viewed', { p_entry_id: entryId })
  if (error) {
    if (missingPayrollColumn(error) || error.code === 'PGRST202') throw new Error('Chưa cài SQL ghi nhận đã xem phiếu lương trên Supabase.')
    throw error
  }
  window.dispatchEvent(new CustomEvent(PAYSLIP_VIEWED_EVENT, { detail: { entryId, viewedAt: new Date().toISOString() } }))
}

export async function confirmOwnPayslip(user: AppUser, entry: PayrollEntry): Promise<string> {
  if (!canReceivePayslip(user.role) || entry.employeeId !== user.id) throw new Error('Chỉ được xác nhận phiếu lương của chính mình.')
  if (!entry.id || !entry.publishedAt) throw new Error('Phiếu lương chưa được gửi hoặc đã thu hồi.')
  if (shouldUseLanApi(user) || !supabase) throw new Error('Môi trường LAN chưa hỗ trợ xác nhận phiếu lương.')
  const { data, error } = await supabase.rpc('confirm_own_payslip', { p_entry_id: entry.id, p_published_at: entry.publishedAt })
  if (error) {
    if (missingPayrollColumn(error) || error.code === 'PGRST202') throw new Error('Chưa cài migration xác nhận phiếu lương trên Supabase.')
    throw error
  }
  if (typeof data !== 'string' || !data) throw new Error('Không nhận được kết quả xác nhận phiếu lương.')
  return data
}
