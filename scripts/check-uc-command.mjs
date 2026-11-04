#!/usr/bin/env node
/**
 * 验收 uc-command（服务端谁是卧底引擎）。
 *
 * 会真的在项目里建一个房间、拉 4 个匿名账号、开始一局、领词、确认、推进到投票。
 * 需要项目开启匿名登录（Authentication → Anonymous）。
 *
 * 用法： node scripts/check-uc-command.mjs
 * 配置： VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY，或 app/.env.local
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

async function mustCall(path, options) {
  const res = await call(path, options)
  if (!res.ok) throw new Error(`${path} -> ${res.status} ${res.text.slice(0, 200)}`)
  return res.data
}

const anonSession = async () => (await mustCall('/auth/v1/signup', { method: 'POST', body: {} })).access_token
const rpc = (name, args, token) => mustCall(`/rest/v1/rpc/${name}`, { method: 'POST', token, body: args })

async function uc(body, token) {
  const res = await call('/functions/v1/uc-command', { method: 'POST', token, body })
  return res
}

async function main() {
  if (!BASE || !KEY) {
    console.error('缺少 Supabase 配置')
    process.exit(2)
  }
  console.log(`项目：${BASE}\n`)

  console.log('[1] 准备 4 个账号与房间')
  const tokens = []
  try {
    for (let i = 0; i < 4; i++) tokens.push(await anonSession())
    ok('4 个匿名账号')
  } catch (e) {
    bad('匿名登录', String(e.message).slice(0, 160))
    return summary()
  }

  const host = tokens[0]
  let roomId
  try {
    const rows = await rpc('create_room', { p_title: '引擎验收房', p_game_type: 'lobby', p_max_players: 8, p_settings: {} }, host)
    roomId = rows[0].room_id
    const code = rows[0].room_code
    for (let i = 1; i < 4; i++) await rpc('join_room', { p_code: code }, tokens[i])
    for (const t of tokens) await rpc('set_ready', { p_room_id: roomId, p_ready: true }, t)
    ok('建房 + 3 人加入 + 全员准备', `房间号 ${code}`)
  } catch (e) {
    bad('准备房间', String(e.message).slice(0, 200))
    return summary()
  }

  console.log('\n[2] 开局')
  let gameId
  // 投票阶段要留够时间：脚本是串行发请求的，2 秒会在投完之前超时
  const tinyConfig = { describeSeconds: 2, voteSeconds: 25, revealSeconds: 2, maxRounds: 3 }
  try {
    const res = await uc({ op: 'start', room_id: roomId, variant: 'classic', request_id: 'check-start', config: tinyConfig }, host)
    if (!res.ok) throw new Error(`${res.status} ${res.text.slice(0, 200)}`)
    const snap = res.data
    gameId = snap.gameId
    if (snap.view?.phase === 'word' && snap.players?.length === 4) ok('主持人开局', `gameId ${gameId.slice(0, 8)}… phase=word 玩家=4`)
    else bad('主持人开局', JSON.stringify(snap).slice(0, 200))
    if (snap.playerId && snap.hostId === snap.playerId) ok('快照里的身份是房主自己')
    else bad('快照里的身份')
  } catch (e) {
    bad('主持人开局', String(e.message).slice(0, 200))
    return summary()
  }

  console.log('\n[3] 权限与幂等')
  try {
    const again = await uc({ op: 'start', room_id: roomId, variant: 'classic', request_id: 'check-start-2', config: tinyConfig }, tokens[1])
    if (again.status === 403) ok('非房主开局被拒（403）')
    else bad('非房主开局被拒', `HTTP ${again.status} ${again.text.slice(0, 120)}`)
  } catch (e) {
    bad('非房主开局', String(e.message).slice(0, 160))
  }

  console.log('\n[4] 领词')
  const words = []
  for (let i = 0; i < tokens.length; i++) {
    const res = await uc({ op: 'word', game_id: gameId }, tokens[i])
    if (res.ok && typeof res.data?.word !== 'undefined') {
      words.push(res.data.word)
    } else {
      bad(`玩家 ${i + 1} 领词`, `${res.status} ${res.text.slice(0, 120)}`)
    }
  }
  if (words.length === 4) {
    const distinct = new Set(words)
    ok('4 名玩家都拿到词', distinct.size === 2 ? '两组词（平民/卧底）' : `词种=${distinct.size}`)
  }

  console.log('\n[5] 确认词 + 推进')
  try {
    for (let i = 0; i < tokens.length; i++) {
      const res = await uc({ op: 'act', game_id: gameId, action: { type: 'acknowledgeWord' }, meta: { requestId: `ack-${i}` } }, tokens[i])
      if (!res.ok) throw new Error(`ack ${i} -> ${res.status} ${res.text.slice(0, 160)}`)
      if (i === tokens.length - 1) {
        ok('所有人确认词', `phase=${res.data.view.phase}`)
      }
    }
  } catch (e) {
    bad('确认词', String(e.message).slice(0, 200))
  }

  console.log('\n[6] 倒计时推进（tick）')
  try {
    await new Promise((r) => setTimeout(r, 2600))
    const res = await uc({ op: 'tick', game_id: gameId }, host)
    if (res.ok) ok('tick 返回快照', `phase=${res.data.view.phase} version=${res.data.view.version}`)
    else bad('tick', `${res.status} ${res.text.slice(0, 160)}`)
  } catch (e) {
    bad('tick', String(e.message).slice(0, 160))
  }

  console.log('\n[7] 当前局查询')
  try {
    const res = await uc({ op: 'current', room_id: roomId }, tokens[2])
    console.log(`    current 顶层字段: ${Object.keys(res.data ?? {}).join(', ')}`)
    // 服务端可能返回 { snapshot } 也可能直接返回快照
    const snap = res.data?.snapshot ?? res.data
    if (res.ok && snap?.gameId === gameId) ok('房内成员能找到进行中的一局')
    else bad('current', `${res.status} ${res.text.slice(0, 160)}`)
  } catch (e) {
    bad('current', String(e.message).slice(0, 160))
  }

  console.log('\n[8] 推进到投票并投出一轮')
  try {
    let phase = ''
    let snapshot = null
    for (let i = 0; i < 14; i++) {
      await new Promise((r) => setTimeout(r, 1200))
      const res = await uc({ op: 'tick', game_id: gameId }, host)
      if (!res.ok) break
      snapshot = res.data
      phase = snapshot.view.phase
      if (phase === 'vote' || phase === 'ended') break
    }
    if (phase === 'vote') ok('倒计时把局面推进到投票阶段')
    else bad('推进到投票', `停在 ${phase || '未知'}`)

    if (phase === 'vote') {
      const alive = snapshot.view.players.filter((p) => p.alive)
      const target = alive[0]?.id
      let voted = 0
      for (let i = 0; i < tokens.length; i++) {
        const me = alive[i]
        if (!me) continue
        const to = alive.find((p) => p.id !== me.id)?.id
        const res = await uc(
          { op: 'act', game_id: gameId, action: { type: 'vote', targetId: to ?? target }, meta: { requestId: `vote-${i}` } },
          tokens[i],
        )
        if (res.ok) voted++
        else console.log(`    投票失败(${i}): ${res.status} ${res.text.slice(0, 140)}`)
      }
      if (voted >= alive.length) ok(`所有在局玩家都投出（${voted} 票）`)
      else bad('投票', `只成功 ${voted}/${alive.length}`)

      await new Promise((r) => setTimeout(r, 1500))
      const after = await uc({ op: 'tick', game_id: gameId }, host)
      if (after.ok && ['reveal', 'ended', 'vote'].includes(after.data.view.phase)) {
        ok('投票后局面继续推进', `phase=${after.data.view.phase}`)
      } else {
        bad('投票后推进', `${after.status} ${after.text.slice(0, 120)}`)
      }
    }
  } catch (e) {
    bad('投票流程', String(e.message).slice(0, 200))
  }

  console.log('\n[9] 积分落库')
  try {
    // 先看 scores 表里到底有没有行，区分「没写进去」和「聚合查不出来」
    const raw = await mustCall(`/rest/v1/scores?game_id=eq.${gameId}&select=user_id,reason,points,ref`, { token: host })
    console.log(`    scores 表里这局有 ${Array.isArray(raw) ? raw.length : '?'} 条记录`)
    if (Array.isArray(raw) && raw.length > 0) {
      console.log(`    样例: ${JSON.stringify(raw.slice(0, 3))}`)
    }
    const board = await rpc('room_leaderboard', { p_room_id: roomId }, host)
    if (Array.isArray(board) && board.length > 0 && board.some((row) => Number(row.points) > 0)) {
      ok('积分榜有数据', board.map((row) => `${row.nickname}:${row.points}`).join('  '))
    } else {
      bad('积分榜有数据', JSON.stringify(board).slice(0, 200))
    }
  } catch (e) {
    bad('room_leaderboard', String(e.message).slice(0, 200))
  }

  console.log('\n[10] 收尾')
  try {
    // 投票可能直接把胜负打出来（phase=ended），这时不需要再结束一次
    const probe = await uc({ op: 'tick', game_id: gameId }, host)
    const alreadyEnded = probe.ok && probe.data.view.phase === 'ended'
    if (alreadyEnded) {
      ok('投票后已自动结算，无需主持人结束')
    } else {
      const res = await uc({ op: 'act', game_id: gameId, action: { type: 'endGame' }, meta: { requestId: 'check-end' } }, host)
      if (res.ok) ok('主持人结束本局', `phase=${res.data.view.phase}`)
      else bad('结束本局', `${res.status} ${res.text.slice(0, 160)}`)
    }
    const rooms = await mustCall(`/rest/v1/rooms?id=eq.${roomId}&select=status`, { token: host })
    if (rooms[0]?.status === 'lobby') ok('房间回到大厅')
    else bad('房间回到大厅', JSON.stringify(rooms))
  } catch (e) {
    bad('收尾', String(e.message).slice(0, 200))
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




