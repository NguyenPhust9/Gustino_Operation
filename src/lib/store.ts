import { getProducts, isWarehouseProduct } from './constants'
import { createId, readLocalJson } from './browser'
import { isDuplicateKey, isMissingRpc, isMissingUniqueConstraint, userHeaders } from './core'
import { localDateKey, localDayBoundsIso } from './dates'
import { roundQuantity } from './inventoryEntry'
import { shouldUseLanApi, supabase } from './supabase'
import { clearReadCache, invalidateReadCache } from './readCache'
import type { AppUser, InventoryReport, OperationDay, ReportSnapshot, StockLine, StockMovement } from '../types'

const USER_KEY = 'gustino_user_v1'
const LEGACY_USER_KEY = 'gustino_demo_user_v1'

async function lanApi<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
  })
  if (!response.ok) throw new Error((await response.json().catch(() => null))?.error || 'Máy chủ đồng bộ không phản hồi.')
  return response.json() as Promise<T>
}

export function loadLocalUser(): AppUser | null {
  return readLocalJson<AppUser | null>(USER_KEY, null) || readLocalJson<AppUser | null>(LEGACY_USER_KEY, null)
}

export function saveLocalUser(user: AppUser | null) {
  if (!user) clearReadCache()
  try {
    if (user) localStorage.setItem(USER_KEY, JSON.stringify(user))
    else localStorage.removeItem(USER_KEY)
    localStorage.removeItem(LEGACY_USER_KEY)
  } catch {
    // Một số trình duyệt điện thoại chặn localStorage ở chế độ riêng tư.
  }
}

export function clearLocalBusinessCache() {
  const keep = new Set([
    USER_KEY,
    LEGACY_USER_KEY,
    'gustino_lang',
    'gustino_sidebar_collapsed',
  ])
  try {
    Object.keys(localStorage).forEach((key) => {
      if (key.startsWith('gustino_') && !keep.has(key)) localStorage.removeItem(key)
    })
  } catch {
    // Best-effort cleanup. Some mobile/private browsers can block storage iteration.
  }
}

export function loadLocalMovements(): StockMovement[] {
  return []
}

export function saveLocalMovements(items: StockMovement[]) {
  void items
}

const STOCK_MOVEMENT_PAGE_SIZE = 1000
/** Số trang kéo song song mỗi lượt. 4 × 1000 phủ hết chi nhánh lớn nhất trong MỘT lượt đi-về. */
const STOCK_MOVEMENT_PAGE_BATCH = 4

async function fetchAllMovementRows(
  loadPage: (from: number, to: number) => PromiseLike<{ data: any[] | null; error: any }>,
): Promise<any[]> {
  const rows: any[] = []
  for (let from = 0; ; from += STOCK_MOVEMENT_PAGE_SIZE) {
    const { data, error } = await loadPage(from, from + STOCK_MOVEMENT_PAGE_SIZE - 1)
    if (error) throw error
    const page = data || []
    rows.push(...page)
    if (page.length < STOCK_MOVEMENT_PAGE_SIZE) return rows
  }
}

/**
 * Kéo hết sổ kho mà KHÔNG hỏi tổng số dòng trước.
 *
 * Bản cũ gọi `select('id', { count: 'exact', head: true })` để biết số trang.
 * Trên prod (07/08/2026) truy vấn đếm đó là điểm nghẽn của cả hệ thống:
 * **15.428 lượt × 2.025 ms trung bình = 8,7 giờ thời gian CPU database**, trong
 * khi lấy CHÍNH dữ liệu chỉ 34 ms. Lý do: `count exact` phải quét toàn bộ dòng
 * của chi nhánh và chạy RLS `can_manage_branch()` trên từng dòng, còn lượt lấy
 * dữ liệu thì dừng ở 1.000 dòng đầu. Đây vừa là nguồn "web lag quá", vừa là
 * lượt trả HTTP 500 trong console (statement timeout).
 *
 * Nay kéo song song theo lô và dừng khi gặp trang chưa đầy — không cần biết
 * trước tổng số dòng. Chi nhánh lớn nhất (~2.800 dòng) xong trong đúng một lượt.
 */
async function fetchMovementPagesParallel(
  loadPage: (from: number, to: number) => PromiseLike<{ data: any[] | null; error: any }>,
): Promise<any[]> {
  const rows: any[] = []
  for (let batch = 0; ; batch += 1) {
    const pages = await Promise.all(
      Array.from({ length: STOCK_MOVEMENT_PAGE_BATCH }, (_, index) => {
        const from = (batch * STOCK_MOVEMENT_PAGE_BATCH + index) * STOCK_MOVEMENT_PAGE_SIZE
        return loadPage(from, from + STOCK_MOVEMENT_PAGE_SIZE - 1)
      }),
    )
    let lastPageWasFull = true
    for (const page of pages) {
      if (page.error) throw page.error
      const data = page.data || []
      rows.push(...data)
      if (data.length < STOCK_MOVEMENT_PAGE_SIZE) { lastPageWasFull = false; break }
    }
    if (!lastPageWasFull) return rows
  }
}

