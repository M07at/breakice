#!/usr/bin/env node
/**
 * 验收你画我猜联机的服务端底座：
 *   主持人发布视图 → 成员读到 → 成员投指令 → 主持人取走（且不重复取）
 *   → 非主持人不能发布 / 不能取队列 → 非成员读不到。
 *
 * 需要项目开启匿名登录，且已跑 0017。
 * 用法： node scripts/check-draw-room.mjs
 */

import { readFileSync, existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const envFile = resolve(root, 'app/.env.local')

function readEnvFile() {
  if (!existsSync(envFile)) return {}
  const out = {}
  for (const line of readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
  return out
}

const env = readEnvFile()
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

async function call(path, { method = 'GET', token, body } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { apikey: KEY, Authorization: `Bearer ${token ?? KEY}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await res.text()
  let data = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    data = text
  }
  return { status: res.status, ok: res.ok, data, text }
}

async function must(path, options) {
  const res = await call(path, options)
  if (!res.ok) throw new Error(`${path} -> ${res.status} ${res.text.slice(0, 200)}`)
  return res.data
}

const rpc = (name, args, token) => call(`/rest/v1/rpc/${name}`, { method: 'POST', token, body: args })
const anon = () => must('/auth/v1/signup', { method: 'POST', body: {} })

async function main() {
  if (!BASE || !KEY) {
    console.error('缺少 Supabase 配置')
    process.exit(2)
  }
  console.log(`项目：${BASE}\n`)

  const host = await anon()
  const guest = await anon()
  const outsider = await anon()

  console.log('[1] 建房 + 第二人加入')
  let roomId
  try {
    const room = await rpc('create_room', { p_title: '你画我猜联机验收', p_game_type: 'draw', p_max_players: 8, p_settings: {} }, host.access_token)
    if (!room.ok) throw new Error(`${room.status} ${room.text.slice(0, 160)}`)
    roomId = room.data[0].room_id
    const joined = await rpc('join_room', { p_code: room.data[0].room_code }, guest.access_token)
    if (!joined.ok) throw new Error(`${joined.status} ${joined.text.slice(0, 160)}`)
    ok('房间就绪')
  } catch (e) {
    bad('准备房间', String(e.message).slice(0, 200))
    return summary()
  }

  const view = { phase: 'drawing', round: 1, painterId: host.user.id, word: '长颈鹿', messages: [] }

  console.log('\n[2] 主持人发布视图')
  let version = 0
  try {
    const res = await rpc('publish_draw_view', { p_room_id: roomId, p_view: view }, host.access_token)
    if (res.ok && Number(res.data) >= 1) {
      version = Number(res.data)
      ok('发布成功', `version=${version}`)
    } else bad('发布视图', `${res.status} ${res.text.slice(0, 160)}`)
  } catch (e) {
    bad('发布视图', String(e.message).slice(0, 200))
  }

  console.log('\n[3] 成员读取视图')
  try {
    const res = await rpc('read_draw_view', { p_room_id: roomId }, guest.access_token)
    const row = Array.isArray(res.data) ? res.data[0] : res.data
    if (res.ok && row?.view?.word === '长颈鹿') ok('成员读到同一份视图', `version=${row.version}`)
    else bad('读取视图', `${res.status} ${res.text.slice(0, 160)}`)
  } catch (e) {
    bad('读取视图', String(e.message).slice(0, 200))
  }

  console.log('\n[4] 成员投指令')
  try {
    const res = await rpc('post_draw_action', { p_room_id: roomId, p_kind: 'message', p_payload: { text: '是长颈鹿吧' } }, guest.access_token)
    if (res.ok && res.data) ok('指令入队', `id=${res.data}`)
    else bad('投指令', `${res.status} ${res.text.slice(0, 160)}`)
  } catch (e) {
    bad('投指令', String(e.message).slice(0, 200))
  }

  console.log('\n[5] 主持人取走指令（不重复）')
  try {
    const first = await rpc('take_draw_actions', { p_room_id: roomId, p_limit: 50 }, host.access_token)
    const rows = Array.isArray(first.data) ? first.data : []
    if (first.ok && rows.length === 1 && rows[0].kind === 'message') ok('取到 1 条指令', `sender=${String(rows[0].user_id).slice(0, 8)}…`)
    else bad('取指令', `${first.status} ${JSON.stringify(first.data).slice(0, 160)}`)

    const second = await rpc('take_draw_actions', { p_room_id: roomId, p_limit: 50 }, host.access_token)
    const again = Array.isArray(second.data) ? second.data : []
    if (second.ok && again.length === 0) ok('再取为空（已消费，不会重复处理）')
    else bad('重复取指令', JSON.stringify(again).slice(0, 160))
  } catch (e) {
    bad('取指令', String(e.message).slice(0, 200))
  }

  console.log('\n[6] 权限边界')
  try {
    const notHost = await rpc('publish_draw_view', { p_room_id: roomId, p_view: view }, guest.access_token)
    if (!notHost.ok && /HOST_ONLY|42501/i.test(notHost.text)) ok('非主持人不能发布视图')
    else bad('非主持人发布', `${notHost.status} ${notHost.text.slice(0, 120)}`)

    const notHostTake = await rpc('take_draw_actions', { p_room_id: roomId, p_limit: 10 }, guest.access_token)
    if (!notHostTake.ok && /HOST_ONLY|42501/i.test(notHostTake.text)) ok('非主持人不能取指令队列')
    else bad('非主持人取队列', `${notHostTake.status} ${notHostTake.text.slice(0, 120)}`)

    const outsiderRead = await rpc('read_draw_view', { p_room_id: roomId }, outsider.access_token)
    if (!outsiderRead.ok && /NOT_A_MEMBER|42501/i.test(outsiderRead.text)) ok('非成员读不到视图')
    else bad('非成员读取', `${outsiderRead.status} ${outsiderRead.text.slice(0, 120)}`)
  } catch (e) {
    bad('权限边界', String(e.message).slice(0, 200))
  }

  summary()
}

function summary() {
  console.log(`\n通过 ${passed} 项，失败 ${failed} 项`)
  process.exitCode = failed === 0 && passed > 0 ? 0 : 1
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})

