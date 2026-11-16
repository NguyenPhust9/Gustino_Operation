import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { basename, join } from 'node:path'

const fileEnv = await readEnv('.env.local')
const env = {
  ...fileEnv,
  ...(process.env.VITE_SUPABASE_URL ? { VITE_SUPABASE_URL: process.env.VITE_SUPABASE_URL } : {}),
  ...(process.env.VITE_SUPABASE_ANON_KEY ? { VITE_SUPABASE_ANON_KEY: process.env.VITE_SUPABASE_ANON_KEY } : {}),
}
const expectedUrl = env.VITE_SUPABASE_URL
const expectedAnonKey = env.VITE_SUPABASE_ANON_KEY
assert.ok(expectedUrl, 'VITE_SUPABASE_URL must exist in .env.local for the production bundle check')
assert.ok(expectedAnonKey, 'VITE_SUPABASE_ANON_KEY must exist in .env.local for the production bundle check')

const assetsDir = join('dist', 'assets')
const files = (await readdir(assetsDir)).filter((name) => name.endsWith('.js'))
const bundles = await Promise.all(files.map(async (name) => ({
  name,
  source: await readFile(join(assetsDir, name), 'utf8'),
})))

const expectedHost = new URL(expectedUrl).host
const embeddedProjects = new Set(bundles.flatMap((item) => [...item.source.matchAll(/https:\/\/([a-z0-9]{20})\.supabase\.co/g)].map((match) => match[1])))
assert.deepEqual([...embeddedProjects], [expectedHost.split('.')[0]], 'production JS includes another Supabase project')
const urlBundle = bundles.find((item) => item.source.includes(expectedUrl) || item.source.includes(expectedHost))
const keyBundle = bundles.find((item) => item.source.includes(expectedAnonKey))
for (const name of ['SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_TARGET_SERVICE_ROLE_KEY', 'SUPABASE_DB_PASSWORD', 'SUPABASE_TARGET_DB_PASSWORD']) {
  const secret = process.env[name] || fileEnv[name]
  if (secret) assert.ok(!bundles.some((item) => item.source.includes(secret)), `production JS contains server-only credential ${name}`)
}
assert.ok(!expectedAnonKey.startsWith('sb_secret_'), 'browser Supabase key must be public')
if (expectedAnonKey.startsWith('eyJ')) {
  const payload = JSON.parse(Buffer.from(expectedAnonKey.split('.')[1], 'base64url').toString('utf8'))
  assert.equal(payload.role, 'anon', 'browser JWT key must be anon')
  assert.equal(payload.ref, new URL(expectedUrl).hostname.split('.')[0], 'Supabase URL and JWT key refer to different projects')
}
const revenueBundle = bundles.find((item) => /^revenue-[\w-]+\.js$/.test(item.name))
assert.ok(
  urlBundle,
  'production JS does not contain the configured Supabase project URL; users would fall back to the LAN API and see empty data',
)
assert.ok(
  keyBundle,
  'production JS does not contain the public Supabase anon key; browser authentication/data reads cannot work',
)
assert.ok(revenueBundle, 'production build is missing the shared revenue bundle')
assert.ok(
  revenueBundle.source.includes('hasRevenueSummary') && revenueBundle.source.includes('receipt-'),
  'production revenue bundle lost the partial-snapshot POS fallback; deploying it would hide valid receipt revenue',
)

console.log(`PRODUCTION_SUPABASE_BUNDLE_OK (${basename(urlBundle.name)}; ${revenueBundle.name})`)

async function readEnv(path) {
  const result = {}
  const source = await readFile(path, 'utf8').catch((error) => {
    if (error?.code === 'ENOENT') return ''
    throw error
  })
  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const separator = line.indexOf('=')
    if (separator < 1) continue
    const name = line.slice(0, separator).trim()
    let value = line.slice(separator + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    result[name] = value
  }
  return result
}
