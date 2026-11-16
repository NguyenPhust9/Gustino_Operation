import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { watchVisibleData } from '../lib/browser'
import { branchName as configuredBranchName, useConfiguredBranches } from '../lib/branches'
import { fetchEmployees, permittedBranchIds } from '../lib/attendance'
import { dashboardEventInScope, fetchDashboardMovements, fetchDashboardSnapshots, invalidateDashboardEvent } from '../lib/dashboardData'
import { invalidateReadCache } from '../lib/readCache'
import { fetchBagAllocations, fetchBagShiftSessions } from '../lib/shiftLedger'
import { buildShiftLeaderRevenueRows } from '../lib/shiftCompetition'
import { buildDailyRevenueRows } from '../lib/revenue'
import { employeePeriodRevenueTarget, summarizeEmployeeBagSales } from '../lib/commission'
import { fetchSalesReceiptsRange, type SalesReceipt } from '../lib/salesReceipts'
import { useLang } from '../lib/i18n'
import { supabase, uniqueChannelName } from '../lib/supabase'
import type { AppUser, BagAllocation, BagShiftSession, EmployeeProfile, ReportSnapshot, StockMovement } from '../types'
import type { Page } from '../components/AppShell'

export function ManagerDashboardPage({
  user,
  onNavigate,
}: {
  user: AppUser
  onNavigate: (page: Page, section?: string) => void
}) {
  const lang = useLang()
  const text = DASHBOARD_TEXT[lang]
  const [movements, setMovements] = useState<StockMovement[]>([])
  const [snapshots, setSnapshots] = useState<ReportSnapshot[]>([])
  const [allocations, setAllocations] = useState<BagAllocation[]>([])
  const [bagSessions, setBagSessions] = useState<BagShiftSession[]>([])
  const [receipts, setReceipts] = useState<SalesReceipt[]>([])
  const [employees, setEmployees] = useState<EmployeeProfile[]>([])
  const [loading, setLoading] = useState(true)
  const hasLoadedRef = useRef(false)
  const [error, setError] = useState('')
  // Mặc định mở dashboard là HÔM NAY (user yêu cầu: vừa vào phải ở hôm nay trước).
  const initialRange = rollingRange(1)
  const [from, setFrom] = useState(initialRange.from)
  const [to, setTo] = useState(initialRange.to)
  const [selectedBranchId, setSelectedBranchId] = useState('')
  const [drilldownBranchId, setDrilldownBranchId] = useState('')
  const refreshRef = useRef<() => Promise<void>>(() => Promise.resolve())
  const pendingLoadRef = useRef<Promise<void>>(Promise.resolve())
  const branchIds = permittedBranchIds(user)
  const branchKey = branchIds.join('|')
  const configuredBranches = useConfiguredBranches({ user })
  const branches = configuredBranches.filter((branch) => branchIds.includes(branch.id))
  const compareFrom = addDays(from, -Math.max(daysInWindow(from, to), 7))

  useEffect(() => {
    if (selectedBranchId && !branchIds.includes(selectedBranchId)) setSelectedBranchId('')
    if (drilldownBranchId && !branchIds.includes(drilldownBranchId)) setDrilldownBranchId('')
  }, [branchKey, selectedBranchId, drilldownBranchId])

  useEffect(() => {
    let active = true
    async function load() {
      if (!hasLoadedRef.current) setLoading(true)
      try {
        const [nextMovements, nextSnapshots, nextAllocations, nextEmployees] = await Promise.all([
          Promise.all(branchIds.map((id) => fetchDashboardMovements(id, user))).then((items) => items.flat()),
          Promise.all(branchIds.map((id) => fetchDashboardSnapshots(id, user, { from: compareFrom, to }))).then((items) => items.flat()),
          Promise.all(branchIds.map((id) => fetchBagAllocations(user, { branchId: id }))).then((items) => items.flat()),
          fetchEmployees(user),
        ])
        if (!active) return
        setMovements(nextMovements)
        setSnapshots(nextSnapshots)
        setAllocations(nextAllocations)
        setEmployees(nextEmployees)
        setError('')
      } catch (reason) {
        if (!active) return
        setError(reason instanceof Error ? reason.message : 'Không thể tải tổng quan quản lý.')
      } finally {
        if (active) {
          hasLoadedRef.current = true
          setLoading(false)
        }
      }
    }
    // Include the previous period/week in the POS comparison inputs.
    async function loadReceipts() {
      try {
        const [nextReceipts, nextSessions] = await Promise.all([
          fetchSalesReceiptsRange(user, { branchIds, from: compareFrom, to }),
          Promise.all(branchIds.map((id) => fetchBagShiftSessions(user, { branchId: id, from: compareFrom, to }))).then((items) => items.flat()),
        ])
        if (active) {
          setReceipts(nextReceipts)
          setBagSessions(nextSessions)
          setError((current) => current.startsWith('Không thể tải hóa đơn POS:') ? '' : current)
        }
      } catch (reason) {
        if (!active) return
        setError(`Không thể tải hóa đơn POS: ${reason instanceof Error ? reason.message : 'Máy chủ không phản hồi.'}`)
      }
    }
    const previous = pendingLoadRef.current
    let inFlight: Promise<void> | null = null
    let queued = false
    const refresh = (): Promise<void> => {
      queued = true
      if (inFlight) return inFlight
      const run = async () => {
        // A date/account change waits for the old scope to finish, without applying it.
        await previous
        while (active && queued) {
          queued = false
          await Promise.all([load(), loadReceipts()])
        }
      }
      inFlight = run().finally(() => { inFlight = null })
      pendingLoadRef.current = inFlight
      return inFlight
    }
    refreshRef.current = refresh
    void refresh()
    return () => { active = false }
  }, [user.id, user.branchId, user.role, branchKey, compareFrom, to])

  useEffect(() => {
    const client = user.authToken ? null : supabase
    const refresh = watchVisibleData(() => refreshRef.current(), client ? {} : { fallbackMs: 5000 })
    if (!client) {
      return refresh.dispose
    }
    // Ignore known unrelated branches; coalesce partial/joined events into one batch.
    const changed = (table: string, payload: { eventType?: string; new?: Record<string, unknown>; old?: Record<string, unknown> }) => {
      if (!dashboardEventInScope(payload, branchIds)) return
      invalidateDashboardEvent(table, payload)
      refresh.trigger()
    }
    const channel = client.channel(uniqueChannelName(`manager-revenue-live:${branchKey}`))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sales_receipts' }, (payload) => changed('sales_receipts', payload))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sales_receipt_items' }, (payload) => changed('sales_receipt_items', payload))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'bag_allocations' }, (payload) => changed('bag_allocations', payload))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'bag_shift_sessions' }, (payload) => changed('bag_shift_sessions', payload))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'stock_movements' }, (payload) => changed('stock_movements', payload))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'operation_days' }, (payload) => changed('operation_days', payload))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'report_snapshots' }, (payload) => changed('report_snapshots', payload))
      .subscribe(refresh.status)
    return () => {
      refresh.dispose()
      void client.removeChannel(channel)
    }
  }, [user.authToken, branchKey])

  const scopedBranchIds = selectedBranchId ? [selectedBranchId] : branchIds
  const scopedBranches = selectedBranchId
    ? branches.filter((branch) => branch.id === selectedBranchId)
    : branches
  const detailBranchId = drilldownBranchId || selectedBranchId
  const revenueRows = useMemo(
    () => buildDailyRevenueRows(snapshots, allocations, movements, { branchId: selectedBranchId || undefined, from, to, receipts }),
    [snapshots, allocations, movements, receipts, selectedBranchId, from, to],
  )
  const windowDays = daysInWindow(from, to)
  const prevFrom = addDays(from, -windowDays)
  const prevTo = addDays(from, -1)
  const weekFrom = addDays(from, -7)
  const weekTo = addDays(to, -7)
  const sumRevenue = (winFrom: string, winTo: string, branchId?: string) =>
    buildDailyRevenueRows(snapshots, allocations, movements, { branchId, from: winFrom, to: winTo, receipts })
      .reduce((sum, row) => sum + row.revenue, 0)
  const branchRows = scopedBranches.map((branch) => {
    const rows = revenueRows.filter((row) => row.branchId === branch.id)
    return {
      branchId: branch.id,
      branchName: branch.name,
      revenue: rows.reduce((sum, row) => sum + row.revenue, 0),
      sold: rows.reduce((sum, row) => sum + row.totalSold, 0),
      days: rows.length,
      prevRevenue: sumRevenue(prevFrom, prevTo, branch.id),
      weekRevenue: sumRevenue(weekFrom, weekTo, branch.id),
    }
  }).sort((a, b) => b.revenue - a.revenue)
  const totalRevenue = branchRows.reduce((sum, row) => sum + row.revenue, 0)
  const prevTotalRevenue = sumRevenue(prevFrom, prevTo, selectedBranchId || undefined)
  const weekTotalRevenue = sumRevenue(weekFrom, weekTo, selectedBranchId || undefined)
  const isSingleDay = windowDays === 1
  const dailyTrendRows = buildDailyTrendRows(revenueRows, { from, to })
  const maxDailyRevenue = Math.max(...dailyTrendRows.map((row) => row.revenue), 1)
  const firstHalfRevenue = dailyTrendRows.slice(0, Math.ceil(dailyTrendRows.length / 2)).reduce((sum, row) => sum + row.revenue, 0)
  const secondHalfRevenue = dailyTrendRows.slice(Math.ceil(dailyTrendRows.length / 2)).reduce((sum, row) => sum + row.revenue, 0)
  const trendRate = firstHalfRevenue ? (secondHalfRevenue - firstHalfRevenue) / firstHalfRevenue * 100 : (secondHalfRevenue ? 100 : 0)
  const bestBranch = branchRows[0]
  const weakestBranch = branchRows.slice().reverse().find((row) => row.revenue > 0) || branchRows[branchRows.length - 1]
  const employeeRows = buildEmployeeRevenueRows(allocations, receipts, { branchIds: scopedBranchIds, from, to })
  const selectedEmployeeBranchId = detailBranchId || branchRows[0]?.branchId || branches[0]?.id || ''
  const selectedEmployeeRows = employeeRows
    .filter((row) => row.branchId === selectedEmployeeBranchId && row.revenue > 0)
    .sort((a, b) => b.revenue - a.revenue)
  const selectedEmployeeTotal = selectedEmployeeRows.reduce((sum, row) => sum + row.revenue, 0)
  const visibleReceipts = receipts.filter((receipt) =>
    scopedBranchIds.includes(receipt.branchId)
    && receipt.businessDate >= from
    && receipt.businessDate <= to
  )
  const branchReceiptList = receipts
    .filter((receipt) => detailBranchId && receipt.branchId === detailBranchId && receipt.businessDate >= from && receipt.businessDate <= to)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  const hourlyReceipts = buildHourlyReceipts(visibleReceipts)
  const maxHourlyBills = Math.max(...hourlyReceipts.map((row) => row.count), 1)
  const topEmployee = employeeRows.slice().sort((a, b) => b.revenue - a.revenue)[0]
  const topEmployeeProfile = topEmployee ? employeeProfileFor(topEmployee, employees) : undefined
  const maxEmployeeRevenue = Math.max(...employeeRows.map((row) => row.revenue), 1)
  const leaderRows = buildShiftLeaderRevenueRows(bagSessions, receipts, {
    branchIds: scopedBranchIds,
    from,
    to,
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
  }).filter((row) => row.revenue > 0)
  const maxLeaderRevenue = Math.max(...leaderRows.map((row) => row.revenue), 1)

  const todayKey = localDateKey(new Date())
  const monthFirstKey = localDateKey(new Date(new Date().getFullYear(), new Date().getMonth(), 1))
  const presetKey = to !== todayKey ? ''
    : from === todayKey ? 'today'
      : from === rollingRange(7).from ? '7'
        : from === rollingRange(30).from ? '30'
          : from === monthFirstKey ? 'month' : ''
  function applyPreset(days: number) {
    const range = rollingRange(days)
    setFrom(range.from)
    setTo(range.to)
  }
  function applyThisMonth() {
    setFrom(monthFirstKey)
    setTo(todayKey)
  }

  return (
    <div className="page manager-dashboard-page">
      <div className="manager-dashboard-hero">
        <div>
          <span className="eyebrow dark">DOANH THU</span>
          <h1>{text.title}</h1>
          <p>{text.subtitle}</p>
        </div>
        <div className="manager-dashboard-filter">
          <label>{text.branch}
            <select value={selectedBranchId} onChange={(event) => {
              setSelectedBranchId(event.target.value)
              setDrilldownBranchId('')
            }}>
              <option value="">{text.allBranches}</option>
              {branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
            </select>
          </label>
          <label>{text.from}<input type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></label>
          <label>{text.to}<input type="date" value={to} min={from} onChange={(event) => setTo(event.target.value)} /></label>
          <button
            type="button"
            className="dashboard-reload-button"
            onClick={() => {
              branchIds.forEach((id) => {
                invalidateReadCache('stock_movements', id)
                invalidateReadCache('report_snapshots', id)
              })
              void refreshRef.current()
            }}
            title={lang === 'en' ? 'Reload data' : 'Tải lại dữ liệu'}
          >
            ⟳ {lang === 'en' ? 'Reload' : 'Tải lại'}
          </button>
        </div>
      </div>

      {error && <div className="feedback-bar">{error}<button onClick={() => setError('')}>×</button></div>}
      {loading ? (
        <section className="section-card">{text.loading}</section>
      ) : (
        <>
          <div className="ck-presets" role="tablist">
            <button type="button" className={presetKey === 'today' ? 'active' : ''} onClick={() => applyPreset(1)}>{text.today}</button>
            <button type="button" className={presetKey === '7' ? 'active' : ''} onClick={() => applyPreset(7)}>{text.days7}</button>
            <button type="button" className={presetKey === '30' ? 'active' : ''} onClick={() => applyPreset(30)}>{text.days30}</button>
            <button type="button" className={presetKey === 'month' ? 'active' : ''} onClick={applyThisMonth}>{text.thisMonth}</button>
          </div>

          <section className="ck-hero-card">
            <span className="ck-hero-label">{selectedBranchId ? (branches.find((b) => b.id === selectedBranchId)?.name || text.chainRevenue) : text.chainRevenue}</span>
            <strong className="ck-hero-number">{formatFullMoney(totalRevenue)}</strong>
            <div className="ck-hero-compares">
              <ComparisonRow label={isSingleDay ? text.vsYesterday : text.vsPrevPeriod} rate={pctChange(totalRevenue, prevTotalRevenue)} />
              <ComparisonRow label={isSingleDay ? text.vsLastWeekDay : text.vsLastWeekPeriod} rate={pctChange(totalRevenue, weekTotalRevenue)} />
            </div>
          </section>

          {!selectedBranchId && (
            <section className="ck-branch-cards" aria-label={text.revenueByBranch}>
              {branchRows.map((row) => (
                <button
                  key={row.branchId}
                  type="button"
                  className={`ck-branch-card${selectedEmployeeBranchId === row.branchId ? ' active' : ''}`}
                  onClick={() => setDrilldownBranchId(row.branchId)}
                >
                  <div className="ck-branch-top"><strong>{row.branchName}</strong><span className="ck-chevron" aria-hidden="true">›</span></div>
                  <div className="ck-branch-figure">
                    <span className="ck-branch-metric">{text.revenue}<b className="ck-branch-count">{formatNumber(row.sold)}</b></span>
                    <strong>{formatFullMoney(row.revenue)}</strong>
                  </div>
                  <ComparisonRow label={isSingleDay ? text.vsYesterday : text.vsPrevPeriod} rate={pctChange(row.revenue, row.prevRevenue)} />
                  <ComparisonRow label={isSingleDay ? text.vsLastWeekDay : text.vsLastWeekPeriod} rate={pctChange(row.revenue, row.weekRevenue)} />
                </button>
              ))}
              {!branchRows.length && <p className="empty-copy">{text.noBranchRevenue}</p>}
            </section>
          )}

          <section className="manager-kpi-grid">
            <article><span>{text.periodRevenue}</span><strong>{formatMoney(totalRevenue)}</strong><small>{branchRows.length} {text.stores}</small></article>
            <article><span>{text.soldBags}</span><strong>{formatNumber(branchRows.reduce((sum, row) => sum + row.sold, 0))}</strong><small>{text.chain}</small></article>
            <article>
              <span>{text.activeSellers}</span>
              <strong>{employeeRows.length}</strong>
              {topEmployee ? (
                <small className="top-employee-inline">
                  <EmployeeAvatar name={topEmployee.employeeName} avatarUrl={topEmployeeProfile?.avatarUrl} />
                  <span>{text.top}: {topEmployeeProfile?.name || topEmployee.employeeName}</span>
                </small>
              ) : <small>{text.noData}</small>}
            </article>
          </section>

          <section className="manager-revenue-insights">
            <div className="manager-revenue-chart">
              <div className="section-title">
                <div><span className="eyebrow dark">{text.revenueTrend}</span><h2>{text.trendTitle}</h2></div>
                <span className={trendRate >= 0 ? 'date-chip good' : 'date-chip warning'}>{trendRate >= 0 ? '+' : ''}{trendRate.toFixed(1)}%</span>
              </div>
              <div className="revenue-area-chart" aria-label={text.revenueTrend}>
                <ResponsiveContainer width="100%" height={230}>
                  <AreaChart data={dailyTrendRows} margin={{ top: 12, right: 10, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="managerRevenueFill" x1="0" x2="0" y1="0" y2="1">
                        <stop offset="0%" stopColor="#a8d12d" stopOpacity={0.55} />
                        <stop offset="100%" stopColor="#1688d8" stopOpacity={0.04} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="4 4" stroke="#eef2f6" vertical={false} />
                    <XAxis
                      dataKey="date"
                      tickFormatter={(value: string) => shortDate(value, lang)}
                      tick={{ fontSize: 10, fontWeight: 700, fill: '#8693a4' }}
                      axisLine={false}
                      tickLine={false}
                      minTickGap={28}
                    />
                    <YAxis
                      tickFormatter={(value: number) => formatMoney(value)}
                      tick={{ fontSize: 10, fontWeight: 700, fill: '#8693a4' }}
                      axisLine={false}
                      tickLine={false}
                      width={52}
                    />
                    <Tooltip
                      formatter={(value) => [formatMoney(Number(value)), lang === 'en' ? 'Revenue' : 'Doanh thu']}
                      labelFormatter={(value) => fullDate(String(value), lang)}
                      contentStyle={CHART_TOOLTIP_STYLE}
                    />
                    <Area
                      type="monotone"
                      dataKey="revenue"
                      stroke="#1688d8"
                      strokeWidth={3}
                      fill="url(#managerRevenueFill)"
                      dot={false}
                      activeDot={{ r: 5, fill: '#102238', strokeWidth: 2, stroke: '#fff' }}
                    />
                  </AreaChart>
                </ResponsiveContainer>
                <div className="revenue-area-summary">
                  <strong>{formatMoney(maxDailyRevenue)}</strong>
                  <small>{lang === 'en' ? 'peak day' : 'ngày cao nhất'}</small>
                </div>
              </div>
            </div>
            {false && <div className="business-strategy-panel">
              <div><span className="eyebrow dark">{text.strategy}</span><h2>{text.strategyTitle}</h2></div>
              <article><strong>{text.focusBranch}</strong><span>{bestBranch ? `${bestBranch.branchName} · ${formatMoney(bestBranch.revenue)}` : text.noData}</span></article>
              <article><strong>{text.needPush}</strong><span>{weakestBranch ? `${weakestBranch.branchName} · ${formatMoney(weakestBranch.revenue)}` : text.noData}</span></article>
              <article><strong>{text.actionPlan}</strong><span>{trendRate >= 0 ? text.keepPlan : text.recoverPlan}</span></article>
            </div>}
          </section>

          <section className="manager-crm-actions" aria-label="Chức năng quản lý">
            <button onClick={() => onNavigate('manager-revenue')}><span>▤</span><strong>{text.business}</strong><small>{text.businessSub}</small></button>
            <button onClick={() => onNavigate('manager-inventory')}><span>▦</span><strong>{text.inventory}</strong><small>{text.inventorySub}</small></button>
            {user.role === 'admin' && <button onClick={() => onNavigate('manager-attendance')}><span>◉</span><strong>{text.timesheet}</strong><small>{text.timesheetSub}</small></button>}
            {user.role === 'admin' && <button onClick={() => onNavigate('report-archive')}><span>▣</span><strong>{text.reportArchive}</strong><small>{text.reportArchiveSub}</small></button>}
            {user.role === 'admin' && <button onClick={() => onNavigate('control')}><span>↑</span><strong>{text.audit}</strong><small>{text.auditSub}</small></button>}
          </section>

          <section className="section-card manager-priority-panel">
            <div className="section-title">
              <div><span className="eyebrow dark">{lang === 'en' ? 'SHIFT LEADER RANKING' : 'XẾP HẠNG CA TRƯỞNG'}</span><h2>{lang === 'en' ? 'Revenue by shift leader' : 'Doanh thu theo ca trưởng'}</h2></div>
              <span className="date-chip">{leaderRows.length} {lang === 'en' ? 'leaders' : 'ca trưởng'}</span>
            </div>
            <div className="leader-priority-bars">
              {leaderRows.slice(0, 8).map((row, index) => (
                <article key={`${row.branchId}-${row.leaderKey}`}>
                  <span className={`leaderboard-rank rank-${index + 1}`}>{index + 1}</span>
                  <div>
                    <strong>{row.leaderName}</strong>
                    <small>{branchName(row.branchId)} · {row.shiftCount} {lang === 'en' ? 'shifts' : 'ca'} · {formatNumber(row.soldQuantity)} {lang === 'en' ? 'items' : 'sản phẩm'} · KPI {formatNumber(row.progress)}%</small>
                    <i><em style={{ width: `${Math.max(7, row.revenue / maxLeaderRevenue * 100)}%` }} /></i>
                  </div>
                  <b>{formatMoney(row.revenue)}</b>
                </article>
              ))}
              {!leaderRows.length && <p className="empty-copy">{lang === 'en' ? 'No shift leader data in this filter.' : 'Chưa có dữ liệu ca trưởng trong bộ lọc này.'}</p>}
            </div>
          </section>

          <section className="dashboard-single-column">
            <div className="section-card dashboard-panel">
              <div className="section-title">
                <div><span className="eyebrow dark">{text.employeeRegion}</span><h2>{text.salesShare}</h2></div>
              </div>
              <div className="employee-pie-list">
                <article>
                  <div className="employee-pie-chart">
                    <ResponsiveContainer width="100%" height={190}>
                      <PieChart>
                        <Pie
                          data={selectedEmployeeRows.slice(0, 6).map((row) => ({ name: row.employeeName, value: row.revenue }))}
                          dataKey="value"
                          nameKey="name"
                          innerRadius="58%"
                          outerRadius="92%"
                          paddingAngle={3}
                          stroke="#fff"
                          strokeWidth={2}
                        >
                          {selectedEmployeeRows.slice(0, 6).map((row, index) => (
                            <Cell key={`${row.branchId}-${row.employeeKey}`} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                          ))}
                        </Pie>
                        <Tooltip
                          formatter={(value, name) => [formatMoney(Number(value)), String(name)]}
                          contentStyle={CHART_TOOLTIP_STYLE}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                    <span className="employee-pie-center">{selectedEmployeeRows.length}</span>
                  </div>
                  <div className="employee-pie-copy">
                    <strong>{branches.find((branch) => branch.id === selectedEmployeeBranchId)?.name || text.branch}</strong>
                    <small>{formatMoney(selectedEmployeeTotal)}</small>
                    {selectedEmployeeRows.slice(0, 6).map((row, index) => (
                      <span key={`${row.branchId}-${row.employeeKey}`}>
                        <i style={{ background: PIE_COLORS[index % PIE_COLORS.length] }} />
                        {row.employeeName} · {formatMoney(row.revenue)}
                      </span>
                    ))}
                    {!selectedEmployeeRows.length && <span>{text.noEmployeeRevenue}</span>}
                  </div>
                </article>
              </div>
            </div>
          </section>

          <section className="section-card employee-race-panel">
            <div className="section-title">
              <div><span className="eyebrow dark">{text.motivation}</span><h2>{text.leaderboardTitle}</h2></div>
              <span className="date-chip">{from} → {to}</span>
            </div>
            <div className="modern-leaderboard">
              {employeeRows.slice().sort((a, b) => b.revenue - a.revenue).slice(0, 3).map((row, index) => (
                <article key={`${row.branchId}-${row.employeeKey}`} className={`place-${index + 1}`}>
                  <span className="medal">{index + 1}</span>
                  <EmployeeAvatar name={row.employeeName} avatarUrl={employeeProfileFor(row, employees)?.avatarUrl} />
                  <div>
                    <strong>{employeeProfileFor(row, employees)?.name || row.employeeName}</strong>
                    <small>{branchName(row.branchId)} · {formatNumber(row.soldQuantity)} {text.bags}</small>
                    <i><em style={{ width: `${Math.max(6, row.revenue / maxEmployeeRevenue * 100)}%` }} /></i>
                  </div>
                  <b>{formatMoney(row.revenue)}</b>
                </article>
              ))}
              {!employeeRows.length && <p className="empty-copy">{text.noLeaderboard}</p>}
            </div>
          </section>

          {user.role === 'admin' && detailBranchId && (
            <section className="section-card receipt-drilldown-panel">
              <div className="section-title">
                <div><span className="eyebrow dark">{text.receiptDrilldown}</span><h2>{branchName(detailBranchId)}</h2></div>
                <span className="date-chip">{branchReceiptList.length} {text.receipts}</span>
              </div>
              {/* Hóa đơn phân loại theo ngày, mặc định thu gọn — bấm ngày mới xổ ra xem. */}
              <div className="manager-receipt-days">
                {groupReceiptsByDate(branchReceiptList).map(([date, dayReceipts], index) => (
                  <details className="manager-receipt-day" key={date} open={index === 0}>
                    <summary>
                      <span><strong>{fullDate(date, lang)}</strong><small>{dayReceipts.length} {text.receipts}</small></span>
                      <b>{formatMoney(dayReceipts.reduce((sum, receipt) => sum + receipt.totalAmount, 0))}</b>
                    </summary>
                    <div className="manager-receipt-list">
                      {dayReceipts.slice(0, 80).map((receipt) => (
                        <article key={receipt.id}>
                          <span><strong>{receipt.code}</strong><small>{formatDateTime(receipt.createdAt)} · {receipt.sellerName}</small></span>
                          <b>{formatMoney(receipt.totalAmount)}</b>
                          <em>{formatNumber(receipt.totalQuantity)} {text.bags}</em>
                        </article>
                      ))}
                    </div>
                  </details>
                ))}
                {!branchReceiptList.length && <p className="empty-copy">{text.noReceipts}</p>}
              </div>
            </section>
          )}

          <section className="section-card dashboard-panel">
            <div className="section-title">
              <div><span className="eyebrow dark">{text.hourlyReceipts}</span><h2>{text.customerEstimate}</h2></div>
            </div>
            <div className="hourly-bill-chart">
              {hourlyReceipts.some((row) => row.count) ? (
                <ResponsiveContainer width="100%" height={210}>
                  <BarChart data={hourlyReceipts} margin={{ top: 10, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="4 4" stroke="#eef2f6" vertical={false} />
                    <XAxis
                      dataKey="hour"
                      tickFormatter={(value: string) => `${Number(value.slice(0, 2))}h`}
                      tick={{ fontSize: 10, fontWeight: 700, fill: '#8693a4' }}
                      axisLine={false}
                      tickLine={false}
                      interval={1}
                    />
                    <YAxis
                      allowDecimals={false}
                      tick={{ fontSize: 10, fontWeight: 700, fill: '#8693a4' }}
                      axisLine={false}
                      tickLine={false}
                      width={30}
                    />
                    <Tooltip
                      cursor={{ fill: 'rgba(22, 136, 216, .07)' }}
                      formatter={(value) => [`${value} ${text.receipts}`, text.hourlyReceipts]}
                      contentStyle={CHART_TOOLTIP_STYLE}
                    />
                    <Bar dataKey="count" radius={[7, 7, 0, 0]} maxBarSize={26}>
                      {hourlyReceipts.map((row) => (
                        <Cell key={row.hour} fill={row.count === maxHourlyBills ? '#a8d12d' : '#1688d8'} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              ) : <p className="empty-copy">{text.noPosReceipts}</p>}
            </div>
          </section>
        </>
      )}
    </div>
  )
}

function groupReceiptsByDate(receipts: SalesReceipt[]) {
  const map = new Map<string, SalesReceipt[]>()
  receipts.forEach((receipt) => {
    const key = receipt.businessDate || receipt.createdAt.slice(0, 10)
    map.set(key, [...(map.get(key) || []), receipt])
  })
  return Array.from(map.entries()).sort((a, b) => b[0].localeCompare(a[0]))
}

function buildHourlyReceipts(receipts: Array<{ createdAt: string }>) {
  const hours = Array.from({ length: 15 }, (_, index) => `${String(index + 8).padStart(2, '0')}:00`)
  return hours.map((hour) => {
    const start = Number(hour.slice(0, 2))
    return {
      hour,
      count: receipts.filter((receipt) => new Date(receipt.createdAt).getHours() === start).length,
    }
  })
}

function buildDailyTrendRows(rows: Array<{ reportDate: string; revenue: number }>, range: { from: string; to: string }) {
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

const CHART_TOOLTIP_STYLE: CSSProperties = {
  borderRadius: 12,
  border: '1px solid #e6ecf1',
  boxShadow: '0 8px 24px rgba(16, 34, 56, .12)',
  fontSize: 12,
  fontWeight: 700,
  padding: '8px 12px',
}

function shortDate(value: string, lang: 'vi' | 'en') {
  return new Date(`${value}T00:00:00`).toLocaleDateString(lang === 'en' ? 'en-US' : 'vi-VN', { day: '2-digit', month: '2-digit' })
}

function fullDate(value: string, lang: 'vi' | 'en') {
  return new Date(`${value}T00:00:00`).toLocaleDateString(lang === 'en' ? 'en-US' : 'vi-VN', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' })
}

function buildEmployeeRevenueRows(
  allocations: BagAllocation[],
  receipts: SalesReceipt[],
  filters: { branchIds: string[]; from: string; to: string },
) {
  const rows = new Map<string, ReturnType<typeof summarizeEmployeeBagSales>[number] & { receiptCount: number }>()
  const scopedAllocations = allocations.filter((allocation) => {
    const date = (allocation.settledAt || allocation.issuedAt).slice(0, 10)
    return date >= filters.from && date <= filters.to && filters.branchIds.includes(allocation.branchId)
  })
  summarizeEmployeeBagSales(scopedAllocations).forEach((row) => {
    rows.set(`${row.branchId}|${row.employeeKey}`, { ...row, receiptCount: 0 })
  })
  receipts.forEach((receipt) => {
    if (!filters.branchIds.includes(receipt.branchId)) return
    if (receipt.businessDate < filters.from || receipt.businessDate > filters.to) return
    const employeeKey = receipt.sellerId || receipt.sellerKey || normalizeName(receipt.sellerName)
    const key = `${receipt.branchId}|${employeeKey}`
    const current = rows.get(key) || {
      employeeKey,
      employeeId: receipt.sellerId,
      employeeName: receipt.sellerName,
      branchId: receipt.branchId,
      soldQuantity: 0,
      revenue: 0,
      commissionBase: 0,
      achieved: false,
      commission: 0,
      receiptCount: 0,
    }
    const directLines = receipt.lines.filter((line) => !line.allocationId)
    if (directLines.length || (current.soldQuantity <= 0 && current.revenue <= 0)) {
      current.soldQuantity += directLines.length
        ? directLines.reduce((sum, line) => sum + line.quantity, 0)
        : receipt.totalQuantity
      current.revenue += directLines.length
        ? directLines.reduce((sum, line) => sum + line.total, 0)
        : receipt.totalAmount
    }
    current.receiptCount += 1
    rows.set(key, current)
  })
  return Array.from(rows.values()).sort((a, b) => b.revenue - a.revenue)
}

function branchName(id: string) {
  return configuredBranchName(id) || id
}

function employeeProfileFor(
  row: { employeeKey?: string; employeeId?: string; employeeName: string; branchId: string },
  employees: EmployeeProfile[],
) {
  const key = row.employeeId || row.employeeKey
  return employees.find((employee) =>
    employee.branchId === row.branchId
    && (
      employee.id === key
      || normalizeName(employee.name) === normalizeName(row.employeeName)
    ),
  )
}

function ComparisonRow({ label, rate }: { label: string; rate: number }) {
  const flat = Math.abs(rate) < 0.05
  const up = rate >= 0
  return (
    <div className="ck-compare-row">
      <span>{label}</span>
      <b className={flat ? 'ck-flat' : up ? 'ck-up' : 'ck-down'}>
        {flat ? '—' : `${up ? '+' : ''}${rate.toFixed(1)}%`}
        {!flat && <i aria-hidden="true">{up ? '↑' : '↓'}</i>}
      </b>
    </div>
  )
}

function pctChange(current: number, base: number) {
  if (base > 0) return (current - base) / base * 100
  return current > 0 ? 100 : 0
}

function daysInWindow(from: string, to: string) {
  return Math.max(1, Math.round((new Date(`${to}T00:00:00`).getTime() - new Date(`${from}T00:00:00`).getTime()) / 86400000) + 1)
}

function addDays(dateStr: string, delta: number) {
  const date = new Date(`${dateStr}T00:00:00`)
  date.setDate(date.getDate() + delta)
  return localDateKey(date)
}

function formatFullMoney(value: number) {
  return `${Math.round(value).toLocaleString('vi-VN')}đ`
}

function EmployeeAvatar({ name, avatarUrl }: { name: string; avatarUrl?: string }) {
  return (
    <span className="employee-top-avatar" aria-hidden="true">
      {avatarUrl ? <img src={avatarUrl} alt="" /> : name.slice(0, 1).toUpperCase()}
    </span>
  )
}

function normalizeName(value: string) {
  return value.trim().toLocaleLowerCase('vi').normalize('NFD').replace(/\p{Diacritic}/gu, '')
}

const PIE_COLORS = ['#1688d8', '#a8d12d', '#ef6fcf', '#e2a600', '#a173ff', '#ff6d78']

function rollingRange(days: number) {
  const to = new Date()
  const from = new Date()
  // days=1 phải ra hôm nay→hôm nay (1 ngày). Trước đây Math.max(1, …) khiến
  // "Hôm nay" thành hôm qua→hôm nay nên nút không active và không xem được đúng ngày.
  from.setDate(to.getDate() - Math.max(0, days - 1))
  return { from: localDateKey(from), to: localDateKey(to) }
}

function localDateKey(date = new Date()) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function formatMoney(value: number) {
  if (value >= 1000000) return `${(value / 1000000).toFixed(value >= 10000000 ? 0 : 1)} tr`
  return `${Math.round(value).toLocaleString('vi-VN')}đ`
}

function formatNumber(value: number) {
  return Number(value.toFixed(2)).toLocaleString('vi-VN')
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString('vi-VN', { hour12: false })
}

const DASHBOARD_TEXT = {
  vi: {
    title: 'Dashboard quản lý',
    subtitle: 'So sánh doanh thu chi nhánh, tỷ trọng bán hàng nhân viên và lượng hóa đơn theo khung giờ.',
    chainRevenue: 'DOANH THU TOÀN CHUỖI',
    revenue: 'Doanh thu',
    vsYesterday: 'So với hôm qua',
    vsPrevPeriod: 'So với kỳ trước',
    vsLastWeekDay: 'So với ngày này tuần trước',
    vsLastWeekPeriod: 'So với cùng kỳ tuần trước',
    today: 'Hôm nay',
    days7: '7 ngày',
    days30: '30 ngày',
    thisMonth: 'Tháng này',
    branch: 'Chi nhánh',
    allBranches: 'Tất cả chi nhánh',
    from: 'Từ ngày',
    to: 'Đến ngày',
    loading: 'Đang tải tổng quan toàn chuỗi...',
    periodRevenue: 'Doanh thu kỳ này',
    stores: 'cửa hàng',
    soldBags: 'Sản phẩm đã bán',
    chain: 'toàn chuỗi',
    activeSellers: 'Nhân viên có doanh số',
    top: 'Top',
    noData: 'chưa có dữ liệu',
    revenueTrend: 'XU HƯỚNG DOANH THU',
    trendTitle: 'Diễn biến theo ngày',
    strategy: 'CHIẾN LƯỢC',
    strategyTitle: 'Gợi ý hành động kinh doanh',
    focusBranch: 'Giữ đà chi nhánh mạnh',
    needPush: 'Chi nhánh cần thúc đẩy',
    actionPlan: 'Hành động ưu tiên',
    keepPlan: 'Duy trì tồn an toàn, đẩy combo bán chạy và thưởng ca có doanh số cao.',
    recoverPlan: 'Kiểm tra khung giờ thấp điểm, tăng trưng bày và theo sát nhân viên chưa có doanh số.',
    business: 'Kinh doanh',
    businessSub: 'Doanh thu, hóa đơn, bán chạy',
    inventory: 'Kho',
    inventorySub: 'Tồn kho, hao hụt, cảnh báo',
    timesheet: 'Bảng công',
    timesheetSub: 'Ca làm và giờ công',
    payroll: 'Lương & KPI',
    payrollSub: 'Bảng lương tháng + KPI theo ca',
    orders: 'Đặt hàng',
    ordersSub: 'Tổng hợp theo ngày',
    reportArchive: 'Kho báo cáo',
    reportArchiveSub: 'Bản lưu báo cáo đã chốt',
    audit: 'Audit log',
    auditSub: 'Nhật ký thao tác admin',
    roleCharts: 'PHÂN QUYỀN QUẢN LÝ',
    roleCompare: 'Doanh thu theo vai trò vận hành',
    easyCompare: 'dễ đối chiếu',
    roleAdmin: 'Admin hệ thống',
    roleManager: 'Quản lý',
    roleStaff: 'Nhân viên bán hàng',
    branchCompare: 'SO SÁNH CỬA HÀNG',
    revenueByBranch: 'Doanh số theo chi nhánh',
    revenueDays: 'ngày có doanh thu',
    bags: 'sản phẩm',
    noBranchRevenue: 'Chưa có dữ liệu doanh thu trong kỳ này.',
    employeeRegion: 'NHÂN VIÊN THEO KHU VỰC',
    salesShare: 'Tỷ trọng doanh số',
    noEmployeeRevenue: 'Chưa có nhân viên phát sinh doanh số.',
    motivation: 'THI ĐUA BÁN HÀNG',
    leaderboardTitle: 'Bảng xếp hạng doanh thu nhân viên',
    receipts: 'hóa đơn',
    noLeaderboard: 'Chưa có dữ liệu bán hàng để xếp hạng.',
    receiptDrilldown: 'HÓA ĐƠN CHI NHÁNH',
    noReceipts: 'Chi nhánh này chưa có hóa đơn trong bộ lọc.',
    hourlyReceipts: 'HÓA ĐƠN THEO GIỜ',
    customerEstimate: 'Số lượng khách ước tính',
    noPosReceipts: 'Chưa có hóa đơn POS trong bộ lọc này.',
  },
  en: {
    title: 'Management Dashboard',
    subtitle: 'Compare branch revenue, employee sales share, and receipt volume by hour.',
    chainRevenue: 'WHOLE-CHAIN REVENUE',
    revenue: 'Revenue',
    vsYesterday: 'vs yesterday',
    vsPrevPeriod: 'vs previous period',
    vsLastWeekDay: 'vs same day last week',
    vsLastWeekPeriod: 'vs same period last week',
    today: 'Today',
    days7: '7 days',
    days30: '30 days',
    thisMonth: 'This month',
    branch: 'Branch',
    allBranches: 'All branches',
    from: 'From',
    to: 'To',
    loading: 'Loading chain overview...',
    periodRevenue: 'Period revenue',
    stores: 'stores',
    soldBags: 'Items sold',
    chain: 'whole chain',
    activeSellers: 'Sellers with revenue',
    top: 'Top',
    noData: 'no data yet',
    revenueTrend: 'REVENUE TREND',
    trendTitle: 'Daily performance',
    strategy: 'STRATEGY',
    strategyTitle: 'Business action plan',
    focusBranch: 'Keep momentum',
    needPush: 'Branch to push',
    actionPlan: 'Priority action',
    keepPlan: 'Keep stock safe, push best-selling combos, and reward high-revenue shifts.',
    recoverPlan: 'Review weak hours, improve display, and coach sellers without revenue.',
    business: 'Business',
    businessSub: 'Revenue, receipts, best sellers',
    inventory: 'Inventory',
    inventorySub: 'Stock, waste, alerts',
    timesheet: 'Timesheets',
    timesheetSub: 'Shifts and work hours',
    payroll: 'Payroll & KPI',
    payrollSub: 'Monthly payroll + per-shift KPI',
    orders: 'Orders',
    ordersSub: 'Daily request summary',
    reportArchive: 'Report archive',
    reportArchiveSub: 'Finalized report snapshots',
    audit: 'Audit log',
    auditSub: 'Admin activity history',
    roleCharts: 'MANAGEMENT PERMISSIONS',
    roleCompare: 'Revenue by operating role',
    easyCompare: 'easy comparison',
    roleAdmin: 'System Admin',
    roleManager: 'Manager',
    roleStaff: 'Sales staff',
    branchCompare: 'STORE COMPARISON',
    revenueByBranch: 'Revenue by branch',
    revenueDays: 'revenue days',
    bags: 'items',
    noBranchRevenue: 'No revenue data in this period.',
    employeeRegion: 'EMPLOYEES BY AREA',
    salesShare: 'Sales share',
    noEmployeeRevenue: 'No employee revenue yet.',
    motivation: 'SALES MOTIVATION',
    leaderboardTitle: 'Employee revenue leaderboard',
    receipts: 'receipts',
    noLeaderboard: 'No sales data for ranking yet.',
    receiptDrilldown: 'BRANCH RECEIPTS',
    noReceipts: 'No receipts for this branch in the selected filter.',
    hourlyReceipts: 'RECEIPTS BY HOUR',
    customerEstimate: 'Estimated customer count',
    noPosReceipts: 'No POS receipts in this filter.',
  },
} as const
