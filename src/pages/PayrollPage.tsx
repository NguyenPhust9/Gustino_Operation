import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from 'react'
import { buildAttendanceReport, fetchAttendanceRecords, fetchEmployees, fetchShiftRegistrations, permittedBranchIds } from '../lib/attendance'
import { useConfiguredBranches } from '../lib/branches'
import { calculatePersonalKpiReward } from '../lib/commission'
import { fetchBagAllocations } from '../lib/shiftLedger'
import { fetchSalesReceiptsRange } from '../lib/salesReceipts'
import { canReceivePayslip, deletePayrollEntry, revokePayrollEntry, fetchPayrollEntries, fetchPayrollFixedConfigs, KITCHEN_PAYROLL_BRANCH, payrollBranchId, publishPayrollEntries, upsertPayrollEntry, type PayrollEntry, type PayrollFixedConfig } from '../lib/payroll'
import { employeePositionLabel } from '../lib/access'
import { localDateKey } from '../lib/dates'
import type { AppUser, EmployeeProfile } from '../types'

type MoneyField = 'baseSalary' | 'responsibilityAllowance' | 'attendanceAllowance' | 'mealTransportAllowance'
  | 'agreedSalary' | 'dailyRate' | 'workdaySalary' | 'kpiBonus' | 'netSalary'
type Draft = Record<MoneyField | 'overtimeHours', string> & { note: string }

const EMPTY_DRAFT: Draft = {
  baseSalary: '', responsibilityAllowance: '', attendanceAllowance: '', mealTransportAllowance: '',
  agreedSalary: '', dailyRate: '', workdaySalary: '', overtimeHours: '', kpiBonus: '', netSalary: '', note: '',
}

