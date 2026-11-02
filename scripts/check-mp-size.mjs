// 检查小程序包体积：主包 < 2MB，总包 < 20MB（NFR 约束）
// 用法：node scripts/check-mp-size.mjs app/dist/build/mp-weixin
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

const MB = 1024 * 1024
const MAIN_LIMIT = 2 * MB
const TOTAL_LIMIT = 20 * MB

const dir = process.argv[2] ?? 'app/dist/build/mp-weixin'
const appJson = join(dir, 'app.json')
if (!existsSync(appJson)) {
  console.error(`找不到 ${appJson}，先运行 npm run build:mp-weixin`)
  process.exit(1)
}

const app = JSON.parse(readFileSync(appJson, 'utf8'))
const roots = (app.subPackages ?? app.subpackages ?? []).map((p) => p.root.replace(/\/+$/, ''))
const sizes = new Map([['(主包)', 0], ...roots.map((r) => [r, 0])])

function walk(p) {
  for (const name of readdirSync(p)) {
    const full = join(p, name)
    const st = statSync(full)
    if (st.isDirectory()) {
      walk(full)
      continue
    }
    const rel = relative(dir, full).split(sep).join('/')
    const root = roots.find((r) => rel.startsWith(`${r}/`)) ?? '(主包)'
    sizes.set(root, sizes.get(root) + st.size)
  }
}
walk(dir)

const fmt = (n) => `${(n / MB).toFixed(2)} MB`
let total = 0
for (const [name, size] of sizes) {
  total += size
  console.log(`${name.padEnd(24)} ${fmt(size)}`)
}
console.log(`${'(总计)'.padEnd(24)} ${fmt(total)}`)

const main = sizes.get('(主包)')
let failed = false
if (main >= MAIN_LIMIT) {
  console.error(`主包 ${fmt(main)} 超过 2MB：把页面和大文件挪进分包`)
  failed = true
}
if (total >= TOTAL_LIMIT) {
  console.error(`总包 ${fmt(total)} 超过 20MB`)
  failed = true
}
process.exit(failed ? 1 : 0)
