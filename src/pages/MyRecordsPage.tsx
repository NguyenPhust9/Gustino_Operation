import { useEffect, useMemo, useState } from 'react'
import { fetchAttendanceRecords, fetchShiftRegistrations, findAttendanceRecordForRegistration, permittedBranchIds } from '../lib/attendance'
import { fetchSalesReceiptsRange, type SalesReceipt } from '../lib/salesReceipts'
import { localDateKey } from '../lib/dates'
import { ReportArchiveContent } from './ReportArchivePage'
import type { Page } from '../components/AppShell'
import type { AppUser, AttendanceRecord, ShiftRegistration } from '../types'

type RecordsTab = 'personal' | 'archive'

export function MyRecordsPage({ user, onNavigate }: { user: AppUser; onNavigate: (page: Page) => void }) {
  const isManagement = (user.role === 'admin' || user.role === 'manager') && !user.canRoamBranches
  const [tab, setTab] = useState<RecordsTab>(isManagement ? 'archive' : 'personal')
  if (isManagement) {
    return (
      <div className="page my-records-page">
        <div className="page-heading">
          <div>
            <span className="eyebrow dark">KHO BÁO CÁO</span>
            <h1>Báo cáo đã chốt</h1>
            <p>Kho lưu trữ báo cáo theo ngày, tháng, năm và chi nhánh. Lịch sử cá nhân chỉ dành cho nhân viên và ca trưởng.</p>
          </div>
        </div>
        <ReportArchiveContent user={user} />
      </div>
    )
  }
  return (
    <div className="page my-records-page">
      <div className="page-heading">
        <div>
          <span className="eyebrow dark">LỊCH SỬ & BÁO CÁO</span>
          <h1>{tab === 'personal' ? 'Hóa đơn bán hàng & giờ công' : 'Kho báo cáo đã chốt'}</h1>
          <p>{tab === 'personal'
            ? 'Xem lại hóa đơn POS đã tạo và các ca làm/check-in/check-out của chính tài khoản này.'
            : 'Xem lại báo cáo cuối ca/cuối ngày đã lưu tự động theo ngày, tháng và chi nhánh.'}</p>
        </div>
      </div>
      <nav className="control-tabs" aria-label="Lịch sử và báo cáo">
        <button className={tab === 'personal' ? 'active' : ''} onClick={() => setTab('personal')}>Lịch sử của tôi</button>
        <button className={tab === 'archive' ? 'active' : ''} onClick={() => setTab('archive')}>Kho báo cáo</button>
      </nav>
      {tab === 'personal'
        ? <PersonalRecords user={user} onNavigate={onNavigate} />
        : <ReportArchiveContent user={user} />}
    </div>
  )
}