export function PayrollPage({ user }: { user: AppUser }) {
  const branches = useConfiguredBranches({ user })
  const [period, setPeriod] = useState(() => localDateKey().slice(0, 7))
  const [branchId, setBranchId] = useState('')
  const [search, setSearch] = useState('')
  const [employees, setEmployees] = useState<EmployeeProfile[]>([])
  const [entries, setEntries] = useState<PayrollEntry[]>([])
  const [configs, setConfigs] = useState<PayrollFixedConfig[]>([])
  const [attendanceRows, setAttendanceRows] = useState<ReturnType<typeof buildAttendanceReport>>([])
  const [kpiByEmployee, setKpiByEmployee] = useState<Record<string, number>>({})
  const [selectedId, setSelectedId] = useState('')
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [removing, setRemoving] = useState(false)
  const [error, setError] = useState('')
  const [feedback, setFeedback] = useState('')

  const allowedBranchIds = useMemo(() => permittedBranchIds(user), [user, branches])
  // Bếp không thuộc chi nhánh nào → thêm nhóm "Bếp trung tâm" để phiếu lương của bếp không bị sót.
  const payrollBranchIds = useMemo(() => Array.from(new Set([...allowedBranchIds, KITCHEN_PAYROLL_BRANCH.id])), [allowedBranchIds])
  const visibleBranches = [...branches.filter((branch) => allowedBranchIds.includes(branch.id) && branch.id !== KITCHEN_PAYROLL_BRANCH.id), { id: KITCHEN_PAYROLL_BRANCH.id, name: KITCHEN_PAYROLL_BRANCH.name }]
  const monthFrom = `${period}-01`
  const monthTo = lastDayOfMonth(period)

  useEffect(() => {
    let active = true
    setLoading(true)
    setError('')
    Promise.all([
      fetchEmployees(user, { includeInactive: false }),
      fetchShiftRegistrations(user, { from: monthFrom, to: monthTo }),
      fetchAttendanceRecords(user, { from: monthFrom, to: monthTo }),
      fetchPayrollEntries(user, period, payrollBranchIds),
      fetchPayrollFixedConfigs(user, payrollBranchIds),
      Promise.all(allowedBranchIds.map((id) => fetchBagAllocations(user, { branchId: id }))).then((rows) => rows.flat()),
      fetchSalesReceiptsRange(user, { branchIds: allowedBranchIds, from: monthFrom, to: monthTo }),
    ]).then(([nextEmployees, registrations, records, nextEntries, nextConfigs, allocations, receipts]) => {
      if (!active) return
      const report = buildAttendanceReport(registrations, records, new Map())
      const payrollEmployees = nextEmployees
        .filter((employee) => employee.active !== false && canReceivePayslip(employee.role) && Boolean(payrollBranchId(employee)))
        .map((employee) => ({ ...employee, branchId: payrollBranchId(employee) }))
      // KPI cá nhân tính từ doanh số quầy, không áp dụng cho bếp.
      const rewards = Object.fromEntries(payrollEmployees.filter((employee) => employee.role !== 'kitchen').map((employee) => [employee.id, calculatePersonalKpiReward({
        id: employee.id,
        name: employee.name,
        role: employee.role,
        branchId: employee.branchId || '',
        employmentType: employee.employmentType,
        positionTitle: employee.positionTitle,
      }, allocations, receipts, monthFrom, monthTo).reward]))
      setEmployees(payrollEmployees)
      setAttendanceRows(report)
      setEntries(nextEntries)
      setConfigs(nextConfigs)
      setKpiByEmployee(rewards)
      setLoading(false)
    }).catch((reason) => {
      if (!active) return
      setError(reason instanceof Error ? reason.message : 'Không thể tải dữ liệu phiếu lương.')
      setLoading(false)
    })
    return () => { active = false }
  }, [user.id, period, allowedBranchIds.join('|')])

  const allRows = useMemo(() => employees
    .map((employee) => ({
      ...buildPayslipRow(employee, entries, configs, attendanceRows, kpiByEmployee),
      branchName: employee.branchId === KITCHEN_PAYROLL_BRANCH.id ? KITCHEN_PAYROLL_BRANCH.name : branches.find((branch) => branch.id === employee.branchId)?.name || employee.branchId || 'Chưa gán chi nhánh',
    }))
    .sort((a, b) => a.branchId.localeCompare(b.branchId) || a.employeeName.localeCompare(b.employeeName, 'vi')), [employees, entries, configs, attendanceRows, kpiByEmployee, branches])
  const rows = useMemo(() => {
    const query = normalizeName(search)
    return allRows.filter((row) => (!branchId || row.branchId === branchId) && (!query || normalizeName(`${row.employeeName} ${row.positionTitle} ${row.branchName}`).includes(query)))
  }, [allRows, branchId, search])
  const selected = allRows.find((row) => row.employeeId === selectedId)
  const selectedSet = new Set(selectedIds)

  function openDetail(employeeId: string) {
    const row = allRows.find((item) => item.employeeId === employeeId)
    if (!row) return
    setSelectedId(employeeId)
    setDraft({
      baseSalary: moneyInput(row.values.baseSalary),
      responsibilityAllowance: moneyInput(row.values.responsibilityAllowance),
      attendanceAllowance: moneyInput(row.values.attendanceAllowance),
      mealTransportAllowance: moneyInput(row.values.mealTransportAllowance),
      agreedSalary: moneyInput(row.values.agreedSalary),
      dailyRate: moneyInput(row.values.dailyRate),
      workdaySalary: moneyInput(row.values.workdaySalary),
      overtimeHours: decimalInput(row.values.overtimeHours),
      kpiBonus: moneyInput(row.values.kpiBonus),
      netSalary: moneyInput(row.values.netSalary),
      note: row.entry?.note || '',
    })
    setFeedback('')
    setError('')
  }

  function toggleSelected(employeeId: string) {
    setSelectedIds((current) => current.includes(employeeId) ? current.filter((id) => id !== employeeId) : [...current, employeeId])
  }

  function selectAllVisible() {
    setSelectedIds((current) => Array.from(new Set([...current, ...rows.map((row) => row.employeeId)])))
  }

  async function publishSelected() {
    const selectedRows = allRows.filter((row) => selectedSet.has(row.employeeId))
    if (!selectedRows.length) return
    setPublishing(true)
    setError('')
    setFeedback('')
    try {
      const published = await publishPayrollEntries(user, selectedRows.map((row) => ({
        employeeId: row.employeeId,
        branchId: row.branchId,
        period,
        baseSalary: row.values.baseSalary,
        responsibilityAllowance: row.values.responsibilityAllowance,
        attendanceAllowance: row.values.attendanceAllowance,
        mealTransportAllowance: row.values.mealTransportAllowance,
        agreedSalary: row.values.agreedSalary,
        dailyRate: row.values.dailyRate,
        workdaySalary: row.values.workdaySalary,
        overtimeHours: row.values.overtimeHours,
        kpiBonus: row.values.kpiBonus,
        netSalary: row.values.netSalary,
        note: row.entry?.note || '',
      })))
      const publishedIds = new Set(published.map((entry) => entry.employeeId))
      setEntries((current) => [...current.filter((entry) => !publishedIds.has(entry.employeeId)), ...published])
      setFeedback(`Đã gửi phiếu lương cho ${published.length} nhân viên.`)
      setSelectedIds([])
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Không thể gửi phiếu lương.')
    } finally {
      setPublishing(false)
    }
  }

  async function saveDetail() {
    if (!selected) return
    setSaving(true)
    setError('')
    setFeedback('')
    try {
      const value = (key: keyof Draft) => draft[key].trim() === '' ? null : Number(draft[key])
      const next: PayrollEntry = {
        id: selected.entry?.id,
        publishedAt: selected.entry?.publishedAt,
        employeeViewedAt: selected.entry?.employeeViewedAt,
        employeeId: selected.employeeId,
        branchId: selected.branchId,
        period,
        baseSalary: value('baseSalary'),
        responsibilityAllowance: value('responsibilityAllowance'),
        attendanceAllowance: value('attendanceAllowance'),
        mealTransportAllowance: value('mealTransportAllowance'),
        agreedSalary: value('agreedSalary'),
        dailyRate: value('dailyRate'),
        workdaySalary: value('workdaySalary'),
        overtimeHours: value('overtimeHours'),
        kpiBonus: value('kpiBonus'),
        netSalary: value('netSalary'),
        note: draft.note.trim(),
      }
      const saved = await upsertPayrollEntry(user, next)
      setEntries((current) => [...current.filter((entry) => entry.employeeId !== next.employeeId), saved])
      setFeedback('Đã lưu phiếu lương theo tháng.')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : (reason as { message?: string } | null)?.message || 'Không thể lưu phiếu lương.')
    } finally {
      setSaving(false)
    }
  }

  async function removeDetail(action: 'revoke' | 'delete') {
    if (!selected?.entry?.id || removing || saving || publishing) return
    const entryId = selected.entry.id
    const employeeId = selected.employeeId
    const message = action === 'revoke'
      ? `Thu hồi phiếu lương của ${selected.employeeName} tháng ${period}? Nhân viên sẽ không còn xem được phiếu; dữ liệu được giữ để chỉnh sửa và gửi lại.`
      : `Xóa vĩnh viễn phiếu lương của ${selected.employeeName} tháng ${period}? Các giá trị đã lưu và ghi chú của phiếu sẽ bị xóa. Dữ liệu chấm công, KPI và cấu hình lương vẫn được giữ.`
    if (!window.confirm(message)) return
    setRemoving(true)
    setError('')
    setFeedback('')
    try {
      if (action === 'revoke') {
        const next = await revokePayrollEntry(user, entryId)
        setEntries((current) => current.map((entry) => entry.id === entryId ? next : entry))
        setFeedback('Đã thu hồi phiếu lương. Có thể chỉnh sửa và gửi lại.')
      } else {
        await deletePayrollEntry(user, entryId)
        setEntries((current) => current.filter((entry) => entry.id !== entryId))
        setSelectedIds((current) => current.filter((id) => id !== employeeId))
        setFeedback('Đã xóa phiếu lương đã lưu của tháng này.')
      }
      setSelectedId('')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Không thể thu hồi hoặc xóa phiếu lương.')
    } finally {
      setRemoving(false)
    }
  }

  if (user.role !== 'admin') return null

  return <section className="payslip-page">
    <header className="payslip-header">
      <div><span className="eyebrow dark">NHÂN SỰ · TIỀN LƯƠNG</span><h1>Phiếu lương</h1><p>Danh sách nhân viên theo chi nhánh và kỳ lương.</p></div>
      <div className="payslip-filters">
        <label>Tháng<input type="month" value={period} onChange={(event) => { if (event.target.value) setPeriod(event.target.value); setSelectedId(''); setSelectedIds([]) }} /></label>
        <label>Chi nhánh<select value={branchId} onChange={(event) => { setBranchId(event.target.value); setSelectedId('') }}><option value="">Tất cả chi nhánh</option>{visibleBranches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></label>
      </div>
    </header>
    {!selected && error && <p className="error-banner" role="alert">{error}</p>}
    {!selected && feedback && <p className="success-banner" role="status">{feedback}</p>}
    <div className="payslip-toolbar">
      <label className="payslip-search"><span aria-hidden="true">⌕</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Tìm kiếm" aria-label="Tìm nhân viên" /></label>
      <span className="payslip-selected-count">Đã chọn <b>{selectedIds.length}</b></span>
      <button type="button" className="payslip-link-action" disabled={!selectedIds.length} onClick={() => setSelectedIds([])}>Bỏ chọn</button>
      <button type="button" className="payslip-link-action" disabled={!rows.length} onClick={selectAllVisible}>Chọn tất cả trên DS</button>
      <button type="button" className="payslip-send-button" disabled={!selectedIds.length || publishing || saving || removing || loading} onClick={() => void publishSelected()}><span aria-hidden="true">✈</span>{publishing ? 'Đang gửi…' : 'Gửi phiếu lương'}</button>
    </div>
    {loading ? <p className="empty-copy">Đang tải phiếu lương…</p> : <div className="payslip-branch-list">
      {visibleBranches.filter((branch) => !branchId || branch.id === branchId).map((branch) => {
        const branchRows = rows.filter((row) => row.branchId === branch.id)
        return <article className="payslip-branch" key={branch.id}>
          <div className="payslip-branch-title"><label className="payslip-check-all"><input type="checkbox" checked={branchRows.length > 0 && branchRows.every((row) => selectedSet.has(row.employeeId))} onChange={() => {
            const ids = branchRows.map((row) => row.employeeId)
            const allChecked = ids.length > 0 && ids.every((id) => selectedSet.has(id))
            setSelectedIds((current) => allChecked ? current.filter((id) => !ids.includes(id)) : Array.from(new Set([...current, ...ids])))
          }} aria-label={`Chọn tất cả nhân viên ${branch.name}`} /><strong>{branch.name}</strong></label><span>{branchRows.length} nhân viên</span></div>
          <div className="payslip-employee-list">{branchRows.map((row) => <div className="payslip-employee" key={row.employeeId}>
            <input className="payslip-row-check" type="checkbox" checked={selectedSet.has(row.employeeId)} onChange={() => toggleSelected(row.employeeId)} aria-label={`Chọn ${row.employeeName}`} />
            <span><strong>{row.employeeName}</strong><small>{row.positionTitle}</small></span>
            <span className="payslip-net-preview"><small>{row.entry?.publishedAt ? 'Đã gửi' : 'Lương thực lãnh'}</small><b>{row.values.netSalary === null ? 'Chưa nhập' : formatMoney(row.values.netSalary)}</b></span>
            <button type="button" onClick={() => openDetail(row.employeeId)}>Xem chi tiết</button>
          </div>)}</div>
          {!branchRows.length && <p className="empty-copy">Chưa có nhân viên trong chi nhánh này.</p>}
        </article>
      })}
    </div>}

    {selected && <div className="payslip-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) setSelectedId('') }}>
      <section className="payslip-detail" role="dialog" aria-modal="true" aria-labelledby="payslip-detail-title">
        <header><div><span>PHIẾU LƯƠNG · {period}</span><h2 id="payslip-detail-title">{selected.employeeName}</h2><p>{selected.branchName} · {selected.positionTitle}</p></div><button type="button" className="payslip-close" aria-label="Đóng" onClick={() => setSelectedId('')}>×</button></header>
        <p className="payslip-source-note">Dữ liệu có sẵn được lấy từ cấu hình lương, chấm công và KPI. Ô chưa có dữ liệu để Admin nhập sẽ được lưu riêng theo nhân viên và tháng.</p>
        <div className="payslip-supporting"><span>Ngày công trong kỳ <b>{formatNumber(selected.workDays)}</b></span><span>Tổng giờ công <b>{formatNumber(selected.totalHours)}</b></span></div>
        <div className="payslip-field-grid">
          <MoneyInput label="Lương cơ bản" field="baseSalary" draft={draft} setDraft={setDraft} fromSystem={selected.sources.baseSalary} />
          <MoneyInput label="Phụ cấp trách nhiệm" field="responsibilityAllowance" draft={draft} setDraft={setDraft} fromSystem={selected.sources.responsibilityAllowance} />
          <MoneyInput label="Phụ cấp chuyên cần" field="attendanceAllowance" draft={draft} setDraft={setDraft} fromSystem={selected.sources.attendanceAllowance} />
          <MoneyInput label="Phụ cấp cơm và xăng xe" field="mealTransportAllowance" draft={draft} setDraft={setDraft} fromSystem={selected.sources.mealTransportAllowance} />
          <MoneyInput label="Lương thỏa thuận" field="agreedSalary" draft={draft} setDraft={setDraft} />
          <MoneyInput label="Lương 1 ngày công" field="dailyRate" draft={draft} setDraft={setDraft} />
          <MoneyInput label="Lương theo ngày công tính lương" field="workdaySalary" draft={draft} setDraft={setDraft} />
          <label className="payslip-input">Số giờ làm thêm <span>{selected.sources.overtimeHours ? 'Từ chấm công · Admin có thể sửa' : 'Admin nhập'}</span><input type="number" min="0" step="0.01" value={draft.overtimeHours} onChange={(event) => setDraft((value) => ({ ...value, overtimeHours: cleanDecimal(event.target.value) }))} placeholder="Chưa có dữ liệu" /></label>
          <MoneyInput label="Thưởng KPI" field="kpiBonus" draft={draft} setDraft={setDraft} fromSystem={selected.sources.kpiBonus} />
          <MoneyInput label="Lương thực lãnh" field="netSalary" draft={draft} setDraft={setDraft} prominent />
          <label className="payslip-input payslip-note">Ghi chú<textarea value={draft.note} onChange={(event) => setDraft((value) => ({ ...value, note: event.target.value }))} placeholder="Ghi chú cho kỳ lương này" /></label>
        </div>
        <footer>
          {error && <p className="error-banner payslip-detail-feedback" role="alert">{error}</p>}
          {feedback && <p className="success-banner payslip-detail-feedback" role="status">{feedback}</p>}
          {selected.entry?.publishedAt && <button type="button" className="secondary-button" disabled={saving || publishing || removing} onClick={() => void removeDetail('revoke')}>Thu hồi phiếu lương</button>}
          {selected.entry?.id && <button type="button" className="secondary-button" disabled={saving || publishing || removing} onClick={() => void removeDetail('delete')}>Xóa phiếu lương</button>}
          <button type="button" className="secondary-button" onClick={() => setSelectedId('')}>Đóng</button>
          <button type="button" className="primary-button" disabled={saving || publishing || removing} onClick={() => void saveDetail()}>{saving ? 'Đang lưu…' : 'Lưu phiếu lương'}</button>
        </footer>
      </section>
    </div>}
  </section>
}

