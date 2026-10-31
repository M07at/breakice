import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
const app = resolve(dirname(fileURLToPath(import.meta.url)), '../app')
const files = []
function walk(folder) { for (const name of readdirSync(folder).sort()) { const file = join(folder, name); if (statSync(file).isDirectory()) walk(file); else { const bytes = readFileSync(file); files.push({ path: relative(app, file).replaceAll('\\', '/'), bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }) } } }
for (const root of ['dist/build/mp-weixin', 'dist/build/h5']) { const folder = resolve(app, root); if (!existsSync(folder)) throw new Error(`缺少构建产物：${root}`); walk(folder) }
mkdirSync(resolve(app, 'reports'), { recursive: true })
writeFileSync(resolve(app, 'reports/release-manifest.json'), JSON.stringify({ version: JSON.parse(readFileSync(resolve(app, 'package.json'), 'utf8')).version, node: process.version, generatedAt: new Date().toISOString(), files }, null, 2))
console.log(`已记录${files.length}个构建文件及SHA-256；未上传或发布。`)
