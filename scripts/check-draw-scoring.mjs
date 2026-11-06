#!/usr/bin/env node
// Live integration: two temporary users, a private image, a real model call and cached receipt.
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const env = Object.fromEntries(readFileSync(resolve(root, 'app/.env.local'), 'utf8').split(/\r?\n/)
  .map(line => line.match(/^([A-Z0-9_]+)=(.*)$/)).filter(Boolean)
  .map(match => [match[1], match[2].replace(/^["']|["']$/g, '')]))
const base = env.VITE_SUPABASE_URL
const key = env.VITE_SUPABASE_ANON_KEY
const image = readFileSync(resolve(root, process.argv[2] || 'app/reports/scoring-apple.png'))
const report = { at: new Date().toISOString(), users: [], rooms: [], checks: [] }
let host, roomId
async function call(path, token, body, method = 'POST', binary = false) {
  const res = await fetch(`${base}${path}`, {
    method, headers: { apikey: key, Authorization: `Bearer ${token || key}`, 'Content-Type': binary ? 'image/png' : 'application/json' },
    body: body === undefined ? undefined : binary ? body : JSON.stringify(body), signal: AbortSignal.timeout(65000),
  })
  return { status: res.status, data: await res.json().catch(() => null) }
}
async function must(path, token, body, method, binary) {
  const result = await call(path, token, body, method, binary)
  assert(result.status >= 200 && result.status < 300, `${path} HTTP ${result.status}: ${JSON.stringify(result.data)}`)
  return result.data
}
const rpc = (name, token, args) => must(`/rest/v1/rpc/${name}`, token, args)
function pass(text) { report.checks.push(text); console.log(`✓ ${text}`) }
try {
  host = await must('/auth/v1/signup', null, {})
  const guest = await must('/auth/v1/signup', null, {})
  report.users.push(host.user.id, guest.user.id)
  const [room] = await rpc('create_room', host.access_token, { p_title: 'AI评分自动验收', p_game_type: 'lobby', p_max_players: 4, p_settings: {} })
  roomId = room.room_id
  report.rooms.push(roomId)
  await rpc('join_room', guest.access_token, { p_code: room.room_code })
  const gameKey = `check-draw-${Date.now()}`
  const view = { gameId: gameKey, phase: 'drawing', variant: 'custom', roundIndex: 0, roundKey: 'r1', painterId: host.user.id, startedAt: Date.now() - 10000, endsAt: Date.now() + 20000, players: [{ id: host.user.id }, { id: guest.user.id }], word: null, palette: [] }
  await rpc('publish_draw_view', host.access_token, { p_room_id: roomId, p_view: view })
  await rpc('publish_draw_word', host.access_token, { p_room_id: roomId, p_round_key: 'r1', p_user_id: host.user.id, p_word: '苹果' })
  const ref = `${roomId}/draw/r1/${host.user.id}-${Date.now()}.png`
  await must(`/storage/v1/object/artworks/${ref}`, host.access_token, image, 'POST', true)
  const body = { room_id: roomId, round_key: 'r1', image_ref: ref }
  const outsider = await call('/functions/v1/draw-score', guest.access_token, body)
  assert.equal(outsider.status, 403)
  pass('Non-host scoring denied')
  const wrongPath = await call('/functions/v1/draw-score', host.access_token, { ...body, image_ref: ref.replace(roomId, 'other-room') })
  assert.equal(wrongPath.status, 400)
  pass('Cross-room image reference denied')
  const scored = await must('/functions/v1/draw-score', host.access_token, body)
  assert.equal(scored.status, 'success', JSON.stringify(scored))
  assert.equal(scored.provider, 'drawzy')
  assert(Number.isFinite(scored.score) && scored.score >= 0 && scored.score <= 100)
  assert.equal(typeof scored.guess, 'string')
  pass(`Real model result received: ${scored.score}/100; guess=${scored.guess}`)
  report.result = scored
  const cached = await must('/functions/v1/draw-score', host.access_token, body)
  assert.deepEqual(cached, scored)
  pass('Repeated scoring returns the same saved receipt')
  await rpc('publish_draw_view', host.access_token, { p_room_id: roomId, p_view: { ...view, roundKey: 'r2', roundIndex: 1 } })
  await rpc('publish_draw_word', host.access_token, { p_room_id: roomId, p_round_key: 'r2', p_user_id: host.user.id, p_word: '量子力学' })
  const unsupported = await must('/functions/v1/draw-score', host.access_token, { ...body, round_key: 'r2', image_ref: ref.replace('/r1/', '/r2/') })
  assert.equal(unsupported.status, 'unsupported')
  pass('Unsupported custom prompts explicitly skip AI points')
} catch (error) {
  report.error = error.message
  console.error(error.message)
  process.exitCode = 1
} finally {
  if (roomId) {
    try { await rpc('close_room', host.access_token, { p_room_id: roomId }); report.closed = true }
    catch (error) { console.error(`Cleanup failed: ${error.message}`); process.exitCode = 1 }
  }
  mkdirSync(resolve(root, 'app/reports'), { recursive: true })
  writeFileSync(resolve(root, `app/reports/draw-scoring-live-${Date.now()}.json`), `${JSON.stringify(report, null, 2)}\n`)
}
