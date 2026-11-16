import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

const source = (file) => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')
function load(file, mocks = {}) {
  const output = ts.transpileModule(source(file), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const module = { exports: {} }
  new Function('require', 'module', 'exports', output)((name) => mocks[name] || {}, module, module.exports)
  return module.exports
}
const timers = new Map()
let id = 0
const windowMock = {
  setTimeout(fn, ms) { timers.set(++id, { fn, ms }); return id },
  clearTimeout(key) { timers.delete(key) },
  setInterval(fn, ms) { timers.set(++id, { fn, ms, interval: true }); return id },
  clearInterval(key) { timers.delete(key) },
  addEventListener() {}, removeEventListener() {},
}
globalThis.window = windowMock
const { burstGuard } = load('src/lib/browser.ts')
function flushTimeouts() {
  const pending = [...timers.entries()].filter(([, t]) => !t.interval)
  for (const [key, t] of pending) { timers.delete(key); t.fn() }
}
const documentMock = { visibilityState: 'visible', addEventListener() {}, removeEventListener() {} }
const user = { id: 'u1', role: 'admin', branchId: 'b1', name: 'Admin' }
function channelMock() {
  const callbacks = new Map()
  let status
  const channel = { on(_event, config, fn) { callbacks.set(config.table, fn); return this }, subscribe(fn) { status = fn; return this } }
  return { channel: () => channel, removeChannel() {}, callbacks, status: (s) => status?.(s) }
}

// Execute the actual Today operations effect against controllable socket/timers.
const today = source('src/pages/TodayPage.tsx')
const operations = today.slice(today.indexOf('    let realtimeConnected = false'), today.indexOf('  }, [todayKey, user.id, user.branchId, user.authToken])', today.indexOf('    let realtimeConnected = false')))
const client = channelMock()
let sessionReads = 0, receiptReads = 0
const mountToday = new Function('window', 'document', 'user', 'todayKey', 'supabase', 'uniqueChannelName', 'burstGuard', 'fetchBagShiftSessions', 'fetchSalesReceipts', 'setBagSessions', 'setSalesReceipts', operations)
const cleanupToday = mountToday(windowMock, documentMock, user, '2026-09-12', client, (s) => s, burstGuard,
  async () => { sessionReads++; return [] }, async () => { receiptReads++; return [] }, () => {}, () => {})
const interval = [...timers.values()].find((t) => t.interval)
assert.equal(interval.ms, 60000)
client.status('SUBSCRIBED')
const connectedReads = sessionReads
interval.fn(); interval.fn()
assert.equal(sessionReads, connectedReads, 'Connected Realtime must suppress fallback reads')
client.status('CHANNEL_ERROR'); interval.fn()
assert.equal(sessionReads, connectedReads + 1)
documentMock.visibilityState = 'hidden'; interval.fn()
assert.equal(sessionReads, connectedReads + 1, 'Hidden tab must not poll')
assert.equal(receiptReads, sessionReads)
cleanupToday(); assert.equal(timers.size, 0)
documentMock.visibilityState = 'visible'

const keyExpression = today.match(/const sessionReportKey = (.+)/)[1]
const sessionKey = new Function('bagSessions', `return ${keyExpression}`)
assert.equal(sessionKey([{ id: 's1', status: 'open' }]), sessionKey([{ id: 's1', status: 'open' }]))
assert.notEqual(sessionKey([{ id: 's1', status: 'open' }]), sessionKey([{ id: 's1', status: 'closed' }]))
assert.ok(today.includes('{ from: todayKey, to: todayKey }'))

// Execute Report subscription callbacks; joined datasets need one batched read.
const report = source('src/pages/ReportPage.tsx')
const reportEffect = report.slice(report.indexOf('    const reloadLedgerSoon ='), report.indexOf('    return () => {', report.indexOf('    const reloadLedgerSoon =')))
let ledgerReads = 0, dayReads = 0, finalized, snapshot
const reportClient = channelMock()
const reportJs = ts.transpileModule(reportEffect, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
new Function('client', 'user', 'businessDate', 'uniqueChannelName', 'burstGuard', 'refreshLedger', 'refreshFinalizationState', 'setFinalized', 'reloadAll', 'setReportSnapshot', reportJs)(
  reportClient, user, '2026-09-12', (s) => s, burstGuard, async () => { ledgerReads++ }, async () => { dayReads++ }, (v) => { finalized = v }, () => {}, (v) => { snapshot = v })
for (const table of ['bag_shift_sessions', 'bag_allocations', 'sales_receipts', 'attendance_records', 'report_snapshots']) reportClient.callbacks.get(table)({})
assert.equal(ledgerReads, 0)
assert.equal([...timers.values()][0].ms, 400)
flushTimeouts(); assert.equal(ledgerReads, 1, 'Five callbacks must coalesce')
reportClient.callbacks.get('report_snapshots')({ eventType: 'UPDATE', new: { id: 'r1', branch_id: 'b1', report_date: '2026-09-12', payload: { shiftReports: {} }, created_at: '2026-09-12T00:00:00Z' } })
assert.equal(snapshot.id, 'r1'); assert.equal(ledgerReads, 1); assert.equal(timers.size, 0)
reportClient.callbacks.get('operation_days')({ eventType: 'UPDATE', new: { branch_id: 'b1', business_date: '2026-09-12', status: 'closed' } })
assert.equal(finalized, true); assert.equal(dayReads, 0)
reportClient.callbacks.get('operation_days')({ eventType: 'DELETE', new: {} })
flushTimeouts(); assert.equal(dayReads, 1)

// Actual data adapter filters before transferring rows and retains full-list callers.
const queryCalls = []
const rows = ['pending', 'acknowledged', 'fulfilled', 'cancelled'].map((status, i) => ({ id: `${i}`, status, branch_id: 'b1' }))
const supabase = { from(table) {
  queryCalls.push(table)
  const filters = []
  const query = { select() { return this }, in(field, values) { filters.push([field, values]); return this }, order() { return this }, range() { return this },
    then(resolve) { return Promise.resolve({ data: rows.filter((row) => filters.every(([f, values]) => values.includes(row[f]))), error: null }).then(resolve) } }
  return query
} }
const supply = load('src/lib/supplyRequests.ts', { './supabase': { supabase, shouldUseLanApi: () => false } })
assert.deepEqual((await supply.fetchSupplyRequests(user, ['b1'], { activeOnly: true })).map((r) => r.status), ['pending', 'acknowledged'])
assert.equal((await supply.fetchSupplyRequests(user, ['b1'])).length, 4)
const kitchen = source('src/pages/KitchenPage.tsx')
const historyEffect = kitchen.slice(kitchen.indexOf('    if (!historyOpen) return'), kitchen.indexOf('  }, [historyOpen,'))
let historyReads = 0
const runHistory = new Function('historyOpen', 'user', 'branchIds', 'fetchSupplyRequests', 'setHistoryLoading', 'setHistoryRequests', 'setFeedback', 'tx', historyEffect)
runHistory(false, user, ['b1'], async () => { historyReads++; return [] }, () => {}, () => {}, () => {}, {})
assert.equal(historyReads, 0)
runHistory(true, user, ['b1'], async () => { historyReads++; return [] }, () => {}, () => {}, () => {}, {})
assert.equal(historyReads, 1)

// Run real helpers sequentially and concurrently with a shared request context.
let branchReads = 0
const attendanceDb = { from(table) {
  if (table === 'branches') branchReads++
  const q = { select() { return this }, eq() { return this }, in() { return this }, order() { return this },
    then(resolve) { return Promise.resolve({ data: table === 'branches' ? [{ id: 'b1' }] : [], error: null }).then(resolve) } }
  return q
} }
const attendance = load('src/lib/attendance.ts', {
  './supabase': { supabase: attendanceDb, shouldUseLanApi: () => false },
  './branches': { branchIds: () => ['b1'] }, './access': { hasSystemWideScope: () => true },
})
const context = attendance.createAttendanceReadContext()
await attendance.fetchWorkShifts(user, context)
await attendance.fetchEmployees(user, { readContext: context })
await Promise.all([attendance.fetchWorkShifts(user, context), attendance.fetchEmployees(user, { readContext: context })])
assert.equal(branchReads, 1, 'Sequential/nested reads in one context must reuse branches')
await attendance.fetchWorkShifts(user, attendance.createAttendanceReadContext())
assert.equal(branchReads, 2, 'A new flow must read current active branches')
await Promise.all([attendance.fetchWorkShifts(user), attendance.fetchEmployees(user)])
assert.equal(branchReads, 3, 'Concurrent default helpers must share in-flight read')
await attendance.fetchWorkShifts({ ...user, id: 'u2' }, context)
assert.equal(branchReads, 4, 'Contexts must not reuse another user scope')

const admin = source('src/pages/AdminPage.tsx')
// Admin's old 400ms trailing debounce is superseded by the visible, bounded,
// single-flight scheduler exercised behaviorally in test-dashboard-egress.mjs.
assert.match(admin, /watchVisibleData\(\(\) => refresh\(false\)/)
assert.match(admin, /invalidateDashboardEvent\(table, payload\)/)
assert.match(admin, /reconciliation\.dispose\(\)/)
console.log('SUPABASE_EGRESS_REFRESH_OK')
