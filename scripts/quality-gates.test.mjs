import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, truncateSync, rmSync } from 'node:fs'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
const scripts = dirname(fileURLToPath(import.meta.url))
function fixture(fn) { const root = mkdtempSync(join(tmpdir(), 'pobingju-gate-')); try { fn(root) } finally { if (!resolve(root).startsWith(resolve(tmpdir()) + sep)) throw new Error('Invalid cleanup target'); rmSync(root, { recursive: true, force: true }) } }
const run = (script, root) => spawnSync(process.execPath, [join(scripts, script), root], { encoding: 'utf8' })
test('主包恰好2MiB时失败，低于限制时通过', () => fixture(root => {
  writeFileSync(join(root, 'app.json'), '{}')
  writeFileSync(join(root, 'payload.js'), '')
  truncateSync(join(root, 'payload.js'), 2 * 1024 * 1024)
  assert.equal(run('check-mp-size.mjs', root).status, 1)
  truncateSync(join(root, 'payload.js'), 100)
  assert.equal(run('check-mp-size.mjs', root).status, 0)
}))
test('总包超过限制时失败', () => fixture(root => {
  mkdirSync(join(root, 'pages-sub'))
  writeFileSync(join(root, 'app.json'), JSON.stringify({ subPackages: [{ root: 'pages-sub' }] }))
  const file = join(root, 'pages-sub/payload.js'); writeFileSync(file, ''); truncateSync(file, 20 * 1024 * 1024)
  assert.equal(run('check-mp-size.mjs', root).status, 1)
}))
test('扫描拒绝合成密钥且不打印值；公开配置允许', () => fixture(root => {
  const synthetic = 'sk' + '-' + 'x'.repeat(24)
  writeFileSync(join(root, 'bad.js'), `const credential = '${synthetic}'`)
  const failed = run('check-secrets.mjs', root)
  assert.equal(failed.status, 1); assert(!failed.stderr.includes(synthetic))
  writeFileSync(join(root, 'bad.js'), 'const publicConfiguration = true')
  writeFileSync(join(root, '.env.example'), 'VITE_APP_ENV=dev\nVITE_SUPABASE_ANON_KEY=\n')
  assert.equal(run('check-secrets.mjs', root).status, 0)
}))
