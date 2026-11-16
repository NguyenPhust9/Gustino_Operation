import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

const source = readFileSync(new URL('../src/lib/supabase.ts', import.meta.url), 'utf8').replaceAll('import.meta.env', 'testEnv')
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
function create(project) {
  let configuration
  const module = { exports: {} }
  const require = () => ({ createClient(url, key, options) { configuration = { url, key, options }; return configuration } })
  new Function('require', 'module', 'exports', 'testEnv', compiled)(require, module, module.exports, {
    VITE_SUPABASE_URL: `https://${project}.supabase.co`, VITE_SUPABASE_ANON_KEY: 'sb_publishable_isolated-test',
  })
  return configuration
}
const first = create('first-test-project')
const second = create('second-test-project')
assert.notEqual(first.options.auth.storageKey, second.options.auth.storageKey, 'switching projects must not reuse the previous JWT session')
assert.notEqual(second.options.auth.storageKey, 'gustino_supabase_auth_v1', 'legacy global session must not be reused')
assert.equal(second.options.auth.persistSession, true)
assert.equal(second.options.auth.autoRefreshToken, true)
console.log('SUPABASE_PROJECT_SESSION_OK')
