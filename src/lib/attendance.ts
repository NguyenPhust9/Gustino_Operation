import { createId, decodeImageForCanvas } from './browser'
import {
  attendanceOutboxFastCount,
  deleteAttendanceOutboxOp,
  inspectAttendanceOutbox,
  saveAttendanceOutboxOp,
  type AttendanceOutboxDurability,
  type AttendanceOutboxOp,
} from './attendanceOutbox'
import { hasSystemWideScope, isBranchlessRole, isRoamingStaffIdentity } from './access'
import { detectDeviceEnvironment } from './deviceReadiness'
import { branchIds, branchName } from './branches'
import { localDateKey } from './dates'
import { shouldUseLanApi, supabase } from './supabase'
import { functionsErrorMessage, functionsErrorStatus } from './functionsError'
import { usernameToEmail, validateUsername } from './authIdentity'
import { formatWorkDurationBetween } from './workDuration'
import { resolveLateCheckOutAt } from './lateCheckOut'
import { isAttendanceAutoClosedError } from './attendanceErrors'
import { buildAttendanceAdjustmentNoteMap } from './attendanceNotes'
export { ATTENDANCE_AUTO_CLOSE_ADDRESS_PREFIX, isAttendanceAutoClosedError } from './attendanceErrors'
import type {
  AppUser,
  AttendanceAdjustmentRequest,
  AttendanceRecord,
  AttendanceReportRow,
  Branch,
  EmployeeProfile,
  EmploymentStatus,
  EmploymentType,
  Role,
  ScheduleEntry,
  SchedulePerson,
  ShiftRegistration,
  WorkShift,
} from '../types'

interface AttendanceFilters {
  readContext?: AttendanceReadContext
  branchId?: string
  userId?: string
  from?: string
  to?: string
}

/** Nhỏ hơn giới hạn mặc định PostgREST; lặp tới hết để không mất dòng âm thầm. */
const ATTENDANCE_PAGE_SIZE = 500

export const DEFAULT_WORK_SHIFT_TEMPLATES: Array<Pick<WorkShift, 'name' | 'startTime' | 'endTime' | 'employmentTypes'>> = [
  { name: 'Ca 1', startTime: '07:00', endTime: '14:30', employmentTypes: ['leader', 'full_time'] },
  { name: 'Ca 2', startTime: '14:30', endTime: '22:00', employmentTypes: ['leader', 'full_time'] },
  { name: 'Ca 1 07:00-15:00', startTime: '07:00', endTime: '15:00', employmentTypes: ['leader', 'full_time'] },
  { name: 'Ca 2 14:00-22:00', startTime: '14:00', endTime: '22:00', employmentTypes: ['leader', 'full_time'] },
  { name: 'Ca PT sáng', startTime: '09:00', endTime: '13:00', employmentTypes: ['part_time'] },
  { name: 'Ca PT chiều', startTime: '16:00', endTime: '22:00', employmentTypes: ['part_time'] },
]

export function canManageShiftSetup(user: AppUser) {
  return user.role === 'admin' || user.role === 'manager' || user.role === 'shift_leader'
}

function authHeaders(user: AppUser) {
  return {
    'Content-Type': 'application/json',
    ...(user.authToken ? { Authorization: `Bearer ${user.authToken}` } : {}),
    'X-User-Id': user.id,
    'X-User-Role': user.role,
    'X-User-Branch': user.branchId,
    'X-User-Branches': (user.branchIds || [user.branchId]).join(','),
  }
}

async function attendanceApi<T>(user: AppUser, path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/attendance${path}`, {
    ...init,
    headers: { ...authHeaders(user), ...(init?.headers || {}) },
  })
  const contentType = response.headers.get('content-type') || ''
  if (!contentType.includes('application/json')) {
    throw Object.assign(
      new Error('Máy chủ chấm công chưa hoạt động. Hãy khởi động lại ứng dụng bằng lệnh npm run dev.'),
      { status: response.status },
    )
  }
  if (!response.ok) {
    const payload = await response.json().catch(() => null)
    throw Object.assign(
      new Error(payload?.error || 'Không thể xử lý dữ liệu chấm công.'),
      { status: response.status },
    )
  }
  return response.json() as Promise<T>
}

function shouldUseAttendanceApi(user: AppUser) {
  return shouldUseLanApi(user)
}

function queryString(filters: AttendanceFilters) {
  const params = new URLSearchParams()
  if (filters.branchId) params.set('branchId', filters.branchId)
  if (filters.userId) params.set('userId', filters.userId)
  if (filters.from) params.set('from', filters.from)
  if (filters.to) params.set('to', filters.to)
  return params.toString()
}

export function permittedBranchIds(user: AppUser) {
  // SUP MT là vai trò giám sát/đối chiếu toàn hệ thống — xem được mọi chi nhánh như admin.
  if (hasSystemWideScope(user.role) || user.canRoamBranches || isRoamingStaffIdentity(user)) return branchIds()
  if (user.role === 'manager' || user.role === 'kitchen') {
    const scopedIds = Array.from(new Set([user.branchId, ...(user.branchIds || [])].filter(Boolean)))
    return scopedIds.length ? scopedIds : branchIds()
  }
  const scopedIds = Array.from(new Set([user.branchId, ...(user.branchIds || [])].filter(Boolean)))
  return scopedIds.length ? scopedIds : branchIds()
}

export interface AttendanceReadContext {
  activeBranches?: Promise<Set<string>>
  activeBranchesKey?: string
}

export function createAttendanceReadContext(): AttendanceReadContext {
  return {}
}

const activeBranchReads = new Map<string, Promise<Set<string>>>()

async function activeBranchIdSet(user: AppUser, context?: AttendanceReadContext) {
  const key = JSON.stringify([user.id, user.role, user.branchId, user.branchIds, user.authToken])
  if (context?.activeBranches && context.activeBranchesKey === key) return context.activeBranches
  let read = activeBranchReads.get(key)
  if (!read) {
    read = readActiveBranchIds()
    activeBranchReads.set(key, read)
    const pending = read
    void read.finally(() => {
      if (activeBranchReads.get(key) === pending) activeBranchReads.delete(key)
    }).catch(() => undefined)
  }
  if (context) {
    context.activeBranches = read
    context.activeBranchesKey = key
  }
  return read
}

async function readActiveBranchIds() {
  if (!supabase) return new Set(branchIds())
  const { data, error } = await supabase.from('branches').select('id').eq('active', true)
  if (error) {
    console.warn('Falling back to cached active branches:', error.message)
    return new Set(branchIds())
  }
  return new Set((data || []).map((row: { id: string }) => row.id))
}

function isActiveBranch(branchId: string | undefined, activeBranches: Set<string>) {
  return Boolean(branchId && activeBranches.has(branchId))
}

export async function fetchWorkShifts(user: AppUser, readContext?: AttendanceReadContext): Promise<WorkShift[]> {
  if (shouldUseAttendanceApi(user)) return attendanceApi(user, '/shifts')
  const activeBranches = await activeBranchIdSet(user, readContext)
  const { data, error } = await supabase!.from('shifts').select('*').eq('active', true).order('start_time')
  if (error) throw error
  return (data || []).filter((row) => isActiveBranch(row.branch_id, activeBranches)).map((row) => ({
    id: row.id,
    branchId: row.branch_id,
    name: row.name,
    startTime: String(row.start_time).slice(0, 5),
    endTime: String(row.end_time).slice(0, 5),
    graceMinutes: row.grace_minutes,
    recommendedStaff: row.recommended_staff || 3,
    employmentTypes: row.employment_types || undefined,
    active: row.active,
  }))
}

export async function fetchEmployees(user: AppUser, options: { includeInactive?: boolean; readContext?: AttendanceReadContext } = {}): Promise<EmployeeProfile[]> {
  if (shouldUseAttendanceApi(user)) return attendanceApi(user, '/employees')
  const branches = permittedBranchIds(user)
  const activeBranches = await activeBranchIdSet(user, options.readContext)
  const client = supabase!
  let query = client.from('profiles').select('id, full_name, email, role, branch_id, can_roam_branches, active, employment_type, position_title, avatar_url, employment_status, employment_start_date, probation_end_date, employment_end_date, employment_note').order('full_name')
  if (!options.includeInactive) query = query.eq('active', true)
  // Vai trò toàn hệ thống (admin, SUP MT) không lọc theo chi nhánh: lọc `branch_id in (...)`
  // sẽ cắt mất chính các tài khoản không gắn chi nhánh (quản lý, bếp, giám sát).
  if (!hasSystemWideScope(user.role) && !user.canRoamBranches) query = query.in('branch_id', branches)
  let { data, error } = await query as { data: any[] | null; error: any }
  if (error) throw error
  const rows = options.includeInactive
    ? (data || [])
    : (data || []).filter((row) => row.role === 'admin' || isBranchlessRole(row.role) || Boolean(row.can_roam_branches) || isActiveBranch(row.branch_id, activeBranches))
  return rows.map((row) => ({
    id: row.id,
    name: row.full_name,
    email: row.email || undefined,
    role: row.role,
    branchId: row.branch_id || undefined,
    canRoamBranches: Boolean(row.can_roam_branches),
    active: row.active !== false,
    hasLoginAccount: Boolean(row.email),
    employmentType: row.employment_type || undefined,
    positionTitle: row.position_title || undefined,
    avatarUrl: row.avatar_url || undefined,
    employmentStatus: row.employment_status || (row.active === false ? 'ended' : 'working'),
    employmentStartDate: row.employment_start_date || undefined,
    probationEndDate: row.probation_end_date || undefined,
    employmentEndDate: row.employment_end_date || undefined,
    employmentNote: row.employment_note || '',
  }))
}

export async function switchActiveBranch(user: AppUser, nextBranchId: string): Promise<string> {
  const targetBranchId = nextBranchId.trim()
  if (!targetBranchId) throw new Error('Vui lòng chọn chi nhánh làm việc hợp lệ.')
  let resolvedBranchId = targetBranchId
  if (supabase && !shouldUseAttendanceApi(user)) {
    const { data, error } = await supabase.rpc('switch_my_active_branch', {
      p_branch_id: targetBranchId,
    })
    if (error) throw new Error(error.message || 'Không thể chuyển chi nhánh làm việc.')
    if (typeof data === 'string' && data.trim()) {
      resolvedBranchId = data.trim()
    }
  }
  const allBranches = branchIds()
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('gustino:user-profile-updated', {
      detail: {
        id: user.id,
        branchId: resolvedBranchId,
        branchIds: allBranches.length ? allBranches : [resolvedBranchId],
        canRoamBranches: true,
      },
    }))
    window.dispatchEvent(new CustomEvent('gustino-attendance-updated'))
  }
  return resolvedBranchId
}

export async function updateEmployeeRoaming(
  user: AppUser,
  employeeId: string,
  canRoamBranches: boolean,
): Promise<boolean> {
  if (user.role !== 'admin') throw new Error('Chỉ Admin mới được cấp quyền di chuyển đa chi nhánh.')
  if (!supabase || shouldUseAttendanceApi(user)) {
    throw new Error('Cần kết nối Supabase để cập nhật quyền đa chi nhánh.')
  }
  const { data, error } = await supabase.rpc('admin_set_employee_roaming', {
    p_employee_id: employeeId,
    p_can_roam: canRoamBranches,
  })
  if (error) throw new Error(error.message || 'Không thể cập nhật quyền di chuyển đa chi nhánh.')
  return Boolean(data)
}

export async function updateEmployeeCrmDetails(
  user: AppUser,
  employeeId: string,
  input: {
    employmentStatus: EmploymentStatus
    employmentStartDate?: string
    probationEndDate?: string
    employmentEndDate?: string
    employmentNote?: string
  },
) {
  if (user.role !== 'admin') throw new Error('Chỉ Admin hệ thống được cập nhật hồ sơ CRM nhân viên.')
  if (shouldUseAttendanceApi(user)) {
    return attendanceApi<EmployeeProfile>(user, `/employees/${employeeId}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    })
  }
  const { data, error } = await supabase!.rpc('admin_update_employee_crm', {
    p_employee_id: employeeId,
    p_employment_status: input.employmentStatus,
    p_start_date: input.employmentStartDate || null,
    p_probation_end_date: input.probationEndDate || null,
    p_end_date: input.employmentStatus === 'ended' ? input.employmentEndDate || null : null,
    p_note: input.employmentNote || '',
  })
  if (error) throw error
  return {
    employmentStatus: data.employment_status as EmploymentStatus,
    employmentStartDate: data.employment_start_date || undefined,
    probationEndDate: data.probation_end_date || undefined,
    employmentEndDate: data.employment_end_date || undefined,
    employmentNote: data.employment_note || '',
  }
}

export async function fetchSchedulePeople(user: AppUser, readContext = createAttendanceReadContext()): Promise<SchedulePerson[]> {
  if (!supabase) {
    return (await fetchEmployees(user, { readContext })).map((employee, index) => ({
      id: employee.id,
      profileId: employee.id,
      name: employee.name,
      branchId: employee.branchId || user.branchId,
      active: employee.active !== false,
      employmentType: employee.employmentType,
      positionTitle: employee.positionTitle,
      sortOrder: index,
    }))
  }
  const { data, error } = await supabase.rpc('list_schedule_people')
  if (error) {
    console.warn('Falling back to profiles for schedule people:', error.message)
    return (await fetchEmployees(user, { readContext })).map((employee, index) => ({
      id: employee.id,
      profileId: employee.id,
      name: employee.name,
      branchId: employee.branchId || user.branchId,
      active: employee.active !== false,
      employmentType: employee.employmentType,
      positionTitle: employee.positionTitle,
      sortOrder: index,
    }))
  }
  const activeProfileIds = new Set((await fetchEmployees(user, { readContext }).catch(() => [] as EmployeeProfile[])).map((employee) => employee.id))
  const canTrustProfileFilter = (user.role === 'admin' || user.role === 'manager') && activeProfileIds.size > 0
  const activeBranches = await activeBranchIdSet(user, readContext)
  return (data || [])
    .map((row: any, index: number) => ({
    id: row.id,
    profileId: row.profile_id || (row.role ? row.id : undefined),
    name: row.full_name,
    branchId: row.branch_id,
    active: row.active !== false,
    employmentType: row.employment_type || undefined,
    positionTitle: row.position_title || undefined,
    sortOrder: Number(row.sort_order ?? index),
    }))
    .filter((person: SchedulePerson) =>
      person.active !== false
      && isActiveBranch(person.branchId, activeBranches)
      && (!person.profileId || !canTrustProfileFilter || activeProfileIds.has(person.profileId)),
    )
}

export async function fetchScheduleEntries(
  user: AppUser,
  filters: { branchId: string; from: string; to: string },
): Promise<ScheduleEntry[]> {
  if (shouldUseAttendanceApi(user)) return []
  const { data, error } = await supabase!
    .from('schedule_entries')
    .select('*')
    .eq('branch_id', filters.branchId)
    .gte('work_date', filters.from)
    .lte('work_date', filters.to)
    .order('work_date')
  if (error) {
    console.warn('Schedule entries unavailable, using registrations as fallback:', error.message)
    return []
  }
  return (data || []).map((row) => ({
    id: row.id,
    personId: row.person_id,
    branchId: row.branch_id,
    workDate: row.work_date,
    shiftId: row.shift_id || undefined,
    startTime: String(row.start_time).slice(0, 5),
    endTime: String(row.end_time).slice(0, 5),
    note: row.note || '',
  }))
}

