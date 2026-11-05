#!/usr/bin/env node
/**
 * 机器人补位的验收脚本：
 *   1. 线上 uc-command 是不是新版（op=version 里带 bots 标记）
 *   2. 两个真人 + 2 个机器人能开成一局 4 人局
 *   3. 机器人不会替真人跳过流程——开局后应该停在「领词」，不会直接结算
 *
 * 用法：npm run check:bots
 */

import { readFileSync, existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const env = {}
const file = resolve(root, 'app/.env.local')
if (existsSync(file)) {
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
}
const BASE = (process.env.VITE_SUPABASE_URL || env.VITE_SUPABASE_URL || '').replace(/\/+$/, '')
const KEY = process.env.VITE_SUPABASE_ANON_KEY || env.VITE_SUPABASE_ANON_KEY || ''

let passed = 0
let failed = 0
const ok = (name, detail = '') => {
  passed++
  console.log(`  ✓ ${name}${detail ? `  ${detail}` : ''}`)
}
const bad = (name, detail = '') => {
  failed++
  console.log(`  ✗ ${name}${detail ? `  ${detail}` : ''}`)
}

const call = async (path, { method = 'GET', token, body } = {}) => {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { apikey: KEY, Authorization: `Bearer ${token ?? KEY}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  return { status: res.status, ok: res.ok, data: await res.json().catch(() => null), text: '' }
}
const rpc = (name, args, token) => call(`/rest/v1/rpc/${name}`, { method: 'POST', token, body: args })

const main = async () => {
  console.log(`项目：${BASE}\n`)

  console.log('[1] 线上函数版本')
  const ver = await call('/functions/v1/uc-command', { method: 'POST', body: { op: 'version' } })
  const version = ver.data?.version ?? '(读不到)'
  if (String(version).includes('bots')) ok('线上是带机器人补位的版本', version)
  else bad('线上函数还是旧版，请重新部署 uc-command', version)

  console.log('\n[2] 两个真人 + 两个机器人开局')
  const host = await call('/auth/v1/signup', { method: 'POST', body: {} })
  const guest = await call('/auth/v1/signup', { method: 'POST', body: {} })
  const created = await rpc('create_room', { p_title: '机器人验收', p_game_type: 'lobby', p_max_players: 8, p_settings: {} }, host.data.access_token)
  const roomId = created.data[0].room_id
  const code = created.data[0].code
  await rpc('join_room', { p_code: code }, guest.data.access_token)
  for (const token of [host.data.access_token, guest.data.access_token]) {
    await rpc('set_ready', { p_room_id: roomId, p_ready: true }, token)
  }

  const started = await call('/functions/v1/uc-command', {
    method: 'POST',
    token: host.data.access_token,
    body: { op: 'start', room_id: roomId, variant: 'classic', bots: 2, request_id: `probe-${Date.now()}` },
  })
  if (!started.ok) {
    bad('开局失败', `${started.status} ${JSON.stringify(started.data).slice(0, 160)}`)
    return summary()
  }
  const snap = started.data
  if (snap.players?.length === 4) ok('补齐到 4 人', `2 真人 + 2 机器人`)
  else bad('人数不对', String(snap.players?.length))

  console.log('\n[3] 机器人不会替真人走完流程')
  if (snap.view.phase === 'word') ok('开局停在领词阶段，没有直接结算')
  else bad('开局阶段异常', snap.view.phase)

  const acked = await call('/functions/v1/uc-command', {
    method: 'POST',
    token: host.data.access_token,
    body: { op: 'act', game_id: snap.gameId, action: { type: 'acknowledgeWord', by: snap.playerId }, meta: { requestId: `ack-${Date.now()}` } },
  })
  if (acked.ok && acked.data.view.phase === 'ended') {
    bad('真人只确认了词，局面却直接结算了——机器人把流程跑完了', acked.data.view.phase)
  } else if (acked.ok) {
    ok('真人确认词后局面正常推进', `phase=${acked.data.view.phase}`)
  } else {
    bad('确认词失败', `${acked.status} ${JSON.stringify(acked.data).slice(0, 140)}`)
  }
}

function summary() {
  console.log(`\n通过 ${passed} 项，失败 ${failed} 项`)
  process.exitCode = failed === 0 && passed > 0 ? 0 : 1
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
