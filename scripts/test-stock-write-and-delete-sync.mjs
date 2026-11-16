// Kho không đồng bộ giữa các máy (06/08) — khoá lại hai nguyên nhân im lặng.
//
// 1) PostgREST trả `error = null` cho lệnh ghi/xoá KHÔNG khớp dòng nào (RLS lọc
//    sạch, hoặc branchId truyền vào không phải chi nhánh của phiếu). Lớp lưu kho
//    cũ không đọc số dòng trả về nên màn Kho báo "Đã xóa…"/"Đã lưu…" trong khi
//    máy chủ không đổi gì — máy vừa thao tác hiện số mới (nó tự tính lại tại
//    chỗ), mọi máy khác đọc từ DB nên vẫn hiện số cũ.
//
// 2) Realtime so khớp `filter` với chính dòng vừa đổi. Với DELETE, dòng cũ chỉ
//    còn cột thuộc REPLICA IDENTITY — `stock_movements` để mặc định nên payload
//    chỉ có `id`. Điều kiện `branch_id=eq...` không bao giờ khớp ⇒ event xoá bị
//    bỏ rơi và máy khác không biết phiếu đã bị xoá.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'

const PRODUCTS = [{ id: 'chestnut-cooked-kg', name: 'Hạt dẻ chín (kg)', unit: 'kg', lowStock: 1 }]

/** Supabase giả: ghi lại lệnh đã gọi và trả về đúng số dòng ta dựng sẵn. */
function makeFakeSupabase() {
  const state = { deleteRows: [], insertRows: [], countValue: 0, rpcError: null, calls: [] }
  const api = {
    state,
    rpc(name) {
      state.calls.push(`rpc:${name}`)
      return Promise.resolve({ error: state.rpcError })
    },
    from() {
      const q = {}
      const chain = {
        delete() { q.op = 'delete'; return chain },
        insert(rows) { q.op = 'insert'; q.rows = rows; return chain },
        select() { q.selected = true; return chain },
        eq() { return chain },
        in(_column, ids) { q.ids = ids; return chain },
        then(resolve, reject) {
          let result
          if (q.op === 'delete') result = { data: state.deleteRows, error: null }
          else if (q.op === 'insert') result = { data: state.insertRows, error: null }
          else result = { count: state.countValue, error: null }
          state.calls.push(q.op || 'count')
          return Promise.resolve(result).then(resolve, reject)
        },
      }
      return chain
    },
  }
  return api
}

async function loadStoreModule() {
  let source = await readFile(new URL('../src/lib/store.ts', import.meta.url), 'utf8')
  source = source.replace(/^import\s[^\n]+\n/gm, '')
  source = [
    `const PRODUCTS = ${JSON.stringify(PRODUCTS)};`,
    'const getProducts = () => PRODUCTS;',
    'const isWarehouseProduct = () => true;',
    'const readLocalJson = (_key, fallback) => fallback;',
    'const localDateKey = () => "2026-08-06";',
    'const localDayBoundsIso = () => ({ start: "", end: "" });',
    'const createId = () => "id";',
    'const isDuplicateKey = () => false;',
    'const isMissingRpc = () => false;',
    'const isMissingUniqueConstraint = () => false;',
    'const userHeaders = () => ({});',
    'const shouldUseLanApi = () => false;',
    'const invalidateReadCache = (...args) => globalThis.__READ_CACHE_INVALIDATIONS__.push(args);',
    'const clearReadCache = () => {};',
    'const supabase = globalThis.__FAKE_SUPABASE__;',
  ].join('\n') + '\n' + source
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText
  return import(`data:text/javascript;base64,${Buffer.from(output).toString('base64')}`)
}

const fake = makeFakeSupabase()
globalThis.__FAKE_SUPABASE__ = fake
globalThis.__READ_CACHE_INVALIDATIONS__ = []
const store = await loadStoreModule()

const user = { id: 'u1', role: 'shift_leader', branchId: 'gold-coast' }
const movement = (id) => ({
  id,
  branchId: 'gold-coast',
  productId: 'chestnut-cooked-kg',
  type: 'count',
  quantity: 0,
  shiftDate: '2026-08-06',
  note: '[SỬA TỒN] hệ thống 12 kg → thực tế 0 kg',
  createdBy: 'u1',
  createdAt: '2026-08-06T10:00:00.000Z',
})

// ── 1. Xoá bị RLS chặn (0 dòng) phải BÁO LỖI, không được coi là thành công ──
fake.state.deleteRows = []
await assert.rejects(
  () => store.deleteMovements('gold-coast', ['a', 'b'], user),
  /không xóa được dòng nào/i,
  'Xoá 0 dòng phải ném lỗi để màn Kho không báo "Đã xóa"',
)

// ── 2. Xoá thiếu dòng (chứng từ chỉ xoá được một phần) cũng phải báo ──
fake.state.deleteRows = [{ id: 'a' }]
await assert.rejects(
  () => store.deleteMovements('gold-coast', ['a', 'b'], user),
  /1\/2/,
  'Xoá thiếu dòng phải nói rõ đã xoá được bao nhiêu',
)

// ── 3. Xoá đủ dòng thì đi qua bình thường ──
fake.state.deleteRows = [{ id: 'a' }, { id: 'b' }]
await store.deleteMovements('gold-coast', ['a', 'b'], user)

// ── 4. Phiếu ghi qua RPC nhưng máy chủ không có dòng nào ⇒ phải báo CHƯA lưu ──
fake.state.rpcError = null
fake.state.countValue = 0
await assert.rejects(
  () => store.addMovements([movement('m1')], user),
  /chưa được lưu lên máy chủ/i,
  'RPC trả void: phải tự xác nhận dòng đã nằm trên máy chủ',
)

// ── 5. Máy chủ có đủ dòng ⇒ lưu thành công ──
fake.state.countValue = 1
await store.addMovements([movement('m1')], user)

// ── 6. Ghi thẳng (bypass kiểm tra tồn) bị RLS chặn cũng phải báo ──
fake.state.insertRows = []
await assert.rejects(
  () => store.addMovements([movement('m2')], user, { allowInsufficientStock: true }),
  /không nhận đủ số dòng/i,
  'Insert 0 dòng do RLS phải ném lỗi thay vì im lặng',
)

// ── 7. Realtime phải nhận được event XOÁ của sổ kho ──
const appSource = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8')
const start = appSource.indexOf("table: 'stock_movements'")
assert.ok(start > 0, 'App.tsx phải còn đăng ký realtime cho stock_movements')
const subscription = appSource.slice(start, start + 400)
assert.ok(
  !/filter:\s*`branch_id=eq/.test(subscription),
  'stock_movements KHÔNG được lọc branch_id ở phía Supabase: payload DELETE chỉ có `id` '
  + '(replica identity mặc định) nên filter không khớp và event xoá bị bỏ rơi.',
)
assert.ok(
  /eventType === 'DELETE'/.test(subscription),
  'Vẫn phải phân biệt DELETE (tải đầy đủ) với INSERT/UPDATE (tải gia số)',
)

console.log('STOCK_WRITE_AND_DELETE_SYNC_OK')
assert.ok(globalThis.__READ_CACHE_INVALIDATIONS__.some(([table, branch]) => table === 'stock_movements' && branch === user.branchId), 'Stock write/delete attempts must invalidate background history even on partial failure')
