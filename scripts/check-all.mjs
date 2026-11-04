#!/usr/bin/env node
/**
 * 一键跑完所有「需要真实后端」的验收脚本，最后给一张汇总表。
 *
 * 用法： node scripts/check-all.mjs
 *       npm run check:all
 *
 * 只用 stdio: 'inherit' 起子进程（不捕获输出），避免沙箱下管道被拒；
 * 每项的详细输出直接打在控制台上，汇总只看退出码。
 */

import { spawnSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptsDir = dirname(fileURLToPath(import.meta.url))

const CHECKS = [
  { id: 'backend', name: '房间与表结构', file: 'check-supabase.mjs', needs: '匿名登录' },
  { id: 'uc', name: '谁是卧底对局 + 积分 + 退出同步', file: 'check-uc-command.mjs', needs: '部署 uc-command' },
  { id: 'artwork', name: '融合玩法画作链路', file: 'check-artwork.mjs', needs: '匿名登录' },
  { id: 'truth', name: '真心话回合共享', file: 'check-truth.mjs', needs: '0014' },
  { id: 'drawroom', name: '你画我猜会话与指令队列', file: 'check-draw-room.mjs', needs: '0017' },
  { id: 'qrcode', name: '微信小程序码', file: 'check-qrcode.mjs', needs: '部署 wechat-qrcode' },
  { id: 'realtime', name: 'Realtime 广播收发', file: 'probe-realtime.mjs', needs: '无' },
]

const results = []

for (const check of CHECKS) {
  console.log(`\n${'='.repeat(60)}\n▶ ${check.name}（${check.id}）\n${'='.repeat(60)}`)
  const run = spawnSync(process.execPath, [resolve(scriptsDir, check.file)], { stdio: 'inherit' })
  results.push({ ...check, ok: run.status === 0 })
}

console.log(`\n${'='.repeat(60)}\n汇总\n${'='.repeat(60)}`)
let failed = 0
for (const result of results) {
  if (!result.ok) failed += 1
  const mark = result.ok ? '✓' : '✗'
  console.log(`${mark} ${result.name.padEnd(28, ' ')} ${result.ok ? '' : `（前置：${result.needs}）`}`)
}

console.log(`\n${results.length - failed}/${results.length} 项通过`)
process.exitCode = failed === 0 ? 0 : 1
