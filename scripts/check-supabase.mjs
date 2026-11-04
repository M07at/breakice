#!/usr/bin/env node
/**
 * 对着真实的 Supabase 项目做一次后端验收。
 *
 * 检查内容：
 *   1. 0001–0006 的表和 RPC 是否都存在；
 *   2. 未登录时 RPC 是否被拒绝（AUTH_REQUIRED / 401）；
 *   3. 两个账号能否建房、加入、准备、开局、结束；
 *   4. 房间隔离：第三个账号看不到别人的房间。
 *
 * 用法：
 *   node scripts/check-supabase.mjs
 * 配置来源：环境变量 VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY，没有就读 app/.env.local。
 *
 * 注意：会真的往项目里写测试数据（房间和测试用户），跑完不会自动删。
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
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (match) out[match[1]] = match[2].replace(/^["']|["']$/g, '')
  }
  return out
}

const fileEnv = readEnvFile()
const BASE = (process.env.VITE_SUPABASE_URL || fileEnv.VITE_SUPABASE_URL || '').replace(/\/+$/, '')
const KEY = process.env.VITE_SUPABASE_ANON_KEY || fileEnv.VITE_SUPABASE_ANON_KEY || ''

let passed = 0
let failed = 0

function ok(name, detail = '') {
  passed++
  console.log(`  ✓ ${name}${detail ? `  ${detail}` : ''}`)
}

function fail(name, detail = '') {
  failed++
  console.log(`  ✗ ${name}${detail ? `  ${detail}` : ''}`)
}

async function call(path, { method = 'GET', token, body, expectOk = true } = {}) {
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      apikey: KEY,
      Authorization: `Bearer ${token ?? KEY}`,
      'Content-Type': 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await response.text()
  let data = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    data = text
  }
  if (expectOk && !response.ok) {
    const error = new Error(`${method} ${path} -> ${response.status} ${text.slice(0, 200)}`)
    error.status = response.status
    error.data = data
    throw error
  }
  return { status: response.status, data, text }
}

async function anonymousSession(label) {
  const { data } = await call('/auth/v1/signup', { method: 'POST', body: {} })
  if (!data?.access_token || !data?.user?.id) throw new Error(`${label} 匿名登录没有拿到会话`)
  return { token: data.access_token, userId: data.user.id, label }
}

async function main() {
  if (!BASE || !KEY) {
    console.error('缺少 VITE_SUPABASE_URL 或 VITE_SUPABASE_ANON_KEY（环境变量或 app/.env.local）')
    process.exit(2)
  }
  console.log(`项目：${BASE}\n`)

  console.log('[1] 表结构')
  for (const table of ['profiles', 'rooms', 'room_members', 'games', 'game_secrets', 'artworks', 'word_banks']) {
    try {
      await call(`/rest/v1/${table}?select=*&limit=1`)
      ok(`表 ${table}`)
    } catch (error) {
      fail(`表 ${table}`, String(error.message).slice(0, 160))
    }
  }

  console.log('\n[2] RPC 存在性与权限')
  for (const [name, args] of [
    ['create_room', { p_title: 'x', p_game_type: 'lobby', p_max_players: 8, p_settings: {} }],
    ['join_room', { p_code: 'ZZZZZZ' }],
    ['set_ready', { p_room_id: '00000000-0000-0000-0000-000000000000', p_ready: true }],
    ['start_room_game', { p_room_id: '00000000-0000-0000-0000-000000000000', p_game_type: 'undercover' }],
    ['end_room_game', { p_room_id: '00000000-0000-0000-0000-000000000000' }],
    ['set_my_nickname', { p_nickname: 'x' }],
  ]) {
    try {
      await call(`/rest/v1/rpc/${name}`, { method: 'POST', body: args })
      fail(`RPC ${name}`, '未登录居然调用成功，权限有问题')
    } catch (error) {
      if (error.status === 404) fail(`RPC ${name}`, '函数不存在')
      else ok(`RPC ${name} 存在且拒绝未登录调用`, `HTTP ${error.status}`)
    }
  }

  console.log('\n[3] 房间流程')
  let host, guest, outsider
  try {
    host = await anonymousSession('host')
    guest = await anonymousSession('guest')
    outsider = await anonymousSession('outsider')
    ok('三个匿名会话')
  } catch (error) {
    fail('匿名登录', String(error.message).slice(0, 200))
    console.log('\n匿名登录不可用时，第 3 节无法验证。')
    return summary()
  }

  let roomId, roomCode
  try {
    const { data } = await call('/rest/v1/rpc/create_room', {
      method: 'POST',
      token: host.token,
      body: { p_title: '后端验收房', p_game_type: 'lobby', p_max_players: 8, p_settings: {} },
    })
    roomId = data?.[0]?.room_id
    roomCode = data?.[0]?.room_code
    if (!roomId) throw new Error('没有返回 room_id')
    ok('房主建房', `房间号 ${roomCode}`)
  } catch (error) {
    fail('房主建房', String(error.message).slice(0, 200))
    return summary()
  }

  try {
    const { data } = await call('/rest/v1/rpc/join_room', {
      method: 'POST',
      token: guest.token,
      body: { p_code: roomCode },
    })
    ok('房客加入', `座位 ${data?.[0]?.seat}`)
  } catch (error) {
    fail('房客加入', String(error.message).slice(0, 200))
  }

  try {
    const { data } = await call(`/rest/v1/room_members?room_id=eq.${roomId}&left_at=is.null&select=user_id,seat,role,ready`, {
      token: host.token,
    })
    if (Array.isArray(data) && data.length === 2) ok('房主能看到 2 名成员')
    else fail('房主能看到 2 名成员', JSON.stringify(data).slice(0, 160))
  } catch (error) {
    fail('读取成员列表', String(error.message).slice(0, 160))
  }

  try {
    await call(`/rest/v1/room_members?room_id=eq.${roomId}`, { token: outsider.token })
    fail('房间隔离', '陌生人读到了成员列表')
  } catch {
    ok('房间隔离：陌生人读不到成员')
  }

  try {
    await call('/rest/v1/rpc/start_room_game', {
      method: 'POST',
      token: host.token,
      body: { p_room_id: roomId, p_game_type: 'undercover' },
    })
    fail('未准备不能开局', '全员未准备却开局成功')
  } catch (error) {
    ok('未准备时拒绝开局', `HTTP ${error.status}`)
  }

  for (const session of [host, guest]) {
    await call('/rest/v1/rpc/set_ready', { method: 'POST', token: session.token, body: { p_room_id: roomId, p_ready: true } })
  }

  try {
    await call('/rest/v1/rpc/start_room_game', {
      method: 'POST',
      token: guest.token,
      body: { p_room_id: roomId, p_game_type: 'undercover' },
    })
    fail('非房主不能开局', '房客开局成功')
  } catch (error) {
    ok('非房主不能开局', `HTTP ${error.status}`)
  }

  try {
    await call('/rest/v1/rpc/start_room_game', {
      method: 'POST',
      token: host.token,
      body: { p_room_id: roomId, p_game_type: 'undercover' },
    })
    const { data } = await call(`/rest/v1/rooms?id=eq.${roomId}&select=status,game_type`, { token: host.token })
    const room = data?.[0]
    if (room?.status === 'playing' && room?.game_type === 'undercover') ok('房主开局', JSON.stringify(room))
    else fail('房主开局', JSON.stringify(room))
  } catch (error) {
    fail('房主开局', String(error.message).slice(0, 200))
  }

  try {
    await call('/rest/v1/rpc/end_room_game', { method: 'POST', token: host.token, body: { p_room_id: roomId } })
    const { data } = await call(`/rest/v1/rooms?id=eq.${roomId}&select=status,game_type`, { token: host.token })
    const room = data?.[0]
    if (room?.status === 'lobby') ok('结束本局回到大厅', JSON.stringify(room))
    else fail('结束本局回到大厅', JSON.stringify(room))
  } catch (error) {
    fail('结束本局', String(error.message).slice(0, 200))
  }

  summary()
}

function summary() {
  console.log(`\n通过 ${passed} 项，失败 ${failed} 项`)
  process.exitCode = failed === 0 && passed > 0 ? 0 : 1
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