function mapMovementRow(row: any): StockMovement {
  return {
    id: row.id,
    branchId: row.branch_id,
    productId: row.product_id,
    type: row.movement_type,
    quantity: Number(row.quantity),
    shiftDate: row.shift_date,
    note: row.note ?? '',
    createdBy: row.created_by,
    createdAt: row.created_at,
    sourceProductId: row.source_product_id ?? undefined,
    sourceQuantity: row.source_quantity ? Number(row.source_quantity) : undefined,
    documentId: row.document_id ?? undefined,
    measuredWeightKg: row.measured_weight_kg ? Number(row.measured_weight_kg) : undefined,
  }
}

export async function fetchMovements(branchId: string, user?: AppUser): Promise<StockMovement[]> {
  if (shouldUseLanApi(user)) {
    return lanApi<StockMovement[]>(`/movements?branchId=${encodeURIComponent(branchId)}`)
  }
  const branchPage = (from: number, to: number) => supabase!
    .from('stock_movements')
    .select('*')
    .eq('branch_id', branchId)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .range(from, to)

  // Kéo song song theo lô, KHÔNG hỏi tổng số dòng trước (xem
  // `fetchMovementPagesParallel`: lượt đếm đó là điểm nghẽn số 1 của prod).
  const rows = await fetchMovementPagesParallel(branchPage)
  // Có phiếu kho được ghi ngay giữa lúc phân trang thì các trang sẽ trượt một
  // nhịp và trả trùng dòng; lọc theo id để bảng tồn không cộng đôi.
  const seen = new Set<string>()
  const unique: any[] = []
  for (const row of rows) {
    if (seen.has(row.id)) continue
    seen.add(row.id)
    unique.push(row)
  }
  return unique.map(mapMovementRow)
}

/** Số ngày gần đây được soi để phát hiện phiếu bị xoá. */
const RECENT_DELETION_WINDOW_DAYS = 3

/**
 * Sổ kho là event sourcing nên chỉ có thêm, gần như không sửa. Tải lại TOÀN BỘ
 * lịch sử mỗi 15 giây (đầu tháng 7 đã ~1.700 dòng/chi nhánh, mỗi ngày thêm ~90)
 * là lý do app ngày càng ì: 4 lượt gọi mạng mỗi nhịp, mỗi lượt vài trăm KB JSON
 * phải parse lại trên điện thoại. Nhịp nền vì vậy chỉ lấy phần MỚI kể từ
 * `sinceCreatedAt`.
 *
 * Xoá phiếu thì không có dòng mới nào để nhận ra, nên kèm một mốc đối chiếu.
 * Bản trước dùng `count exact` trên TOÀN chi nhánh — chính là truy vấn 2 giây
 * chạy 15 giây một lần đã ngốn 8,7 giờ CPU database (xem
 * `fetchMovementPagesParallel`). Nay chỉ đếm **3 ngày gần nhất**, bám đúng index
 * `stock_movements_branch_date_idx` (~270 dòng thay vì ~2.800) và vẫn bắt được
 * đúng tình huống thật: ca trưởng xoá nhầm phiếu vừa lập. Phiếu cũ hơn 3 ngày bị
 * xoá thì lượt tải đầy đủ định kỳ (2,5 phút) vẫn nhặt được.
 */
export async function fetchMovementsDelta(
  branchId: string,
  sinceCreatedAt: string,
  user?: AppUser,
): Promise<{ rows: StockMovement[]; recentTotal: number; recentSince: string } | null> {
  if (shouldUseLanApi(user) || !supabase) return null
  const since = new Date()
  since.setDate(since.getDate() - RECENT_DELETION_WINDOW_DAYS)
  const recentSince = `${since.getFullYear()}-${String(since.getMonth() + 1).padStart(2, '0')}-${String(since.getDate()).padStart(2, '0')}`
  const [inserted, counted] = await Promise.all([
    fetchAllMovementRows((from, to) => supabase!
      .from('stock_movements')
      .select('*')
      .eq('branch_id', branchId)
      .gt('created_at', sinceCreatedAt)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .range(from, to)),
    supabase.from('stock_movements')
      .select('id', { count: 'exact', head: true })
      .eq('branch_id', branchId)
      .gte('shift_date', recentSince),
  ])
  if (counted.error) throw counted.error
  return { rows: inserted.map(mapMovementRow), recentTotal: counted.count || 0, recentSince }
}

