// Tối ưu tốc độ (28/07): sổ kho không còn tải lại TOÀN BỘ mỗi 15 giây, và
// `calculateStock` gom theo sản phẩm một lần thay vì filter+sort toàn mảng cho
// TỪNG sản phẩm. Test này khoá lại: kết quả tồn phải y hệt thuật toán cũ.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'

const PRODUCTS = [
  { id: 'chestnut-cooked-kg', name: 'Hạt dẻ chín (kg)', unit: 'kg', lowStock: 1 },
  { id: 'chestnut-raw-kg', name: 'Hạt dẻ tươi (kg)', unit: 'kg', lowStock: 1 },
  { id: 'bag-330', name: 'Túi 330g', unit: 'túi', lowStock: 5 },
  { id: 'never-moved', name: 'Chưa từng phát sinh', unit: 'cái', lowStock: 0 },
]

async function loadStoreModule() {
  let source = await readFile(new URL('../src/lib/store.ts', import.meta.url), 'utf8')
  source = source.replace(/^import\s[^\n]+\n/gm, '')
  source = [
    `const PRODUCTS = ${JSON.stringify(PRODUCTS)};`,
    'const getProducts = () => PRODUCTS;',
    'const isWarehouseProduct = () => true;',
    'const readLocalJson = (_key, fallback) => fallback;',
    'const localDateKey = () => "2026-07-28";',
    'const localDayBoundsIso = () => ({ start: "", end: "" });',
    'const createId = () => "id";',
    'const isDuplicateKey = () => false;',
    'const isMissingRpc = () => false;',
    'const isMissingUniqueConstraint = () => false;',
    'const userHeaders = () => ({});',
    'const shouldUseLanApi = () => false;',
    'const supabase = null;',
  ].join('\n') + '\n' + source
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText
  return import(`data:text/javascript;base64,${Buffer.from(output).toString('base64')}`)
}

/** Thuật toán TRƯỚC khi tối ưu, giữ nguyên để đối chiếu. */
function legacyCalculateStock(movements) {
  const signs = {
    opening: 1, inbound: 1, processing_out: -1, processing_in: 1,
    packing_out: -1, packing_in: 1, sale_out: -1, waste: -1, adjustment: 1, count: 0,
  }
  const movedProductIds = new Set(movements.map((item) => item.productId))
  return PRODUCTS
    .filter((product) => true || movedProductIds.has(product.id))
    .map((product) => {
      const productMovements = movements
        .filter((item) => item.productId === product.id)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      const latestCount = [...productMovements]
        .filter((item) => item.type === 'count')
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]
      const beforeCount = latestCount
        ? productMovements.filter((item) => item.createdAt < latestCount.createdAt)
        : productMovements
      const expectedAtCount = beforeCount.reduce((sum, item) => {
        const informational = item.type === 'waste' && Boolean(item.sourceProductId)
        return sum + item.quantity * (informational ? 0 : signs[item.type])
      }, 0)
      const afterCount = latestCount
        ? productMovements.filter((item) => item.createdAt > latestCount.createdAt)
        : []
      const expected = latestCount
        ? afterCount.reduce((sum, item) => {
            const informational = item.type === 'waste' && Boolean(item.sourceProductId)
            return sum + item.quantity * (informational ? 0 : signs[item.type])
          }, latestCount.quantity)
        : expectedAtCount
      const actual = latestCount?.quantity
      return {
        productId: product.id,
        expected,
        actual,
        variance: actual === undefined ? undefined : actual - expectedAtCount,
      }
    })
}

const store = await loadStoreModule()

const at = (minute) => `2026-07-28T0${Math.floor(minute / 60)}:${String(minute % 60).padStart(2, '0')}:00.000Z`
let seq = 0
const movement = (productId, type, quantity, minute, extra = {}) => ({
  id: `mv-${seq += 1}`,
  branchId: 'gold-coast',
  productId,
  type,
  quantity,
  shiftDate: '2026-07-28',
  note: '',
  createdBy: 'leader',
  createdAt: at(minute),
  ...extra,
})

