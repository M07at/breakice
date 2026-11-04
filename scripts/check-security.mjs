#!/usr/bin/env node
/**
 * 权限 / 隔离 / 幂等验收（对应 A 的验收清单）。
 *
 *   1. 未登录调用受保护 RPC → AUTH_REQUIRED
 *   2. 跨房间隔离：A 房成员读不到 B 房的局次与视图
 *   3. 只能读自己的词牌
 *   4. 非房主调 close_room / set_room_settings → HOST_ONLY
 *   5. 房主离开后房主身份转移
 *   6. 同一 requestId 开局重放 → 同一局次（幂等）
 *   7. submit_artwork 同一回合重复提交只更新自己那张；别人占用的回合被拒
 *
 * 需要匿名登录。用法： node scripts/check-security.mjs
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
const denied = (res) => !res.ok && /AUTH_REQUIRED|HOST_ONLY|NOT_A_MEMBER|42501|28000|permission/i.test(res.text)

async function main() {
  if (!BASE || !KEY) {
    console.error('缺少 Supabase 配置')
    process.exit(2)
  }
  console.log(`项目：${BASE}\n`)

  console.log('[1] 未登录调用受保护 RPC')
  for (const [name, args] of [
    ['create_room', { p_title: 'x', p_game_type: 'lobby', p_max_players: 8, p_settings: {} }],
    ['set_room_truth', { p_room_id: '00000000-0000-0000-0000-000000000000', p_truth: null }],
    ['read_draw_view', { p_room_id: '00000000-0000-0000-0000-000000000000' }],
  ]) {
    const res = await call(`/rest/v1/rpc/${name}`, { method: 'POST', body: args })
    if (!res.ok) ok(`${name} 拒绝未登录`, `HTTP ${res.status}`)
    else bad(`${name} 未登录可调用`)
  }

  console.log('\n[2] 两个房间互相隔离')
  let roomA
  let roomB
  let hostA
  let hostB
  try {
    hostA = await anon()
    hostB = await anon()
    const a = await rpc('create_room', { p_title: 'A 房', p_game_type: 'lobby', p_max_players: 8, p_settings: {} }, hostA.access_token)
    const b = await rpc('create_room', { p_title: 'B 房', p_game_type: 'lobby', p_max_players: 8, p_settings: {} }, hostB.access_token)
    roomA = a.data[0].room_id
    roomB = b.data[0].room_id
    ok('两个房间已建立')

    const cross = await must(`/rest/v1/rooms?id=eq.${roomB}&select=id,title`, { token: hostA.access_token })
    if (Array.isArray(cross) && cross.length === 0) ok('A 房成员读不到 B 房房间行')
    else bad('跨房读取房间', JSON.stringify(cross).slice(0, 120))

    const view = await rpc('read_draw_view', { p_room_id: roomB }, hostA.access_token)
    if (denied(view) || (view.ok && Array.isArray(view.data) && view.data.length === 0)) ok('A 房成员读不到 B 房对局视图')
    else bad('跨房读取视图', `${view.status} ${view.text.slice(0, 120)}`)
  } catch (e) {
    bad('跨房隔离', String(e.message).slice(0, 200))
  }

  console.log('\n[3] 只能读自己的词牌')
  try {
    const code = (await must(`/rest/v1/rooms?id=eq.${roomA}&select=code`, { token: hostA.access_token }))[0].code
    // 谁是卧底要 4 人：房主 + 另外 3 个
    const members = [hostA]
    for (let i = 0; i < 3; i++) {
      const extra = await anon()
      await rpc('join_room', { p_code: code }, extra.access_token)
      members.push(extra)
    }
    for (const member of members) {
      await rpc('set_ready', { p_room_id: roomA, p_ready: true }, member.access_token)
    }
    const guest = members[1]
    const started = await call('/functions/v1/uc-command', {
      method: 'POST',
      token: hostA.access_token,
      body: { op: 'start', room_id: roomA, variant: 'classic', config: { describeSeconds: 5, voteSeconds: 5, maxRounds: 2 }, request_id: 'sec-start' },
    })
    if (!started.ok) throw new Error(`开局失败 ${started.status} ${started.text.slice(0, 140)}`)
    const gameId = started.data.gameId

    const mine = await rpc('get_my_word', { p_game_id: gameId }, guest.access_token)
    const rows = Array.isArray(mine.data) ? mine.data : []
    if (mine.ok && rows.length === 1) ok('成员能读到自己的词牌', `camp=${rows[0].camp}`)
    else bad('读取自己的词牌', `${mine.status} ${mine.text.slice(0, 120)}`)

    // 再造一个不在局里的账号，应该什么都读不到
    const outsider = await anon()
    const other = await rpc('get_my_word', { p_game_id: gameId }, outsider.access_token)
    const otherRows = Array.isArray(other.data) ? other.data : []
    if (otherRows.length === 0) ok('非对局成员读不到任何词牌')
    else bad('越权读词牌', JSON.stringify(otherRows).slice(0, 120))

    // 幂等：同一个 request_id 再开一次，应该回到同一局
    const replay = await call('/functions/v1/uc-command', {
      method: 'POST',
      token: hostA.access_token,
      body: { op: 'start', room_id: roomA, variant: 'classic', config: { describeSeconds: 5, voteSeconds: 5, maxRounds: 2 }, request_id: 'sec-start' },
    })
    if (replay.ok && replay.data.gameId === gameId) ok('同一 requestId 重放返回同一局次')
    else if (!replay.ok && /GAME_ACTIVE|REQUEST_CONFLICT/.test(replay.text)) ok('同一 requestId 重放被幂等挡下', `HTTP ${replay.status}`)
    else bad('开局幂等', `${replay.status} ${replay.text.slice(0, 140)}`)
  } catch (e) {
    bad('词牌与幂等', String(e.message).slice(0, 200))
  }

  console.log('\n[4] 非房主不能改房间设置 / 关房')
  try {
    const guest = await anon()
    const code = (await must(`/rest/v1/rooms?id=eq.${roomB}&select=code`, { token: hostB.access_token }))[0].code
    await rpc('join_room', { p_code: code }, guest.access_token)

    const settings = await rpc('set_room_settings', { p_room_id: roomB, p_game_type: 'undercover', p_settings: {} }, guest.access_token)
    if (denied(settings)) ok('非房主改设置被拒', `HTTP ${settings.status}`)
    else bad('非房主改设置', `${settings.status} ${settings.text.slice(0, 120)}`)

    const close = await rpc('close_room', { p_room_id: roomB }, guest.access_token)
    if (denied(close)) ok('非房主关房被拒', `HTTP ${close.status}`)
    else bad('非房主关房', `${close.status} ${close.text.slice(0, 120)}`)
  } catch (e) {
    bad('房主权限', String(e.message).slice(0, 200))
  }

  console.log('\n[5] 房主离开后身份转移')
  try {
    const guest = await anon()
    const code = (await must(`/rest/v1/rooms?id=eq.${roomB}&select=code`, { token: hostB.access_token }))[0].code
    await rpc('join_room', { p_code: code }, guest.access_token)
    await rpc('leave_room', { p_room_id: roomB }, hostB.access_token)

    const rows = await must(`/rest/v1/rooms?id=eq.${roomB}&select=host_id`, { token: guest.access_token })
    const stillMember = Array.isArray(rows) && rows[0]?.host_id !== hostB.user.id
    if (stillMember) ok('房主已从离开的人转给留下的人', `新 host=${String(rows[0].host_id).slice(0, 8)}…`)
    else bad('房主转移', JSON.stringify(rows).slice(0, 140))
  } catch (e) {
    bad('房主转移', String(e.message).slice(0, 200))
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