export async function addMovement(item: StockMovement, user?: AppUser): Promise<void> {
  try {
    if (shouldUseLanApi(user)) {
      await lanApi('/movements', { method: 'POST', body: JSON.stringify(item) })
      return
    }
    const { error } = await supabase!.from('stock_movements').insert({
      id: item.id,
      branch_id: item.branchId,
      product_id: item.productId,
      movement_type: item.type,
      quantity: item.quantity,
      shift_date: item.shiftDate,
      note: item.note,
      created_by: item.createdBy,
      source_product_id: item.sourceProductId ?? null,
      source_quantity: item.sourceQuantity ?? null,
      document_id: item.documentId ?? null,
      measured_weight_kg: item.measuredWeightKg ?? null,
    })
    if (error) throw error
  } finally {
    invalidateReadCache('stock_movements', item.branchId)
  }
}

export async function addMovements(
  items: StockMovement[],
  user?: AppUser,
  options?: { allowInsufficientStock?: boolean },
): Promise<void> {
  try {
    // Phiếu rỗng không được đi tới RPC: create_stock_movements_checked raise
    // 'Phiếu không có dòng dữ liệu' — thông báo khó hiểu cho người dùng cuối.
    if (!items.length) return
    const invalid = items.find((item) => !Number.isFinite(item.quantity) || item.quantity < 0)
    if (invalid) throw new Error('Số lượng trên phiếu không hợp lệ (phải là số ≥ 0).')
    if (shouldUseLanApi(user)) {
      await lanApi('/movements', { method: 'POST', body: JSON.stringify(items) })
      return
    }
    const rows = items.map((item) => ({
      id: item.id,
      branch_id: item.branchId,
      product_id: item.productId,
      movement_type: item.type,
      quantity: item.quantity,
      shift_date: item.shiftDate,
      note: item.note,
      created_by: item.createdBy,
      source_product_id: item.sourceProductId ?? null,
      source_quantity: item.sourceQuantity ?? null,
      document_id: item.documentId ?? null,
      measured_weight_kg: item.measuredWeightKg ?? null,
    }))
    // The operator already confirmed this exceptional negative-stock write in the
    // calling UI. Avoid an expected HTTP 400 before the approved direct write.
    if (options?.allowInsufficientStock) {
      await insertStockRowsDirect(rows)
      return
    }
    const { error } = await supabase!.rpc('create_stock_movements_checked', { p_items: rows })
    if (error) {
      // Các loại này vốn được phép ghi âm tồn (bán/hủy/kiểm kê/điều chỉnh).
      // `allowInsufficientStock` = user đã bấm "vẫn tiếp tục" (vd chưa nhập kho nhưng vẫn ghi mẻ) → cho ghi thẳng.
      const canBypassStockCheck = items.every((item) =>
        ['sale_out', 'waste', 'count', 'adjustment'].includes(item.type),
      )
      const isStockCheckConflict = String(error.message || '').includes('Không đủ tồn')
        || String((error as any).code || '') === 'P0001'
      if (!canBypassStockCheck || !isStockCheckConflict) throw error
      await insertStockRowsDirect(rows)
      return
    }
    // RPC trả `void`: gọi xong không có gì chứng minh dòng đã nằm trong bảng. Một
    // phiếu "lưu thành công" nhưng máy chủ trống là nguyên nhân kinh điển của báo
    // lỗi "kho không đồng bộ" — máy vừa ghi hiện số mới (nó tự tính lại tại chỗ),
    // mọi máy khác đọc từ DB nên vẫn hiện số cũ, và không ai thấy thông báo lỗi.
    // Một lượt đếm cho cả phiếu là đủ rẻ để đổi lấy việc lỗi hiện ra ngay.
    await assertMovementsPersisted(rows.map((row) => row.id))
  } finally {
    for (const branchId of new Set(items.map((item) => item.branchId))) invalidateReadCache('stock_movements', branchId)
  }
}

/** Xác nhận các dòng vừa ghi đã thực sự có trên máy chủ. Ném lỗi nếu thiếu. */
async function assertMovementsPersisted(ids: string[]): Promise<void> {
  if (!supabase || !ids.length) return
  const { count, error } = await supabase
    .from('stock_movements')
    .select('id', { count: 'exact', head: true })
    .in('id', ids)
  // Không đọc kiểm tra được (mạng chập chờn) thì im lặng: ghi có thể đã thành
  // công, báo lỗi sai còn tệ hơn. Chỉ báo khi chắc chắn máy chủ thiếu dòng.
  if (error) return
  if ((count ?? ids.length) < ids.length) {
    throw new Error('Phiếu chưa được lưu lên máy chủ (máy chủ không có đủ số dòng vừa ghi). Kiểm tra kết nối/quyền rồi lưu lại.')
  }
}

