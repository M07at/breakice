import { existsSync, mkdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
const app = resolve(dirname(fileURLToPath(import.meta.url)), '../app')
const reports = resolve(app, 'reports')
mkdirSync(reports, { recursive: true })
for (const name of ['tests.xml', 'release-manifest.json']) { const file = resolve(reports, name); if (existsSync(file)) unlinkSync(file) }
const result = { startedAt: new Date().toISOString(), node: process.version, status: 'running', stages: [] }
writeFileSync(resolve(reports, 'verify.json'), JSON.stringify(result, null, 2))
const stages = ['doctor', 'check:bundle', 'type-check', 'test:ci', 'test:quality', 'build:mp-weixin', 'build:h5', 'check:size', 'check:secrets', 'release:manifest']
for (const stage of stages) {
  console.log(`\n[C checks] ${stage}`)
  const started = Date.now()
  const npmCli = process.env.npm_execpath
  const command = npmCli ? process.execPath : process.platform === 'win32' ? 'npm.cmd' : 'npm'
  const args = npmCli ? [npmCli, 'run', stage] : ['run', stage]
  const child = spawnSync(command, args, { cwd: app, stdio: 'inherit', shell: !npmCli && process.platform === 'win32' })
  const code = child.status ?? 1
  result.stages.push({ name: stage, passed: code === 0, exitCode: code, durationMs: Date.now() - started })
  if (child.error) console.error('无法启动检查进程；请通过npm run verify运行。')
  result.status = code === 0 ? 'running' : 'failed'
  writeFileSync(resolve(reports, 'verify.json'), JSON.stringify(result, null, 2))
  if (code !== 0) { process.exitCode = code; break }
}
if (!process.exitCode) result.status = 'passed'
result.finishedAt = new Date().toISOString()
writeFileSync(resolve(reports, 'verify.json'), JSON.stringify(result, null, 2))
console.log(`\nC checks: ${result.status}; reports/verify.json`)
