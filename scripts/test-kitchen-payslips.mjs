import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

// Bếp (role = 'kitchen') không gán chi nhánh nhưng vẫn phải có phiếu lương.
const page = readFileSync(new URL('../src/pages/PayrollPage.tsx', import.meta.url), 'utf8')
const payroll = readFileSync(new URL('../src/lib/payroll.ts', import.meta.url), 'utf8')
const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8')
const sql = readFileSync(new URL('../supabase/migrations/20261109_kitchen_payslips.sql', import.meta.url), 'utf8')

assert.match(payroll, /PAYSLIP_EMPLOYEE_ROLES: Role\[\] = \['shift_leader', 'staff', 'cashier', 'kitchen'\]/)
assert.match(payroll, /KITCHEN_PAYROLL_BRANCH = \{ id: 'central-kitchen', name: 'Bếp trung tâm' \}/)
assert.match(payroll, /employee\.role === 'kitchen' \? KITCHEN_PAYROLL_BRANCH\.id : employee\.branchId \|\| ''/)
assert.doesNotMatch(page, /Boolean\(employee\.branchId\) && PAYROLL_ROLES/, 'Không được lọc bỏ nhân viên không có chi nhánh (bếp).')
assert.match(page, /canReceivePayslip\(employee\.role\) && Boolean\(payrollBranchId\(employee\)\)/)
assert.match(page, /\{ id: KITCHEN_PAYROLL_BRANCH\.id, name: KITCHEN_PAYROLL_BRANCH\.name \}/, 'Danh sách phải có nhóm Bếp trung tâm.')
assert.match(page, /fetchPayrollEntries\(user, period, payrollBranchIds\)/, 'Phải tải phiếu lương đã lưu của bếp.')
assert.match(page, /employee\.role !== 'kitchen'/, 'Không tính KPI quầy cho bếp.')
assert.match(page, /useMemo\(\(\) => permittedBranchIds\(user\), \[user, branches\]\)/, 'Phải tính lại danh sách chi nhánh khi branches từ cloud tải về.')
assert.match(app, /if \(page === 'my-payslips'\) return canReceivePayslip\(user\.role\)/)
assert.match(sql, /role::text in \('staff', 'shift_leader', 'cashier', 'kitchen'\)/)
console.log('KITCHEN_PAYSLIPS_OK')