async function insertStockRowsDirect(rows: Array<{
  id: string
  branch_id: string
  product_id: string
  movement_type: StockMovement['type']
  quantity: number
  shift_date: string
  note: string
  created_by: string
  source_product_id: string | null
  source_quantity: number | null
  document_id: string | null
  measured_weight_kg: number | null
}>) {
  if (!supabase || !rows.length) return
  // Cùng lý do như `deleteMovements`: insert bị RLS chặn có thể về `error = null`
  // với 0 dòng. Phiếu "lưu xong" mà máy chủ không có dòng nào là kiểu lỗi tệ nhất
  // của sổ kho — máy ghi thấy số mới, mọi máy khác vẫn thấy số cũ.
  const { data, error } = await supabase!.from('stock_movements').insert(rows).select('id')
  if (error) throw error
  if ((data?.length ?? 0) < rows.length) {
    throw new Error('Máy chủ không nhận đủ số dòng của phiếu (thiếu quyền ghi). Phiếu CHƯA được lưu — kiểm tra lại quyền tài khoản.')
  }
}

export async function deleteMovements(branchId: string, movementIds: string[], user?: AppUser): Promise<void> {
  try {
    if (!movementIds.length) return
    if (shouldUseLanApi(user)) {
      await lanApi(`/movements?branchId=${encodeURIComponent(branchId)}`, {
        method: 'DELETE',
        body: JSON.stringify({ ids: movementIds }),
      })
      return
    }
    // `.select()` là BẮT BUỘC, không phải để lấy dữ liệu về.
    //
    // PostgREST trả `error = null` cho lệnh xoá không khớp dòng nào — kể cả khi RLS
    // đã lọc sạch hoặc `branchId` truyền vào không phải chi nhánh của phiếu. Không
    // có `.select()` thì lớp gọi không phân biệt được "đã xoá" với "không xoá được
    // dòng nào", màn Kho báo "Đã xóa …" trong khi máy chủ không đổi gì → máy khác
    // vẫn hiện số cũ và người dùng kết luận app không đồng bộ.
    const { data, error } = await supabase!
      .from('stock_movements')
      .delete()
      .eq('branch_id', branchId)
      .in('id', movementIds)
      .select('id')
    if (error) throw error
    const removed = data?.length ?? 0
    if (removed < movementIds.length) {
      throw new Error(
        removed === 0
          ? 'Máy chủ không xóa được dòng nào (thiếu quyền hoặc phiếu thuộc chi nhánh khác). Dữ liệu kho chưa thay đổi.'
          : `Chỉ xóa được ${removed}/${movementIds.length} dòng của chứng từ. Tải lại trang và kiểm tra lại sổ kho.`,
      )
    }
  } finally {
    invalidateReadCache('stock_movements', branchId)
  }
}

/** Dấu của từng loại phiếu khi cộng vào tồn. `count` = 0 vì nó là MỐC RESET, không phải phát sinh. */
const MOVEMENT_SIGNS: Record<StockMovement['type'], number> = {
  opening: 1,
  inbound: 1,
  processing_out: -1,
  processing_in: 1,
  packing_out: -1,
  packing_in: 1,
  sale_out: -1,
  waste: -1,
  adjustment: 1,
  count: 0,
}

/**
 * Giá trị một phiếu cộng vào tồn. `waste` có `sourceProductId` là hao hụt chế
 * biến: chỉ để thông tin, KHÔNG trừ tồn lần hai (phần hụt đã nằm trong chênh
 * lệch giữa `processing_out` và `processing_in`).
 */
function movementStockValue(item: StockMovement): number {
  const informationalProcessingLoss = item.type === 'waste' && Boolean(item.sourceProductId)
  return item.quantity * (informationalProcessingLoss ? 0 : MOVEMENT_SIGNS[item.type])
}

