import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
const app = resolve(dirname(fileURLToPath(import.meta.url)), '../app')
const fail = message => { console.error(message); process.exitCode = 1 }
if (Number(process.versions.node.split('.')[0]) < 22) fail('需要Node.js 22或更新版本；CI使用Node.js 22。')
for (const name of ['package-lock.json', '.env.example', 'src/pages.json']) if (!existsSync(resolve(app, name))) fail(`缺少 ${name}`)
const values = {}
for (const filename of ['.env', '.env.local']) {
  const file = resolve(app, filename)
  if (existsSync(file)) for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/)
    if (match) values[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2')
  }
}
Object.assign(values, Object.fromEntries(Object.entries(process.env).filter(([key]) => key.startsWith('VITE_'))))
if (values.VITE_APP_ENV && !['dev', 'prod'].includes(values.VITE_APP_ENV)) fail('VITE_APP_ENV只能是dev或prod。')
if (!!values.VITE_SUPABASE_URL !== !!values.VITE_SUPABASE_ANON_KEY) fail('Supabase公开URL与公开key应同时配置或同时留空。')
if (values.VITE_SUPABASE_URL) { try { if (new URL(values.VITE_SUPABASE_URL).protocol !== 'https:') fail('VITE_SUPABASE_URL需要https。') } catch { fail('VITE_SUPABASE_URL格式无效。') } }
if (!process.exitCode) console.log(`环境检查通过：Node ${process.versions.node}；不要求真实平台密钥。`)