export async function createSchedulePerson(
  user: AppUser,
  input: Pick<SchedulePerson, 'name' | 'branchId' | 'employmentType' | 'positionTitle'>,
) {
  if (user.role !== 'manager' && user.role !== 'admin') throw new Error('Chỉ Quản lý được thêm nhân sự vào bảng lịch.')
  if (!supabase) throw new Error('Cần kết nối Supabase để quản lý bảng lịch.')
  const { error } = await supabase.from('schedule_people').insert({
    full_name: input.name.trim(),
    branch_id: input.branchId,
    employment_type: input.employmentType || 'part_time',
    position_title: input.positionTitle?.trim() || 'Part-time',
  })
  if (error) throw error
}

export async function deleteSchedulePerson(user: AppUser, personId: string) {
  if (user.role !== 'manager' && user.role !== 'admin') throw new Error('Chỉ Quản lý được xóa dòng nhân sự.')
  if (!supabase) throw new Error('Cần kết nối Supabase để quản lý bảng lịch.')
  const { error } = await supabase.from('schedule_people').update({ active: false }).eq('id', personId)
  if (error) throw error
}

export async function setScheduleEntry(
  user: AppUser,
  input: { personId: string; branchId: string; workDate: string; shiftId?: string },
) {
  if (!supabase) throw new Error('Cần kết nối Supabase để cập nhật bảng lịch.')
  const { error } = await supabase.rpc('set_schedule_entry', {
    p_person_id: input.personId,
    p_branch_id: input.branchId,
    p_work_date: input.workDate,
    p_shift_id: input.shiftId || null,
  })
  if (error) throw error
}

export async function createWorkShift(
  user: AppUser,
  input: Pick<WorkShift, 'branchId' | 'name' | 'startTime' | 'endTime' | 'employmentTypes'>,
) {
  if (!canManageShiftSetup(user)) throw new Error('Bạn không có quyền tạo khung ca.')
  const name = (input.name || `${input.startTime}-${input.endTime}`).trim()
  if (shouldUseAttendanceApi(user)) {
    return attendanceApi<WorkShift>(user, '/shifts', {
      method: 'POST',
      body: JSON.stringify({ ...input, name }),
    })
  }
  if (!supabase) throw new Error('Cần kết nối Supabase để tạo khung ca.')
  const safeCreated = await supabase.rpc('create_work_shift_safe', {
    p_branch_id: input.branchId,
    p_name: name,
    p_start_time: input.startTime,
    p_end_time: input.endTime,
    p_employment_types: input.employmentTypes || [],
  })
  if (!safeCreated.error) return mapWorkShift(safeCreated.data)
  if (!isMissingRpcError(safeCreated.error)) throw friendlyShiftSetupError(safeCreated.error)

  const { error } = await supabase.from('shifts').upsert({
    branch_id: input.branchId,
    name,
    start_time: input.startTime,
    end_time: input.endTime,
    grace_minutes: 5,
    recommended_staff: 3,
    employment_types: input.employmentTypes || [],
    active: true,
    created_by: user.id,
  }, { onConflict: 'branch_id,name' })
  if (error) {
    if (/foreign key|violates foreign key|branches/i.test(error.message)) {
      throw new Error('Chi nhánh này chưa được đồng bộ lên Supabase. Hãy lưu chi nhánh trong Trung tâm quản trị rồi thử lại.')
    }
    throw error
  }
}

export async function syncBranchToCloud(user: AppUser, branch: { id: string; name: string }) {
  if (user.role !== 'admin') throw new Error('Chỉ Admin hệ thống được đồng bộ chi nhánh.')
  if (!supabase) return
  const { error } = await supabase.rpc('upsert_config_branch', {
    p_branch_id: branch.id,
    p_branch_name: branch.name,
  })
  if (!error) return
  if (!isMissingRpcError(error)) throw error
  const { error: directError } = await supabase.from('branches').upsert({
    id: branch.id,
    name: branch.name,
    active: true,
  }, { onConflict: 'id' })
  if (directError) throw directError
}

export async function ensureDefaultWorkShifts(user: AppUser, branch: Branch): Promise<WorkShift[]> {
  if (!canManageShiftSetup(user)) throw new Error('Bạn không có quyền thiết lập khung ca.')
  if (user.role === 'admin') await syncBranchToCloud(user, branch)
  const current = await fetchWorkShifts(user)
  const existing = current.filter((shift) => shift.branchId === branch.id && shift.active !== false)
  if (existing.length) return existing
  for (const template of DEFAULT_WORK_SHIFT_TEMPLATES) {
    await createWorkShift(user, {
      branchId: branch.id,
      name: template.name,
      startTime: template.startTime,
      endTime: template.endTime,
      employmentTypes: template.employmentTypes,
    })
  }
  return (await fetchWorkShifts(user)).filter((shift) => shift.branchId === branch.id && shift.active !== false)
}

/**
 * Chuyển bộ ca mặc định sang giờ mới mà không tái sử dụng shift ID cũ.
 * Các đăng ký ca lịch sử vẫn giữ start/end time đã lưu trong registration.
 */
export async function ensureCurrentDefaultWorkShifts(user: AppUser, branch: Branch): Promise<WorkShift[]> {
  if (!canManageShiftSetup(user)) throw new Error('Bạn không có quyền thiết lập khung ca.')
  if (user.role === 'admin') await syncBranchToCloud(user, branch)

  let current = (await fetchWorkShifts(user)).filter((shift) => shift.branchId === branch.id && shift.active !== false)
  const desiredTimes = new Set(['07:00-14:30', '14:30-22:00', '07:00-15:00', '14:00-22:00', '09:00-13:00', '16:00-21:00'])
  const obsoleteShifts = current.filter((shift) => !desiredTimes.has(`${shift.startTime}-${shift.endTime}`))
  for (const shift of obsoleteShifts) await archiveWorkShift(user, shift.id)

  current = (await fetchWorkShifts(user)).filter((shift) => shift.branchId === branch.id && shift.active !== false)
  const desired = [
    { name: 'Ca 1 mới', startTime: '07:00', endTime: '14:30', employmentTypes: ['leader', 'full_time'] as EmploymentType[] },
    { name: 'Ca 2 mới', startTime: '14:30', endTime: '22:00', employmentTypes: ['leader', 'full_time'] as EmploymentType[] },
    { name: 'Ca 1 07:00-15:00', startTime: '07:00', endTime: '15:00', employmentTypes: ['leader', 'full_time'] as EmploymentType[] },
    { name: 'Ca 2 14:00-22:00', startTime: '14:00', endTime: '22:00', employmentTypes: ['leader', 'full_time'] as EmploymentType[] },
    { name: 'Ca PT sáng', startTime: '09:00', endTime: '13:00', employmentTypes: ['part_time'] as EmploymentType[] },
    { name: 'Ca PT chiều', startTime: '16:00', endTime: '21:00', employmentTypes: ['part_time'] as EmploymentType[] },
  ]
  for (const template of desired) {
    if (current.some((shift) => shift.startTime === template.startTime && shift.endTime === template.endTime)) continue
    await createWorkShift(user, { branchId: branch.id, ...template })
  }
  return (await fetchWorkShifts(user)).filter((shift) => shift.branchId === branch.id && shift.active !== false)
}

export async function archiveWorkShift(user: AppUser, shiftId: string) {
  if (!canManageShiftSetup(user)) throw new Error('Bạn không có quyền xóa khung ca.')
  if (shiftId.startsWith('fallback-shift:')) {
    throw new Error('Đây là khung ca mặc định tạm thời. Hãy tạo khung ca thật trên Supabase rồi thử lại.')
  }
  if (shouldUseAttendanceApi(user)) {
    await attendanceApi(user, `/shifts/${shiftId}`, { method: 'DELETE' })
    return
  }
  if (!supabase) throw new Error('Cần kết nối Supabase để xóa khung ca.')
  const archived = await supabase.rpc('archive_work_shift_safe', { p_shift_id: shiftId })
  if (!archived.error) return
  if (!isMissingRpcError(archived.error)) throw friendlyShiftSetupError(archived.error)

  const { data, error } = await supabase
    .from('shifts')
    .update({ active: false })
    .eq('id', shiftId)
    .select('id')
    .maybeSingle()
  if (error) throw friendlyShiftSetupError(error)
  if (!data) throw new Error('Chưa xóa được ca. Tài khoản hiện tại chưa có quyền trên Supabase hoặc migration xóa ca chưa được chạy.')
}

export interface CreateEmployeeAccountInput {
  name: string
  username: string
  branchId?: string
  role: Exclude<Role, 'admin'>
  employmentType: EmploymentType
  positionTitle: string
  password: string
}

export async function createEmployeeAccount(user: AppUser, input: CreateEmployeeAccountInput): Promise<EmployeeProfile> {
  if (user.role !== 'admin') throw new Error('Chỉ Admin hệ thống được tạo tài khoản nhân viên.')
  const username = validateUsername(input.username)
  if (input.password.length < 6) throw new Error('Mật khẩu cần ít nhất 6 ký tự.')
  const payload = {
    ...input,
    username,
    email: usernameToEmail(username),
    temporaryPassword: input.password,
    branchName: input.branchId ? branchName(input.branchId) : undefined,
  }
  if (shouldUseAttendanceApi(user)) {
    return attendanceApi<EmployeeProfile>(user, '/employees', {
      method: 'POST',
      body: JSON.stringify(payload),
    })
  }
  const data = await invokeManageEmployee({ action: 'create', ...payload })
  return data.employee as EmployeeProfile
}

export async function resetEmployeePassword(user: AppUser, employeeId: string, temporaryPassword: string): Promise<void> {
  if (user.role !== 'admin') throw new Error('Chỉ Admin hệ thống được đặt lại mật khẩu.')
  if (shouldUseAttendanceApi(user)) {
    await attendanceApi(user, `/employees/${employeeId}/password`, {
      method: 'PATCH',
      body: JSON.stringify({ temporaryPassword }),
    })
    return
  }
  await invokeManageEmployee({ action: 'reset_password', employeeId, password: temporaryPassword })
}

export async function deleteEmployeeAccount(user: AppUser, employeeId: string): Promise<void> {
  if (user.role !== 'admin') throw new Error('Chỉ Admin hệ thống được xóa tài khoản.')
  if (employeeId === user.id) throw new Error('Bạn không thể xóa tài khoản đang đăng nhập.')
  if (shouldUseAttendanceApi(user)) {
    await attendanceApi(user, `/employees/${employeeId}?hard=1`, { method: 'DELETE' })
    return
  }
  await invokeManageEmployee({ action: 'hard_delete', employeeId })
}

async function invokeManageEmployee(body: Record<string, unknown>): Promise<any> {
  if (!supabase) throw new Error('Supabase chưa được cấu hình.')
  const client = supabase
  const invoke = async (accessToken: string) => client.functions.invoke('manage-employee', {
    headers: { Authorization: `Bearer ${accessToken}` },
    body,
  })
  const { data: sessionData, error: sessionError } = await client.auth.getSession()
  if (sessionError || !sessionData.session?.access_token) {
    throw new Error('Không tìm thấy phiên Supabase. Hãy tải lại trang và thử lại.')
  }

  let result = await invoke(sessionData.session.access_token)
  if (functionsErrorStatus(result.error) === 401) {
    const { data: refreshed, error: refreshError } = await client.auth.refreshSession()
    if (!refreshError && refreshed.session?.access_token) {
      result = await invoke(refreshed.session.access_token)
    }
  }
  if (result.error) {
    if (functionsErrorStatus(result.error) === 401) {
      throw new Error('Supabase chưa xác nhận được phiên Admin. Hãy bấm lại thao tác, không cần đăng nhập lại.')
    }
    throw new Error(await functionsErrorMessage(result.error, 'Không thể quản lý tài khoản.'))
  }
  if (result.data?.error) throw new Error(result.data.error)
  return result.data
}

export async function updateEmployeeRole(user: AppUser, employeeId: string, role: Role): Promise<void> {
  if (user.role !== 'admin') throw new Error('Chỉ Admin hệ thống được thay đổi phân quyền.')
  if (role === 'admin' && employeeId !== user.id) throw new Error('Không cấp quyền Admin từ màn nhân sự thường.')
  if (employeeId === user.id && role !== 'admin') throw new Error('Bạn không thể tự hạ quyền Admin của chính mình.')
  if (shouldUseAttendanceApi(user)) {
    await attendanceApi(user, `/employees/${employeeId}`, {
      method: 'PATCH',
      body: JSON.stringify({ role }),
    })
    return
  }
  const { error } = await supabase!.rpc('admin_update_profile_role', {
    p_profile_id: employeeId,
    p_role: role,
  })
  if (error) throw error
}