export function calculateStock(movements: StockMovement[]): StockLine[] {
  // Kho = nguyên vật liệu + bao bì + thành phẩm chế biến. Món trong menu bán không đi qua kho
  // (POS ghi hóa đơn, không ghi movement) nên bị loại khỏi bảng tồn. Ngoại lệ duy nhất: SKU nào
  // đã từng có phiếu kho thật thì vẫn hiện, để không giấu mất số tồn đang treo trong sổ.
  // Gom theo sản phẩm MỘT lần. Trước đây mỗi sản phẩm lại `.filter()` + `.sort()`
  // trên toàn bộ mảng movement (≈60 SKU × vài nghìn dòng mỗi lần gọi) nên bảng
  // tồn tính lại là giật, mà hàm này chạy ở gần như mọi trang vận hành.
  const byProduct = new Map<string, StockMovement[]>()
  for (const item of movements) {
    const bucket = byProduct.get(item.productId)
    if (bucket) bucket.push(item)
    else byProduct.set(item.productId, [item])
  }
  return getProducts()
    .filter((product) => isWarehouseProduct(product) || byProduct.has(product.id))
    .map((product) => {
      const productMovements = byProduct.get(product.id) || []
      // Kiểm kê gần nhất là mốc reset: mọi thứ trước nó chỉ dùng để tính lệch.
      let latestCount: StockMovement | undefined
      for (const item of productMovements) {
        if (item.type !== 'count') continue
        if (!latestCount || item.createdAt > latestCount.createdAt) latestCount = item
      }
      let expectedAtCount = 0
      let afterCountSum = 0
      for (const item of productMovements) {
        const value = movementStockValue(item)
        if (!latestCount) expectedAtCount += value
        // Trước đây so sánh bằng `<` và `>` nên dòng ghi ĐÚNG micro-giây của mốc
        // kiểm kê rơi khỏi cả hai vế và biến mất khỏi bảng tồn. Trùng dấu thời
        // gian là chuyện thường: một lệnh INSERT nhiều dòng thì Postgres gán
        // `now()` giống hệt nhau cho mọi dòng. Coi dòng trùng mốc là TRƯỚC kiểm
        // kê — số đếm thực tế đã bao gồm nó rồi. (Bản thân dòng `count` có dấu 0
        // nên nằm vế nào cũng không đổi kết quả.)
        else if (item.createdAt <= latestCount.createdAt) expectedAtCount += value
        else afterCountSum += value
      }
      const expected = latestCount ? latestCount.quantity + afterCountSum : expectedAtCount
      const actual = latestCount?.quantity
      return {
        product,
        expected,
        actual,
        variance: actual === undefined ? undefined : actual - expectedAtCount,
      }
    })
}

export interface StockAdjustment {
  movement: StockMovement
  /** Số khai − tồn hệ thống ngay trước phiếu. Dương = sổ đang thiếu so với thực tế. */
  delta: number
}

/**
 * Độ lệch mà mỗi phiếu kiểm kê / SỬA TỒN (`count`) tạo ra.
 *
 * Vì sao cần: `count` là mốc reset nên bảng tồn nhảy sang số khai ngay, nhưng nó
 * KHÔNG thuộc cột Nhập lẫn cột Xuất của bất kỳ bảng sổ kho nào. Sau một phiếu
 * sửa tồn, "Tồn đầu + Nhập − Xuất − Hao" không còn ra "Tồn cuối" và người xem
 * kết luận là dữ liệu kho không đồng bộ. Có delta thì mọi bảng thêm được một cột
 * "Điều chỉnh" và cân trở lại.
 *
 * Phải truyền TOÀN BỘ lịch sử của chi nhánh (không lọc theo kỳ) vì delta là hiệu
 * so với tồn cộng dồn ngay trước phiếu; lọc theo kỳ ở phía gọi, dựa trên
 * `movement.shiftDate`.
 */
export function stockAdjustmentDeltas(movements: StockMovement[]): StockAdjustment[] {
  const byProduct = new Map<string, StockMovement[]>()
  for (const item of movements) {
    const bucket = byProduct.get(item.productId)
    if (bucket) bucket.push(item)
    else byProduct.set(item.productId, [item])
  }
  const adjustments: StockAdjustment[] = []
  for (const rows of byProduct.values()) {
    // Cùng dấu thời gian thì phiếu phát sinh phải chạy TRƯỚC phiếu kiểm kê — đúng
    // quy ước `<=` của `calculateStock`, nếu không delta sẽ lệch đúng bằng phiếu đó.
    const ordered = rows.slice().sort((a, b) =>
      a.createdAt.localeCompare(b.createdAt)
      || Number(a.type === 'count') - Number(b.type === 'count')
      || a.id.localeCompare(b.id),
    )
    let running = 0
    for (const item of ordered) {
      if (item.type !== 'count') {
        running += movementStockValue(item)
        continue
      }
      adjustments.push({ movement: item, delta: roundQuantity(item.quantity - running) })
      running = item.quantity
    }
  }
  return adjustments
}

/** Tổng điều chỉnh của một sản phẩm trong khoảng ngày vận hành (theo `shiftDate`). */
export function sumStockAdjustments(
  adjustments: StockAdjustment[],
  filter: { productId?: string; from?: string; to?: string } = {},
): number {
  let total = 0
  for (const item of adjustments) {
    if (filter.productId && item.movement.productId !== filter.productId) continue
    if (filter.from && item.movement.shiftDate < filter.from) continue
    if (filter.to && item.movement.shiftDate > filter.to) continue
    total += item.delta
  }
  return roundQuantity(total)
}

