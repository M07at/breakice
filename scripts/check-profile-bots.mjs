#!/usr/bin/env node
/** Live acceptance: creates two anonymous test accounts and closes its test rooms.
 * Account/room IDs (never tokens) are saved in ignored app/reports for cleanup.
 */
import assert from 'node:assert/strict'
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const fileEnv = Object.fromEntries(readFileSync(resolve(root, 'app/.env.local'), 'utf8')
  .split(/\r?\n/).map(line => line.match(/^([A-Z0-9_]+)=(.*)$/))
  .filter(Boolean).map(match => [match[1], match[2].replace(/^["']|["']$/g, '')]))
const base = (process.env.VITE_SUPABASE_URL || fileEnv.VITE_SUPABASE_URL || '').replace(/\/+$/, '')
const key = process.env.VITE_SUPABASE_ANON_KEY || fileEnv.VITE_SUPABASE_ANON_KEY
assert(base && key, 'Supabase public configuration is required')
const report = { at: new Date().toISOString(), users: [], rooms: [], checks: [], closedRooms: [] }
const sessions = []
const rooms = []

async function call(path, token, body, method = 'POST') {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { apikey: key, Authorization: `Bearer ${token || key}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(20000),
  })
  return { status: response.status, data: await response.json().catch(() => null) }
}
async function must(path, token, body, method) {
  const result = await call(path, token, body, method)
  assert(result.status >= 200 && result.status < 300, `${path}: HTTP ${result.status} ${JSON.stringify(result.data)}`)
  return result.data
}
const rpc = (name, token, body) => must(`/rest/v1/rpc/${name}`, token, body)
const uc = (token, body) => must('/functions/v1/uc-command', token, body)
function passed(message) {
  report.checks.push(message)
  console.log(`✓ ${message}`)
}

try {
  for (let i = 0; i < 2; i++) {
    const session = await must('/auth/v1/signup', null, {})
    assert(session.access_token && session.user?.id, 'Anonymous test session is unavailable')
    sessions.push(session)
    report.users.push(session.user.id)
  }
  const [host, guest] = sessions
  const version = await uc(host.access_token, { op: 'version' })
  assert.equal(version.version, 'uc-2026-11-06-bots5-mbti')
  passed(`Live function version: ${version.version}`)

  const profile = async (session) => (await must(
    `/rest/v1/profiles?id=eq.${session.user.id}&select=nickname,mbti`, session.access_token, undefined, 'GET'))[0]
  for (const [session, nickname, mbti] of [[host, 'P1验收房主', ' enfp '], [guest, 'P1验收访客', 'INTJ']]) {
    await rpc('set_my_profile_v2', session.access_token, { p_nickname: nickname, p_mbti: mbti })
    assert.equal((await profile(session)).mbti, mbti.trim().toUpperCase())
  }
  passed('Name and normalized MBTI persist for both authenticated profiles')
  const invalid = await call('/rest/v1/rpc/set_my_profile_v2', host.access_token, { p_mbti: 'INVALID' })
  assert(invalid.status >= 400 && /BAD_MBTI/.test(JSON.stringify(invalid.data)))
  assert.equal((await profile(host)).mbti, 'ENFP')
  const anonymous = await call('/rest/v1/rpc/set_my_profile_v2', null, { p_mbti: 'ENFP' })
  assert([401, 403].includes(anonymous.status))
  await rpc('set_my_profile_v2', host.access_token, { p_mbti: null })
  assert.equal((await profile(host)).mbti, null)
  await rpc('set_my_profile_v2', host.access_token, { p_mbti: 'ENFP' })
  passed('Invalid MBTI and unauthenticated writes rejected; clearing MBTI works')

  for (const requested of [5, 99, undefined]) {
    const [room] = await rpc('create_room', host.access_token, {
      p_title: 'P1自动验收', p_game_type: 'lobby', p_max_players: 8, p_settings: {},
    })
    rooms.push(room.room_id)
    report.rooms.push(room.room_id)
    const outsider = await rpc('room_leaderboard_v2', guest.access_token, { p_room_id: room.room_id })
    assert.deepEqual(outsider, [])
    await rpc('set_ready', host.access_token, { p_room_id: room.room_id, p_ready: true })
    const start = { op: 'start', room_id: room.room_id, variant: 'classic', request_id: crypto.randomUUID() }
    if (requested !== undefined) start.bots = requested
    const snapshot = await uc(host.access_token, start)
    assert.equal(snapshot.players.length, requested === undefined ? 4 : 6)
    assert.equal(snapshot.view.phase, 'word')
    assert.equal(snapshot.players.find(p => p.id === host.user.id)?.mbti, 'ENFP')
    assert.equal(snapshot.players.find(p => p.id === host.user.id)?.name, 'P1验收房主')
    passed(`bots=${requested ?? 'default'}: ${snapshot.players.length - 1} bots, host MBTI retained, waits for human`)
    const denied = await call('/functions/v1/uc-command', guest.access_token, start)
    assert.equal(denied.status, 403)
  }
  const [lobby] = await rpc('create_room', host.access_token, {
    p_title: 'P1资料同步验收', p_game_type: 'lobby', p_max_players: 8, p_settings: {},
  })
  rooms.push(lobby.room_id)
  report.rooms.push(lobby.room_id)
  await rpc('join_room', guest.access_token, { p_code: lobby.room_code })
  const roster = await must(`/rest/v1/room_members?room_id=eq.${lobby.room_id}&left_at=is.null&select=user_id,profiles(nickname,mbti)`, guest.access_token, undefined, 'GET')
  assert.equal(roster.find(p => p.user_id === host.user.id)?.profiles?.mbti, 'ENFP')
  assert.equal(roster.find(p => p.user_id === guest.user.id)?.profiles?.mbti, 'INTJ')
  await rpc('room_leaderboard_v2', guest.access_token, { p_room_id: lobby.room_id })
  passed('Non-host start rejected; joined player reads both MBTI profiles and v2 leaderboard')
} catch (error) {
  report.error = error.message
  console.error(error.message)
  process.exitCode = 1
} finally {
  for (const roomId of rooms) {
    try {
      await rpc('close_room', sessions[0].access_token, { p_room_id: roomId })
      report.closedRooms.push(roomId)
    } catch (error) {
      console.error(`Test room cleanup failed: ${error.message}`)
      process.exitCode = 1
    }
  }
  mkdirSync(resolve(root, 'app/reports'), { recursive: true })
  writeFileSync(resolve(root, `app/reports/profile-bots-live-${Date.now()}.json`), `${JSON.stringify(report, null, 2)}\n`)
}
