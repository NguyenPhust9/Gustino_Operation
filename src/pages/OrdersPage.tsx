import { useEffect, useMemo, useRef, useState } from 'react'
import { getProducts } from '../lib/constants'
import { branchName } from '../lib/branches'
import { fetchConfiguredProducts } from '../lib/products'
import { canvasToBlob, shareOrDownloadBlob } from '../lib/browser'
import { localDateKey } from '../lib/dates'
import { supabase, uniqueChannelName } from '../lib/supabase'
import {
  createSupplyRequests,
  deleteSupplyRequest,
  fetchSupplyRequests,
  formatSupplyRequestDelivery as formatRequestedDelivery,
  updateSupplyRequestStatus,
  type SupplyDeliveryPeriod,
  type SupplyRequest,
} from '../lib/supplyRequests'
import type { AppUser, StockMovement } from '../types'

interface Props {
  user: AppUser
  movements: StockMovement[]
}

interface OrderDraftLine {
  id: string
  productName: string
  quantity: string
  unit: string
  note: string
  specificationHint: string
}

type OrderStatusFilter = 'all' | SupplyRequest['status']

const emptyOrderLine = (): OrderDraftLine => ({
  id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
  productName: '',
  quantity: '',
  unit: 'kg',
  note: '',
  specificationHint: '',
})

