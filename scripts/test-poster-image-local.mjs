import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import http from 'node:http'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

import handler from '../api/n8n/poster-image.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const outputDir = join(root, 'artifacts', 'poster-tests')
const secret = 'local-poster-test-secret'
const gustinoToken = 'local-gustino-test-token'
const today = '2026-10-11'
const branchIds = [
  'lotte-2310',
  'lotte-vt',
  'gold-coast',
  'passio-pho-quang',
  'passio-dong-den',
  'cn-15h',
]

let visibleCount = 3
const server = http.createServer(async (request, response) => {
  const url = new URL(request.url || '/', 'http://127.0.0.1')
  if (url.pathname === '/api/n8n/poster-image') {
    request.headers['x-forwarded-proto'] = 'http'
    request.query = Object.fromEntries(url.searchParams)
    response.status = function status(code) { this.statusCode = code; return this }
    response.json = function json(value) {
      this.setHeader('Content-Type', 'application/json')
      this.end(JSON.stringify(value))
      return this
    }
    response.send = function send(value) { this.end(value); return this }
    await handler(request, response)
    return
  }

  if (url.pathname === '/api/n8n/revenue') {
    const rows = []
    for (const [index, branchId] of branchIds.slice(0, visibleCount).entries()) {
      const edgeRevenues = [9_999_999_999, 125_430_000, 3_750_000, 2_500_000, 1_250_000, 0]
      const currentRevenue = visibleCount === 6
        ? edgeRevenues[index]
        : Math.round((visibleCount - index) * 1_250_000)
      const comparisons = [
        [0, currentRevenue],
        [1, index === 0 && visibleCount === 6 ? currentRevenue / 2 : index === 5 ? 1_000_000 : currentRevenue * 0.9],
        [7, currentRevenue * 0.8],
      ]
      for (const [daysAgo, revenue] of comparisons) {
        const date = new Date(`${today}T00:00:00Z`)
        date.setUTCDate(date.getUTCDate() - daysAgo)
        rows.push({
          branchId,
          reportDate: date.toISOString().slice(0, 10),
          revenue: Math.round(revenue),
          totalSold: (visibleCount - index) * 17,
        })
      }
    }
    response.writeHead(200, { 'Content-Type': 'application/json' })
    response.end(JSON.stringify({ rows }))
    return
  }

  if (url.pathname.startsWith('/poster/')) {
    const requested = url.pathname.slice('/poster/'.length)
    let image
    try {
      image = await readFile(join(root, 'public', 'poster', requested))
    } catch {
      image = await readFile(join(root, 'public', 'poster', 'lotte-2310.png'))
    }
    response.writeHead(200, { 'Content-Type': 'image/png' })
    response.end(image)
    return
  }

  response.writeHead(404)
  response.end()
})

function responseCapture() {
  return {
    statusCode: 200,
    headers: {},
    body: undefined,
    setHeader(name, value) { this.headers[name.toLowerCase()] = value },
    status(code) { this.statusCode = code; return this },
    json(value) { this.body = value; return this },
    send(value) { this.body = value; return this },
  }
}

async function invoke({ count, apiKey, queryKey, includeHidden = false }) {
  visibleCount = count
  process.env.POSTER_INCLUDE_HIDDEN_BRANCHES = includeHidden ? 'true' : 'false'
  const address = server.address()
  const response = responseCapture()
  await handler({
    method: 'GET',
    headers: { host: `127.0.0.1:${address.port}`, 'x-forwarded-proto': 'http', ...(apiKey ? { 'x-api-key': apiKey } : {}) },
    query: { date: today, ...(queryKey ? { key: queryKey } : {}) },
  }, response)
  return response
}

process.env.N8N_API_SECRET = secret
process.env.N8N_REPORT_WEBHOOK_TOKEN = gustinoToken
if (process.platform === 'win32') {
  process.env.POSTER_CHROMIUM_EXECUTABLE_PATH ||= 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'
}
await mkdir(outputDir, { recursive: true })
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))

try {
  const unauthorized = await invoke({ count: 3, apiKey: 'wrong' })
  assert.equal(unauthorized.statusCode, 401)

  const queryKeyOnly = await invoke({ count: 3, queryKey: secret })
  assert.equal(queryKeyOnly.statusCode, 401)

  for (const count of [1, 3, 5, 6]) {
    const response = await invoke({ count, apiKey: secret, includeHidden: count === 6 })
    assert.equal(response.statusCode, 200)
    assert.equal(response.headers['content-type'], 'image/png')
    assert.ok(Buffer.isBuffer(response.body))
    assert.equal(response.body.subarray(1, 4).toString(), 'PNG')
    await writeFile(join(outputDir, `poster-${count}-branches.png`), response.body)
  }

  const run = promisify(execFile)
  const baseUrl = `http://127.0.0.1:${server.address().port}/api/n8n/poster-image?date=${today}`
  visibleCount = 5
  process.env.POSTER_INCLUDE_HIDDEN_BRANCHES = 'false'
  const curlOutput = join(outputDir, 'curl-poster.png')
  await run('curl.exe', ['--silent', '--show-error', '--fail', '--output', curlOutput, '--header', `x-api-key: ${secret}`, baseUrl])
  assert.equal((await readFile(curlOutput)).subarray(1, 4).toString(), 'PNG')
  await run('curl.exe', ['--silent', '--show-error', '--fail', '--output', curlOutput, '--header', `x-gustino-token: ${gustinoToken}`, baseUrl])
  assert.equal((await readFile(curlOutput)).subarray(1, 4).toString(), 'PNG')
  const wrongKey = await run('curl.exe', ['--silent', '--output', 'NUL', '--write-out', '%{http_code}', '--header', 'x-api-key: wrong', baseUrl])
  assert.equal(wrongKey.stdout, '401')
  const queryKey = await run('curl.exe', ['--silent', '--output', 'NUL', '--write-out', '%{http_code}', `${baseUrl}&key=${secret}`])
  assert.equal(queryKey.stdout, '401')
  console.log(`POSTER_IMAGE_LOCAL_OK ${outputDir}`)
} finally {
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
}
