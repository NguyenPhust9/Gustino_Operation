import assert from 'node:assert/strict'

const previousEnv = {
  CRON_SECRET: process.env.CRON_SECRET,
  SUPABASE_URL: process.env.SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
}
const previousFetch = globalThis.fetch

try {
  process.env.CRON_SECRET = 'test-cron-secret-at-least-16'
  process.env.SUPABASE_URL = 'https://example.supabase.co'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key'
  const { default: handler, previousBusinessDateInTimeZone } = await import('../api/auto-close-day.ts')
  assert.equal(typeof previousBusinessDateInTimeZone, 'function')
  assert.equal(
    previousBusinessDateInTimeZone(new Date('2026-07-15T17:00:00.000Z'), 'Asia/Bangkok'),
    '2026-07-15',
    '00:00 UTC+7 on July 16 must target the completed July 15 business day',
  )

  let fetchCount = 0
  let operationDaysQuery = ''
  const unauthorized = responseRecorder()
  await handler({ method: 'GET', headers: {} }, unauthorized)
  assert.equal(unauthorized.statusCode, 401)
  assert.equal(fetchCount, 0)

  const calls = []
  globalThis.fetch = async (url, init = {}) => {
    fetchCount += 1
    calls.push({ url: String(url), init })
    const path = new URL(String(url)).pathname + new URL(String(url)).search
    if (path.startsWith('/rest/v1/operation_days?status=eq.open')) {
      operationDaysQuery = path
      return jsonResponse([{
        id: 'day-1', branch_id: 'branch-1', business_date: '2026-07-15', opened_by: 'actor-1',
      }])
    }
    if (path.startsWith('/rest/v1/bag_shift_sessions?')) {
      return jsonResponse([{
        id: 'shift-2', leader_id: 'actor-1', sequence: 2, status: 'open', discrepancy_note: null,
      }])
    }
    if (path.startsWith('/rest/v1/bag_allocations?')) {
      return jsonResponse([{
        id: 'allocation-1', shift_id: 'shift-2', issued_quantity: 10, sold_quantity: 3, damaged_quantity: 1,
      }])
    }
    if (path.startsWith('/rest/v1/sales_receipts?')) {
      return jsonResponse([{
        id: 'receipt-1', total_amount: 538000, total_quantity: 7,
      }])
    }
    if (path.startsWith('/rest/v1/report_snapshots?') && (init.method || 'GET') === 'GET') {
      return jsonResponse([{ payload: { shiftReports: { prior: { sequence: 1 } } } }])
    }
    return new Response(null, { status: 204 })
  }

  const authorized = responseRecorder()
  await handler({
    method: 'GET',
    headers: { authorization: `Bearer ${process.env.CRON_SECRET}` },
  }, authorized)
  assert.equal(authorized.statusCode, 200)
  assert.equal(authorized.body.ok, true)
  assert.equal(authorized.body.closed.length, 1)
  assert.ok(
    operationDaysQuery.includes(`business_date=lte.${previousBusinessDateInTimeZone(new Date(), 'Asia/Bangkok')}`),
    'auto-close must select only the completed previous business day and older stale open days',
  )

  const allocationPatch = findCall(calls, '/rest/v1/bag_allocations?id=eq.allocation-1', 'PATCH')
  assert.equal(JSON.parse(String(allocationPatch.init.body)).returned_quantity, 6)
  const shiftPatch = findCall(calls, '/rest/v1/bag_shift_sessions?id=eq.shift-2', 'PATCH')
  assert.equal(JSON.parse(String(shiftPatch.init.body)).status, 'closed')
  const snapshotPost = findCall(calls, '/rest/v1/report_snapshots?on_conflict=branch_id,report_date', 'POST')
  const snapshotBody = JSON.parse(String(snapshotPost.init.body))
  assert.ok(snapshotBody.payload.autoFinalizedAt)
  assert.equal(snapshotBody.payload.shiftReports.prior.sequence, 1)
  assert.equal(
    snapshotBody.payload.summary?.revenue,
    538000,
    'auto-close snapshot must preserve the authoritative POS revenue for the completed day',
  )
  assert.equal(
    snapshotBody.payload.dailyReport?.totals?.revenue,
    538000,
    'archive dailyReport must not become an empty/zero report when the leader forgets to finalize',
  )
  const dayPatchIndex = calls.findIndex((call) => call.url.includes('/rest/v1/operation_days?id=eq.day-1') && call.init.method === 'PATCH')
  const snapshotPostIndex = calls.indexOf(snapshotPost)
  assert.ok(dayPatchIndex > snapshotPostIndex, 'operation day must close only after settlement/session/snapshot writes')
  assert.equal(calls[0].init.headers.Authorization, 'Bearer test-service-role-key', 'legacy JWT key keeps its Bearer header')

  process.env.SUPABASE_SERVICE_ROLE_KEY = 'sb_secret_isolated-test-key'
  let modernReads = 0
  globalThis.fetch = async (_url, init) => {
    modernReads += 1
    assert.equal(init.headers.apikey, 'sb_secret_isolated-test-key')
    assert.equal(new Headers(init.headers).has('Authorization'), false, 'secret API key is not a JWT Bearer token')
    return jsonResponse([])
  }
  const modern = responseRecorder()
  await handler({ method: 'GET', headers: { authorization: `Bearer ${process.env.CRON_SECRET}` } }, modern)
  assert.equal(modern.statusCode, 200)
  assert.ok(modernReads > 0)

  console.log('AUTO_CLOSE_DAY_OK')
} finally {
  globalThis.fetch = previousFetch
  for (const [key, value] of Object.entries(previousEnv)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
}

function responseRecorder() {
  return {
    statusCode: 200,
    body: undefined,
    headers: {},
    status(code) { this.statusCode = code; return this },
    json(body) { this.body = body; return this },
    setHeader(key, value) { this.headers[key] = value },
  }
}

function jsonResponse(value) {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

function findCall(calls, fragment, method) {
  const call = calls.find((candidate) => candidate.url.includes(fragment) && candidate.init.method === method)
  assert.ok(call, `missing ${method} ${fragment}`)
  return call
}
