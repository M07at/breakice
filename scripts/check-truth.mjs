#!/usr/bin/env node
/**
 * 验收真心话大冒险的共享回合：
 *   A 写 rooms.settings.truth → 同房 B 读到同一份 → 非成员 C 写入被拒。
 *
 * 需要项目开启匿名登录。
 * 用法： node scripts/check-truth.mjs
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

const fileEnv = readEnvFile()
const BASE = (process.env.VITE_SUPABASE_URL || fileEnv.VITE_SUPABASE_URL || '').replace(/\/+$/, '')
const KEY = process.env.VITE_SUPABASE_ANON_KEY || fileEnv.VITE_SUPABASE_ANON_KEY || ''

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

  const a = await anon()
  const b = await anon()
  const c = await anon()

  console.log('[1] 两人房间')
  let roomId
  try {
    const room = await rpc('create_room', { p_title: '真心话验收房', p_game_type: 'lobby', p_max_players: 8, p_settings: {} }, a.access_token)
    if (!room.ok) throw new Error(`建房失败 ${room.status} ${room.text.slice(0, 160)}`)
    roomId = room.data[0].room_id
    const joined = await rpc('join_room', { p_code: room.data[0].room_code }, b.access_token)
    if (!joined.ok) throw new Error(`加入失败 ${joined.status} ${joined.text.slice(0, 160)}`)
    ok('建房 + 第二人加入')
  } catch (e) {
    bad('准备房间', String(e.message).slice(0, 200))
    return summary()
  }

  const turn = {
    round: 2,
    targetId: b.user.id,
    promptId: 'truth-001',
    type: 'truth',
    text: '说一件你最近撒过的谎',
    at: Date.now(),
    by: a.user.id,
  }

  console.log('\n[2] A 写共享状态')
  try {
    const res = await rpc('set_room_truth', { p_room_id: roomId, p_truth: turn }, a.access_token)
    if (res.ok) ok('主持人写入成功')
    else bad('写入共享状态', `${res.status} ${res.text.slice(0, 160)}`)
  } catch (e) {
    bad('写入共享状态', String(e.message).slice(0, 200))
  }

  console.log('\n[3] B 读到同一份')
  try {
    const rows = await must(`/rest/v1/rooms?id=eq.${roomId}&select=settings`, { token: b.access_token })
    const truth = rows?.[0]?.settings?.truth
    if (truth?.targetId === b.user.id && truth?.text === turn.text) ok('同房成员读到同一个人和同一道题', `round=${truth.round}`)
    else bad('读取共享状态', JSON.stringify(truth ?? null).slice(0, 160))
  } catch (e) {
    bad('读取共享状态', String(e.message).slice(0, 200))
  }

  console.log('\n[4] B 换题也同步')
  try {
    const next = { ...turn, round: 3, promptId: 'truth-002', text: '你最后悔的一次冲动消费' }
    const res = await rpc('set_room_truth', { p_room_id: roomId, p_truth: next }, b.access_token)
    if (!res.ok) throw new Error(`${res.status} ${res.text.slice(0, 160)}`)
    const rows = await must(`/rest/v1/rooms?id=eq.${roomId}&select=settings`, { token: a.access_token })
    const truth = rows?.[0]?.settings?.truth
    if (truth?.promptId === 'truth-002' && truth?.round === 3) ok('轮换主持人/换题后双方一致')
    else bad('换题同步', JSON.stringify(truth).slice(0, 160))
  } catch (e) {
    bad('换题同步', String(e.message).slice(0, 200))
  }

  console.log('\n[5] 非成员写入被拒')
  try {
    const res = await rpc('set_room_truth', { p_room_id: roomId, p_truth: turn }, c.access_token)
    if (!res.ok && /NOT_A_MEMBER|42501|permission/i.test(res.text)) ok('非成员被拒', `HTTP ${res.status}`)
    else bad('非成员写入', `${res.status} ${res.text.slice(0, 160)}`)
  } catch (e) {
    bad('非成员写入', String(e.message).slice(0, 200))
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

