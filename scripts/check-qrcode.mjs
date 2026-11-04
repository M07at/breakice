#!/usr/bin/env node
/**
 * 验收微信小程序码：
 *   建房 → 调 wechat-qrcode → 拿到 base64 图片（或明确错误）→ 非成员被拒。
 *
 * 需要项目开启匿名登录，且已部署 wechat-qrcode 函数、配好 WECHAT_APPID / WECHAT_SECRET。
 * 用法： node scripts/check-qrcode.mjs
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
  const outsider = await anon()

  console.log('[1] 建房')
  let roomCode
  try {
    const room = await rpc('create_room', { p_title: '小程序码验收', p_game_type: 'lobby', p_max_players: 8, p_settings: {} }, host.access_token)
    if (!room.ok) throw new Error(`${room.status} ${room.text.slice(0, 160)}`)
    roomCode = room.data[0].room_code
    ok('房间就绪', `房间号 ${roomCode}`)
  } catch (e) {
    bad('建房', String(e.message).slice(0, 200))
    return summary()
  }

  console.log('\n[2] 生成小程序码')
  for (const target of ['trial', 'release']) {
    const res = await call('/functions/v1/wechat-qrcode', {
      method: 'POST',
      token: host.access_token,
      body: { room_code: roomCode, env: target },
    })
    if (res.ok && typeof res.data?.image === 'string' && res.data.image.startsWith('data:image/')) {
      const bytes = Math.round((res.data.image.length * 3) / 4)
      ok(`env=${target} 生成成功`, `约 ${Math.round(bytes / 1024)} KB 图片`)
      break
    }
    const detail = res.data?.detail ?? res.text ?? ''
    console.log(`    env=${target} 不可用：${res.status} ${String(detail).slice(0, 200)}`)
    if (target === 'release') bad('两种 env 都失败', String(detail).slice(0, 200))
  }

  console.log('\n[3] 非成员被拒')
  try {
    const res = await call('/functions/v1/wechat-qrcode', {
      method: 'POST',
      token: outsider.access_token,
      body: { room_code: roomCode, env: 'trial' },
    })
    if (!res.ok && /NOT_A_MEMBER|403/i.test(`${res.status} ${res.text}`)) ok('非成员不能生成', `HTTP ${res.status}`)
    else bad('非成员生成', `${res.status} ${res.text.slice(0, 140)}`)
  } catch (e) {
    bad('非成员生成', String(e.message).slice(0, 200))
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