export async function updateEmployeeDetails(
  user: AppUser,
  employeeId: string,
  patch: {
    name?: string
    branchId?: string
    role?: Exclude<Role, 'admin'>
    employmentType?: EmploymentType
    positionTitle?: string
    avatarUrl?: string
  },
): Promise<EmployeeProfile> {
  if (user.role !== 'admin') throw new Error('Chỉ Admin hệ thống được chỉnh sửa hồ sơ nhân viên.')
  if (employeeId === user.id && patch.role) {
    throw new Error('Bạn không thể tự hạ quyền Admin của chính mình.')
  }
  if (shouldUseAttendanceApi(user)) {
    return attendanceApi<EmployeeProfile>(user, `/employees/${employeeId}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    })
  }
  const data = await invokeManageEmployee({
    action: 'update',
    employeeId,
    ...patch,
    branchName: patch.branchId ? branchName(patch.branchId) : undefined,
  })
  return data.employee as EmployeeProfile
}

export async function fetchShiftRegistrations(user: AppUser, filters: AttendanceFilters = {}): Promise<ShiftRegistration[]> {
  if (shouldUseAttendanceApi(user)) return attendanceApi(user, `/registrations?${queryString(filters)}`)
  // Khi query đã khóa đúng chính user, mọi row đều đi nhánh "own" bên dưới;
  // không gọi thêm bảng branches ở mỗi event realtime.
  const onlyOwn = filters.userId === user.id
  const activeBranches = onlyOwn ? new Set<string>() : await activeBranchIdSet(user, filters.readContext)
  const rows: any[] = []
  for (let offset = 0; ; offset += ATTENDANCE_PAGE_SIZE) {
    let query = supabase!
      .from('shift_registrations')
      .select('*, profiles!shift_registrations_user_id_fkey(full_name, active, employment_type, position_title)')
      .order('work_date', { ascending: false })
      .order('start_time')
      .order('id')
    if (filters.branchId) query = query.eq('branch_id', filters.branchId)
    if (filters.userId) query = query.eq('user_id', filters.userId)
    if (filters.from) query = query.gte('work_date', filters.from)
    if (filters.to) query = query.lte('work_date', filters.to)
    const { data, error } = await query.range(offset, offset + ATTENDANCE_PAGE_SIZE - 1)
    if (error) throw error
    const page = data || []
    rows.push(...page)
    if (page.length < ATTENDANCE_PAGE_SIZE) break
  }
  return rows
    // Ca của CHÍNH MÌNH không bao giờ bị lọc: bộ lọc active-branch chỉ để giấu dữ
    // liệu chi nhánh đã xóa khỏi màn quản lý, không được làm người dùng "mất ca".
    .filter((row) => row.user_id === user.id
      || (row.profiles?.active !== false && isActiveBranch(row.branch_id, activeBranches)))
    .map(mapRegistration)
}

export async function createShiftRegistration(
  user: AppUser,
  input: Pick<ShiftRegistration, 'branchId' | 'workDate' | 'startTime' | 'endTime' | 'shiftId' | 'note'>,
) {
  validateRegistration(input)
  const registration: ShiftRegistration = {
    id: createId(),
    userId: user.id,
    userName: user.name,
    employmentType: user.employmentType,
    positionTitle: user.positionTitle,
    branchId: input.branchId,
    workDate: input.workDate,
    startTime: input.startTime,
    endTime: input.endTime,
    shiftId: input.shiftId,
    status: 'approved',
    note: input.note.trim(),
    createdAt: new Date().toISOString(),
  }
  if (shouldUseAttendanceApi(user)) {
    await attendanceApi(user, '/registrations', { method: 'POST', body: JSON.stringify(registration) })
    return registration
  }
  if ((user.canRoamBranches || isRoamingStaffIdentity(user)) && registration.branchId && registration.branchId !== user.branchId) {
    await supabase!.rpc('switch_my_active_branch', { p_branch_id: registration.branchId })
  }
  const safeRpc = await supabase!.rpc('add_shift_registration_safe', {
    p_user_id: registration.userId,
    p_branch_id: registration.branchId,
    p_work_date: registration.workDate,
    p_shift_id: registration.shiftId || null,
    p_start_time: registration.startTime,
    p_end_time: registration.endTime,
    p_note: registration.note,
  })
  if (!safeRpc.error && safeRpc.data) {
    return {
      ...mapRegistration({ ...safeRpc.data, profiles: { full_name: user.name } }),
      userName: user.name,
      employmentType: user.employmentType,
      positionTitle: user.positionTitle,
    }
  }
  if (safeRpc.error && !isMissingRpcError(safeRpc.error)) throw friendlyRegistrationError(safeRpc.error)

  const manualRpc = await supabase!.rpc('add_manual_shift_registration', {
    p_user_id: registration.userId,
    p_branch_id: registration.branchId,
    p_work_date: registration.workDate,
    p_start_time: registration.startTime,
    p_end_time: registration.endTime,
    p_note: registration.note,
  })
  if (!manualRpc.error && manualRpc.data) {
    return {
      ...mapRegistration({ ...manualRpc.data, profiles: { full_name: user.name } }),
      userName: user.name,
      employmentType: user.employmentType,
      positionTitle: user.positionTitle,
      shiftId: registration.shiftId,
    }
  }
  if (manualRpc.error && !isMissingRpcError(manualRpc.error)) throw friendlyRegistrationError(manualRpc.error)

  const { error } = await supabase!.from('shift_registrations').insert({
    id: registration.id,
    user_id: registration.userId,
    branch_id: registration.branchId,
    shift_id: registration.shiftId || null,
    work_date: registration.workDate,
    start_time: registration.startTime,
    end_time: registration.endTime,
    status: 'approved',
    note: registration.note,
    employment_type: registration.employmentType || null,
    position_title: registration.positionTitle || null,
  })
  if (error) throw friendlyRegistrationError(error)
  return registration
}

export async function createManualShiftRegistration(
  actor: AppUser,
  input: {
    userId: string
    userName: string
    branchId: string
    workDate: string
    startTime: string
    endTime: string
    note: string
    employmentType?: EmploymentType
    positionTitle?: string
  },
) {
  validateRegistration(input)
  const managesBranch = canManageShiftSetup(actor) && permittedBranchIds(actor).includes(input.branchId)
  const canEdit = input.userId === actor.id || managesBranch
  if (!canEdit) throw new Error('Bạn chỉ được thêm ca cho chính mình.')
  if (!managesBranch && input.workDate < localDateKey()) {
    throw new Error('Không thể thêm ca cho ngày đã qua.')
  }
  const registration: ShiftRegistration = {
    id: createId(),
    userId: input.userId,
    userName: input.userName,
    employmentType: input.employmentType,
    positionTitle: input.positionTitle,
    branchId: input.branchId,
    workDate: input.workDate,
    startTime: input.startTime,
    endTime: input.endTime,
    status: 'approved',
    note: input.note.trim(),
    createdAt: new Date().toISOString(),
  }
  if (shouldUseAttendanceApi(actor)) {
    if (input.userId !== actor.id && !managesBranch) throw new Error('Máy chủ local chỉ hỗ trợ nhân viên tự thêm ca của mình.')
    await attendanceApi(actor, '/registrations', { method: 'POST', body: JSON.stringify(registration) })
    return registration
  }
  if ((actor.canRoamBranches || isRoamingStaffIdentity(actor)) && input.branchId && input.branchId !== actor.branchId) {
    await supabase!.rpc('switch_my_active_branch', { p_branch_id: input.branchId })
  }
  const result = await supabase!.rpc('add_manual_shift_registration', {
    p_user_id: input.userId,
    p_branch_id: input.branchId,
    p_work_date: input.workDate,
    p_start_time: input.startTime,
    p_end_time: input.endTime,
    p_note: registration.note,
  })
  if (!result.error && result.data) return { ...registration, id: result.data.id || registration.id, createdAt: result.data.created_at || registration.createdAt }
  if (input.userId !== actor.id) {
    throw new Error(result.error?.message || 'Cần cập nhật Supabase để quản lý thêm ca cho nhân viên.')
  }
  const { error } = await supabase!.from('shift_registrations').insert({
    id: registration.id,
    user_id: registration.userId,
    branch_id: registration.branchId,
    shift_id: null,
    work_date: registration.workDate,
    start_time: registration.startTime,
    end_time: registration.endTime,
    status: 'approved',
    note: registration.note,
    employment_type: registration.employmentType || null,
    position_title: registration.positionTitle || null,
  })
  if (error) throw error
  return registration
}

export async function createAttendanceSupplement(
  actor: AppUser,
  input: {
    userId: string
    branchId: string
    shiftRegistrationId?: string
    workDate: string
    scheduledStartTime?: string
    scheduledEndTime?: string
    checkInTime: string
    checkOutTime: string
    reason: string
  },
) {
  if (actor.role !== 'admin') throw new Error('Chỉ Admin hệ thống được bổ sung công cho nhân viên.')
  validateRegistration({
    branchId: 'selected-registration',
    workDate: input.workDate,
    startTime: input.checkInTime,
    endTime: input.checkOutTime,
  })
  const supplementalCheckOut = localDateTime(
    input.workDate,
    input.checkOutTime,
    input.checkOutTime <= input.checkInTime,
  )
  if (supplementalCheckOut.getTime() > Date.now()) {
    throw new Error('Chỉ được bổ sung công sau khi ca đã kết thúc. Ca đang hoặc chưa diễn ra phải chấm công bình thường.')
  }
  if (!input.shiftRegistrationId) {
    validateRegistration({
      branchId: input.branchId,
      workDate: input.workDate,
      startTime: input.scheduledStartTime || '',
      endTime: input.scheduledEndTime || '',
    })
  }
  if (shouldUseAttendanceApi(actor)) {
    throw new Error('Bổ sung công chỉ thực hiện trên hệ thống online để đảm bảo đồng bộ dữ liệu.')
  }
  const { data, error } = await supabase!.rpc('admin_add_attendance_supplement', {
    p_user_id: input.userId,
    p_branch_id: input.branchId,
    p_work_date: input.workDate,
    p_shift_registration_id: input.shiftRegistrationId || null,
    p_scheduled_start_time: input.scheduledStartTime || null,
    p_scheduled_end_time: input.scheduledEndTime || null,
    p_check_in_time: input.checkInTime,
    p_check_out_time: input.checkOutTime,
    p_reason: input.reason.trim(),
  })
  if (error) {
    if (isMissingRpcError(error)) {
      throw new Error('Chưa cập nhật chức năng bổ sung công trên Supabase. Cần chạy migration mới rồi thử lại.')
    }
    throw new Error(error.message || 'Không thể bổ sung công cho nhân viên.')
  }
  window.dispatchEvent(new CustomEvent('gustino-attendance-updated'))
  return data
}

export async function updateAttendanceRecordByAdmin(
  actor: AppUser,
  input: {
    recordId: string
    checkInTime: string
    checkOutTime: string
    reason: string
  },
) {
  if (actor.role !== 'admin') throw new Error('Chỉ Admin hệ thống được chỉnh công cho nhân viên.')
  const checkIn = new Date(input.checkInTime)
  const checkOut = new Date(input.checkOutTime)
  if (!input.recordId || Number.isNaN(checkIn.getTime()) || Number.isNaN(checkOut.getTime())) {
    throw new Error('Thiếu bản ghi, giờ vào hoặc giờ ra hợp lệ.')
  }
  if (checkOut <= checkIn) throw new Error('Giờ ra phải sau giờ vào.')
  if (checkOut.getTime() - checkIn.getTime() > 18 * 60 * 60 * 1000) {
    throw new Error('Một ca không được vượt quá 18 giờ.')
  }
  if (checkOut.getTime() > Date.now()) throw new Error('Không được chỉnh giờ ra trong tương lai.')
  if (input.reason.trim().length < 3) throw new Error('Hãy nhập lý do điều chỉnh ít nhất 3 ký tự.')
  if (shouldUseAttendanceApi(actor)) {
    throw new Error('Chỉnh công chỉ thực hiện trên hệ thống online để đồng bộ với bảng lương.')
  }
  const { data, error } = await supabase!.rpc('admin_update_attendance_record', {
    p_record_id: input.recordId,
    p_check_in_time: checkIn.toISOString(),
    p_check_out_time: checkOut.toISOString(),
    p_reason: input.reason.trim(),
  })
  if (error) {
    if (isMissingRpcError(error)) {
      throw new Error('Chưa cập nhật chức năng chỉnh công trên Supabase. Cần chạy migration mới rồi thử lại.')
    }
    throw new Error(error.message || 'Không thể chỉnh công cho nhân viên.')
  }
  window.dispatchEvent(new CustomEvent('gustino-attendance-updated'))
  return data
}

export async function deleteAttendanceRecordByAdmin(
  actor: AppUser,
  input: {
    recordId: string
    reason: string
  },
) {
  if (actor.role !== 'admin') throw new Error('Chỉ Admin hệ thống được xóa ca công của nhân viên.')
  if (!input.recordId) throw new Error('Thiếu bản ghi chấm công cần xóa.')
  if (input.reason.trim().length < 3) throw new Error('Hãy nhập lý do xóa ít nhất 3 ký tự.')
  if (shouldUseAttendanceApi(actor)) {
    throw new Error('Xóa ca công chỉ thực hiện trên hệ thống online để đồng bộ với bảng lương.')
  }
  const { data, error } = await supabase!.rpc('admin_delete_attendance_record', {
    p_record_id: input.recordId,
    p_reason: input.reason.trim(),
  })
  if (error) {
    if (isMissingRpcError(error)) {
      throw new Error('Chưa cập nhật chức năng xóa ca công trên Supabase. Cần chạy migration mới rồi thử lại.')
    }
    throw new Error(error.message || 'Không thể xóa ca công của nhân viên.')
  }
  window.dispatchEvent(new CustomEvent('gustino-attendance-updated'))
  return data
}

export async function deleteEmptyShiftRegistrationByAdmin(
  actor: AppUser,
  input: {
    registrationId: string
    reason: string
  },
) {
  if (actor.role !== 'admin') throw new Error('Chỉ Admin hệ thống được xóa dòng đăng ký ca.')
  if (!input.registrationId) throw new Error('Thiếu dòng đăng ký ca cần xóa.')
  if (input.reason.trim().length < 3) throw new Error('Hãy nhập lý do xóa ít nhất 3 ký tự.')
  if (shouldUseAttendanceApi(actor)) {
    throw new Error('Xóa dòng đăng ký ca chỉ thực hiện trên hệ thống online để giữ dữ liệu đồng bộ.')
  }
  const { data, error } = await supabase!.rpc('admin_delete_empty_shift_registration', {
    p_registration_id: input.registrationId,
    p_reason: input.reason.trim(),
  })
  if (error) {
    if (isMissingRpcError(error)) {
      throw new Error('Chưa cập nhật chức năng xóa dòng đăng ký ca trên Supabase. Cần chạy migration mới rồi thử lại.')
    }
    throw new Error(error.message || 'Không thể xóa dòng đăng ký ca.')
  }
  window.dispatchEvent(new CustomEvent('gustino-attendance-updated'))
  return data
}

export async function setScheduleRegistration(
  user: AppUser,
  input: {
    userId: string
    userName: string
    branchId: string
    workDate: string
    shift?: WorkShift
    startTime?: string
    endTime?: string
    note?: string
    employmentType?: EmploymentType
    positionTitle?: string
  },
) {
  const managesBranch = canManageShiftSetup(user) && permittedBranchIds(user).includes(input.branchId)
  const canEdit = input.userId === user.id || managesBranch
  const startTime = input.shift?.startTime || input.startTime
  const endTime = input.shift?.endTime || input.endTime
  if (!canEdit) throw new Error('Bạn chỉ được chỉnh lịch của chính mình.')
  if (!input.shift && (input.startTime || input.endTime)) {
    validateRegistration({
      branchId: input.branchId,
      workDate: input.workDate,
      startTime: input.startTime || '',
      endTime: input.endTime || '',
    })
  }
  if (shouldUseAttendanceApi(user)) {
    return attendanceApi<ShiftRegistration | null>(user, '/registrations/cell', {
      method: 'PUT',
      body: JSON.stringify({
        ...input,
        shiftId: input.shift?.id,
        startTime,
        endTime,
      }),
    })
  }
  if ((user.canRoamBranches || isRoamingStaffIdentity(user)) && input.branchId && input.branchId !== user.branchId) {
    await supabase!.rpc('switch_my_active_branch', { p_branch_id: input.branchId })
  }
  const safeCell = await supabase!.rpc('set_schedule_registration_safe', {
    p_user_id: input.userId,
    p_branch_id: input.branchId,
    p_work_date: input.workDate,
    p_shift_id: input.shift?.id || null,
    p_start_time: !input.shift ? startTime || null : null,
    p_end_time: !input.shift ? endTime || null : null,
    p_note: input.note || '',
  })
  if (!safeCell.error) {
    return safeCell.data
      ? {
        ...mapRegistration({ ...safeCell.data, profiles: { full_name: input.userName } }),
        userName: input.userName,
        employmentType: input.employmentType,
        positionTitle: input.positionTitle,
      }
      : null
  }
  if (isMissingRpcError(safeCell.error)) {
    throw new Error('Chưa cập nhật migration set_schedule_registration_safe trên Supabase nên chưa thể sửa/xóa ca an toàn.')
  }
  throw friendlyRegistrationError(safeCell.error)

  const { data, error } = await supabase!.rpc('set_schedule_registration', {
    p_user_id: input.userId,
    p_branch_id: input.branchId,
    p_work_date: input.workDate,
    p_shift_id: input.shift?.id || null,
  })
  if (error) {
    if (input.shift && isMissingRpcError(error)) {
      const safeRpc = await supabase!.rpc('add_shift_registration_safe', {
        p_user_id: input.userId,
        p_branch_id: input.branchId,
        p_work_date: input.workDate,
        p_shift_id: input.shift!.id,
        p_start_time: input.shift!.startTime,
        p_end_time: input.shift!.endTime,
        p_note: input.note || '',
      })
      if (!safeRpc.error && safeRpc.data) {
        return {
          ...mapRegistration({ ...safeRpc.data, profiles: { full_name: input.userName } }),
          userName: input.userName,
          employmentType: input.employmentType,
          positionTitle: input.positionTitle,
        }
      }
      throw friendlyRegistrationError(safeRpc.error || error)
    }
    throw friendlyRegistrationError(error)
  }
  if (!input.shift && input.startTime && input.endTime) {
    const custom = await supabase!.rpc('add_manual_shift_registration', {
      p_user_id: input.userId,
      p_branch_id: input.branchId,
      p_work_date: input.workDate,
      p_start_time: input.startTime,
      p_end_time: input.endTime,
      p_note: input.note || 'Ca tự chọn',
    })
    if (custom.error) throw custom.error
    return custom.data
  }
  return data
}

export async function fetchAttendanceRecords(user: AppUser, filters: AttendanceFilters = {}): Promise<AttendanceRecord[]> {
  if (shouldUseAttendanceApi(user)) return attendanceApi(user, `/records?${queryString(filters)}`)
  const onlyOwn = user.role === 'staff' || filters.userId === user.id
  const activeBranches = onlyOwn ? new Set<string>() : await activeBranchIdSet(user, filters.readContext)
  const rows: any[] = []
  for (let offset = 0; ; offset += ATTENDANCE_PAGE_SIZE) {
    let query = supabase!
      .from('attendance_records')
      // Bảng công thuộc ngày của registration, không thuộc ngày thiết bị gửi
      // check-in. !inner cho phép lọc đúng work_date cả với ca qua đêm/outbox.
      .select('*, profiles!attendance_records_user_id_fkey(full_name, active), shift_registrations!inner(work_date)')
      .order('check_in_time', { ascending: false })
      .order('id')
    if (user.role === 'staff') query = query.eq('user_id', user.id)
    if (filters.branchId) query = query.eq('branch_id', filters.branchId)
    if (filters.userId) query = query.eq('user_id', filters.userId)
    if (filters.from) query = query.gte('shift_registrations.work_date', filters.from)
    if (filters.to) query = query.lte('shift_registrations.work_date', filters.to)
    const { data, error } = await query.range(offset, offset + ATTENDANCE_PAGE_SIZE - 1)
    if (error) throw error
    const page = data || []
    rows.push(...page)
    if (page.length < ATTENDANCE_PAGE_SIZE) break
  }
  return rows
    // Bản ghi chấm công của CHÍNH MÌNH không bao giờ bị lọc — nếu bộ lọc
    // active-branch trục trặc mà giấu mất bản ghi, màn chấm công sẽ hiện nút
    // Check-in lần nữa dù đã chấm rồi (một gốc của "bị bắt chấm công lại").
    .filter((row) => row.user_id === user.id
      || (row.profiles?.active !== false && isActiveBranch(row.branch_id, activeBranches)))
    .map(mapAttendance)
}

/** Query nhỏ cho AppShell: phát hiện mọi phiên của chính user còn mở mà không tải lịch sử. */
export async function fetchOwnOpenAttendanceRecords(user: AppUser): Promise<AttendanceRecord[]> {
  if (shouldUseAttendanceApi(user)) {
    const records = await attendanceApi<AttendanceRecord[]>(user, `/records?userId=${encodeURIComponent(user.id)}`)
    return records.filter((record) => record.userId === user.id && !record.checkOutTime)
  }
  const { data, error } = await supabase!
    .from('attendance_records')
    .select('*, profiles!attendance_records_user_id_fkey(full_name, active)')
    .eq('user_id', user.id)
    .is('check_out_time', null)
    .order('check_in_time', { ascending: false })
    .limit(20)
  if (error) throw error
  return (data || []).map(mapAttendance)
}

export type AttendancePhase = 'locating' | 'saving'

function notifyAttendanceUpdated() {
  try {
    if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('gustino-attendance-updated'))
  } catch {
    // Test/node hoặc tab đang đóng: realtime/polling vẫn là lưới hòa giải.
  }
}

function attendanceSelfiePath(userId: string, branchId: string, registrationId: string, operationId: string) {
  return `${userId}/${branchId}/${registrationId}-${operationId}.jpg`
}

const ATTENDANCE_WRITE_MAX_ATTEMPTS = 2
const ATTENDANCE_GEOCODE_MAX_ATTEMPTS = 2

// Mỗi bước chấm công phải có hạn chót cứng. Trước đây canvas.toBlob(), giải mã
// ảnh và các lệnh Supabase (storage/postgrest) đều KHÔNG có timeout: khi một
// bước treo, promise không bao giờ settle nên nút Check-in quay vòng mãi mà
// không hiện lỗi nào. Hết hạn phải BÁO LỖI, tuyệt đối không bỏ qua ảnh/GPS/địa chỉ.
const ATTENDANCE_LOCATION_DEADLINE_MS = 25000
/** Cạnh dài tối đa khi giải mã ảnh chấm công (ảnh đóng dấu vẫn xuất ở 1280px chiều ngang). */
const ATTENDANCE_PHOTO_DECODE_MAX_EDGE = 2560
const ATTENDANCE_PHOTO_DEADLINE_MS = 20000
const ATTENDANCE_UPLOAD_DEADLINE_MS = 25000
const ATTENDANCE_DB_DEADLINE_MS = 20000

/** Hết hạn chót một bước chấm công. `status` 408 để lớp retry sẵn có thử lại một lần. */
class AttendanceStepTimeoutError extends Error {
  status?: number
  constructor(message: string, status?: number) {
    super(message)
    this.status = status
  }
}

/**
 * Hạn chót cho các lệnh ĐỌC của màn chấm công. Lệnh ghi đã có hạn chót từ
 * BUG-106, nhưng đường đọc (`fetchShiftRegistrations`/`fetchAttendanceRecords`…)
 * thì chưa: supabase-js không đặt timeout, nên trên 4G chập chờn một request
 * treo là `loading` không bao giờ tắt và màn chấm công quay vòng vô tận, không
 * có ca nào để bấm. Hết hạn phải BÁO LỖI để người dùng bấm tải lại.
 */
export const ATTENDANCE_READ_DEADLINE_MS = 20000

export function withAttendanceReadDeadline<T>(action: () => Promise<T>, label: string) {
  return withAttendanceDeadline(
    action,
    ATTENDANCE_READ_DEADLINE_MS,
    `Máy chủ chưa trả dữ liệu ${label} sau 20 giây. Hãy kiểm tra mạng rồi bấm "Tải lại" để thử lại.`,
    408,
  )
}

function withAttendanceDeadline<T>(
  action: () => Promise<T>,
  timeoutMs: number,
  message: string,
  retryableStatus?: number,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false
    const timer = window.setTimeout(() => {
      if (settled) return
      settled = true
      reject(new AttendanceStepTimeoutError(message, retryableStatus))
    }, timeoutMs)
    const finish = (callback: () => void) => {
      if (settled) return
      settled = true
      window.clearTimeout(timer)
      callback()
    }
    action().then(
      (value) => finish(() => resolve(value)),
      (error) => finish(() => reject(error)),
    )
  })
}

async function withAttendanceWriteRetry<T>(action: () => Promise<T>): Promise<T> {
  let lastError: unknown
  for (let attempt = 1; attempt <= ATTENDANCE_WRITE_MAX_ATTEMPTS; attempt += 1) {
    try {
      return await action()
    } catch (error) {
      lastError = error
      if (attempt >= ATTENDANCE_WRITE_MAX_ATTEMPTS || !isRetryableAttendanceWriteError(error)) throw error
      await new Promise((resolve) => window.setTimeout(resolve, 350))
    }
  }
  throw lastError
}

function isDuplicateAttendanceWrite(error: unknown) {
  const candidate = error as { code?: string; message?: string }
  return String(candidate?.code || '') === '23505' || /duplicate|already exists|đã check-in/i.test(candidate?.message || '')
}

/**
 * Vi phạm ràng buộc DB "một người chỉ được một phiên chấm công đang mở"
 * (unique partial index attendance_records_one_open_per_user, migration 20260727).
 * Đây là lớp chặn cuối cùng cho đa thiết bị/bấm nhiều lần — guard UI có thể bị
 * vượt qua nhưng DB thì không.
 */
function isSingleOpenSessionViolation(error: unknown) {
  const candidate = error as { message?: string; details?: string }
  return /attendance_records_one_open_per_user|một phiên chấm công đang mở|một ca chưa check-out/i.test(
    `${candidate?.message || ''} ${candidate?.details || ''}`,
  )
}

function isRetryableAttendanceWriteError(error: unknown) {
  const candidate = error as { status?: number; statusCode?: number; message?: string }
  const status = Number(candidate?.status || candidate?.statusCode || 0)
  return status === 408 || status === 425 || status === 429 || status >= 500
    || /fetch|network|timeout|timed out|connection|gateway|temporar|chưa xác nhận/i.test(candidate?.message || '')
}

function isPermanentAttendanceReplayRejection(error: unknown) {
  const candidate = error as { status?: number; statusCode?: number; code?: string }
  const status = Number(candidate?.status || candidate?.statusCode || 0)
  const code = String(candidate?.code || '')
  return ['22P02', '23503', '23505', '42501'].includes(code)
    || (status >= 400 && status < 500 && ![401, 408, 425, 429].includes(status))
}

class AttendanceReplayNeedsReviewError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AttendanceReplayNeedsReviewError'
  }
}

export async function checkIn(
  user: AppUser,
  registration: ShiftRegistration,
  selfie: Blob,
  onPhase?: (phase: AttendancePhase) => void,
) {
  if (registration.userId !== user.id || registration.status === 'rejected') {
    throw new Error('Ca làm không hợp lệ hoặc không thuộc tài khoản này.')
  }
  onPhase?.('locating')
  const location = await getAttendanceLocation()
  const now = await getTrustedTimestamp()
  onPhase?.('saving')
  // BUG-131 (quyết định chủ quán 04/08): lượt chấm công ghi THẲNG máy chủ, không
  // phụ thuộc bất kỳ bộ nhớ tạm nào trên máy. Đóng dấu ảnh là best-effort — máy
  // không xử lý được ảnh (WebView/thiếu RAM) thì dùng ảnh gốc, không chặn lượt chấm;
  // giờ/GPS/địa chỉ vẫn nằm đầy đủ trong bản ghi DB.
  const stampedSelfie = await stampAttendancePhoto(selfie, {
    actionLabel: 'CHECK-IN',
    employeeName: user.name,
    branchName: branchName(registration.branchId) || registration.branchId,
    timestamp: now,
    address: location.address,
    latitude: location.latitude,
    longitude: location.longitude,
    accuracy: location.accuracy,
  }).catch(() => selfie)
  // Ảnh xem trước chỉ để hiển thị, KHÔNG phải bằng chứng chấm công: nếu máy đọc
  // chậm/thiếu bộ nhớ thì bỏ qua preview chứ không được treo cả lượt check-in.
  const selfiePreviewUrl = await withAttendanceDeadline(
    () => blobToDataUrl(stampedSelfie),
    ATTENDANCE_PHOTO_DEADLINE_MS,
    'preview-timeout',
  ).catch(() => '')
  const selfieUrl = await uploadSelfie(
    user,
    registration,
    stampedSelfie,
    attendanceSelfiePath(user.id, registration.branchId, registration.id, createId()),
  )
  const record: AttendanceRecord = {
    id: createId(),
    userId: user.id,
    userName: user.name,
    branchId: registration.branchId,
    shiftRegistrationId: registration.id,
    checkInTime: now,
    selfieUrl,
    selfiePreviewUrl,
    checkInLatitude: location.latitude ?? undefined,
    checkInLongitude: location.longitude ?? undefined,
    checkInAccuracy: location.accuracy ?? undefined,
    checkInAddress: location.address,
    createdAt: now,
    updatedAt: now,
  }
  if (shouldUseAttendanceApi(user)) {
    try {
      const saved = await withAttendanceWriteRetry(() => attendanceApi<AttendanceRecord>(user, '/records', {
        method: 'POST',
        body: JSON.stringify(record),
      }))
      notifyAttendanceUpdated()
      return { ...saved, selfiePreviewUrl }
    } catch (error) {
      const existing = await attendanceApi<AttendanceRecord[]>(user, `/records?userId=${encodeURIComponent(user.id)}`)
        .then((rows) => rows.find((item) => item.shiftRegistrationId === registration.id))
        .catch(() => undefined)
      if (existing && (isDuplicateAttendanceWrite(error) || isRetryableAttendanceWriteError(error))) {
        notifyAttendanceUpdated()
        return existing
      }
      if (isSingleOpenSessionViolation(error)) {
        throw new Error('Bạn còn một ca chưa check-out nên chưa thể check-in ca mới. Hãy đóng ca cũ rồi check-in lại.')
      }
      throw error
    }
  }
  try {
    await withAttendanceWriteRetry(async () => {
      const { error } = await withAttendanceDeadline(
        async () => await supabase!.from('attendance_records').insert({
          id: record.id,
          user_id: record.userId,
          branch_id: record.branchId,
          shift_registration_id: record.shiftRegistrationId,
          check_in_time: record.checkInTime,
          selfie_url: record.selfieUrl,
          check_in_latitude: record.checkInLatitude,
          check_in_longitude: record.checkInLongitude,
          check_in_accuracy: record.checkInAccuracy,
          check_in_address: record.checkInAddress,
        }),
        ATTENDANCE_DB_DEADLINE_MS,
        'Máy chủ chưa phản hồi lệnh check-in. Hệ thống sẽ thử lại; nếu vẫn lỗi hãy kiểm tra mạng rồi bấm lại.',
        408,
      )
      if (error) throw error
    })
  } catch (error) {
    const existing = await verifyExistingCheckIn(user.id, registration.id).catch(() => undefined)
    if (existing && (isDuplicateAttendanceWrite(error) || isRetryableAttendanceWriteError(error))) {
      notifyAttendanceUpdated()
      return existing
    }
    if (isSingleOpenSessionViolation(error)) {
      throw new Error('Bạn còn một ca chưa check-out nên chưa thể check-in ca mới. Hãy đóng ca cũ rồi check-in lại.')
    }
    throw error
  }
  notifyAttendanceUpdated()
  return record
}

/**
 * Ghi chú thêm vào lỗi chấm công theo đúng độ bền của hộp thư đi: IndexedDB có
 * thể tự phục hồi sau reload; fallback RAM phải nói rõ chỉ sống trong tab này.
 */
function withOutboxRetryNote(error: unknown, durability: AttendanceOutboxDurability = 'persistent') {
  const base = error instanceof Error ? error.message : 'Không thể lưu lượt chấm công.'
  if (/hộp thư đi|tự gửi lại/.test(base)) return error instanceof Error ? error : new Error(base)
  if (durability === 'memory') {
    return new Error(`${base} Ảnh và giờ chấm hiện chỉ được GIỮ TẠM trong tab này vì máy không mở được kho lưu bền. Giữ app mở và bấm "Gửi lại ngay" khi có mạng; đóng/reload tab có thể làm mất bằng chứng tạm.`)
  }
  return new Error(`${base} Bằng chứng (ảnh + giờ chấm) đã được lưu trên máy — app sẽ TỰ GỬI LẠI khi có mạng, giữ nguyên giờ chấm công gốc.`)
}

async function markAttendanceOutboxNeedsReview(op: AttendanceOutboxOp, deliveryNote: string) {
  await saveAttendanceOutboxOp({ ...op, deliveryState: 'needs-review', deliveryNote })
}

async function quarantineAttendanceOutboxOp(op: AttendanceOutboxOp, deliveryNote: string): Promise<never> {
  await markAttendanceOutboxNeedsReview(op, deliveryNote)
  throw new AttendanceReplayNeedsReviewError(deliveryNote)
}

export async function checkOut(
  user: AppUser,
  record: AttendanceRecord,
  registration: ShiftRegistration,
  selfie: Blob,
  onPhase?: (phase: AttendancePhase) => void,
) {
  if (record.userId !== user.id || record.checkOutTime) throw new Error('Bản ghi này không thể check-out.')
  onPhase?.('locating')
  const location = await getAttendanceLocation()
  const checkOutTime = await getTrustedTimestamp()
  onPhase?.('saving')
  // BUG-131 (quyết định chủ quán 04/08): check-out cũng ghi THẲNG máy chủ, không
  // qua bộ nhớ tạm; đóng dấu ảnh best-effort như check-in.
  const stampedSelfie = await stampAttendancePhoto(selfie, {
    actionLabel: 'CHECK-OUT',
    employeeName: user.name,
    branchName: branchName(registration.branchId) || registration.branchId,
    timestamp: checkOutTime,
    address: location.address,
    latitude: location.latitude,
    longitude: location.longitude,
    accuracy: location.accuracy,
    totalHoursLabel: record.checkInTime ? `Tổng giờ làm: ${formatWorkDurationBetween(record.checkInTime, checkOutTime)}` : undefined,
  }).catch(() => selfie)
  const checkOutSelfieUrl = await uploadSelfie(
    user,
    registration,
    stampedSelfie,
    attendanceSelfiePath(user.id, registration.branchId, registration.id, createId()),
  )
  if (shouldUseAttendanceApi(user)) {
    try {
      const saved = await withAttendanceWriteRetry(() => attendanceApi<AttendanceRecord>(user, `/records/${record.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
            checkOutTime,
            updatedAt: checkOutTime,
            checkOutSelfieUrl,
            checkOutLatitude: location.latitude,
            checkOutLongitude: location.longitude,
            checkOutAccuracy: location.accuracy,
            checkOutAddress: location.address,
          }),
        }))
      notifyAttendanceUpdated()
      return saved?.id ? saved : {
        ...record,
        checkOutTime,
        checkOutSelfieUrl,
        checkOutLatitude: location.latitude ?? undefined,
        checkOutLongitude: location.longitude ?? undefined,
        checkOutAccuracy: location.accuracy ?? undefined,
        checkOutAddress: location.address,
        updatedAt: checkOutTime,
      }
    } catch (error) {
      const existing = await attendanceApi<AttendanceRecord[]>(user, `/records?userId=${encodeURIComponent(user.id)}`)
        .then((rows) => rows.find((item) => item.id === record.id))
        .catch(() => undefined)
      if (existing?.checkOutTime && isRetryableAttendanceWriteError(error)) {
        notifyAttendanceUpdated()
        return existing
      }
      throw error
    }
  }
  try {
    await withAttendanceWriteRetry(async () => {
      const { data, error } = await withAttendanceDeadline(
        async () => await supabase!.from('attendance_records').update({
          check_out_time: checkOutTime,
          check_out_selfie_url: checkOutSelfieUrl,
          check_out_latitude: location.latitude,
          check_out_longitude: location.longitude,
          check_out_accuracy: location.accuracy,
          check_out_address: location.address,
          updated_at: checkOutTime,
        })
          .eq('id', record.id)
          .eq('user_id', user.id)
          .is('check_out_time', null)
          .select('id, check_out_time')
          .maybeSingle(),
        ATTENDANCE_DB_DEADLINE_MS,
        'Máy chủ chưa phản hồi lệnh check-out. Hệ thống sẽ kiểm tra lại; nếu vẫn lỗi hãy kiểm tra mạng rồi bấm lại.',
        408,
      )
      if (error) throw error
      if (data?.check_out_time || await verifyCompletedCheckout(user.id, record.id)) return
      throw new Error('Supabase chưa xác nhận check-out. Hệ thống sẽ kiểm tra và thử lại một lần.')
    })
  } catch (error) {
    if (!await verifyCompletedCheckout(user.id, record.id).catch(() => false)) throw error
  }
  notifyAttendanceUpdated()
  return {
    ...record,
    checkOutTime,
    checkOutSelfieUrl,
    checkOutLatitude: location.latitude ?? undefined,
    checkOutLongitude: location.longitude ?? undefined,
    checkOutAccuracy: location.accuracy ?? undefined,
    checkOutAddress: location.address,
    updatedAt: checkOutTime,
  }
}