const movements = [
  // Có kiểm kê: mốc reset + lệch so với kỳ vọng.
  movement('chestnut-cooked-kg', 'opening', 10, 5),
  movement('chestnut-cooked-kg', 'inbound', 5, 10),
  movement('chestnut-cooked-kg', 'count', 12, 20),
  movement('chestnut-cooked-kg', 'sale_out', 2, 30),
  // Hao hụt chế biến (có sourceProductId) chỉ để thông tin, không trừ tồn.
  movement('chestnut-raw-kg', 'inbound', 8, 5),
  movement('chestnut-raw-kg', 'waste', 1, 8, { sourceProductId: 'chestnut-cooked-kg' }),
  movement('chestnut-raw-kg', 'waste', 2, 9),
  movement('chestnut-raw-kg', 'processing_out', 3, 12),
  // Đóng gói + bán, không kiểm kê.
  movement('bag-330', 'packing_in', 20, 15),
  movement('bag-330', 'sale_out', 7, 40),
  movement('bag-330', 'adjustment', 1, 45),
]
// Danh sách thật trả về từ máy chủ là mới → cũ, không phải thứ tự thời gian.
const serverOrder = [...movements].reverse()

const rows = store.calculateStock(serverOrder).map((line) => ({
  productId: line.product.id,
  expected: line.expected,
  actual: line.actual,
  variance: line.variance,
}))

assert.deepEqual(rows, legacyCalculateStock(serverOrder), 'Tồn kho sau tối ưu phải khớp thuật toán cũ')

// Giá trị chốt cứng để bản sau không lặng lẽ đổi nghiệp vụ.
const byId = Object.fromEntries(rows.map((row) => [row.productId, row]))
assert.deepEqual(byId['chestnut-cooked-kg'], { productId: 'chestnut-cooked-kg', expected: 10, actual: 12, variance: -3 })
assert.deepEqual(byId['chestnut-raw-kg'], { productId: 'chestnut-raw-kg', expected: 3, actual: undefined, variance: undefined })
assert.deepEqual(byId['bag-330'], { productId: 'bag-330', expected: 14, actual: undefined, variance: undefined })
assert.deepEqual(byId['never-moved'], { productId: 'never-moved', expected: 0, actual: undefined, variance: undefined })

// Đồng bộ theo gia số phải có mặt và nhịp nền không được chạy khi máy đang ẩn.
assert.equal(typeof store.fetchMovementsDelta, 'function')
const appSource = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8')
assert.match(appSource, /if \(document\.hidden\) return/)
assert.match(appSource, /ticks % 10 === 0 \? refreshMovements\(\) : syncMovements\(\)/)
// 07/08/2026: mốc phát hiện XOÁ phiếu đổi từ `count exact` TOÀN chi nhánh sang
// đếm vài ngày gần nhất rồi so với chính danh sách đang giữ trong máy. Truy vấn
// đếm toàn chi nhánh là điểm nghẽn số 1 trên prod: 15.428 lượt × 2.025 ms.
assert.match(appSource, /delta\.recentTotal !== recentInMemory/)
assert.doesNotMatch(appSource, /movementSignature/)
const storeSource = await readFile(new URL('../src/lib/store.ts', import.meta.url), 'utf8')
assert.doesNotMatch(
  storeSource,
  /select\('id', \{ count: 'exact', head: true \}\)\s*\n?\s*\.eq\('branch_id', branchId\)\s*(?!\s*\.gte)/,
  'Không được đếm exact toàn bộ sổ kho của chi nhánh — đó là truy vấn 2 giây chạy mỗi 15 giây.',
)
assert.match(storeSource, /RECENT_DELETION_WINDOW_DAYS/, 'Thiếu cửa sổ đối chiếu xoá phiếu.')
assert.match(storeSource, /fetchMovementPagesParallel/, 'Tải sổ kho phải phân trang song song, không hỏi tổng số dòng trước.')

// Realtime gộp burst ở các màn nghe bảng dòng hàng (bảng này không lọc được chi nhánh).
for (const page of ['SalesPage', 'ShiftHandoverPage', 'TodayPage', 'ManagerDashboardPage']) {
  const source = await readFile(new URL(`../src/pages/${page}.tsx`, import.meta.url), 'utf8')
  assert.match(source, /(?:burstGuard|watchVisibleData)\(/, `${page} phải gộp burst realtime`)
}

console.log('OK — tồn kho giữ nguyên kết quả, đồng bộ nền nhẹ hơn.')
