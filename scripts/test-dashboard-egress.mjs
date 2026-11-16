import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

function load(file, mocks = {}) {
  const source = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const module = { exports: {} }
  new Function('require', 'module', 'exports', js)((name) => mocks[name] || {}, module, module.exports)
  return module.exports
}
const originalNow = Date.now
const originalWindow = globalThis.window
const originalDocument = globalThis.document
let now = Date.parse('2026-11-16T08:00:00Z')
Date.now = () => now
const flush = async () => { for (let i = 0; i < 15; i++) await Promise.resolve() }
try {
  const cache = load('src/lib/readCache.ts')
  const user = { id: 'u1', role: 'admin', branchId: 'b1', branchIds: ['b1', 'b2'] }
  let reads = 0, finish
  const pending = () => { reads++; return new Promise((resolve) => { finish = resolve }) }
  const a = cache.sharedRead('one', 't', 'b1', 5000, pending)
  const b = cache.sharedRead('one', 't', 'b1', 5000, pending)
  await flush(); assert.equal(reads, 1)
  finish(['old']); assert.deepEqual(await a, await b)
  await cache.sharedRead('one', 't', 'b1', 5000, pending); assert.equal(reads, 1)
  now += 5001
  const stale = cache.sharedRead('one', 't', 'b1', 5000, pending)
  await flush()
  cache.invalidateReadCache('t', 'b1')
  const fresh = await cache.sharedRead('one', 't', 'b1', 5000, async () => ['new'])
  finish(['outdated']); await stale
  assert.deepEqual(fresh, ['new'])
  assert.deepEqual(await cache.sharedRead('one', 't', 'b1', 5000, async () => ['wrong']), ['new'], 'invalidated pending response cannot replace newer data')
  await assert.rejects(cache.sharedRead('fail', 't', 'b1', 5000, async () => { throw Error('offline') }))
  assert.equal(await cache.sharedRead('fail', 't', 'b1', 5000, async () => 42), 42, 'failures must retry')
  assert.notEqual(cache.readScope(user), cache.readScope({ ...user, id: 'u2' }))
  assert.notEqual(cache.readScope(user), cache.readScope({ ...user, role: 'staff' }))
  const oldScope = cache.readScope(user); cache.clearReadCache(); assert.notEqual(oldScope, cache.readScope(user))

  let fullReads = 0, deltaReads = 0, snapshotReads = 0, snapshotFilters
  let sourceRows = [
    { id: 'old', branchId: 'b1', createdAt: '2020-01-01T00:00:00Z', shiftDate: '2020-01-01', quantity: 20 },
    { id: 'a', branchId: 'b1', createdAt: '2026-11-16T01:00:00.000Z', shiftDate: '2026-11-16', quantity: 2 },
  ]
  let delta = { rows: [], recentTotal: 1, recentSince: '2026-11-13' }, since
  const store = {
    async fetchMovements() { fullReads++; return sourceRows.map((r) => ({ ...r })) },
    async fetchMovementsDelta(_branch, stamp) { deltaReads++; since = stamp; return delta },
    async fetchReportSnapshots(_branch, _user, filters) { snapshotReads++; snapshotFilters = filters; return [{ id: 'r1' }] },
  }
  const data = load('src/lib/dashboardData.ts', { './store': store, './supabase': { shouldUseLanApi: () => false }, './readCache': cache })
  await Promise.all([data.fetchDashboardMovements('b1', user), data.fetchDashboardMovements('b1', user)])
  assert.equal(fullReads, 1)
  sourceRows.push({ id: 'b', branchId: 'b1', createdAt: '2026-11-16T01:00:00.000Z', shiftDate: '2026-11-16', quantity: 3 })
  delta = { rows: [sourceRows[1], sourceRows[2]], recentTotal: 2, recentSince: '2026-11-13' }
  data.invalidateDashboardEvent('stock_movements', { eventType: 'INSERT', new: { branch_id: 'b1' } })
  let rows = await data.fetchDashboardMovements('b1', user)
  assert.equal(rows.length, 3, 'same-timestamp insert retained exactly once')
  assert.ok(new Date(since) < new Date(sourceRows[1].createdAt))
  assert.ok(rows.some((r) => r.id === 'old'), 'complete historical baseline retained')
  assert.equal(fullReads, 1); assert.equal(deltaReads, 1)
  sourceRows[0].quantity = 99
  data.invalidateDashboardEvent('stock_movements', { eventType: 'UPDATE', new: { branch_id: 'b1' } })
  rows = await data.fetchDashboardMovements('b1', user)
  assert.equal(rows.find((r) => r.id === 'old').quantity, 99, 'old historical edits trigger full reconciliation')
  assert.equal(fullReads, 2)
  sourceRows = sourceRows.filter((r) => r.id !== 'old')
  data.invalidateDashboardEvent('stock_movements', { eventType: 'DELETE', old: { id: 'old' } })
  rows = await data.fetchDashboardMovements('b1', user)
  assert.equal(rows.length, 2); assert.equal(fullReads, 3, 'partial DELETE must invalidate every potentially affected branch')
  now += 5001; delta = { rows: [], recentTotal: 0, recentSince: '2026-11-13' }
  await data.fetchDashboardMovements('b1', user)
  assert.equal(fullReads, 4, 'count mismatch recovers missed deletions')
  now += 150001
  await data.fetchDashboardMovements('b1', user)
  assert.equal(fullReads, 5, 'bounded complete reconciliation catches missed historical updates')
  const period = { from: '2026-11-01', to: '2026-11-16' }
  await Promise.all([data.fetchDashboardSnapshots('b1', user, period), data.fetchDashboardSnapshots('b1', user, period)])
  assert.equal(snapshotReads, 1); assert.deepEqual(snapshotFilters, period)
  data.invalidateDashboardEvent('sales_receipts', { eventType: 'INSERT', new: { branch_id: 'b1' } })
  await data.fetchDashboardSnapshots('b1', user, period); assert.equal(snapshotReads, 1, 'new receipt does not redownload historical report payloads')
  data.invalidateDashboardEvent('report_snapshots', { eventType: 'UPDATE', new: { branch_id: 'b1' } })
  await data.fetchDashboardSnapshots('b1', user, period); assert.equal(snapshotReads, 2)
  await data.fetchDashboardSnapshots('b1', { ...user, id: 'u2' }, period); assert.equal(snapshotReads, 3)
  assert.equal(data.dashboardEventInScope({ new: { branch_id: 'other' } }, ['b1']), false)
  assert.equal(data.dashboardEventInScope({ new: { branch_id: 'other' }, old: { branch_id: 'b1' } }, ['b1']), true)
  assert.equal(data.dashboardEventInScope({ old: { id: 'partial' } }, ['b1']), true)

  // Execute the actual Manager load effect, including the two independently handled data groups.
  const managerSource = readFileSync(new URL('../src/pages/ManagerDashboardPage.tsx', import.meta.url), 'utf8')
  const managerAst = ts.createSourceFile('ManagerDashboardPage.tsx', managerSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let managerEffectSource
  const findEffect = (node) => {
    if (ts.isCallExpression(node) && node.expression.getText(managerAst) === 'useEffect'
      && node.arguments[0]?.getText(managerAst).includes('refreshRef.current = refresh')) managerEffectSource = node.arguments[0].getText(managerAst)
    ts.forEachChild(node, findEffect)
  }
  findEffect(managerAst)
  assert.ok(managerEffectSource, 'Manager async refresh effect exists')
  const managerJs = ts.transpileModule(`const effect = ${managerEffectSource}`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
  let managerReads = 0, managerParallel = 0, managerMaximum = 0, releaseManager
  const movementBranches = [], appliedMovements = []
  const managerMocks = {
    user, branchIds: ['b1'], compareFrom: '2026-11-09', to: '2026-11-16',
    hasLoadedRef: { current: false }, refreshRef: { current: null }, pendingLoadRef: { current: Promise.resolve() },
    setLoading() {}, setMovements(rows) { appliedMovements.push(rows) }, setSnapshots() {},
    setAllocations() {}, setEmployees() {}, setError() {}, setReceipts() {}, setBagSessions() {},
    async fetchDashboardMovements(branch) {
      managerReads++; movementBranches.push(branch)
      managerMaximum = Math.max(managerMaximum, ++managerParallel)
      const rows = await new Promise((resolve) => { releaseManager = resolve })
      managerParallel--; return rows
    },
    async fetchDashboardSnapshots(_branch, _user, filters) { assert.deepEqual(filters, { from: '2026-11-09', to: '2026-11-16' }); return [] },
    async fetchBagAllocations() { return [] }, async fetchEmployees() { return [] },
    async fetchSalesReceiptsRange() { return [] }, async fetchBagShiftSessions() { return [] },
  }
  const startManager = (mocks) => new Function(...Object.keys(mocks), `${managerJs}; return effect`)(...Object.values(mocks))()
  const disposeManager = startManager(managerMocks)
  await flush(); assert.equal(managerReads, 1)
  for (let i = 0; i < 100; i++) managerMocks.refreshRef.current()
  await flush(); assert.equal(managerReads, 1, 'events wait for the actual Manager request batch')
  releaseManager([{ id: 'first' }]); await flush()
  assert.equal(managerReads, 2, 'pending Manager events produce one follow-up batch')
  releaseManager([{ id: 'second' }]); await managerMocks.pendingLoadRef.current
  assert.equal(managerMaximum, 1)
  managerMocks.refreshRef.current(); await flush()
  assert.equal(managerReads, 3)
  disposeManager()
  const disposeNextManager = startManager({ ...managerMocks, user: { ...user, id: 'u2' }, branchIds: ['b2'] })
  await flush(); assert.equal(managerReads, 3, 'account/scope change waits for the old in-flight batch')
  releaseManager([{ id: 'stale-scope' }]); await flush()
  assert.equal(managerReads, 4)
  releaseManager([{ id: 'new-scope' }]); await managerMocks.pendingLoadRef.current
  assert.deepEqual(movementBranches, ['b1', 'b1', 'b1', 'b2'])
  assert.equal(appliedMovements.some((rows) => rows.some((row) => row.id === 'stale-scope')), false)
  assert.equal(appliedMovements.at(-1)[0].id, 'new-scope')
  assert.equal(managerMaximum, 1)
  disposeNextManager()

  let nextId = 0
  const timers = new Map(), listeners = new Map()
  const on = (name, fn) => { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(fn) }
  const off = (name, fn) => listeners.get(name)?.delete(fn)
  globalThis.window = {
    setTimeout(fn, ms) { timers.set(++nextId, { fn, at: now + ms }); return nextId },
    clearTimeout(id) { timers.delete(id) },
    setInterval(fn, ms) { timers.set(++nextId, { fn, at: now + ms, interval: ms }); return nextId },
    clearInterval(id) { timers.delete(id) }, addEventListener: on, removeEventListener: off,
  }
  globalThis.document = { visibilityState: 'visible', addEventListener: on, removeEventListener: off }
  async function advance(ms) {
    const target = now + ms
    for (;;) {
      const next = [...timers.entries()].filter(([, t]) => t.at <= target).sort((a, b) => a[1].at - b[1].at)[0]
      if (!next) break
      const [id, timer] = next; now = timer.at
      if (timer.interval) timer.at += timer.interval; else timers.delete(id)
      timer.fn(); await flush()
    }
    now = target; await flush()
  }
  const { watchVisibleData } = load('src/lib/browser.ts')
  let calls = 0
  const watcher = watchVisibleData(() => { calls++ })
  watcher.status('SUBSCRIBED')
  await advance(60000); assert.equal(calls, 0, 'healthy socket suppresses short-interval polling')
  for (let i = 0; i < 50; i++) watcher.trigger()
  await advance(300); assert.equal(calls, 1, 'burst coalesces into one read')
  document.visibilityState = 'hidden'; watcher.status('CHANNEL_ERROR')
  for (let i = 0; i < 20; i++) watcher.trigger()
  await advance(180000); assert.equal(calls, 1, 'hidden socket failures/events do not cause reads')
  document.visibilityState = 'visible'
  for (const fn of listeners.get('visibilitychange')) fn()
  await advance(300); assert.equal(calls, 2, 'resume reconciles queued hidden events')
  await advance(60000); assert.ok(calls >= 3, 'disconnected socket polls while visible')
  watcher.status('SUBSCRIBED'); await advance(5001)
  const before = calls
  for (let i = 0; i < 100; i++) watcher.trigger()
  await advance(5001); assert.equal(calls, before + 1)
  watcher.trigger(); watcher.dispose(); await advance(180000)
  assert.equal(calls, before + 1, 'dispose cancels pending work and timers')
  assert.equal(timers.size, 0)

  let release, parallel = 0, maximum = 0, completed = 0
  const slow = watchVisibleData(async () => {
    maximum = Math.max(maximum, ++parallel)
    await new Promise((r) => { release = r })
    parallel--; completed++
  })
  slow.trigger(); await advance(5000)
  for (let i = 0; i < 100; i++) slow.trigger()
  await advance(15000); assert.equal(maximum, 1)
  release(); await flush(); await advance(300)
  assert.equal(maximum, 1); assert.equal(completed, 1)
  release(); await flush(); slow.dispose()
  console.log('DASHBOARD_EGRESS_OK: scoped/shared reads, complete stock + deltas, historical edit/delete recovery, bounded snapshots, hidden/reconnect/single-flight scheduling')
} finally {
  Date.now = originalNow
  globalThis.window = originalWindow
  globalThis.document = originalDocument
}