/**
 * Check-out BÙ cho ca đã quá hạn (BUG-113). Bấm nút lúc này sẽ đóng dấu giờ HIỆN
 * TẠI — sai sự thật và đẻ ra ca 24h/96h/238h trên bảng công — nhưng chặn cứng thì
 * nhân viên kẹt luôn, phải chờ Admin mới đóng được ca. Lối thoát: cho nhân viên tự
 * khai giờ đã về, chặn ở mức KHÔNG BAO GIỜ vượt quá giờ tan ca theo lịch, nên họ
 * chỉ có thể khai bằng hoặc ít hơn lịch chứ không tự cộng giờ cho mình.
 *
 * Bản ghi đóng theo diện HÀNH CHÍNH: không ảnh, không GPS, địa chỉ mở đầu bằng
 * '[CHỐT HÀNH CHÍNH]' đúng như nhánh 2 của ràng buộc
 * `attendance_records_checkout_evidence_required`, để mọi báo cáo nhìn là biết ca
 * này không được xác minh vị trí. Muốn tính giờ về SAU lịch (tăng ca) thì vẫn phải
 * đi đường đơn chỉnh công để Admin duyệt.
 */
export async function lateCheckOut(
  user: AppUser,
  record: AttendanceRecord,
  registration: ShiftRegistration,
  declaredTime: string,
) {
  if (record.userId !== user.id || record.checkOutTime) throw new Error('Bản ghi này không thể check-out.')
  const declaredAt = resolveLateCheckOutAt(registration, record.checkInTime, declaredTime)
  const checkOutTime = declaredAt.toISOString()
  const checkOutAddress = `[CHỐT HÀNH CHÍNH] ${user.name} khai bù giờ về ca ${registration.startTime}–${registration.endTime} ngày ${registration.workDate}; không có ảnh và GPS lúc ra.`
  if (shouldUseAttendanceApi(user)) {
    // Máy chủ LAN tự kẹp lại giờ khai một lần nữa: client không được là nơi duy
    // nhất quyết định số giờ vào bảng công.
    const saved = await withAttendanceWriteRetry(() => attendanceApi<AttendanceRecord>(user, `/records/${record.id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        lateCheckOutTime: checkOutTime,
        checkOutSelfieUrl: null,
        checkOutLatitude: null,
        checkOutLongitude: null,
        checkOutAccuracy: null,
        checkOutAddress,
      }),
    }))
    window.dispatchEvent(new CustomEvent('gustino-attendance-updated'))
    return saved?.id ? saved : { ...record, checkOutTime, checkOutAddress, updatedAt: new Date().toISOString() }
  }
  try {
    await withAttendanceWriteRetry(async () => {
      const { data, error } = await withAttendanceDeadline(
        async () => await supabase!.from('attendance_records').update({
          check_out_time: checkOutTime,
          check_out_selfie_url: null,
          check_out_latitude: null,
          check_out_longitude: null,
          check_out_accuracy: null,
          check_out_address: checkOutAddress,
          updated_at: new Date().toISOString(),
        })
          .eq('id', record.id)
          .eq('user_id', user.id)
          .is('check_out_time', null)
          .select('id, check_out_time')
          .maybeSingle(),
        ATTENDANCE_DB_DEADLINE_MS,
        'Máy chủ chưa phản hồi lệnh khai bù. Hệ thống sẽ kiểm tra lại; nếu vẫn lỗi hãy kiểm tra mạng rồi bấm lại.',
        408,
      )
      if (error) throw error
      if (data?.check_out_time || await verifyCompletedCheckout(user.id, record.id)) return
      throw new Error('Supabase chưa xác nhận khai bù. Hệ thống sẽ kiểm tra và thử lại một lần.')
    })
  } catch (error) {
    if (!await verifyCompletedCheckout(user.id, record.id).catch(() => false)) throw error
  }
  window.dispatchEvent(new CustomEvent('gustino-attendance-updated'))
  return {
    ...record,
    checkOutTime,
    checkOutSelfieUrl: undefined,
    checkOutLatitude: undefined,
    checkOutLongitude: undefined,
    checkOutAccuracy: undefined,
    checkOutAddress,
    updatedAt: new Date().toISOString(),
  }
}

async function verifyExistingCheckIn(userId: string, registrationId: string) {
  // BUG-131: lệnh đọc xác minh cũng phải có hạn chót — một request treo ở đây
  // giữ nút "Đang xử lý" vô hạn dù bản ghi đã/chưa lưu xong.
  const { data, error } = await withAttendanceDeadline(
    async () => await supabase!
      .from('attendance_records')
      .select('*, profiles!attendance_records_user_id_fkey(full_name, active)')
      .eq('shift_registration_id', registrationId)
      .eq('user_id', userId)
      .maybeSingle(),
    ATTENDANCE_DB_DEADLINE_MS,
    'Máy chủ chưa phản hồi khi xác minh chấm công.',
    408,
  )
  if (error) throw error
  return data ? mapAttendance(data) : undefined
}

async function verifyCompletedCheckout(userId: string, recordId: string) {
  const { data, error } = await withAttendanceDeadline(
    async () => await supabase!
      .from('attendance_records')
      .select('id, check_out_time')
      .eq('id', recordId)
      .eq('user_id', userId)
      .maybeSingle(),
    ATTENDANCE_DB_DEADLINE_MS,
    'Máy chủ chưa phản hồi khi xác minh check-out.',
    408,
  )
  if (error) throw error
  return Boolean(data?.check_out_time)
}

function hasNewerAttendanceRecord(records: AttendanceRecord[], op: AttendanceOutboxOp) {
  const capturedAt = Date.parse(op.capturedAt)
  if (!Number.isFinite(capturedAt)) return true
  return records.some((record) =>
    record.shiftRegistrationId !== op.registrationId
    && Number.isFinite(Date.parse(record.checkInTime))
    && Date.parse(record.checkInTime) >= capturedAt,
  )
}

async function hasNewerOwnAttendanceRecord(userId: string, op: AttendanceOutboxOp) {
  const { data, error } = await supabase!
    .from('attendance_records')
    .select('id')
    .eq('user_id', userId)
    .neq('shift_registration_id', op.registrationId)
    .gte('check_in_time', op.capturedAt)
    .limit(1)
  if (error) throw error
  return Boolean(data?.length)
}

async function uploadSelfie(user: AppUser, registration: ShiftRegistration, selfie: Blob, stablePath?: string) {
  if (!selfie.size) throw new Error('Ảnh selfie là bắt buộc.')
  if (shouldUseAttendanceApi(user)) {
    const dataUrl = await blobToDataUrl(selfie)
    const result = await withAttendanceWriteRetry(() => attendanceApi<{ url: string }>(user, '/selfies', {
        method: 'POST',
        body: JSON.stringify({ registrationId: registration.id, branchId: registration.branchId, dataUrl, selfiePath: stablePath }),
      }))
    return result.url
  }
  const path = stablePath || attendanceSelfiePath(user.id, registration.branchId, registration.id, createId())
  await uploadAttendanceSelfieWithRetry(path, selfie)
  return path
}

async function uploadAttendanceSelfieWithRetry(path: string, selfie: Blob) {
  await withAttendanceWriteRetry(async () => {
    // supabase-js không đặt timeout cho storage upload: mạng 4G chập chờn có thể
    // treo request vĩnh viễn. Hạn chót cứng + status 408 để retry sẵn có xử lý.
    const { error } = await withAttendanceDeadline(
      () => supabase!.storage.from('attendance-selfies').upload(path, selfie, {
        contentType: 'image/jpeg',
        upsert: false,
      }),
      ATTENDANCE_UPLOAD_DEADLINE_MS,
      'Mạng quá chậm nên chưa tải được ảnh chấm công lên. Hãy kiểm tra sóng/4G rồi bấm lại.',
      408,
    )
    if (!error || /duplicate|already exists/i.test(error.message || '')) return
    throw error
  })
}

let attendanceOutboxFlushBusy = false

/**
 * Gửi lại các lượt chấm công còn nằm trong hộp thư đi (BUG-118). Idempotent:
 * máy chủ đã có bản ghi tương ứng thì op bị xóa, không ghi đôi. Giờ chấm công
 * dùng đúng `capturedAt` lúc bấm nút, không phải giờ gửi lại.
 * Trả về số op còn lại (0 = sạch).
 */
export async function flushAttendanceOutbox(user: AppUser): Promise<number> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    const offlineSnapshot = await inspectAttendanceOutbox(user.id)
    if (!offlineSnapshot.authoritative) throw offlineSnapshot.error
    return offlineSnapshot.ops.length
  }
  if (attendanceOutboxFlushBusy) return attendanceOutboxFastCount(user.id)
  attendanceOutboxFlushBusy = true
  try {
    const snapshot = await inspectAttendanceOutbox(user.id)
    if (!snapshot.authoritative && !snapshot.ops.length) throw snapshot.error
    let confirmed = 0
    for (const op of snapshot.ops) {
      // Bằng chứng xung đột được giữ cho quản lý rà soát nhưng tuyệt đối không tự
      // replay một timestamp cũ sau khi ca khác đã diễn ra.
      if (op.deliveryState === 'needs-review') continue
      try {
        await flushSingleAttendanceOutboxOp(user, op)
        confirmed += 1
      } catch (error) {
        // Op lỗi vĩnh viễn đã được giữ `needs-review`; tiếp tục các op độc lập
        // phía sau thay vì để một bằng chứng hỏng chặn cả hàng đợi mãi mãi.
        if (error instanceof AttendanceReplayNeedsReviewError) continue
        if (isPermanentAttendanceReplayRejection(error)) {
          try {
            await markAttendanceOutboxNeedsReview(
              op,
              `Máy chủ từ chối lượt gửi lại: ${error instanceof Error ? error.message : 'dữ liệu không hợp lệ.'}`,
            )
            continue
          } catch {
            // Không ghi được trạng thái quarantine thì dừng, giữ nguyên op pending.
          }
        }
        // Giữ op lại, nhịp sau thử tiếp — tuyệt đối không xóa bằng chứng khi chưa
        // xác nhận được với máy chủ. Dừng tại op đầu lỗi để không gửi đảo thứ tự
        // check-in/check-out giữa hai ngày.
        break
      }
    }
    if (confirmed > 0) notifyAttendanceUpdated()
    const finalSnapshot = await inspectAttendanceOutbox(user.id)
    if (!finalSnapshot.authoritative) throw finalSnapshot.error
    return finalSnapshot.ops.length
  } finally {
    attendanceOutboxFlushBusy = false
  }
}

async function flushSingleAttendanceOutboxOp(user: AppUser, op: AttendanceOutboxOp) {
  // uploadSelfie chỉ dùng id + branchId của đăng ký ca.
  const registrationRef = { id: op.registrationId, branchId: op.branchId } as ShiftRegistration
  const drop = () => deleteAttendanceOutboxOp(op.id, user.id)
  if (op.kind === 'check-in') {
    if (shouldUseAttendanceApi(user)) {
      const rows = await attendanceApi<AttendanceRecord[]>(user, `/records?userId=${encodeURIComponent(user.id)}`)
      if (rows.some((item) => item.shiftRegistrationId === op.registrationId)) return drop()
      if (hasNewerAttendanceRecord(rows, op)) {
        return quarantineAttendanceOutboxOp(op, 'Đã có một ca chấm công mới hơn; lượt cũ không được tự gửi lại vì sẽ mở phiên sai thứ tự.')
      }
      const selfieUrl = await uploadSelfie(user, registrationRef, op.selfie, op.selfiePath || attendanceSelfiePath(user.id, op.branchId, op.registrationId, op.id))
      try {
        await attendanceApi(user, '/records', {
          method: 'POST',
          body: JSON.stringify({
            id: createId(),
            userId: user.id,
            userName: user.name,
            branchId: op.branchId,
            shiftRegistrationId: op.registrationId,
            replayedFromOutbox: true,
            checkInTime: op.capturedAt,
            selfieUrl,
            checkInLatitude: op.latitude,
            checkInLongitude: op.longitude,
            checkInAccuracy: op.accuracy,
            checkInAddress: op.address,
            createdAt: op.capturedAt,
            updatedAt: op.capturedAt,
          }),
        })
      } catch (error) {
        const latestRows = await attendanceApi<AttendanceRecord[]>(user, `/records?userId=${encodeURIComponent(user.id)}`).catch(() => [])
        if (latestRows.some((item) => item.shiftRegistrationId === op.registrationId)) return drop()
        if (isSingleOpenSessionViolation(error)) {
          return quarantineAttendanceOutboxOp(op, 'Lượt check-in gửi lại bị từ chối vì còn một ca mở; không tự replay giờ cũ.')
        }
        if (isPermanentAttendanceReplayRejection(error)) {
          return quarantineAttendanceOutboxOp(op, `Máy chủ từ chối check-in đã lưu: ${error instanceof Error ? error.message : 'dữ liệu không hợp lệ.'}`)
        }
        throw error
      }
      return drop()
    }
    const existing = await verifyExistingCheckIn(user.id, op.registrationId)
    if (existing) return drop()
    if (await hasNewerOwnAttendanceRecord(user.id, op)) {
      return quarantineAttendanceOutboxOp(op, 'Đã có một ca chấm công mới hơn; lượt cũ không được tự gửi lại vì sẽ mở phiên sai thứ tự.')
    }
    const selfieUrl = await uploadSelfie(user, registrationRef, op.selfie, op.selfiePath || attendanceSelfiePath(user.id, op.branchId, op.registrationId, op.id))
    const { error } = await withAttendanceDeadline(
      async () => await supabase!.from('attendance_records').insert({
        id: createId(),
        user_id: user.id,
        branch_id: op.branchId,
        shift_registration_id: op.registrationId,
        check_in_time: op.capturedAt,
        selfie_url: selfieUrl,
        check_in_latitude: op.latitude,
        check_in_longitude: op.longitude,
        check_in_accuracy: op.accuracy,
        check_in_address: op.address,
      }),
      ATTENDANCE_DB_DEADLINE_MS,
      'Máy chủ chưa phản hồi khi gửi lại check-in.',
      408,
    )
    if (error) {
      if (isSingleOpenSessionViolation(error)) {
        return quarantineAttendanceOutboxOp(op, 'Lượt check-in gửi lại bị từ chối vì còn một ca mở; không tự replay giờ cũ.')
      }
      if (isDuplicateAttendanceWrite(error)) {
        // 23505 chỉ là idempotent khi read-back xác nhận ĐÚNG registration.
        // Không được xóa op chỉ vì một unique constraint bất kỳ bị vi phạm.
        const confirmed = await verifyExistingCheckIn(user.id, op.registrationId).catch(() => undefined)
        if (confirmed) return drop()
      }
      if (isPermanentAttendanceReplayRejection(error)) {
        return quarantineAttendanceOutboxOp(op, `Máy chủ từ chối check-in đã lưu: ${error.message || error.code || 'dữ liệu không hợp lệ.'}`)
      }
      throw error
    }
    return drop()
  }
  // check-out
  if (!op.recordId) {
    return quarantineAttendanceOutboxOp(op, 'Lượt check-out thiếu mã bản ghi cần đóng; giữ bằng chứng để quản lý rà soát.')
  }
  if (shouldUseAttendanceApi(user)) {
    const rows = await attendanceApi<AttendanceRecord[]>(user, `/records?userId=${encodeURIComponent(user.id)}`)
    const existing = rows.find((item) => item.id === op.recordId)
    if (!existing) {
      return quarantineAttendanceOutboxOp(op, 'Không còn tìm thấy bản ghi check-in cần đóng; giữ bằng chứng check-out để quản lý rà soát.')
    }
    if (existing.checkOutTime) return drop()
    const selfieUrl = await uploadSelfie(user, registrationRef, op.selfie, op.selfiePath || attendanceSelfiePath(user.id, op.branchId, op.registrationId, op.id))
    try {
      await attendanceApi(user, `/records/${op.recordId}`, {
        method: 'PATCH',
        body: JSON.stringify({
          replayedFromOutbox: true,
          checkOutTime: op.capturedAt,
          updatedAt: op.capturedAt,
          checkOutSelfieUrl: selfieUrl,
          checkOutLatitude: op.latitude,
          checkOutLongitude: op.longitude,
          checkOutAccuracy: op.accuracy,
          checkOutAddress: op.address,
        }),
      })
    } catch (error) {
      if (isPermanentAttendanceReplayRejection(error)) {
        return quarantineAttendanceOutboxOp(op, `Máy chủ từ chối check-out đã lưu: ${error instanceof Error ? error.message : 'dữ liệu không hợp lệ.'}`)
      }
      throw error
    }
    return drop()
  }
  const row = await fetchOwnAttendanceRow(user.id, op.recordId)
  if (!row) {
    return quarantineAttendanceOutboxOp(op, 'Không còn tìm thấy bản ghi check-in cần đóng; giữ bằng chứng check-out để quản lý rà soát.')
  }
  if (row.check_out_time) return drop()
  const selfieUrl = await uploadSelfie(user, registrationRef, op.selfie, op.selfiePath || attendanceSelfiePath(user.id, op.branchId, op.registrationId, op.id))
  const { data, error } = await withAttendanceDeadline(
    async () => await supabase!.from('attendance_records').update({
      check_out_time: op.capturedAt,
      check_out_selfie_url: selfieUrl,
      check_out_latitude: op.latitude,
      check_out_longitude: op.longitude,
      check_out_accuracy: op.accuracy,
      check_out_address: op.address,
      updated_at: op.capturedAt,
    })
      .eq('id', op.recordId)
      .eq('user_id', user.id)
      .is('check_out_time', null)
      .select('id, check_out_time')
      .maybeSingle(),
    ATTENDANCE_DB_DEADLINE_MS,
    'Máy chủ chưa phản hồi khi gửi lại check-out.',
    408,
  )
  if (error) {
    if (isPermanentAttendanceReplayRejection(error)) {
      return quarantineAttendanceOutboxOp(op, `Máy chủ từ chối check-out đã lưu: ${error.message || error.code || 'dữ liệu không hợp lệ.'}`)
    }
    throw error
  }
  if (!data?.check_out_time && !(await verifyCompletedCheckout(user.id, op.recordId))) {
    throw new Error('Máy chủ chưa xác nhận check-out gửi lại — sẽ thử tiếp ở nhịp sau.')
  }
  return drop()
}

async function fetchOwnAttendanceRow(userId: string, recordId: string) {
  const { data, error } = await supabase!
    .from('attendance_records')
    .select('id, check_out_time')
    .eq('id', recordId)
    .eq('user_id', userId)
    .maybeSingle()
  if (error) throw error
  return data as { id: string; check_out_time: string | null } | null
}

export function buildAttendanceReport(
  registrations: ShiftRegistration[],
  records: AttendanceRecord[],
  graceMinutesByShift: Map<string, number>,
  now = new Date(),
): AttendanceReportRow[] {
  const groups = new Map<string, AttendanceReportRow>()
  const matchedRecordIds = new Set<string>()
  for (const registration of registrations.filter((item) => item.status !== 'rejected')) {
    const key = `${registration.userId}|${registration.branchId}`
    const row = groups.get(key) || {
      userId: registration.userId,
      employeeName: registration.userName,
      branchId: registration.branchId,
      totalShifts: 0,
      totalHours: 0,
      overtimeHours: 0,
      workDays: 0,
      lateCount: 0,
      absentCount: 0,
      missingCheckoutCount: 0,
    }
    const record = findAttendanceRecordForRegistration(records, registration)
    const scheduledStart = localDateTime(registration.workDate, registration.startTime)
    const scheduledEnd = localDateTime(registration.workDate, registration.endTime, registration.endTime <= registration.startTime)
    if (!record && now > scheduledEnd) row.absentCount += 1
    if (record) {
      matchedRecordIds.add(record.id)
      row.totalShifts += 1
      const checkIn = new Date(record.checkInTime)
      const grace = graceMinutesByShift.get(registration.shiftId || '') ?? 5
      if (checkIn.getTime() > scheduledStart.getTime() + grace * 60000) row.lateCount += 1
      if (record.checkOutTime) {
        const workedHours = Math.max(0, (new Date(record.checkOutTime).getTime() - checkIn.getTime()) / 3600000)
        row.totalHours += workedHours
        if (isOvertimeRegistration(registration)) row.overtimeHours += workedHours
        row.workDays += workDayCredit(workedHours, scheduledStart, scheduledEnd)
      } else if (now > scheduledEnd) {
        row.missingCheckoutCount += 1
      }
    }
    groups.set(key, row)
  }
  for (const record of records) {
    if (matchedRecordIds.has(record.id)) continue
    const key = `${record.userId}|${record.branchId}`
    const row = groups.get(key) || {
      userId: record.userId,
      employeeName: record.userName,
      branchId: record.branchId,
      totalShifts: 0,
      totalHours: 0,
      overtimeHours: 0,
      workDays: 0,
      lateCount: 0,
      absentCount: 0,
      missingCheckoutCount: 0,
    }
    row.totalShifts += 1
    if (record.checkOutTime) {
      const workedHours = Math.max(0, (new Date(record.checkOutTime).getTime() - new Date(record.checkInTime).getTime()) / 3600000)
      row.totalHours += workedHours
      row.workDays += orphanWorkDayCredit(workedHours)
    } else {
      row.missingCheckoutCount += 1
    }
    groups.set(key, row)
  }
  return Array.from(groups.values()).map((row) => ({
    ...row,
    totalHours: Number(row.totalHours.toFixed(2)),
    overtimeHours: Number(row.overtimeHours.toFixed(2)),
    workDays: Number(row.workDays.toFixed(2)),
  })).sort((a, b) => a.employeeName.localeCompare(b.employeeName, 'vi'))
}

export function validateRegistration(input: Pick<ShiftRegistration, 'branchId' | 'workDate' | 'startTime' | 'endTime'>) {
  if (!input.branchId || !input.workDate || !input.startTime || !input.endTime) throw new Error('Vui lòng nhập đủ ngày, giờ và chi nhánh.')
  const start = localDateTime(input.workDate, input.startTime)
  const end = localDateTime(input.workDate, input.endTime, input.endTime <= input.startTime)
  const hours = (end.getTime() - start.getTime()) / 3600000
  if (hours <= 0 || hours > 18) throw new Error('Thời lượng ca phải lớn hơn 0 và không quá 18 giờ.')
}

function mapRegistration(row: any): ShiftRegistration {
  return {
    id: row.id,
    userId: row.user_id,
    userName: row.profiles?.full_name || 'Nhân viên',
    employmentType: row.employment_type || row.profiles?.employment_type || undefined,
    positionTitle: row.position_title || row.profiles?.position_title || undefined,
    branchId: row.branch_id,
    workDate: row.work_date,
    startTime: String(row.start_time).slice(0, 5),
    endTime: String(row.end_time).slice(0, 5),
    shiftId: row.shift_id || undefined,
    status: row.status,
    note: row.note || '',
    reviewedBy: row.reviewed_by || undefined,
    reviewedAt: row.reviewed_at || undefined,
    rejectionReason: row.rejection_reason || undefined,
    createdAt: row.created_at,
  }
}

function mapWorkShift(row: any): WorkShift | undefined {
  if (!row) return undefined
  return {
    id: row.id,
    branchId: row.branch_id,
    name: row.name,
    startTime: String(row.start_time).slice(0, 5),
    endTime: String(row.end_time).slice(0, 5),
    graceMinutes: row.grace_minutes,
    recommendedStaff: row.recommended_staff || 3,
    employmentTypes: row.employment_types || undefined,
    active: row.active,
  }
}

function isMissingRpcError(error: any) {
  const message = String(error?.message || error?.details || '')
  return error?.code === 'PGRST202'
    || /function .* does not exist|could not find.*function|schema cache/i.test(message)
}

function friendlyRegistrationError(error: any) {
  const message = String(error?.message || '')
  if (/duplicate key|unique constraint|shift_registrations_user_id_work_date_start_time_end_time/i.test(message)) {
    return new Error('Ca nay da co trong lich cua ban.')
  }
  if (/row-level security|violates row-level security|permission denied/i.test(message)) {
    return new Error('Chưa lưu được ca do quyền dữ liệu trên Supabase. Hãy chạy migration lịch làm mới rồi thử lại.')
  }
  return error instanceof Error ? error : new Error(message || 'Không thể đăng ký ca.')
}

function friendlyShiftSetupError(error: any) {
  const message = String(error?.message || error?.details || '')
  if (/duplicate key|unique constraint|shifts_branch_id_name_key/i.test(message)) {
    return new Error('Khung ca này đã tồn tại. Hãy đổi tên ca hoặc cập nhật lại khung ca cũ.')
  }
  if (/foreign key|violates foreign key|branches/i.test(message)) {
    return new Error('Chi nhánh này chưa được đồng bộ lên Supabase. Hãy lưu chi nhánh trong Trung tâm quản trị rồi thử lại.')
  }
  if (/row-level security|violates row-level security|permission denied/i.test(message)) {
    return new Error('Chưa xử lý được khung ca do quyền dữ liệu trên Supabase. Hãy chạy migration ca làm an toàn rồi thử lại.')
  }
  if (/not found|khong tim thay|không tìm thấy/i.test(message)) {
    return new Error('Không tìm thấy khung ca này hoặc ca đã bị xóa.')
  }
  return error instanceof Error ? error : new Error(message || 'Không thể xử lý khung ca.')
}

function mapAttendance(row: any): AttendanceRecord {
  return {
    id: row.id,
    userId: row.user_id,
    userName: row.profiles?.full_name || 'Nhân viên',
    branchId: row.branch_id,
    shiftRegistrationId: row.shift_registration_id,
    checkInTime: row.check_in_time,
    checkOutTime: row.check_out_time || undefined,
    selfieUrl: row.selfie_url,
    checkOutSelfieUrl: row.check_out_selfie_url || row.checkout_selfie_url || undefined,
    checkInLatitude: row.check_in_latitude === null || row.check_in_latitude === undefined ? undefined : Number(row.check_in_latitude),
    checkInLongitude: row.check_in_longitude === null || row.check_in_longitude === undefined ? undefined : Number(row.check_in_longitude),
    checkInAccuracy: row.check_in_accuracy === null || row.check_in_accuracy === undefined ? undefined : Number(row.check_in_accuracy),
    checkInAddress: row.check_in_address || undefined,
    checkOutLatitude: row.check_out_latitude === null || row.check_out_latitude === undefined ? undefined : Number(row.check_out_latitude),
    checkOutLongitude: row.check_out_longitude === null || row.check_out_longitude === undefined ? undefined : Number(row.check_out_longitude),
    checkOutAccuracy: row.check_out_accuracy === null || row.check_out_accuracy === undefined ? undefined : Number(row.check_out_accuracy),
    checkOutAddress: row.check_out_address || undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

/**
 * Giờ ca làm là giờ TẠI CHI NHÁNH (Việt Nam, +07:00 quanh năm), không phải giờ
 * thiết bị. Neo offset cố định để máy đặt sai múi giờ vẫn tính đúng cửa sổ
 * check-in/check-out. VN không có DST nên cộng thẳng 24h cho ca qua đêm.
 */
function localDateTime(date: string, time: string, nextDay = false) {
  const value = new Date(`${date}T${time}:00+07:00`)
  if (nextDay) return new Date(value.getTime() + 24 * 60 * 60 * 1000)
  return value
}

export function findAttendanceRecordForRegistration(records: AttendanceRecord[], registration: ShiftRegistration) {
  const exact = records.find((item) => item.shiftRegistrationId === registration.id)
  if (exact) return exact
  const startsAt = localDateTime(registration.workDate, registration.startTime)
  const endsAt = localDateTime(registration.workDate, registration.endTime, registration.endTime <= registration.startTime)
  const opensAt = new Date(startsAt.getTime() - 45 * 60000)
  const closesAt = new Date(endsAt.getTime() + 60 * 60000)
  return records.find((item) => {
    if (item.userId !== registration.userId || item.branchId !== registration.branchId) return false
    // Chỉ ghép theo khung giờ cho dữ liệu cũ chưa có mã đăng ký ca. Bản ghi
    // đã gắn với ca khác không được dùng lại cho ca tăng ca cùng ngày.
    if (item.shiftRegistrationId) return false
    const checkedAt = new Date(item.checkInTime)
    return checkedAt >= opensAt && checkedAt <= closesAt
  })
}

type ShiftWindowInput = Pick<ShiftRegistration, 'workDate' | 'startTime' | 'endTime'>

/**
 * Check-out đóng dấu giờ MÁY CHỦ LÚC BẤM, nên một bản ghi bỏ quên vẫn có thể bị
 * đóng nhiều ngày sau và ghi vào bảng công những ca 24h/96h/238h (BUG-113).
 * Sau khi ca kết thúc, check-out bằng giờ hiện tại chỉ còn hợp lệ trong 6 tiếng —
 * đủ cho ca kéo dài, dọn quầy hay điện thoại hết pin, nhưng không đủ để "sáng
 * hôm sau bấm bù". Quá hạn thì phải đi đường đơn chỉnh công có ghi lý do.
 */
export const CHECK_OUT_GRACE_MS = 6 * 60 * 60 * 1000
/** Chỉ nhắc check-out từ 15 phút trước giờ tan ca, không nhắc ngay sau khi check-in. */
export const CHECK_OUT_REMINDER_LEAD_MS = 15 * 60 * 1000

export function registrationEndAt(registration: ShiftWindowInput) {
  return localDateTime(registration.workDate, registration.endTime, registration.endTime <= registration.startTime)
}

export function checkOutDeadlineAt(registration: ShiftWindowInput) {
  return new Date(registrationEndAt(registration).getTime() + CHECK_OUT_GRACE_MS)
}

/** Đã quá hạn tự check-out: chỉ còn xử lý được bằng đơn chỉnh công. */
export function isCheckOutOverdue(registration: ShiftWindowInput, now = new Date()) {
  return now.getTime() > checkOutDeadlineAt(registration).getTime()
}

/** Đang trong khoảng đáng nhắc check-out (gần tan ca → trước khi quá hạn). */
export function isCheckOutDue(registration: ShiftWindowInput, now = new Date()) {
  const current = now.getTime()
  return current >= registrationEndAt(registration).getTime() - CHECK_OUT_REMINDER_LEAD_MS
    && current <= checkOutDeadlineAt(registration).getTime()
}

/** Đang trong khoảng đáng nhắc check-in (mở trước giờ vào 30 phút, hết khi tan ca). */
export function isCheckInDue(registration: ShiftWindowInput, now = new Date()) {
  const current = now.getTime()
  const startsAt = localDateTime(registration.workDate, registration.startTime).getTime()
  return current >= startsAt - 30 * 60000 && current <= registrationEndAt(registration).getTime()
}

export function isOvertimeRegistration(registration: Pick<ShiftRegistration, 'note'>) {
  const normalizedNote = (registration.note || '')
    .toLocaleLowerCase('vi')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
  return normalizedNote.includes('tang ca')
}

function blobToDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}

export interface AttendanceDetailRow {
  registrationId: string
  attendanceRecordId?: string
  userId: string
  employeeName: string
  branchId: string
  workDate: string
  scheduledStart: string
  scheduledEnd: string
  checkInTime?: string
  checkOutTime?: string
  checkOutSelfieUrl?: string
  totalHours: number
  isOvertime: boolean
  workDayCredit: number
  lateMinutes: number
  status: 'completed' | 'working' | 'absent' | 'scheduled'
  checkInAddress?: string
  checkInLatitude?: number
  checkInLongitude?: number
  checkOutAddress?: string
  checkOutLatitude?: number
  checkOutLongitude?: number
  selfieUrl?: string
  note: string
}

export function completedShiftLateMinutes(
  checkIn: Date | undefined,
  checkOut: Date | undefined,
  scheduledStart: Date,
  graceMinutes: number,
) {
  if (!checkIn || !checkOut) return 0
  return Math.max(0, Math.round((checkIn.getTime() - scheduledStart.getTime()) / 60000) - graceMinutes)
}

export function buildAttendanceDetailRows(
  registrations: ShiftRegistration[],
  records: AttendanceRecord[],
  graceMinutesByShift: Map<string, number>,
  adjustmentRequests: AttendanceAdjustmentRequest[] = [],
  now = new Date(),
): AttendanceDetailRow[] {
  const adjustmentNotes = buildAttendanceAdjustmentNoteMap(adjustmentRequests)
  const matchedRecordIds = new Set<string>()
  const rows = registrations.filter((item) => item.status !== 'rejected').map((registration) => {
    const record = findAttendanceRecordForRegistration(records, registration)
    if (record) matchedRecordIds.add(record.id)
    const scheduledStart = localDateTime(registration.workDate, registration.startTime)
    const scheduledEnd = localDateTime(registration.workDate, registration.endTime, registration.endTime <= registration.startTime)
    const checkIn = record ? new Date(record.checkInTime) : undefined
    const checkOut = record?.checkOutTime ? new Date(record.checkOutTime) : undefined
    const grace = graceMinutesByShift.get(registration.shiftId || '') ?? 5
    // Chỉ chốt một lượt đi trễ sau khi ca đã kết thúc. Trong lúc nhân viên vẫn
    // đang làm, bản ghi chưa hoàn chỉnh và không được đưa vào tổng/chi tiết trễ.
    const lateMinutes = completedShiftLateMinutes(checkIn, checkOut, scheduledStart, grace)
    const status: AttendanceDetailRow['status'] = record
      ? checkOut ? 'completed' : 'working'
      : now > scheduledEnd ? 'absent' : 'scheduled'
    return {
      registrationId: registration.id,
      attendanceRecordId: record?.id,
      userId: registration.userId,
      employeeName: registration.userName,
      branchId: registration.branchId,
      workDate: registration.workDate,
      scheduledStart: registration.startTime,
      scheduledEnd: registration.endTime,
      checkInTime: record?.checkInTime,
      checkOutTime: record?.checkOutTime,
      checkOutSelfieUrl: record?.checkOutSelfieUrl,
      totalHours: checkIn && checkOut ? Number(Math.max(0, (checkOut.getTime() - checkIn.getTime()) / 3600000).toFixed(2)) : 0,
      isOvertime: isOvertimeRegistration(registration),
      workDayCredit: checkIn && checkOut
        ? workDayCredit(Math.max(0, (checkOut.getTime() - checkIn.getTime()) / 3600000), scheduledStart, scheduledEnd)
        : 0,
      lateMinutes,
      status,
      checkInAddress: record?.checkInAddress,
      checkInLatitude: record?.checkInLatitude,
      checkInLongitude: record?.checkInLongitude,
      checkOutAddress: record?.checkOutAddress,
      checkOutLatitude: record?.checkOutLatitude,
      checkOutLongitude: record?.checkOutLongitude,
      selfieUrl: record?.selfieUrl,
      note: attendanceRowNote(
        registration.note,
        record?.checkOutAddress,
        adjustmentNotes.get(`${registration.userId}|${registration.branchId}|${registration.workDate}`),
      ),
    }
  })
  for (const record of records) {
    if (matchedRecordIds.has(record.id)) continue
    const checkIn = new Date(record.checkInTime)
    const checkOut = record.checkOutTime ? new Date(record.checkOutTime) : undefined
    const totalHours = checkOut ? Math.max(0, (checkOut.getTime() - checkIn.getTime()) / 3600000) : 0
    rows.push({
      registrationId: record.shiftRegistrationId || `record:${record.id}`,
      attendanceRecordId: record.id,
      userId: record.userId,
      employeeName: record.userName,
      branchId: record.branchId,
      workDate: localDateKey(checkIn),
      scheduledStart: localTimeKey(checkIn),
      scheduledEnd: checkOut ? localTimeKey(checkOut) : '',
      checkInTime: record.checkInTime,
      checkOutTime: record.checkOutTime,
      checkOutSelfieUrl: record.checkOutSelfieUrl,
      totalHours: Number(totalHours.toFixed(2)),
      isOvertime: false,
      workDayCredit: checkOut ? orphanWorkDayCredit(totalHours) : 0,
      lateMinutes: 0,
      status: checkOut ? 'completed' : 'working',
      checkInAddress: record.checkInAddress,
      checkInLatitude: record.checkInLatitude,
      checkInLongitude: record.checkInLongitude,
      checkOutAddress: record.checkOutAddress,
      checkOutLatitude: record.checkOutLatitude,
      checkOutLongitude: record.checkOutLongitude,
      selfieUrl: record.selfieUrl,
      note: attendanceRowNote(
        'Ca chấm công đã ghi nhận, chưa khớp lịch',
        record.checkOutAddress,
        adjustmentNotes.get(`${record.userId}|${record.branchId}|${localDateKey(checkIn)}`),
      ),
    })
  }
  return rows.sort((a, b) => b.workDate.localeCompare(a.workDate) || a.scheduledStart.localeCompare(b.scheduledStart))
}

/** Địa chỉ check-out mở đầu bằng tiền tố này = ca được đóng KHÔNG có ảnh/GPS. */
export const ADMIN_CLOSE_ADDRESS_PREFIX = '[CHỐT HÀNH CHÍNH]'

/**
 * Cột "Ghi chú" của Excel bảng công phải nói thẳng cho admin biết ca nào bị
 * quên check-out và được hệ thống/quản trị tự chốt — không bắt admin tự suy
 * từ cột địa chỉ.
 */
function attendanceRowNote(
  baseNote: string | undefined,
  checkOutAddress: string | undefined,
  adjustmentNote?: string,
) {
  const parts: string[] = []
  if (isAttendanceAutoClosedError(checkOutAddress)) {
    parts.push('QUÊN CHECK-OUT — hệ thống tự chốt theo giờ tan ca (không có ảnh/GPS lúc ra)')
  }
  if (baseNote) parts.push(baseNote)
  if (adjustmentNote) parts.push(adjustmentNote)
  return parts.join(' · ')
}

function scheduledHours(start: Date, end: Date) {
  return Math.max(0, (end.getTime() - start.getTime()) / 3600000)
}

function localTimeKey(date: Date) {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

function workDayCredit(workedHours: number, scheduledStart: Date, scheduledEnd: Date) {
  const plannedHours = scheduledHours(scheduledStart, scheduledEnd)
  if (!plannedHours || !workedHours) return 0
  return Number(Math.min(1, workedHours / plannedHours).toFixed(2))
}

function orphanWorkDayCredit(workedHours: number) {
  return Number(Math.min(1, workedHours / 8).toFixed(2))
}

/** Lỗi định vị có thông điệp thân thiện để UI hiển thị trực tiếp. */
export class AttendanceLocationError extends Error {}

/** Tiền tố tự khai khi máy không lấy được GPS — chấm công vẫn thành công, báo cáo thấy rõ. */
export const NO_GPS_ADDRESS_PREFIX = '[KHÔNG CÓ GPS]'
/** Tiền tố tự khai khi GPS có nhưng sai số vượt 150m (trong nhà/trung tâm thương mại). */
export const LOW_ACCURACY_ADDRESS_PREFIX = '[GPS SAI SỐ LỚN]'
const ATTENDANCE_TARGET_ACCURACY_METRES = 150

export interface AttendanceLocationEvidence {
  latitude: number | null
  longitude: number | null
  accuracy: number | null
  address: string
}

/**
 * BUG-121 — "chấm công không thành công": KHÔNG một tầng vị trí nào được phép
 * chặn chấm công nữa. Ảnh selfie đóng dấu là bằng chứng gốc; GPS/địa chỉ là bằng
 * chứng bổ sung, thiếu thì HẠ CẤP CÓ ĐÓNG DẤU (pattern "[CHỐT HÀNH CHÍNH]"):
 * - GPS tốt (≤150m): như cũ.
 * - GPS sai số lớn (>150m — đứng trong Lotte Mart rất hay gặp): vẫn ghi toạ độ,
 *   địa chỉ mang tiền tố "[GPS SAI SỐ LỚN] ±Xm" để quản lý biết độ tin cậy.
 * - Không lấy được GPS (WebView trong app khác, quyền bị chặn, hết 25s): toạ độ
 *   để trống, địa chỉ mang tiền tố "[KHÔNG CÓ GPS]" kèm lý do — đối chiếu bằng ảnh.
 */
export function finalizeAttendanceLocation(input: {
  latitude: number | null
  longitude: number | null
  accuracy: number | null
  address: string
  failureReason?: string
}): AttendanceLocationEvidence {
  if (input.latitude === null || input.longitude === null || input.accuracy === null) {
    const reason = (input.failureReason || 'không lấy được vị trí trên thiết bị này').trim().replace(/\.+$/, '')
    return {
      latitude: null,
      longitude: null,
      accuracy: null,
      address: `${NO_GPS_ADDRESS_PREFIX} Chấm công không kèm định vị (${reason}). Đối chiếu bằng ảnh chấm công.`,
    }
  }
  if (input.accuracy > ATTENDANCE_TARGET_ACCURACY_METRES) {
    return {
      latitude: input.latitude,
      longitude: input.longitude,
      accuracy: input.accuracy,
      address: `${LOW_ACCURACY_ADDRESS_PREFIX} ±${Math.round(input.accuracy)}m · ${input.address}`,
    }
  }
  return { latitude: input.latitude, longitude: input.longitude, accuracy: input.accuracy, address: input.address }
}

async function getAttendanceLocation(): Promise<AttendanceLocationEvidence> {
  if (!navigator.geolocation) {
    return finalizeAttendanceLocation({
      latitude: null, longitude: null, accuracy: null, address: '',
      failureReason: 'thiết bị/trình duyệt không hỗ trợ định vị',
    })
  }
  // Trên Android Chrome, khi hộp thoại xin quyền vị trí còn treo thì `timeout`
  // của getCurrentPosition không chạy, nên cần hạn chót riêng bọc ngoài.
  // Trong WebView của app khác, getCurrentPosition có thể KHÔNG gọi callback nào cả
  // (app chủ không cài onGeolocationPermissionsShowPrompt).
  const inAppBrowser = detectDeviceEnvironment().isInAppBrowser
  const position = await withAttendanceDeadline(
    () => getBestGeolocationPosition(),
    ATTENDANCE_LOCATION_DEADLINE_MS,
    inAppBrowser
      ? locationPermissionHelpText()
      : 'Quá 25 giây chưa lấy được vị trí. Hãy bật GPS/Vị trí của máy, cho phép trình duyệt truy cập vị trí (và bật "Vị trí chính xác"), ra gần cửa sổ rồi bấm lại.',
  ).catch((error: GeolocationPositionError | Error | null) => error)
  if (!position || !('coords' in position)) {
    const denied = position && 'code' in position && position.code === position.PERMISSION_DENIED
    // KHÔNG chặn chấm công (BUG-121): ghi rõ lý do thiếu GPS vào địa chỉ tự khai.
    return finalizeAttendanceLocation({
      latitude: null, longitude: null, accuracy: null, address: '',
      failureReason: denied
        ? (inAppBrowser ? 'trình duyệt trong app không được cấp quyền định vị' : 'quyền định vị đang bị chặn trên máy')
        : position instanceof Error && position.message
          ? position.message
          : 'không bắt được tín hiệu GPS trong 25 giây',
    })
  }
  const latitude = position.coords.latitude
  const longitude = position.coords.longitude
  const accuracy = position.coords.accuracy
  const address = resolveAttendanceAddress(
    await reverseGeocodeAttendanceWithRetry(latitude, longitude),
    latitude,
    longitude,
    accuracy,
  )
  return finalizeAttendanceLocation({ latitude, longitude, accuracy, address })
}

/** Tiền tố tự khai khi cả hai nguồn dịch địa chỉ cùng hỏng — nhìn báo cáo là biết ngay. */
export const UNRESOLVED_ADDRESS_PREFIX = '[CHƯA DỊCH ĐƯỢC ĐỊA CHỈ]'

/**
 * Địa chỉ chấm công: ưu tiên địa chỉ cụ thể từ bản đồ. Nhưng khi CẢ HAI nguồn
 * dịch địa chỉ (server + trình duyệt) cùng hỏng thì KHÔNG được chặn chấm công
 * (BUG-120): bằng chứng gốc là ảnh + toạ độ GPS + sai số — địa chỉ chỉ là bản
 * dịch cho dễ đọc. Lúc đó ghi toạ độ kèm tiền tố tự khai (đúng pattern
 * "[CHỐT HÀNH CHÍNH]" đã dùng): quản lý nhìn báo cáo biết ngay bản ghi này chưa
 * dịch được địa chỉ nhưng vẫn có đầy đủ vị trí thật để đối chiếu.
 */
export function resolveAttendanceAddress(
  value: string,
  latitude: number,
  longitude: number,
  accuracy: number,
) {
  const cleaned = value
    .replace(/\s*[·|-]\s*GPS\s*-?\d+(?:\.\d+)?,\s*-?\d+(?:\.\d+)?\s*$/i, '')
    .trim()
  if (isConcreteAttendanceAddress(cleaned)) return cleaned
  return `${UNRESOLVED_ADDRESS_PREFIX} GPS ${latitude.toFixed(6)}, ${longitude.toFixed(6)} (±${Math.round(accuracy)}m)`
}

/**
 * Kiểm tra nhanh khả năng lấy vị trí của máy — dùng cho thẻ "Kiểm tra thiết bị" ở màn chấm công.
 * Chạy ĐÚNG code của luồng chấm công thật để kết quả có giá trị chẩn đoán.
 */
export async function probeAttendanceLocation(): Promise<
  { ok: true; accuracy: number; address: string } | { ok: false; message: string }
> {
  try {
    const location = await getAttendanceLocation()
    // BUG-121: luồng chấm công thật không còn ném lỗi vị trí — nhưng thẻ kiểm tra
    // thiết bị vẫn phải CẢNH BÁO khi máy không lấy được GPS để nhân viên biết
    // bản ghi sẽ thiếu định vị (chấm công vẫn thành công).
    if (location.latitude === null || location.accuracy === null) {
      return { ok: false, message: location.address }
    }
    return { ok: true, accuracy: location.accuracy, address: location.address }
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error && error.message
        ? error.message
        : 'Không lấy được vị trí trên máy này.',
    }
  }
}

/** Hướng dẫn bật lại quyền vị trí theo đúng nền tảng của máy đang dùng. */
function locationPermissionHelpText() {
  const agent = typeof navigator === 'undefined' ? '' : navigator.userAgent || ''
  const environment = detectDeviceEnvironment()
  // WebView trong app (Zalo/Facebook…) không có đường bật lại quyền: hướng dẫn ổ khoá/Cài đặt
  // đều vô nghĩa ở đây, cách duy nhất là mở bằng trình duyệt thật.
  if (environment.isInAppBrowser) {
    const host = environment.hostAppName || 'ứng dụng đang mở'
    return `Bạn đang mở app trong ${host} nên trình duyệt không được cấp quyền định vị. Hãy mở https://gustino-operations.vercel.app bằng Chrome (Android) hoặc Safari (iPhone), đăng nhập lại rồi chấm công.`
  }
  if (/iPhone|iPad|iPod/i.test(agent)) {
    return 'Safari đang chặn quyền định vị cho website này. Vào Cài đặt → Quyền riêng tư & Bảo mật → Dịch vụ định vị → Safari Websites → Khi dùng ứng dụng, đồng thời bật Vị trí chính xác.'
  }
  if (/Android/i.test(agent)) {
    return 'Trình duyệt đang bị chặn quyền định vị. Bấm vào biểu tượng ổ khóa cạnh địa chỉ web → Quyền → bật Vị trí, đồng thời bật Vị trí (GPS) trong Cài đặt máy rồi tải lại trang.'
  }
  return 'Trình duyệt đang chặn quyền định vị cho website này. Hãy mở phần quyền của trang (biểu tượng ổ khóa cạnh địa chỉ web) và bật lại quyền Vị trí, sau đó tải lại trang.'
}

async function reverseGeocodeAttendanceWithRetry(latitude: number, longitude: number) {
  let address = ''
  for (let attempt = 1; attempt <= ATTENDANCE_GEOCODE_MAX_ATTEMPTS; attempt += 1) {
    try {
      // Retry is bounded and never substitutes coordinates for the required address.
      const response = await fetchWithTimeout(`/api/reverse-geocode?lat=${encodeURIComponent(latitude)}&lng=${encodeURIComponent(longitude)}`, 6500)
      if (response.ok) {
        const payload = await response.json()
        if (payload?.address) address = payload.address
      }
    } catch {}
    if (isConcreteAttendanceAddress(address)) return address
    if (attempt < ATTENDANCE_GEOCODE_MAX_ATTEMPTS) {
      await new Promise((resolve) => window.setTimeout(resolve, 250))
    }
  }
  return reverseGeocodeFromBrowser(latitude, longitude).catch(() => '')
}

async function getTrustedTimestamp() {
  try {
    const response = await fetchWithTimeout('/api/server-time', 3500, { cache: 'no-store' })
    if (response.ok) {
      const payload = await response.json()
      const value = new Date(payload?.now)
      if (Number.isFinite(value.getTime())) return value.toISOString()
    }
  } catch {
    // Offline/LAN cũ vẫn cho chấm công bằng đồng hồ thiết bị thay vì khóa người dùng.
  }
  return new Date().toISOString()
}

// fetch có timeout cứng: chấm công không được treo vì một request địa chỉ chậm.
async function fetchWithTimeout(input: string, timeoutMs: number, init?: RequestInit) {
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(input, { ...init, signal: controller.signal })
  } finally {
    window.clearTimeout(timer)
  }
}

async function reverseGeocodeFromBrowser(latitude: number, longitude: number) {
  const url = new URL('https://api.bigdatacloud.net/data/reverse-geocode-client')
  url.searchParams.set('latitude', String(latitude))
  url.searchParams.set('longitude', String(longitude))
  url.searchParams.set('localityLanguage', 'vi')
  const response = await fetchWithTimeout(url.toString(), 5000)
  if (!response.ok) throw new Error('Không lấy được địa chỉ.')
  const payload = await response.json()
  const parts = [
    payload.locality,
    payload.city,
    payload.principalSubdivision,
    payload.countryName,
  ].filter(Boolean)
  const uniqueParts = parts.filter((value, index) => parts.indexOf(value) === index)
  if (!uniqueParts.length) throw new Error('Không có địa chỉ.')
  return uniqueParts.join(', ')
}

function isCoordinateOnlyAddress(value: string) {
  return /^-?\d+(\.\d+)?,\s*-?\d+(\.\d+)?$/.test(value.trim())
}

function isConcreteAttendanceAddress(value: string) {
  const cleaned = value
    .replace(/\s*[·|-]\s*GPS\s*-?\d+(?:\.\d+)?,\s*-?\d+(?:\.\d+)?\s*$/i, '')
    .trim()
  return Boolean(cleaned)
    && !isCoordinateOnlyAddress(cleaned)
    && !/^(?:Vị trí GPS|GPS|Chưa lấy được địa chỉ)/i.test(cleaned)
}

function getBestGeolocationPosition() {
  const maximumAccuracyMetres = 150
  const targetAccuracyMetres = 35
  const attemptTimeouts = [10000, 7000]
  return (async () => {
    let best: GeolocationPosition | undefined
    let lastError: unknown
    for (const timeoutMs of attemptTimeouts) {
      try {
        // BUG-131: một số WebView không bao giờ gọi callback của getCurrentPosition
        // (kể cả option timeout) — hạn chót bao ngoài biến "treo" thành lỗi để rơi
        // xuống nhánh chấm công không GPS của BUG-121 thay vì đứng hình cả lượt.
        const position = await withAttendanceDeadline(
          () => requestFreshGeolocationPosition(timeoutMs),
          timeoutMs + 2000,
          'Máy không phản hồi yêu cầu định vị.',
        )
        if (!best || position.coords.accuracy < best.coords.accuracy) best = position
        if (best.coords.accuracy <= targetAccuracyMetres) break
      } catch (error) {
        lastError = error
        if (Number((error as GeolocationPositionError | undefined)?.code) === 1) break
      }
    }
    // BUG-121: sai số lớn KHÔNG chặn chấm công nữa — trả toạ độ tốt nhất lấy được,
    // finalizeAttendanceLocation sẽ đóng dấu "[GPS SAI SỐ LỚN] ±Xm" vào địa chỉ.
    // maximumAccuracyMetres chỉ còn là ngưỡng "đủ tốt để dừng lấy mẫu sớm".
    void maximumAccuracyMetres
    if (best) return best
    throw lastError || new AttendanceLocationError('Không lấy được GPS mới. Hãy kiểm tra quyền định vị và thử lại.')
  })()
}

function requestFreshGeolocationPosition(timeoutMs: number) {
  return new Promise<GeolocationPosition>((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(resolve, (error) => {
      if (error.code === error.PERMISSION_DENIED && typeof window !== 'undefined' && !window.isSecureContext) {
        reject(new AttendanceLocationError('Safari không cho link HTTP dùng định vị. Hãy mở đúng bản HTTPS để chấm công; bật định vị trong máy không thể bỏ qua giới hạn này.'))
        return
      }
      reject(error)
    }, {
      enableHighAccuracy: true,
      timeout: timeoutMs,
      maximumAge: 0,
    })
  })
}

async function stampAttendancePhoto(
  selfie: Blob,
  details: {
    actionLabel: string
    employeeName: string
    branchName: string
    timestamp: string
    address: string
    latitude: number | null
    longitude: number | null
    accuracy: number | null
    totalHoursLabel?: string
  },
) {
  // createImageBitmap()/image.decode() không có timeout và có thể treo vô hạn
  // với ảnh camera lớn trên máy Android yếu. `maxSize` bắt trình duyệt giải mã thẳng
  // về cỡ nhỏ: ảnh 50MP của máy Android phổ thông tốn ~200MB RAM nếu dựng full-res,
  // đủ để máy 4GB treo hoặc bị hệ điều hành giết giữa chừng (BUG-107).
  const decoded = await withAttendanceDeadline(
    () => decodeImageForCanvas(selfie, { maxSize: ATTENDANCE_PHOTO_DECODE_MAX_EDGE }),
    ATTENDANCE_PHOTO_DEADLINE_MS,
    'Máy đọc ảnh chấm công quá lâu. Hãy chụp lại ảnh (hoặc giảm độ phân giải camera) rồi thử lại.',
  )
  const maxWidth = 1280
  const scale = Math.min(1, maxWidth / decoded.width)
  const width = Math.round(decoded.width * scale)
  const height = Math.round(decoded.height * scale)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Không thể xử lý ảnh selfie.')
  context.drawImage(decoded.source, 0, 0, width, height)
  decoded.close()
  const panelHeight = Math.max(190, Math.round(height * .3))
  const gradient = context.createLinearGradient(0, height - panelHeight, 0, height)
  gradient.addColorStop(0, 'rgba(6,18,31,0)')
  gradient.addColorStop(.28, 'rgba(6,18,31,.72)')
  gradient.addColorStop(1, 'rgba(6,18,31,.94)')
  context.fillStyle = gradient
  context.fillRect(0, height - panelHeight, width, panelHeight)
  const padding = Math.max(18, Math.round(width * .025))
  const lines = [
    `${details.actionLabel} · ${details.employeeName}`,
    details.branchName,
    new Date(details.timestamp).toLocaleString('vi-VN', { hour12: false, timeZone: 'Asia/Bangkok' }),
    details.address,
    details.latitude !== null && details.longitude !== null && details.accuracy !== null
      ? `GPS ${details.latitude.toFixed(6)}, ${details.longitude.toFixed(6)} · sai số ±${Math.round(details.accuracy)}m`
      : 'GPS: máy không lấy được vị trí lúc chấm công',
    ...(details.totalHoursLabel ? [details.totalHoursLabel] : []),
  ]
  context.textBaseline = 'bottom'
  lines.forEach((line, index) => {
    context.font = `${index === 0 ? '700' : '500'} ${Math.max(16, Math.round(width * (index === 0 ? .025 : .018)))}px Arial`
    context.fillStyle = index === 0 ? '#d9f47d' : '#ffffff'
    context.fillText(fitCanvasText(context, line, width - padding * 2), padding, height - padding - (lines.length - 1 - index) * Math.max(24, Math.round(width * .027)))
  })
  // canvas.toBlob có thể không bao giờ gọi callback khi máy thiếu bộ nhớ.
  return withAttendanceDeadline(
    () => new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('Không thể lưu ảnh đã đóng dấu.')), 'image/jpeg', .9)
    }),
    ATTENDANCE_PHOTO_DEADLINE_MS,
    'Máy xử lý ảnh chấm công quá lâu (ảnh quá nặng hoặc máy thiếu bộ nhớ). Hãy đóng bớt ứng dụng, chụp lại ảnh rồi thử lại.',
  )
}

function fitCanvasText(context: CanvasRenderingContext2D, text: string, maxWidth: number) {
  if (context.measureText(text).width <= maxWidth) return text
  let value = text
  while (value.length > 12 && context.measureText(`${value}…`).width > maxWidth) value = value.slice(0, -1)
  return `${value}…`
}