function PersonalRecords({ user, onNavigate }: { user: AppUser; onNavigate: (page: Page) => void }) {
  const today = localDateKey()
  const [from, setFrom] = useState(() => offsetDate(today, -6))
  const [to, setTo] = useState(today)
  const [receipts, setReceipts] = useState<SalesReceipt[]>([])
  const [records, setRecords] = useState<AttendanceRecord[]>([])
  const [registrations, setRegistrations] = useState<ShiftRegistration[]>([])
  const [loading, setLoading] = useState(true)
  const [feedback, setFeedback] = useState('')

  async function refresh(showLoading = false) {
    if (showLoading) setLoading(true)
    try {
      const targetBranchIds = user.canRoamBranches ? permittedBranchIds(user) : [user.branchId]
      const [nextReceipts, nextRecords, nextRegistrations] = await Promise.all([
        fetchSalesReceiptsRange(user, { branchIds: targetBranchIds, from, to }),
        fetchAttendanceRecords(user, { branchId: user.canRoamBranches ? undefined : user.branchId, userId: user.id, from, to }),
        fetchShiftRegistrations(user, { branchId: user.canRoamBranches ? undefined : user.branchId, userId: user.id, from, to }),
      ])
      setReceipts(nextReceipts.filter((receipt) =>
        receipt.sellerId === user.id
        || receipt.createdBy === user.id
        || receipt.sellerKey === user.id
        || normalizeName(receipt.sellerName) === normalizeName(user.name),
      ))
      setRecords(nextRecords)
      setRegistrations(nextRegistrations.filter((item) => item.userId === user.id && item.status !== 'rejected'))
      setFeedback('')
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : 'Không thể tải lịch sử của bạn.')
    } finally {
      if (showLoading) setLoading(false)
    }
  }

  useEffect(() => { void refresh(true) }, [user.id, user.branchId, from, to])

  const totals = useMemo(() => ({
    revenue: receipts.reduce((sum, receipt) => sum + receipt.totalAmount, 0),
    quantity: receipts.reduce((sum, receipt) => sum + receipt.totalQuantity, 0),
    receiptCount: receipts.length,
    hours: records.reduce((sum, record) => {
      const end = record.checkOutTime ? new Date(record.checkOutTime).getTime() : Date.now()
      return sum + Math.max(0, (end - new Date(record.checkInTime).getTime()) / 36e5)
    }, 0),
  }), [receipts, records])

  const shiftRows = registrations.map((registration) => {
    const record = findAttendanceRecordForRegistration(records, registration)
    const hours = record
      ? Math.max(0, ((record.checkOutTime ? new Date(record.checkOutTime).getTime() : Date.now()) - new Date(record.checkInTime).getTime()) / 36e5)
      : 0
    return { registration, record, hours }
  }).sort((a, b) => b.registration.workDate.localeCompare(a.registration.workDate) || b.registration.startTime.localeCompare(a.registration.startTime))

  return (
    <div className="my-records-content">
      {feedback && <div className="feedback-bar">{feedback}<button onClick={() => setFeedback('')}>×</button></div>}

      <section className="my-record-filters">
        <label>Từ ngày<input type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></label>
        <label>Đến ngày<input type="date" value={to} min={from} onChange={(event) => setTo(event.target.value)} /></label>
        <button className="secondary-button" onClick={() => void refresh(true)}>Làm mới</button>
      </section>

      <section className="my-record-kpis">
        <article><span>Doanh thu</span><strong>{formatMoney(totals.revenue)}</strong><small>{totals.receiptCount} hóa đơn</small></article>
        <article><span>Sản phẩm đã bán</span><strong>{formatNumber(totals.quantity)}</strong><small>theo POS</small></article>
        <article><span>Giờ công</span><strong>{formatNumber(totals.hours)}</strong><small>đã check-in</small></article>
      </section>

      {loading ? <section className="section-card">Đang tải lịch sử...</section> : (
        <div className="my-record-grid">
          <section className="section-card">
            <div className="section-title"><div><span className="eyebrow dark">HÓA ĐƠN</span><h2>POS đã bán</h2></div><span className="date-chip">{receipts.length}</span></div>
            <div className="my-receipt-list">
              {receipts.map((receipt) => (
                <article key={receipt.id}>
                  <div><strong>{receipt.code}</strong><small>{formatDateTime(receipt.createdAt)} · {receipt.totalQuantity} sản phẩm</small></div>
                  <b>{formatMoney(receipt.totalAmount)}</b>
                </article>
              ))}
              {!receipts.length && <p className="empty-copy">Chưa có hóa đơn POS trong khoảng ngày này.</p>}
            </div>
          </section>

          <section className="section-card">
            <div className="section-title"><div><span className="eyebrow dark">GIỜ CÔNG</span><h2>Ca làm của tôi</h2></div><span className="date-chip">{shiftRows.length}</span></div>
            <div className="my-shift-list">
              {shiftRows.map(({ registration, record, hours }) => (
                <article key={registration.id}>
                  <div>
                    <strong>{formatDate(registration.workDate)} · {registration.startTime}-{registration.endTime}</strong>
                    <small>{record ? `Check-in ${formatTime(record.checkInTime)}${record.checkOutTime ? ` · Check-out ${formatTime(record.checkOutTime)}` : ' · chưa check-out'}` : 'Chưa check-in'}</small>
                  </div>
                  <b>{formatNumber(hours)} giờ</b>
                </article>
              ))}
              {!shiftRows.length && <p className="empty-copy">Chưa có ca làm trong khoảng ngày này.</p>}
            </div>
          </section>
        </div>
      )}
    </div>
  )
}

function offsetDate(date: string, days: number) {
  const cursor = new Date(`${date}T00:00:00`)
  cursor.setDate(cursor.getDate() + days)
  return localDateKey(cursor)
}

function normalizeName(value: string) {
  return value.trim().toLocaleLowerCase('vi').normalize('NFD').replace(/\p{Diacritic}/gu, '')
}

function formatMoney(value: number) {
  return `${Math.round(value).toLocaleString('vi-VN')}đ`
}

function formatNumber(value: number) {
  return new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 1 }).format(value)
}

function formatDate(value: string) {
  return new Date(`${value}T00:00:00`).toLocaleDateString('vi-VN')
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString('vi-VN', { hour12: false })
}

function formatTime(value: string) {
  return new Date(value).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })
}