export function OrdersPage({ user }: Props) {
  const [lines, setLines] = useState<OrderDraftLine[]>(() => [emptyOrderLine()])
  const [requests, setRequests] = useState<SupplyRequest[]>([])
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [feedback, setFeedback] = useState('')
  const [productTick, setProductTick] = useState(0)
  const [statusFilter, setStatusFilter] = useState<OrderStatusFilter>('all')
  const [dateFilter, setDateFilter] = useState('')
  const [searchFilter, setSearchFilter] = useState('')
  const [requestedDeliveryDate, setRequestedDeliveryDate] = useState(() => localDateKey())
  const [requestedDeliveryPeriod, setRequestedDeliveryPeriod] = useState<SupplyDeliveryPeriod>('morning')
  const firstInputRef = useRef<HTMLInputElement>(null)
  const reportRef = useRef<HTMLDivElement>(null)
  const currentBranchName = branchName(user.branchId)
  const branchIds = useMemo(() => [user.branchId], [user.branchId])
  const pending = requests.filter((item) => item.status === 'pending')
  const activeRequests = requests.filter((item) => item.status !== 'fulfilled' && item.status !== 'cancelled')
  const doneRequests = requests.filter((item) => item.status === 'fulfilled' || item.status === 'cancelled')
  const filteredRequests = useMemo(() => {
    const keyword = searchFilter.trim().toLowerCase()
    return requests.filter((item) => {
      const createdDate = (item.createdAt || '').slice(0, 10)
      if (statusFilter !== 'all' && item.status !== statusFilter) return false
      if (dateFilter && createdDate !== dateFilter) return false
      if (keyword && !`${item.productName} ${item.note} ${item.requestedByName}`.toLowerCase().includes(keyword)) return false
      return true
    })
  }, [requests, statusFilter, dateFilter, searchFilter])
  // Gom đơn đã gửi theo ngày để coi lại theo ngày/tháng/năm — bấm ngày mới xổ danh sách của ngày đó.
  const requestsByDate = useMemo(() => {
    const map = new Map<string, SupplyRequest[]>()
    filteredRequests.forEach((item) => {
      const key = (item.createdAt || '').slice(0, 10) || 'khác'
      map.set(key, [...(map.get(key) || []), item])
    })
    return Array.from(map.entries())
      .map(([date, rows]) => [date, rows.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt))] as const)
      .sort((a, b) => b[0].localeCompare(a[0]))
  }, [filteredRequests])
  const orderProducts = useMemo(
    () => getProducts().filter((product) => product.active !== false),
    [productTick],
  )

  useEffect(() => {
    const update = () => setProductTick((tick) => tick + 1)
    window.addEventListener('gustino-products-updated', update)
    window.addEventListener('storage', update)
    void fetchConfiguredProducts(user).then(update).catch(() => {})
    return () => {
      window.removeEventListener('gustino-products-updated', update)
      window.removeEventListener('storage', update)
    }
  }, [user.id, user.authToken])

  async function refresh(showLoading = true) {
    if (showLoading) setLoading(true)
    try {
      setRequests(await fetchSupplyRequests(user, branchIds))
    } catch (reason) {
      setFeedback(reason instanceof Error ? reason.message : 'Không thể tải danh sách đặt hàng.')
    } finally {
      if (showLoading) setLoading(false)
    }
  }

  useEffect(() => { void refresh() }, [user.id, user.branchId])

  useEffect(() => {
    const refreshSilently = () => {
      if (document.visibilityState === 'hidden') return
      void refresh(false)
    }
    window.addEventListener('focus', refreshSilently)
    window.addEventListener('online', refreshSilently)
    // visibilitychange là sự kiện của document (trên window chỉ chạy nhờ bubbling).
    document.addEventListener('visibilitychange', refreshSilently)
    const timer = window.setInterval(refreshSilently, 30000)
    const client = supabase
    const channel = client
      ? client.channel(uniqueChannelName(`orders:${user.branchId}`))
        .on('postgres_changes', {
          event: '*',
          schema: 'public',
          table: 'supply_requests',
          filter: `branch_id=eq.${user.branchId}`,
        }, refreshSilently)
        .subscribe()
      : null
    return () => {
      window.removeEventListener('focus', refreshSilently)
      window.removeEventListener('online', refreshSilently)
      document.removeEventListener('visibilitychange', refreshSilently)
      window.clearInterval(timer)
      if (client && channel) void client.removeChannel(channel)
    }
  }, [user.id, user.branchId, user.authToken])

  function updateLine(id: string, patch: Partial<OrderDraftLine>) {
    setLines((items) => items.map((line) => line.id === id ? { ...line, ...patch } : line))
  }

  function updateLineProduct(id: string, value: string) {
    const selected = orderProducts.find((product) =>
      product.name === value || product.sku === value || `${product.sku} · ${product.name}` === value,
    )
    updateLine(id, {
      productName: selected?.name || value,
      unit: selected?.inboundUnit || selected?.unit || lines.find((line) => line.id === id)?.unit || 'kg',
      specificationHint: selected?.orderSpecificationHint || '',
    })
  }

  function addLine() {
    setLines((items) => [...items, emptyOrderLine()])
  }

  function removeLine(id: string) {
    setLines((items) => items.length === 1 ? items : items.filter((line) => line.id !== id))
  }

  async function submitOrder(event: React.FormEvent) {
    event.preventDefault()
    const validLines = lines
      .map((line) => ({
        productName: line.productName.trim(),
        quantity: Number(line.quantity),
        unit: line.unit.trim() || 'kg',
        note: line.note.trim(),
      }))
      .filter((line) => line.productName && Number.isFinite(line.quantity) && line.quantity > 0)
    if (!validLines.length) {
      setFeedback('Hãy nhập ít nhất một món và số lượng lớn hơn 0.')
      return
    }
    if (!requestedDeliveryDate) {
      setFeedback('Hãy chọn ngày nhận hàng mong muốn.')
      return
    }
    if (requestedDeliveryDate < localDateKey()) {
      setFeedback('Ngày nhận hàng mong muốn không thể trước ngày hôm nay.')
      return
    }
    setBusy(true)
    try {
      await createSupplyRequests(user, validLines, { requestedDeliveryDate, requestedDeliveryPeriod })
      const blank = emptyOrderLine()
      setLines([blank])
      setFeedback(`Đã gửi ${validLines.length} món đến bếp/quản lý.`)
      await refresh()
    } catch (reason) {
      setFeedback(reason instanceof Error ? reason.message : 'Không thể gửi yêu cầu đặt hàng.')
    } finally {
      setBusy(false)
    }
  }

  async function cancelRequest(request: SupplyRequest) {
    if (request.status === 'cancelled') return
    if (!window.confirm(`Hủy đơn "${request.productName}"? Đơn sẽ chuyển sang trạng thái Đã hủy.`)) return
    setBusy(true)
    try {
      await updateSupplyRequestStatus(user, request.id, 'cancelled')
      setFeedback(`Đã hủy đơn "${request.productName}".`)
      await refresh()
    } catch (reason) {
      setFeedback(reason instanceof Error ? reason.message : 'Không thể hủy đơn đặt hàng.')
    } finally {
      setBusy(false)
    }
  }

  async function removeRequest(request: SupplyRequest) {
    if (!window.confirm(`Xóa vĩnh viễn đơn "${request.productName}"? Thao tác này không thể hoàn tác.`)) return
    setBusy(true)
    try {
      await deleteSupplyRequest(user, request.id)
      setFeedback(`Đã xóa đơn "${request.productName}".`)
      await refresh()
    } catch (reason) {
      setFeedback(reason instanceof Error ? reason.message : 'Không thể xóa đơn đặt hàng.')
    } finally {
      setBusy(false)
    }
  }

  async function exportOrderReportImage() {
    const target = reportRef.current
    if (!target) {
      setFeedback('Báo cáo chưa sẵn sàng để xuất ảnh. Hãy thử lại sau khi trang tải xong.')
      return
    }
    setBusy(true)
    try {
      target.classList.add('order-report-sheet-export')
      if (activeRequests.length > 14) target.classList.add('dense')
      await waitForPaint()
      const { default: html2canvas } = await import('html2canvas')
      const canvas = await html2canvas(target, {
        scale: 2,
        backgroundColor: '#fffdf4',
        useCORS: true,
        logging: false,
        width: 1080,
        height: 1350,
        windowWidth: 1080,
        windowHeight: 1350,
      })
      const fileName = `GUSTINO-dat-hang-${user.branchId}-${new Date().toISOString().slice(0, 10)}.png`
      const blob = await canvasToBlob(canvas, 'image/png')
      const result = await shareOrDownloadBlob(blob, fileName, { title: `Phiếu đặt hàng ${currentBranchName}` })
      setFeedback(result === 'shared' ? 'Đã mở chia sẻ phiếu đặt hàng.' : 'Đã tải ảnh phiếu đặt hàng.')
    } catch (reason) {
      setFeedback(reason instanceof Error ? reason.message : 'Không thể xuất ảnh báo cáo đặt hàng.')
    } finally {
      target.classList.remove('order-report-sheet-export', 'dense')
      setBusy(false)
    }
  }

  return (
    <div className="page orders-page">
      <div className="page-heading">
        <div>
          <span className="eyebrow dark">ĐẶT HÀNG</span>
          <h1>Báo hàng cần nhập</h1>
          <p>{currentBranchName || user.branchId} · Gửi nhiều món một lần, bếp và quản lý cùng nhìn thấy trạng thái xử lý.</p>
        </div>
        <span className={pending.length ? 'date-chip warning' : 'date-chip'}>{pending.length} đơn chờ nhận</span>
      </div>

      {feedback && <div className={`feedback-bar${feedback.startsWith('Đã gửi') ? ' success' : ''}`}>{feedback}<button onClick={() => setFeedback('')}>×</button></div>}

      <div className="orders-layout">
        <section className="entry-card orders-form-card">
          <div className="section-title">
            <div><span className="eyebrow dark">PHIẾU MỚI</span><h2>Danh sách hàng cần đặt</h2></div>
            <button className="secondary-button" type="button" onClick={addLine}>+ Thêm món</button>
          </div>
          <form onSubmit={submitOrder}>
            <div className="order-delivery-fields">
              <label>
                <span>Ngày nhận mong muốn</span>
                <input
                  type="date"
                  min={localDateKey()}
                  value={requestedDeliveryDate}
                  onChange={(event) => setRequestedDeliveryDate(event.target.value)}
                  required
                />
              </label>
              <label>
                <span>Buổi nhận</span>
                <select
                  value={requestedDeliveryPeriod}
                  onChange={(event) => setRequestedDeliveryPeriod(event.target.value as SupplyDeliveryPeriod)}
                >
                  <option value="morning">Sáng</option>
                  <option value="noon">Trưa</option>
                  <option value="afternoon">Chiều</option>
                </select>
              </label>
              <p>📦 Lịch nhận này áp dụng cho tất cả món trong phiếu.</p>
            </div>
            <div className="order-entry-table page-order-lines">
              <div className="order-entry-head" aria-hidden="true">
                <span>#</span><span>Hàng cần đặt</span><span>Gợi ý quy cách</span><span>Số lượng</span><span>Đơn vị</span><span>Ghi chú</span><span></span>
              </div>
              {lines.map((line, index) => (
                <div className="order-entry-row" key={line.id}>
                  <strong className="order-entry-index">{index + 1}</strong>
                  <label className="order-entry-product"><span>Hàng cần đặt</span>
                    <input
                      ref={index === 0 ? firstInputRef : undefined}
                      list="order-product-suggestions"
                      value={line.productName}
                      onChange={(event) => updateLineProduct(line.id, event.target.value)}
                      placeholder="Chọn từ danh sách SKU..."
                      required={index === 0}
                    />
                  </label>
                  <div className="order-entry-specification" title={line.specificationHint || undefined}>
                    <span>Gợi ý quy cách</span>
                    {line.specificationHint || '—'}
                  </div>
                  <label className="order-entry-quantity"><span>Số lượng</span>
                      <input
                        type="number"
                        min="0.1"
                        step="0.1"
                        value={line.quantity}
                        onChange={(event) => updateLine(line.id, { quantity: event.target.value })}
                        placeholder="10"
                        required={index === 0}
                      />
                  </label>
                  <label className="order-entry-unit"><span>Đơn vị</span>
                      <select value={line.unit} onChange={(event) => updateLine(line.id, { unit: event.target.value })}>
                        <option value="kg">kg</option>
                        <option value="túi">túi</option>
                        <option value="thùng">thùng</option>
                        <option value="hộp">hộp</option>
                        <option value="cái">cái</option>
                        <option value="chai">chai</option>
                        <option value="phần">phần</option>
                        <option value="lít">lít</option>
                      </select>
                  </label>
                  <label className="order-entry-note"><span>Ghi chú</span>
                    <input
                      value={line.note}
                      onChange={(event) => updateLine(line.id, { note: event.target.value })}
                      placeholder="Cần trước 9 giờ sáng, loại A..."
                    />
                  </label>
                  <div className="order-entry-remove">
                    {lines.length > 1 && <button type="button" onClick={() => removeLine(line.id)} aria-label={`Xóa món ${index + 1}`}>×</button>}
                  </div>
                </div>
              ))}
            </div>
            <datalist id="order-product-suggestions">
              {orderProducts.map((product) => (
                <option key={product.id} value={product.name} label={`${product.sku} · ${product.name}`} />
              ))}
            </datalist>
            <div className="supply-modal-actions orders-actions">
              <button type="button" className="secondary-button" onClick={() => setLines([emptyOrderLine()])}>Làm lại</button>
              <button type="button" className="secondary-button" onClick={() => void exportOrderReportImage()} disabled={busy}>{busy ? 'Đang xuất…' : 'Xuất báo cáo'}</button>
              <button type="submit" className="primary-button" disabled={busy}>{busy ? 'Đang gửi…' : 'Gửi yêu cầu →'}</button>
            </div>
          </form>
        </section>

        <section className="section-card orders-status-card">
          <div className="section-title">
            <div><span className="eyebrow dark">TRẠNG THÁI</span><h2>Đơn đã gửi</h2></div>
            <button className="text-button" onClick={() => void refresh()}>{loading ? 'Đang tải…' : 'Tải lại'}</button>
          </div>
          {/* Phiếu xuất ảnh — tên hàng TỰ ĐIỀN từ đơn đã gửi (không lấy từ ô đang nhập). */}
          <div className="order-report-sheet" ref={reportRef}>
            <div className="order-report-head">
              <div>
                <span>GUSTINO · PHIẾU ĐẶT HÀNG</span>
                <strong>{currentBranchName || user.branchId}</strong>
                <small>{formatDateTime(new Date().toISOString())} · Người lập: {user.name}</small>
              </div>
              <b>{pending.length} chờ nhận</b>
            </div>
            <div className="order-report-grid">
              <article>
                <span>Đơn đã gửi</span>
                <strong>{activeRequests.length}</strong>
                <small>đang xử lý</small>
              </article>
              <article>
                <span>Chờ nhận</span>
                <strong>{pending.length}</strong>
                <small>yêu cầu</small>
              </article>
              <article>
                <span>Đã xong / hủy</span>
                <strong>{doneRequests.length}</strong>
                <small>yêu cầu</small>
              </article>
            </div>
            <table className="order-report-table">
              <thead>
                <tr><th>#</th><th>Tên hàng</th><th>SL</th><th>Ngày đặt / nhận</th><th>Trạng thái</th><th>Người đặt</th></tr>
              </thead>
              <tbody>
                {activeRequests.length ? activeRequests.map((request, index) => (
                  <tr key={request.id}>
                    <td data-label="STT">{index + 1}</td>
                    <td data-label="Tên hàng">
                      <strong>{request.productName}</strong>
                      {request.note ? <small>{request.note}</small> : null}
                    </td>
                    <td className="num" data-label="Số lượng">{formatNumber(request.quantity)} {request.unit}</td>
                    <td data-label="Ngày đặt / nhận">
                      <small>Ngày đặt: {formatDateTime(request.createdAt)}</small>
                      <strong>{formatRequestedDelivery(request)}</strong>
                    </td>
                    <td data-label="Trạng thái"><span className={`order-report-status ${request.status}`}>{statusLabel(request.status)}</span></td>
                    <td data-label="Người đặt">{request.requestedByName}</td>
                  </tr>
                )) : (
                  <tr><td colSpan={6} className="order-report-empty">Chưa có đơn nào đang xử lý. Gửi yêu cầu đặt hàng để phiếu tự điền tên hàng.</td></tr>
                )}
              </tbody>
            </table>
            <footer className="order-report-footer">
              <span>Người lập: <strong>{user.name}</strong></span>
              <span>GUSTINO · PHIẾU ĐẶT HÀNG NỘI BỘ</span>
            </footer>
          </div>

          {/* Đơn đã gửi — danh sách gọn, gom theo ngày; bấm ngày mới xổ ra. */}
          <div className="orders-filter-bar">
            <label>Trạng thái
              <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as OrderStatusFilter)}>
                <option value="all">Tất cả</option>
                <option value="pending">Chờ bếp xác nhận</option>
                <option value="acknowledged">Bếp đã xác nhận</option>
                <option value="fulfilled">Bếp đã gửi</option>
                <option value="cancelled">Đã hủy</option>
              </select>
            </label>
            <label>Ngày gửi
              <input type="date" value={dateFilter} onChange={(event) => setDateFilter(event.target.value)} />
            </label>
            <label>Tìm đơn
              <input value={searchFilter} onChange={(event) => setSearchFilter(event.target.value)} placeholder="Tên hàng, ghi chú..." />
            </label>
            {(statusFilter !== 'all' || dateFilter || searchFilter) && (
              <button type="button" className="mini-button ghost" onClick={() => { setStatusFilter('all'); setDateFilter(''); setSearchFilter('') }}>Xóa lọc</button>
            )}
          </div>
          <div className="orders-history">
            {requestsByDate.length ? requestsByDate.map(([date, rows], index) => {
              const dayPending = rows.filter((row) => row.status === 'pending').length
              return (
                <details className="orders-day" key={date} open={index === 0}>
                  <summary>
                    <span><strong>{date === 'khác' ? 'Khác' : formatDay(date)}</strong><small>{rows.length} đơn{dayPending ? ` · ${dayPending} chờ nhận` : ''}</small></span>
                    <b className={dayPending ? 'warn' : ''}>{dayPending || '✓'}</b>
                  </summary>
                  <div className="supply-request-list compact">
                    {rows.map((request) => <OrderRequestItem
                      key={request.id}
                      request={request}
                      busy={busy}
                      onCancel={() => void cancelRequest(request)}
                      onDelete={() => void removeRequest(request)}
                    />)}
                  </div>
                </details>
              )
            }) : <p className="empty-copy">{loading ? 'Đang tải đơn đặt hàng…' : 'Chưa có đơn đặt hàng nào.'}</p>}
          </div>
        </section>
      </div>
    </div>
  )
}