function MoneyInput({ label, field, draft, setDraft, fromSystem = false, prominent = false }: { label: string; field: MoneyField; draft: Draft; setDraft: Dispatch<SetStateAction<Draft>>; fromSystem?: boolean; prominent?: boolean }) {
  return <label className={`payslip-input${prominent ? ' prominent' : ''}`}>{label}<span>{fromSystem ? 'Từ hệ thống · Admin có thể sửa' : 'Admin nhập'}</span><input inputMode="numeric" value={draft[field]} onChange={(event) => setDraft((value) => ({ ...value, [field]: cleanMoney(event.target.value) }))} placeholder="Chưa có dữ liệu" /></label>
}

function buildPayslipRow(employee: EmployeeProfile, entries: PayrollEntry[], configs: PayrollFixedConfig[], attendanceRows: ReturnType<typeof buildAttendanceReport>, kpiByEmployee: Record<string, number>) {
  const entry = entries.find((item) => item.employeeId === employee.id)
  const config = bestConfig(employee, configs)
  const attendance = attendanceRows.find((row) => row.userId === employee.id || (row.branchId === employee.branchId && normalizeName(row.employeeName) === normalizeName(employee.name)))
  const configValue = (entryValue: number | null | undefined, configured: number | undefined) => entryValue ?? (configured && configured > 0 ? configured : null)
  return {
    employeeId: employee.id,
    employeeName: employee.name,
    branchId: employee.branchId || '',
    branchName: '',
    positionTitle: employeePositionLabel(employee),
    workDays: attendance?.workDays || 0,
    totalHours: attendance?.totalHours || 0,
    entry,
    values: {
      baseSalary: configValue(entry?.baseSalary, config?.baseSalary),
      responsibilityAllowance: configValue(entry?.responsibilityAllowance, config?.responsibilityAllowance),
      attendanceAllowance: configValue(entry?.attendanceAllowance, config?.attendanceAllowance),
      mealTransportAllowance: configValue(entry?.mealTransportAllowance, config?.mealTransportAllowance),
      agreedSalary: entry?.agreedSalary ?? null,
      dailyRate: entry?.dailyRate ?? null,
      workdaySalary: entry?.workdaySalary ?? null,
      overtimeHours: attendance ? attendance.overtimeHours : entry?.overtimeHours ?? null,
      kpiBonus: Object.hasOwn(kpiByEmployee, employee.id) ? kpiByEmployee[employee.id] : entry?.kpiBonus ?? null,
      netSalary: entry?.netSalary ?? null,
    },
    sources: {
      baseSalary: entry?.baseSalary == null && Boolean(config?.baseSalary),
      responsibilityAllowance: entry?.responsibilityAllowance == null && Boolean(config?.responsibilityAllowance),
      attendanceAllowance: entry?.attendanceAllowance == null && Boolean(config?.attendanceAllowance),
      mealTransportAllowance: entry?.mealTransportAllowance == null && Boolean(config?.mealTransportAllowance),
      overtimeHours: Boolean(attendance),
      kpiBonus: Object.hasOwn(kpiByEmployee, employee.id),
    },
  }
}

