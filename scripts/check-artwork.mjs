#!/usr/bin/env node
/**
 * 验收融合玩法的画作链路（不需要两台设备）：
 *   上传 PNG 到 artworks 私有桶 → submit_artwork 建档 → drawingSubmitted
 *   → 快照 artworks[] 能看到 → 签名地址可访问 → ai-score 调用不阻塞
 *
 * 需要项目开启匿名登录。
 * 用法： node scripts/check-artwork.mjs
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

// 1x1 透明 PNG
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)

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

async function call(path, { method = 'GET', token, body, raw, contentType } = {}) {
  const headers = { apikey: KEY, Authorization: `Bearer ${token ?? KEY}` }
  if (raw) headers['Content-Type'] = contentType ?? 'application/octet-stream'
  else headers['Content-Type'] = 'application/json'
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: raw ?? (body === undefined ? undefined : JSON.stringify(body)),
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

const anon = () => must('/auth/v1/signup', { method: 'POST', body: {} })
const rpc = (name, args, token) => must(`/rest/v1/rpc/${name}`, { method: 'POST', token, body: args })
const uc = (body, token) => call('/functions/v1/uc-command', { method: 'POST', token, body })

async function main() {
  if (!BASE || !KEY) {
    console.error('缺少 Supabase 配置')
    process.exit(2)
  }
  console.log(`项目：${BASE}\n`)

  console.log('[1] 4 人开局（融合玩法）')
  let tokens
  let roomId
  let gameId
  let turnKey
  let painterId
  let painterToken
  try {
    tokens = []
    for (let i = 0; i < 4; i++) tokens.push(await anon())
    const room = await rpc('create_room', { p_title: '画作验收房', p_game_type: 'lobby', p_max_players: 8, p_settings: {} }, tokens[0].access_token)
    roomId = room[0].room_id
    const code = room[0].room_code
    for (let i = 1; i < 4; i++) await rpc('join_room', { p_code: code }, tokens[i].access_token)
    for (const t of tokens) await rpc('set_ready', { p_room_id: roomId, p_ready: true }, t.access_token)

    const started = await uc({ op: 'start', room_id: roomId, variant: 'draw', request_id: 'art-start' }, tokens[0].access_token)
    if (!started.ok) throw new Error(`开局失败 ${started.status} ${started.text.slice(0, 160)}`)
    gameId = started.data.gameId
    ok('融合玩法开局', `gameId ${gameId.slice(0, 8)}…`)

    for (let i = 0; i < 4; i++) {
      const res = await uc({ op: 'act', game_id: gameId, action: { type: 'acknowledgeWord' }, meta: { requestId: `art-ack-${i}` } }, tokens[i].access_token)
      if (!res.ok) throw new Error(`确认词失败 ${res.status} ${res.text.slice(0, 160)}`)
      if (i === 3) {
        const view = res.data.view
        turnKey = view.turnKey
        painterId = view.currentSpeakerId
        painterToken = tokens.find((t) => t.user.id === painterId)?.access_token
        if (!painterToken) throw new Error('找不到当前画手的 token')
        ok('进入作画回合', `turnKey=${turnKey}`)
      }
    }
  } catch (e) {
    bad('准备对局', String(e.message).slice(0, 220))
    return summary()
  }

  console.log('\n[2] 上传画作到私有桶')
  const storagePath = `${roomId}/${gameId}/${turnKey}/${painterId}.png`
  try {
    const res = await call(`/storage/v1/object/artworks/${storagePath.split('/').map(encodeURIComponent).join('/')}`, {
      method: 'POST',
      token: painterToken,
      raw: PNG,
      contentType: 'image/png',
    })
    // 覆盖已存在的同名对象需要 upsert，第一次是 200/201，重复时 400 属正常
    if (res.ok || /already exists|Duplicate/i.test(res.text)) ok('上传成功', storagePath)
    else bad('上传画作', `${res.status} ${res.text.slice(0, 160)}`)
  } catch (e) {
    bad('上传画作', String(e.message).slice(0, 200))
  }

  console.log('\n[3] 建档 + 提交')
  let artworkId = ''
  try {
    artworkId = await rpc('submit_artwork', { p_game_id: gameId, p_turn_key: turnKey, p_storage_path: storagePath }, painterToken)
    if (artworkId) ok('submit_artwork 建档', String(artworkId).slice(0, 8) + '…')
    else bad('submit_artwork', '没有返回 id')

    const res = await uc(
      {
        op: 'act',
        game_id: gameId,
        action: { type: 'drawingSubmitted', turnKey, drawingRef: storagePath },
        meta: { requestId: 'art-submit' },
      },
      painterToken,
    )
    if (res.ok) ok('提交等一帧 drawingSubmitted', `phase=${res.data.view.phase}`)
    else bad('提交画作', `${res.status} ${res.text.slice(0, 160)}`)
  } catch (e) {
    bad('建档/提交', String(e.message).slice(0, 200))
  }

  console.log('\n[4] 快照里能看到画作')
  try {
    const res = await uc({ op: 'tick', game_id: gameId }, tokens[0].access_token)
    if (!res.ok) throw new Error(`${res.status} ${res.text.slice(0, 160)}`)
    const artworks = res.data.artworks ?? []
    const mine = artworks.find((a) => a.id === artworkId)
    if (mine && mine.preview === storagePath) ok('artworks[] 含这幅画', `status=${mine.status}`)
    else bad('artworks[]', JSON.stringify(artworks).slice(0, 200))
  } catch (e) {
    bad('读取快照', String(e.message).slice(0, 200))
  }

  console.log('\n[5] 签名地址可访问')
  try {
    const encoded = storagePath.split('/').map(encodeURIComponent).join('/')
    const signed = await must(`/storage/v1/object/sign/artworks/${encoded}`, {
      method: 'POST',
      token: painterToken,
      body: { expiresIn: 60 },
    })
    if (signed?.signedURL) {
      const res = await fetch(`${BASE}/storage/v1${signed.signedURL}`)
      if (res.ok) ok('签名地址能取到图片', `HTTP ${res.status}`)
      else bad('签名地址访问', `HTTP ${res.status}`)
    } else {
      bad('签名地址', JSON.stringify(signed).slice(0, 160))
    }
  } catch (e) {
    bad('签名地址', String(e.message).slice(0, 200))
  }

  console.log('\n[6] AI 评分不阻塞（当前未配 key 应降级）')
  try {
    const res = await call('/functions/v1/ai-score', { method: 'POST', token: painterToken, body: { artwork_id: artworkId } })
    const status = res.data?.status ?? (res.data?.error ? `error:${res.data.error}` : 'unknown')
    if (res.ok) ok('ai-score 有明确返回', `status=${status}`)
    else bad('ai-score', `${res.status} ${res.text.slice(0, 160)}`)
  } catch (e) {
    bad('ai-score', String(e.message).slice(0, 200))
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