function OrderRequestItem({
  request,
  busy,
  onCancel,
  onDelete,
}: {
  request: SupplyRequest
  busy: boolean
  onCancel: () => void
  onDelete: () => void
}) {
  const canCancel = request.status === 'pending' || request.status === 'acknowledged'
  return (
    <article className={`supply-request-item${request.status === 'pending' ? ' pending' : ''}`}>
      <span className="supply-request-icon">↑</span>
      <span>
        <strong>{request.productName} · {formatNumber(request.quantity)} {request.unit}</strong>
        <small>Ngày đặt: {formatDateTime(request.createdAt)} · {request.requestedByName}{request.note ? ` · "${request.note}"` : ''}</small>
        <small className="order-request-delivery">Nhận dự kiến: {formatRequestedDelivery(request)}</small>
      </span>
      <span className="supply-request-tail">
        <span className={`supply-status-badge ${request.status}`}>{statusLabel(request.status)}</span>
        <span className="supply-request-actions">
          {canCancel && <button type="button" className="mini-button ghost" disabled={busy} onClick={onCancel}>Hủy</button>}
          <button type="button" className="mini-button danger" disabled={busy} onClick={onDelete}>Xóa</button>
        </span>
      </span>
    </article>
  )
}

function statusLabel(status: SupplyRequest['status']) {
  return status === 'pending' ? 'Chờ bếp xác nhận'
    : status === 'acknowledged' ? 'Bếp đã xác nhận'
      : status === 'cancelled' ? 'Đã hủy'
        : 'Bếp đã gửi'
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString('vi-VN', { hour12: false, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

function formatDay(value: string) {
  const [year, month, day] = value.split('-')
  if (!day) return value
  return `${day}/${month}/${year}`
}

function formatNumber(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1)
}

function waitForPaint() {
  return new Promise<void>((resolve) => {
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => resolve()))
  })
}