function bestConfig(employee: EmployeeProfile, configs: PayrollFixedConfig[]) {
  const candidates = configs.filter((item) => item.branchId === employee.branchId && item.role === employee.role)
  return candidates.sort((a, b) => configScore(employee, b) - configScore(employee, a))[0]
}

function configScore(employee: EmployeeProfile, config: PayrollFixedConfig) {
  let score = 0
  if (config.employmentType && config.employmentType === employee.employmentType) score += 2
  if (config.positionTitle && normalizeName(config.positionTitle) === normalizeName(employee.positionTitle || '')) score += 4
  return score
}

function lastDayOfMonth(period: string) { const [year, month] = period.split('-').map(Number); return `${period}-${String(new Date(year, month, 0).getDate()).padStart(2, '0')}` }
function normalizeName(value: string) { return value.trim().toLocaleLowerCase('vi').normalize('NFD').replace(/\p{Diacritic}/gu, '') }
function cleanMoney(value: string) { return value.replace(/\D/g, '') }
function cleanDecimal(value: string) { return value.replace(',', '.').replace(/[^\d.]/g, '').replace(/(\..*)\./g, '$1') }
function moneyInput(value: number | null) { return value === null ? '' : String(Math.round(value)) }
function decimalInput(value: number | null) { return value === null ? '' : String(value) }
function formatMoney(value: number) { return `${new Intl.NumberFormat('vi-VN').format(Math.round(value))}đ` }
function formatNumber(value: number) { return new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 2 }).format(value) }