export async function saveReportSnapshot(user: AppUser, payload: Record<string, unknown>) {
  try {
    const reportDate = typeof payload.reportDate === 'string'
      ? payload.reportDate
      : localDateKey()
    const finalizedPayload = {
      ...payload,
      reportDate,
      finalizedBy: user.id,
      finalizedByName: user.name,
      finalizedAt: new Date().toISOString(),
    }
    const snapshot = {
      id: createId(),
      branch_id: user.branchId,
      report_date: reportDate,
      created_by: user.id,
      payload: finalizedPayload,
    }
    if (shouldUseLanApi(user)) {
      await lanApi('/report-snapshots', { method: 'POST', body: JSON.stringify(snapshot) })
      return
    }
    const { error } = await supabase!.from('report_snapshots').upsert(snapshot, {
      onConflict: 'branch_id,report_date',
      ignoreDuplicates: false,
    })
    if (!error) return
    if (!isMissingUniqueConstraint(error)) throw error

    const { data: existing, error: readError } = await supabase!
      .from('report_snapshots')
      .select('id')
      .eq('branch_id', user.branchId)
      .eq('report_date', reportDate)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (readError) throw readError
    if (existing?.id) {
      const { error: updateError } = await supabase!
        .from('report_snapshots')
        .update({ payload: finalizedPayload, created_by: user.id })
        .eq('id', existing.id)
      if (updateError) throw updateError
      return
    }

    const { error: insertError } = await supabase!.from('report_snapshots').insert(snapshot)
    if (isDuplicateKey(insertError)) {
      const { error: updateError } = await supabase!
        .from('report_snapshots')
        .update({ payload: finalizedPayload, created_by: user.id })
        .eq('branch_id', user.branchId)
        .eq('report_date', reportDate)
      if (updateError) throw updateError
      return
    }
    if (insertError) throw insertError
  } finally {
    invalidateReadCache('report_snapshots', user.branchId)
  }
}

export async function fetchReportSnapshots(
  branchId: string,
  user?: AppUser,
  filters: { from?: string; to?: string } = {},
): Promise<ReportSnapshot[]> {
  if (shouldUseLanApi(user)) {
    const query = new URLSearchParams({ branchId })
    if (filters.from) query.set('from', filters.from)
    if (filters.to) query.set('to', filters.to)
    const result = await lanApi<ReportSnapshot[] | ReportSnapshot['payload'] | null>(
      `/report-snapshots?${query}`,
    )
    if (!result) return []
    if (Array.isArray(result)) return result.filter(Boolean)
    return [{
      id: 'lan-latest',
      branchId,
      reportDate: localDateKey(),
      payload: result,
      createdAt: new Date().toISOString(),
    }]
  }
  let request = supabase!
    .from('report_snapshots')
    .select('id, branch_id, report_date, payload, created_at')
    .eq('branch_id', branchId)
    .order('created_at', { ascending: false })
  if (filters.from) request = request.gte('report_date', filters.from)
  if (filters.to) request = request.lte('report_date', filters.to)
  const { data, error } = await request
  if (error) throw error
  return (data ?? []).map((item) => ({
    id: item.id,
    branchId: item.branch_id,
    reportDate: item.report_date,
    payload: item.payload,
    createdAt: item.created_at,
  }))
}

export async function saveShiftReportSnapshot(
  user: AppUser,
  businessDate: string,
  entry: {
    shiftId: string
    sequence: number
    scope: string
    leaderId: string
    leaderName: string
    report: Record<string, unknown>
    zaloIntent?: Record<string, unknown>
    zaloDelivery?: Record<string, unknown>
    n8nDelivery?: Record<string, unknown>
  },
) {
  const existing = (await fetchReportSnapshots(user.branchId, user))
    .find((item) => item.reportDate === businessDate)
  const previousPayload = existing?.payload || {}
  const previousShiftReports = previousPayload.shiftReports || {}
  await saveReportSnapshot(user, {
    ...previousPayload,
    reportDate: businessDate,
    shiftReports: {
      ...previousShiftReports,
      [entry.shiftId]: {
        ...previousShiftReports[entry.shiftId],
        ...entry,
        finalizedAt: new Date().toISOString(),
      },
    },
  })
}

export async function saveInventoryReport(report: InventoryReport, user?: AppUser): Promise<void> {
  if (shouldUseLanApi(user)) {
    await lanApi('/inventory-reports', { method: 'POST', body: JSON.stringify(report) })
    return
  }
  const { error } = await supabase!.from('inventory_reports').insert({
    id: report.id,
    report_no: report.reportNo,
    branch_id: report.branchId,
    report_date: report.reportDate,
    department: report.department,
    location: report.location,
    shift_name: report.shift,
    reporter: report.reporter,
    lines: report.lines,
    created_by: report.createdBy,
  })
  if (error) throw error
}

