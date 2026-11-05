import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
const env = Object.fromEntries(readFileSync('app/.env.local', 'utf8').split(/\r?\n/).map(line => line.match(/^([A-Z0-9_]+)=(.*)$/)).filter(Boolean).map(match => [match[1], match[2]]))
let token, roomId, lastOperation
async function call(path, body, method = 'POST') {
  lastOperation = path
  const r = await fetch(`${env.VITE_SUPABASE_URL}${path}`, { method, headers: { apikey: env.VITE_SUPABASE_ANON_KEY, Authorization: `Bearer ${token || env.VITE_SUPABASE_ANON_KEY}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(20000) })
  const data = await r.json().catch(() => null)
  return { status: r.status, data }
}
async function must(path, body, method) {
  const r = await call(path, body, method)
  assert(r.status < 300, `${path}: ${r.status} ${JSON.stringify(r.data)}`)
  return r.data
}
const rpc = (name, args) => must(`/rest/v1/rpc/${name}`, args)
const uc = body => must('/functions/v1/uc-command', body)
const ready = () => rpc('set_ready', { p_room_id: roomId, p_ready: true })
async function checkLobby() {
  const rows = await must(`/rest/v1/rooms?id=eq.${roomId}&select=status,game_type`, undefined, 'GET')
  assert.equal(rows[0].status, 'lobby')
  assert.equal(rows[0].game_type, 'lobby')
  const members = await must(`/rest/v1/room_members?room_id=eq.${roomId}&left_at=is.null&select=ready`, undefined, 'GET')
  assert(members.every(m => m.ready === false))
}
try {
  token = (await must('/auth/v1/signup', {})).access_token
  const [room] = await rpc('create_room', { p_title: '作画生命周期验收', p_game_type: 'lobby', p_max_players: 8, p_settings: {} })
  roomId = room.room_id
  await ready()
  await rpc('start_room_game', { p_room_id: roomId, p_game_type: 'draw' })
  const view = { gameId: `solo-${Date.now()}`, phase: 'ended', endsAt: 0, players: [], panel: [] }
  await rpc('publish_draw_view', { p_room_id: roomId, p_view: view })
  await rpc('finish_draw_session', { p_room_id: roomId, p_game_key: view.gameId })
  await checkLobby()
  console.log('✓ One-person drawing completes and clears readiness')
  await ready()
  await rpc('clear_draw_session', { p_room_id: roomId })
  await rpc('start_room_game', { p_room_id: roomId, p_game_type: 'draw' })
  await rpc('publish_draw_view', { p_room_id: roomId, p_view: { ...view, gameId: 'new-drawing', phase: 'drawing' } })
  assert.equal((await call('/rest/v1/rpc/finish_draw_session', { p_room_id: roomId, p_game_key: view.gameId })).status, 409)
  await rpc('end_room_game', { p_room_id: roomId })
  await checkLobby()
  const final = await rpc('read_draw_view', { p_room_id: roomId })
  assert.equal(final[0].view.phase, 'ended')
  console.log('✓ A stale finish cannot close the new game; host end closes its shared view')
  await ready()
  let snap = await uc({ op: 'start', room_id: roomId, variant: 'draw', bots: 3, request_id: crypto.randomUUID(), config: { drawSeconds: 10, voteSeconds: 10, revealSeconds: 1, maxRounds: 1 } })
  const gameId = snap.gameId
  const act = async action => {
    const result = await call('/functions/v1/uc-command', { op: 'act', game_id: gameId, action, meta: { requestId: crypto.randomUUID() } })
    if (['DEADLINE_PASSED', 'STALE_STATE'].includes(result.data?.error?.code)) return uc({ op: 'tick', game_id: gameId })
    assert(result.status < 300, JSON.stringify(result.data))
    return result.data
  }
  snap = await act({ type: 'acknowledgeWord' })
  const phases = new Set([snap.view.phase])
  const deadline = Date.now() + 90000
  while (snap.view.phase !== 'ended' && Date.now() < deadline) {
    if (snap.view.phase === 'describe' && snap.view.currentSpeakerId === snap.playerId) {
      snap = await act({ type: 'drawingSubmitted', turnKey: snap.view.turnKey, drawingRef: 'test-drawing.png' })
    } else if (snap.view.phase === 'vote' && snap.view.players.find(p => p.id === snap.playerId)?.canVote && !snap.view.players.find(p => p.id === snap.playerId)?.hasVoted) {
      snap = await act({ type: 'vote', targetId: null })
    } else {
      await new Promise(resolve => setTimeout(resolve, 500))
      snap = await uc({ op: 'tick', game_id: gameId })
    }
    phases.add(snap.view.phase)
  }
  assert.equal(snap.view.phase, 'ended')
  assert(phases.has('review'))
  await checkLobby()
  console.log(`✓ Hybrid completes by Undercover rules: ${[...phases].join(' → ')}`)
  await ready()
  const restarted = await uc({ op: 'start', room_id: roomId, variant: 'draw', request_id: crypto.randomUUID() })
  assert.notEqual(restarted.gameId, gameId)
  assert.equal(restarted.view.phase, 'word')
  assert.deepEqual(restarted.artworks, [])
  await uc({ op: 'act', game_id: restarted.gameId, action: { type: 'endGame' }, meta: { requestId: crypto.randomUUID() } })
  await checkLobby()
  console.log('✓ Hybrid starts cleanly again and host-end clears the whole match')
} catch (error) { console.error(`${lastOperation}: ${error.message}`); process.exitCode = 1 }
finally { if (roomId) await rpc('close_room', { p_room_id: roomId }).catch(() => {}) }
