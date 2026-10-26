import { useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Pie, PieChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import { supabase } from '../lib/supabase'
import type { AppUser } from '../types'

interface AnalystPayload {
  generatedAt: string
  period: { from: string; to: string }
  scope: string
  branches: Array<{ id: string; code: string; name: string }>
  branchRows: Array<{ id: string; code: string; name: string; invoiceCount: number; cancelledCount: number; revenue: number; averageOrderValue: number; quantity: number; basketSize: number; distinctItems: number }>
  overview: { invoiceCount: number; cancelledCount: number; revenue: number; averageOrderValue: number; quantity: number; basketSize: number; distinctItems: number }
  daily: Array<{ date: string; invoices: number; revenue: number }>
  hourly: Array<{ hour: string; invoices: number; revenue: number }>
  channels: Array<{ name: string; invoices: number; revenue: number }>
  topItems: Array<{ name: string; quantity: number; revenue: number; invoiceCount: number }>
}

interface FinancialConfig {
  period_month: string
  fixed_cost: number
  gross_margin_rate: number
  kpi_target: number | null
}

const COLORS = ['#2d9cdb', '#8b5cf6', '#6366f1', '#10b981', '#f59e0b', '#94a3b8']

export function GustinoAnalystPage({ user }: { user: AppUser }) {
  const initial = currentMonthRange()
  const [from, setFrom] = useState(initial.from)
  const [to, setTo] = useState(initial.to)
  const [branchId, setBranchId] = useState('')
  const [data, setData] = useState<AnalystPayload | null>(null)
  const [financialConfig, setFinancialConfig] = useState<FinancialConfig | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [reloadTick, setReloadTick] = useState(0)

  useEffect(() => {
    if (user.role !== 'admin') return
    let active = true
    async function load() {
      setLoading(true)
      setError('')
      try {
        const token = user.authToken || (await supabase?.auth.getSession())?.data.session?.access_token || ''
        if (!token) throw new Error('Không tìm thấy phiên đăng nhập Admin.')
        const params = new URLSearchParams({ from, to })
        if (branchId) params.set('branchId', branchId)
        const response = await fetch(`/api/gustino-analyst?${params}`, { headers: { Authorization: `Bearer ${token}` } })
        const payload = await response.json().catch(() => null)
        if (!response.ok) throw new Error(payload?.error || 'Không thể tải dữ liệu CUKCUK.')
        const periodMonth = `${from.slice(0, 7)}-01`
        const configResult = await supabase
          ?.from('analytics_financial_configs')
          .select('period_month,fixed_cost,gross_margin_rate,kpi_target')
          .eq('period_month', periodMonth)
          .maybeSingle()
        if (active) {
          setData(payload)
          setFinancialConfig((configResult?.data as FinancialConfig | null) || null)
        }
      } catch (reason) {
        if (active) setError(reason instanceof Error ? reason.message : 'Không thể tải dữ liệu CUKCUK.')
      } finally {
        if (active) setLoading(false)
      }
    }
    void load()
    return () => { active = false }
  }, [user.id, user.authToken, user.role, from, to, branchId, reloadTick])

  const peak = useMemo(() => [...(data?.hourly || [])].sort((a, b) => b.invoices - a.invoices)[0], [data])
  const peakRevenue = useMemo(() => [...(data?.hourly || [])].sort((a, b) => b.revenue - a.revenue)[0], [data])
  const maxItemRevenue = data?.topItems[0]?.revenue || 1
  const breakEvenRevenue = financialConfig && financialConfig.gross_margin_rate > 0
    ? financialConfig.fixed_cost / financialConfig.gross_margin_rate
    : null

  if (user.role !== 'admin') return <div className="analyst-state error">Chỉ Admin được xem Gustino Analyst.</div>

  return (
    <main className="analyst-page">
      <header className="analyst-topbar">
        <div className="analyst-title"><span>⌁</span><div><strong>Gustino Analyst</strong><small>Hạt Dẻ Ông Lý · dữ liệu trực tiếp từ CUKCUK API</small></div></div>
        <div className="analyst-filters">
          <label><span>Từ ngày</span><input type="date" value={from} max={to} onChange={(event) => setFrom(event.target.value)} /></label>
          <label><span>Đến ngày</span><input type="date" value={to} min={from} onChange={(event) => setTo(event.target.value)} /></label>
          <label><span>Phạm vi</span><select value={branchId} onChange={(event) => setBranchId(event.target.value)}><option value="">Toàn chuỗi</option>{data?.branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></label>
          <button type="button" onClick={() => setReloadTick((tick) => tick + 1)} disabled={loading}>↻ {loading ? 'Đang tải' : 'Cập nhật'}</button>
        </div>
      </header>

      {error && <div className="analyst-state error"><strong>Không tải được dữ liệu</strong><span>{error}</span><button type="button" onClick={() => setReloadTick((tick) => tick + 1)}>Thử lại</button></div>}
      {!data && loading && <div className="analyst-state"><strong>Đang kết nối CUKCUK…</strong><span>Đang tải hóa đơn và chi tiết món từ API.</span></div>}

      {data && <>
        <section className="analyst-heading"><div><h1>Tổng quan toàn chuỗi</h1><p>{formatDate(from)} – {formatDate(to)} · nguồn CUKCUK API</p></div><small>Dữ liệu cập nhật {formatDateTime(data.generatedAt)}</small></section>
        <section className="analyst-kpis">
          <KpiCard tone="purple" label="Doanh thu thực tế" value={money(data.overview.revenue)} detail={`${data.overview.invoiceCount.toLocaleString('vi-VN')} hóa đơn đã thu tiền`} />
          <KpiCard tone="blue" label="Doanh thu hòa vốn kỳ" value={breakEvenRevenue === null ? 'Chưa cấu hình' : money(breakEvenRevenue)} detail={financialConfig ? `Lãi gộp ${percentRate(financialConfig.gross_margin_rate)} · Định phí ${compactMoney(financialConfig.fixed_cost)}` : `Chưa có cấu hình tháng ${from.slice(5, 7)}/${from.slice(0, 4)}`} />
          <KpiCard tone="orange" label="Đơn hàng" value={data.overview.invoiceCount.toLocaleString('vi-VN')} detail={`TB/đơn ${money(data.overview.averageOrderValue)} · loại ${data.overview.cancelledCount} đơn hủy`} />
          <KpiCard tone="green" label="Quy mô giỏ hàng" value={`${data.overview.basketSize.toLocaleString('vi-VN', { maximumFractionDigits: 2 })} món/đơn`} detail={peak ? `Giờ đông nhất ${peak.hour}:00 · ${peak.invoices} đơn` : 'Chưa có dữ liệu giờ'} />
        </section>

        <section className="analyst-grid analyst-grid-main">
          <article className="analyst-card analyst-chart-card"><CardTitle icon="⌁" title="Doanh thu theo ngày" subtitle="Tổng thanh toán của hóa đơn đã thu tiền" />
            <div className="analyst-chart"><ResponsiveContainer width="100%" height="100%"><AreaChart data={data.daily}><defs><linearGradient id="analystRevenue" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#a855f7" stopOpacity={0.38}/><stop offset="100%" stopColor="#a855f7" stopOpacity={0.02}/></linearGradient></defs><CartesianGrid stroke="#e8edf5" vertical={false}/><XAxis dataKey="date" tickFormatter={(value) => value.slice(8, 10)} tickLine={false}/><YAxis tickFormatter={compactMoney} tickLine={false} axisLine={false}/><Tooltip formatter={(value) => money(Number(value))} labelFormatter={(value) => formatDate(String(value))}/><Area type="monotone" dataKey="revenue" stroke="#a43cf3" strokeWidth={4} fill="url(#analystRevenue)" /></AreaChart></ResponsiveContainer></div>
          </article>
          <article className="analyst-card analyst-insights"><CardTitle icon="✦" title="Trợ lý dữ liệu" subtitle="Nhận định được tính từ kỳ đang lọc" />
            <Insight tone="danger" title="Kiểm soát hóa đơn">Đã loại {data.overview.cancelledCount} hóa đơn hủy. Doanh thu chỉ cộng hóa đơn có trạng thái đã thu tiền.</Insight>
            <Insight tone="warning" title="Giờ cao điểm">{peak ? `${peak.hour}:00–${String(Number(peak.hour) + 1).padStart(2, '0')}:00 có ${peak.invoices} đơn.` : 'Chưa đủ dữ liệu.'} {peakRevenue ? `Khung doanh thu cao nhất là ${peakRevenue.hour}:00 với ${money(peakRevenue.revenue)}.` : ''}</Insight>
            <Insight tone="success" title="Chất lượng dữ liệu">Dữ liệu được tải lại từ CUKCUK khi đổi bộ lọc hoặc nhấn Cập nhật; không dùng số doanh thu viết cứng trong giao diện.</Insight>
          </article>
        </section>

        <section className="analyst-grid analyst-grid-equal">
          <article className="analyst-card"><CardTitle icon="▦" title="Top 10 món bán chạy" subtitle={`${data.overview.distinctItems} món · ${formatNumber(data.overview.quantity)} phần bán ra`} /><div className="analyst-table-wrap"><table className="analyst-table"><thead><tr><th>#</th><th>Tên món</th><th>SL</th><th>Doanh thu đóng góp</th></tr></thead><tbody>{data.topItems.map((item, index) => <tr key={item.name}><td><b className={`analyst-rank rank-${index + 1}`}>{index + 1}</b></td><td><strong>{item.name}</strong><small>{item.invoiceCount} đơn</small></td><td>{formatNumber(item.quantity)}</td><td><strong>{money(item.revenue)}</strong><i><span style={{ width: `${Math.max(4, item.revenue / maxItemRevenue * 100)}%` }} /></i></td></tr>)}</tbody></table></div></article>
          <article className="analyst-card"><CardTitle icon="◴" title="Customer Insights" subtitle="Hành vi mua và giờ bán trong kỳ lọc" /><div className="analyst-mini-kpis"><Mini label="Giá trị đơn TB" value={money(data.overview.averageOrderValue)} /><Mini label="Quy mô giỏ" value={`${data.overview.basketSize.toLocaleString('vi-VN', { maximumFractionDigits: 2 })} món`} /><Mini label="Giờ vàng" value={peak ? `${peak.hour}h` : '—'} /></div><div className="analyst-chart analyst-hour-chart"><ResponsiveContainer width="100%" height="100%"><BarChart data={data.hourly}><CartesianGrid stroke="#edf1f6" vertical={false}/><XAxis dataKey="hour" tickFormatter={(value) => `${value}h`} tickLine={false}/><YAxis axisLine={false} tickLine={false}/><Tooltip formatter={(value) => `${value} đơn`}/><Bar dataKey="invoices" radius={[8,8,0,0]}>{data.hourly.map((row) => <Cell key={row.hour} fill={row.hour === peak?.hour ? '#b832ee' : '#d9cffb'} />)}</Bar></BarChart></ResponsiveContainer></div></article>
        </section>

        <section className="analyst-grid analyst-grid-equal">
          <article className="analyst-card"><CardTitle icon="◕" title="Kênh bán từ API" subtitle="Theo OrderType và DeliveryPartnerName của CUKCUK" /><div className="analyst-channel-layout"><div className="analyst-donut"><ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={data.channels} dataKey="revenue" nameKey="name" innerRadius="62%" outerRadius="88%" paddingAngle={2}>{data.channels.map((row, index) => <Cell key={row.name} fill={COLORS[index % COLORS.length]} />)}</Pie><Tooltip formatter={(value) => money(Number(value))}/></PieChart></ResponsiveContainer><div><strong>{compactMoney(data.overview.revenue)}</strong><span>Tổng doanh thu</span></div></div><ul className="analyst-channel-list">{data.channels.map((channel, index) => <li key={channel.name}><i style={{ background: COLORS[index % COLORS.length] }}/><span><strong>{channel.name}</strong><small>{channel.invoices} đơn</small></span><b>{percent(channel.revenue, data.overview.revenue)}</b><em>{compactMoney(channel.revenue)}</em></li>)}</ul></div></article>
          <article className="analyst-card"><CardTitle icon="▰" title="Xếp hạng chi nhánh" subtitle="Theo doanh thu trong kỳ lọc" /><div className="analyst-branch-list">{[...data.branchRows].sort((a,b) => b.revenue-a.revenue).map((branch, index) => <div key={branch.id}><b>{index + 1}</b><span><strong>{branch.name}</strong><small>{branch.invoiceCount} đơn · {branch.quantity.toLocaleString('vi-VN')} phần</small></span><em>{money(branch.revenue)}</em></div>)}</div></article>
        </section>
      </>}
    </main>
  )
}

function KpiCard({ tone, label, value, detail }: { tone: string; label: string; value: string; detail: string }) { return <article className={`analyst-kpi ${tone}`}><span>{label}</span><strong>{value}</strong><small>{detail}</small></article> }
function CardTitle({ icon, title, subtitle }: { icon: string; title: string; subtitle: string }) { return <header className="analyst-card-title"><b>{icon}</b><div><h2>{title}</h2><p>{subtitle}</p></div></header> }
function Insight({ tone, title, children }: { tone: string; title: string; children: ReactNode }) { return <div className={`analyst-insight ${tone}`}><strong>{title}</strong><p>{children}</p></div> }
function Mini({ label, value }: { label: string; value: string }) { return <div><span>{label}</span><strong>{value}</strong></div> }
function money(value: number) { return `${Math.round(value).toLocaleString('vi-VN')}đ` }
function compactMoney(value: number) { return value >= 1_000_000 ? `${(value / 1_000_000).toLocaleString('vi-VN', { maximumFractionDigits: 1 })} tr` : money(value) }
function formatNumber(value: number) { return value.toLocaleString('vi-VN', { maximumFractionDigits: 2 }) }
function percent(value: number, total: number) { return total ? `${Math.round(value / total * 100)}%` : '0%' }
function percentRate(value: number) { return `${(value * 100).toLocaleString('vi-VN', { maximumFractionDigits: 1 })}%` }
function formatDate(value: string) { const [year, month, day] = value.slice(0,10).split('-'); return `${day}/${month}/${year}` }
function formatDateTime(value: string) { return new Date(value).toLocaleString('vi-VN', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit', year: 'numeric' }) }
function currentMonthRange() { const now = new Date(); const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit' }); const to = formatter.format(now); return { from: `${to.slice(0, 7)}-01`, to } }