export async function fetchInventoryReports(branchId: string, user?: AppUser): Promise<InventoryReport[]> {
  if (shouldUseLanApi(user)) {
    return lanApi<InventoryReport[]>(`/inventory-reports?branchId=${encodeURIComponent(branchId)}`)
  }
  const { data, error } = await supabase!
    .from('inventory_reports')
    .select('*')
    .eq('branch_id', branchId)
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []).map((item) => ({
    id: item.id,
    reportNo: item.report_no,
    branchId: item.branch_id,
    reportDate: item.report_date,
    department: item.department,
    location: item.location,
    shift: item.shift_name,
    reporter: item.reporter,
    lines: item.lines,
    createdBy: item.created_by,
    createdAt: item.created_at,
  }))
}

export async function getOperationDay(branchId: string, businessDate: string, user?: AppUser): Promise<OperationDay | null> {
  if (shouldUseLanApi(user)) {
    return lanApi<OperationDay | null>(`/operation-day?branchId=${encodeURIComponent(branchId)}&date=${encodeURIComponent(businessDate)}`)
  }
  const { data, error } = await supabase!
    .from('operation_days')
    .select('*')
    .eq('branch_id', branchId)
    .eq('business_date', businessDate)
    .maybeSingle()
  if (error) throw error
  if (!data) return null
  return {
    id: data.id,
    branchId: data.branch_id,
    businessDate: data.business_date,
    status: data.status,
    openedBy: data.opened_by,
    openedAt: data.opened_at,
    closedBy: data.closed_by ?? undefined,
    closedAt: data.closed_at ?? undefined,
  }
}

export async function ensureOperationDay(
  user: AppUser,
  businessDate: string,
  options: { allowAutoOpen?: boolean; reopenClosed?: boolean } = {},
): Promise<OperationDay> {
  const existing = await getOperationDay(user.branchId, businessDate, user)
  if (existing) {
    if (existing.status === 'closed') {
      if (!options.reopenClosed) throw new Error('Ngày vận hành đã chốt. Quản lý cần mở lại trước khi thêm phát sinh.')
      const reopened: OperationDay = {
        ...existing,
        status: 'open',
        closedBy: undefined,
        closedAt: undefined,
      }
      if (shouldUseLanApi(user)) {
        await lanApi('/operation-day', { method: 'PUT', body: JSON.stringify(reopened) })
        return reopened
      }
      const { error } = await supabase!.from('operation_days').update({
        status: 'open',
        closed_by: null,
        closed_at: null,
      }).eq('id', existing.id)
      if (error) throw error
      return reopened
    }
    return existing
  }
  if (!options.allowAutoOpen && !(await hasCheckedInForOperation(user, businessDate))) {
    throw new Error('Bạn cần check-in trong mục Chấm công trước khi mở ngày vận hành.')
  }
  const day: OperationDay = {
    id: createId(),
    branchId: user.branchId,
    businessDate,
    status: 'open',
    openedBy: user.id,
    openedAt: new Date().toISOString(),
  }
  if (shouldUseLanApi(user)) {
    await lanApi('/operation-day', { method: 'PUT', body: JSON.stringify(day) })
    return day
  }
  const { error } = await supabase!.from('operation_days').insert({
    id: day.id,
    branch_id: day.branchId,
    business_date: day.businessDate,
    status: day.status,
    opened_by: day.openedBy,
    opened_at: day.openedAt,
  })
  if (error) throw error
  return day
}

async function hasCheckedInForOperation(user: AppUser, businessDate: string) {
  if (shouldUseLanApi(user)) {
    const query = new URLSearchParams({
      branchId: user.branchId,
      userId: user.id,
      from: businessDate,
      to: businessDate,
    })
    try {
      const response = await fetch(`/api/attendance/records?${query}`, { headers: userHeaders(user) })
      if (!response.ok) return false
      const records = await response.json().catch(() => [])
      return Array.isArray(records) && records.some((record) => record.userId === user.id)
    } catch {
      return false
    }
  }
  const bounds = localDayBoundsIso(businessDate)
  const { data, error } = await supabase!
    .from('attendance_records')
    .select('id')
    .eq('branch_id', user.branchId)
    .eq('user_id', user.id)
    .gte('check_in_time', bounds.startIso)
    .lte('check_in_time', bounds.endIso)
    .limit(1)
  if (error) throw error
  return Boolean(data?.length)
}

