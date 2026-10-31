// 防止密钥进代码库和小程序包（NFR：API Key 不暴露前端）
// 用法：node scripts/check-secrets.mjs app supabase cloudfunctions
// 检查：.env* 里 VITE_ 开头的密钥类变量；源码和打包产物里的 service_role JWT、Supabase secret key、sk- 密钥、私钥
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { basename, extname, join } from 'node:path'

const SKIP_DIRS = new Set(['node_modules', '.git', 'unpackage', '.c3-data', 'reports'])
const TEXT_EXT = new Set(['.js', '.mjs', '.cjs', '.ts', '.vue', '.json', '.wxml', '.wxss', '.wxs', '.html', '.css', '.sql', '.yml', '.yaml', '.md'])
const SECRET_VAR = /^\s*(VITE_[A-Z0-9_]*(SECRET|SERVICE_ROLE|PRIVATE|PASSWORD|API_KEY|AI_KEY|TOKEN)[A-Z0-9_]*)\s*=\s*(\S+)/im
const PATTERNS = [
  [/sb_secret_[A-Za-z0-9_-]{10,}/, 'Supabase secret key'],
  [/\bsk-[A-Za-z0-9_-]{20,}/, 'sk- 开头的 API Key'],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, '私钥'],
]
const JWT = /eyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g

const problems = []

function jwtRole(token) {
  try {
    const payload = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')
    return JSON.parse(Buffer.from(payload, 'base64').toString('utf8')).role
  } catch {
    return undefined
  }
}

function checkFile(file) {
  const name = basename(file)
  const isEnv = name.startsWith('.env')
  if (!isEnv && !TEXT_EXT.has(extname(name))) return
  const text = readFileSync(file, 'utf8')
  if (isEnv) {
    for (const line of text.split(/\r?\n/)) {
      const m = SECRET_VAR.exec(line)
      if (m) problems.push(`${file}: ${m[1]} 是密钥，不能用 VITE_ 开头（会被打包进小程序）`)
    }
  }
  for (const [re, label] of PATTERNS) if (re.test(text)) problems.push(`${file}: 发现${label}`)
  for (const token of text.match(JWT) ?? []) {
    if (jwtRole(token) === 'service_role') problems.push(`${file}: 发现 service_role JWT`)
  }
}

function walk(p) {
  const st = statSync(p)
  if (st.isDirectory()) {
    if (SKIP_DIRS.has(basename(p))) return
    for (const name of readdirSync(p)) walk(join(p, name))
  } else {
    checkFile(p)
  }
}

const targets = process.argv.slice(2)
for (const t of targets.length ? targets : ['.']) if (existsSync(t)) walk(t)

if (problems.length) {
  console.error(problems.join('\n'))
  console.error(`\n发现 ${problems.length} 处疑似密钥。密钥只放 CI受保护变量或云函数环境变量。`)
  process.exit(1)
}
console.log('没有发现密钥')
