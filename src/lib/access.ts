import type { Role } from '../types'
import { getLang, T, type Lang } from './i18n'

export const OPERATION_ROLES: Role[] = ['shift_leader']
export const MANAGEMENT_ROLES: Role[] = ['admin', 'manager']
export const KITCHEN_ROLES: Role[] = ['admin', 'kitchen']

export function canUseAdmin(role: Role) {
  return role === 'admin'
}

export function canUseSales(role: Role) {
  return ['shift_leader', 'staff', 'cashier'].includes(role)
}

export function canUseOperations(role: Role) {
  return OPERATION_ROLES.includes(role)
}

export function canUseManagement(role: Role) {
  return MANAGEMENT_ROLES.includes(role)
}

export function canUseKitchen(role: Role) {
  return KITCHEN_ROLES.includes(role)
}

// SUP MT (giám sát) + admin: được XEM bảng lương/bảng công của mọi người để đối chiếu
// và trả lời phản hồi về kế toán. SUP MT không sửa được lương — chỉ admin sửa.
export function canReviewPayroll(role: Role) {
  return role === 'admin' || role === 'supmt'
}

// Trang Quản trị (#/admin/*): admin vừa xem vừa thao tác, SUP MT chỉ xem.
// SUP MT (Supervisor Market Trade) giám sát doanh thu/doanh số/lịch ca/chấm công
// của TOÀN hệ thống nên nhìn thấy đúng những gì admin nhìn thấy.
export const ADMIN_CONSOLE_ROLES: Role[] = ['admin', 'supmt']

export function canOpenAdminConsole(role: Role) {
  return ADMIN_CONSOLE_ROLES.includes(role)
}

/**
 * Vai trò CHỈ ĐỌC trong trang Quản trị.
 *
 * Dùng để ẩn mọi nút/biểu mẫu ghi dữ liệu (chỉnh công, xóa ca, tạo tài khoản,
 * đổi vai trò, đặt lại mật khẩu, tạo/xóa chi nhánh…). Đây là lớp chặn giao diện;
 * lớp chặn thật nằm ở RLS — `supmt` không có mặt trong bất kỳ policy ghi nào
 * ngoài chấm công/đăng ký ca của CHÍNH họ (xem `20260808_supmt_readonly_access.sql`).
 */
export function isReadOnlyConsoleRole(role: Role) {
  return role === 'supmt'
}

// Vai trò giám sát toàn hệ thống: không gắn chi nhánh, đọc dữ liệu mọi chi nhánh.
export function hasSystemWideScope(role: Role) {
  return role === 'admin' || role === 'supmt'
}

// Vai trò không gắn một chi nhánh cố định. Phải khớp `branchlessRole` trong
// edge function `manage-employee` — lệch nhau là tạo tài khoản lỗi ràng buộc.
export function isBranchlessRole(role: Role) {
  return role === 'manager' || role === 'kitchen' || role === 'supmt'
}

export function canSwitchWorkingBranch(user?: { role: Role; canRoamBranches?: boolean; name?: string; email?: string }) {
  return Boolean(user?.canRoamBranches) || isRoamingStaffIdentity(user)
}

export function isRoamingStaffIdentity(input?: {
  canRoamBranches?: boolean | null
  name?: string | null
  full_name?: string | null
  email?: string | null
} | null) {
  if (!input) return false
  if (input.canRoamBranches) return true
  const raw = `${input.name || ''} ${input.full_name || ''} ${input.email || ''}`
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/gi, 'd')
    .toLowerCase()
  return raw.includes('thao vy') || raw.includes('thaovy')
}

export function normalizeRole(role: Role): Role {
  return role
}

// Vị trí nhân viên cho bảng công/Excel: ưu tiên positionTitle (Ca trưởng/Ca phó/Full-time/Part-time),
// fallback theo employmentType, cuối cùng theo role.
export function employeePositionLabel(employee?: { positionTitle?: string; employmentType?: string; role?: string }) {
  const title = employee?.positionTitle?.trim()
  if (title) return title
  const type = employee?.employmentType
  if (type === 'leader') return 'Ca trưởng'
  if (type === 'full_time') return 'Full-time'
  if (type === 'part_time') return 'Part-time'
  return employee?.role === 'shift_leader' ? 'Ca trưởng' : 'Nhân viên'
}

export function displayUserName(user: { name: string }) {
  const trimmed = user.name.trim()
  return trimmed
}

export function roleLabel(role: Role, lang: Lang = getLang()) {
  if (lang === 'en') {
    return {
      admin: 'System Admin',
      manager: 'Manager',
      supmt: 'Supervisor (SUP MT)',
      shift_leader: 'Shift Leader',
      staff: 'Staff',
      cashier: 'POS Cashier',
      kitchen: 'Kitchen',
    }[role]
  }
  const tx = T[lang]
  return {
    admin: tx.roleAdmin,
    manager: tx.roleManager,
    supmt: 'Giám sát (SUP MT)',
    shift_leader: tx.roleShiftLeader,
    staff: tx.roleStaff,
    cashier: 'Thu ngân POS',
    kitchen: tx.roleKitchen,
  }[role]
}