export async function closeOperationDay(user: AppUser, businessDate: string): Promise<void> {
  const existing = await getOperationDay(user.branchId, businessDate, user)
  if (!existing) throw new Error('Ngày vận hành chưa được mở.')
  const closedAt = new Date().toISOString()
  if (shouldUseLanApi(user)) {
    await lanApi('/operation-day', {
      method: 'PUT',
      body: JSON.stringify({ ...existing, status: 'closed', closedBy: user.id, closedAt }),
    })
    return
  }
  const { error } = await supabase!.from('operation_days').update({
    status: 'closed', closed_by: user.id, closed_at: closedAt,
  }).eq('id', existing.id)
  if (error) throw error
}

export async function finalizeDailyReport(user: AppUser, businessDate: string, payload: Record<string, unknown>) {
  if (shouldUseLanApi(user)) {
    await ensureOperationDay(user, businessDate, { allowAutoOpen: true })
    await saveReportSnapshot(user, payload)
    await closeOperationDay(user, businessDate)
    return
  }
  const reportDate = typeof payload.reportDate === 'string' ? payload.reportDate : businessDate
  const finalizedPayload = {
    ...payload,
    reportDate,
    finalizedBy: user.id,
    finalizedByName: user.name,
    finalizedAt: new Date().toISOString(),
  }
  const { error } = await supabase!.rpc('finalize_daily_report', {
    p_branch_id: user.branchId,
    p_report_date: reportDate,
    p_payload: finalizedPayload,
  })
  if (!error) {
    await closeOutstandingBagLedgerForDay(user, businessDate).catch(() => undefined)
    return
  }
  if (!isMissingRpc(error, 'finalize_daily_report')) throw error

  await ensureOperationDay(user, businessDate, { allowAutoOpen: true })
  await saveReportSnapshot(user, payload)
  await closeOutstandingBagLedgerForDay(user, businessDate)
  await closeOperationDay(user, businessDate)
}

async function closeOutstandingBagLedgerForDay(user: AppUser, businessDate: string) {
  if (!supabase) return
  const endedAt = new Date().toISOString()
  const { data: sessions, error: sessionError } = await supabase
    .from('bag_shift_sessions')
    .select('id, status')
    .eq('branch_id', user.branchId)
    .eq('business_date', businessDate)
  if (sessionError) throw sessionError
  const sessionIds = (sessions || []).map((session: { id: string }) => session.id)
  if (!sessionIds.length) return

  const { data: allocations, error: allocationError } = await supabase
    .from('bag_allocations')
    .select('id, shift_id, issued_quantity, sold_quantity, damaged_quantity')
    .eq('branch_id', user.branchId)
    .in('shift_id', sessionIds)
    .is('settled_at', null)
  if (allocationError) throw allocationError

  for (const allocation of allocations || []) {
    const issued = Number(allocation.issued_quantity || 0)
    const sold = Number(allocation.sold_quantity || 0)
    const damaged = Number(allocation.damaged_quantity || 0)
    const returned = Math.max(0, issued - sold - damaged)
    const { error } = await supabase
      .from('bag_allocations')
      .update({
        returned_quantity: returned,
        settled_by: user.id,
        settlement_shift_id: allocation.shift_id,
        settled_at: endedAt,
      })
      .eq('id', allocation.id)
      .is('settled_at', null)
    if (error) throw error
  }

  const openSessionIds = (sessions || [])
    .filter((session: { id: string; status: string }) => session.status === 'open')
    .map((session: { id: string }) => session.id)
  if (!openSessionIds.length) return
  const { error: closeError } = await supabase
    .from('bag_shift_sessions')
    .update({
      status: 'closed',
      discrepancy_note: 'Auto closed by daily report.',
      ended_at: endedAt,
    })
    .in('id', openSessionIds)
    .eq('status', 'open')
  if (closeError) throw closeError
}

export async function fetchLatestReport(user: AppUser) {
  if (shouldUseLanApi(user)) {
    return lanApi(`/report-snapshots?branchId=${encodeURIComponent(user.branchId)}&latest=1`)
  }
  const { data, error } = await supabase!
    .from('report_snapshots')
    .select('payload')
    .eq('branch_id', user.branchId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw error
  return data?.payload ?? null
}

export async function saveReportDraft(user: AppUser, businessDate: string, payload: Record<string, unknown>) {
  if (!shouldUseLanApi(user)) return
  await lanApi(`/report-draft?branchId=${encodeURIComponent(user.branchId)}&date=${encodeURIComponent(businessDate)}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  })
}

export async function fetchReportDraft(user: AppUser, businessDate: string) {
  if (!shouldUseLanApi(user)) return null
  return lanApi<Record<string, unknown> | null>(
    `/report-draft?branchId=${encodeURIComponent(user.branchId)}&date=${encodeURIComponent(businessDate)}`,
  )
}
