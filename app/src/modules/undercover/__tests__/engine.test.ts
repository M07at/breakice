import { describe, expect, it } from 'vitest'
import { createRng } from '../../shared/random'
import {
  LocalUcBackend,
  UcError,
  applyAction,
  createGame,
  currentSpeaker,
  currentTurnKey,
  eligibleVoterIds,
  tick,
  toPublicView,
  toSecretView,
} from '..'
import type { UcAction, UcConfig, UcEvent, UcState } from '..'

const PAIR = { civilian: '苹果', undercover: '梨' }
const HOST = { now: 0, isHost: true }
const PLAYER = { now: 0 }

const ids = (n: number) => Array.from({ length: n }, (_, i) => `p${i + 1}`)

function newGame(n: number, config: Partial<UcConfig> = {}, seed = 1, now = 0) {
  let result = waitingGame(n, config, seed, now)
  if (result.state.phase === 'word') {
    for (const by of ids(n)) result = applyAction(result.state, { type: 'acknowledgeWord', by }, { now })
  }
  return result
}

function waitingGame(n = 6, config: Partial<UcConfig> = {}, seed = 1, now = 0) {
  return createGame({ playerIds: ids(n), pair: PAIR, config: { swapWords: false, ...config }, now, rng: createRng(seed) })
}

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn()
  } catch (e) {
    return e instanceof UcError ? e.code : 'NOT_UC_ERROR'
  }
  return undefined
}

const bad = (s: UcState) => s.players.filter((p) => p.role !== 'civilian').map((p) => p.id)
const good = (s: UcState) => s.players.filter((p) => p.role === 'civilian').map((p) => p.id)
const scores = (events: UcEvent[]) => events.filter((e): e is Extract<UcEvent, { type: 'score' }> => e.type === 'score')
const scored = (events: UcEvent[], reason: string) =>
  scores(events)
    .filter((e) => e.reason === reason)
    .map((e) => e.playerId)
    .sort()

function act(s: UcState, action: UcAction, ctx = PLAYER) {
  return applyAction(s, action, ctx).state
}

function finishDescribe(s: UcState): UcState {
  while (s.phase === 'describe') s = act(s, { type: 'turnDone', by: currentSpeaker(s)! })
  if (s.phase === 'review') s = tick(s, s.phaseDeadline).state
  return s
}

function voteAll(s: UcState, pick: (voterId: string) => string | null) {
  const events: UcEvent[] = []
  for (const by of eligibleVoterIds(s)) {
    if (s.phase !== 'vote') break
    const t = applyAction(s, { type: 'vote', by, targetId: pick(by) }, PLAYER)
    s = t.state
    events.push(...t.events)
  }
  return { state: s, events }
}

/** 造一个 a、b 两个平民 2:2 平票的局面 */
function tiedGame() {
  let s = finishDescribe(newGame(5).state)
  const [a, b] = good(s)
  const others = s.players.map((p) => p.id).filter((id) => id !== a && id !== b)
  const picks: Record<string, string | null> = { [a]: b, [b]: a, [others[0]]: a, [others[1]]: b, [others[2]]: null }
  s = voteAll(s, (id) => picks[id]).state
  return { s, a, b, others }
}

describe('开局', () => {
  it.each([
    [4, 1],
    [6, 1],
    [7, 2],
    [12, 2],
    [13, 3],
    [20, 3],
  ])('%i 人局有 %i 个卧底', (n, expected) => {
    const { state } = newGame(n)
    expect(bad(state)).toHaveLength(expected)
    expect(good(state)).toHaveLength(n - expected)
  })

  it('白板只在 7 人及以上出现', () => {
    expect(newGame(6, { blankEnabled: true }).state.players.some((p) => p.role === 'blank')).toBe(false)
    const s = newGame(7, { blankEnabled: true }).state
    expect(s.players.filter((p) => p.role === 'blank')).toHaveLength(1)
    expect(s.players.find((p) => p.role === 'blank')!.word).toBeNull()
  })

  it('平民拿平民词，卧底拿卧底词', () => {
    const s = newGame(8).state
    for (const p of s.players) expect(p.word).toBe(p.role === 'civilian' ? '苹果' : '梨')
  })

  it('人数不对、重复玩家、词对相同都会拒绝', () => {
    expect(codeOf(() => newGame(3))).toBe('PLAYER_COUNT')
    expect(codeOf(() => newGame(21))).toBe('PLAYER_COUNT')
    expect(codeOf(() => newGame(13, { variant: 'draw' }))).toBe('PLAYER_COUNT')
    expect(codeOf(() => newGame(12, { variant: 'draw' }))).toBeUndefined()
    expect(
      codeOf(() => createGame({ playerIds: ['a', 'a', 'b', 'c'], pair: PAIR, now: 0, rng: createRng(1) })),
    ).toBe('DUPLICATE_PLAYER')
    expect(
      codeOf(() => createGame({ playerIds: ids(4), pair: { civilian: '猫', undercover: ' 猫 ' }, now: 0, rng: createRng(1) })),
    ).toBe('BAD_PAIR')
    expect(codeOf(() => newGame(4, { undercoverCount: 2 }))).toBe('BAD_CONFIG')
  })

  it('同一个种子开出同一局', () => {
    expect(newGame(9, {}, 42).state).toEqual(newGame(9, {}, 42).state)
  })

  it('swapWords 会交换平民词和卧底词', () => {
    const civilianWords = new Set(
      [1, 2, 3, 4, 5, 6, 7, 8].map((seed) => newGame(5, { swapWords: true }, seed).state.pair.civilian),
    )
    expect(civilianWords).toEqual(new Set(['苹果', '梨']))
  })
})

describe('经典模式私密领词', () => {
  it('所有人确认前无发言计时，不能越阶段发言或投票', () => {
    const s = waitingGame().state
    expect(s.phase).toBe('word')
    expect(s.phaseDeadline).toBe(0)
    expect(currentSpeaker(s)).toBeNull()
    expect(tick(s, 1_000_000)).toEqual({ state: s, events: [] })
    expect(codeOf(() => applyAction(s, { type: 'turnDone', by: 'p1' }, PLAYER))).toBe('WRONG_PHASE')
    expect(codeOf(() => applyAction(s, { type: 'vote', by: 'p1', targetId: 'p2' }, PLAYER))).toBe('WRONG_PHASE')
    expect(codeOf(() => applyAction(s, { type: 'next' }, HOST))).toBe('WRONG_PHASE')
    expect(codeOf(() => applyAction(s, { type: 'acknowledgeWord', by: 'stranger' }, PLAYER))).toBe('UNKNOWN_PLAYER')
  })

  it('确认只公开进度；最后一次确认启动计时，重试不推进或重新计时', () => {
    let s = waitingGame().state
    for (const by of ids(6).slice(0, 5)) s = act(s, { type: 'acknowledgeWord', by })
    const publicView = toPublicView(s)
    expect(publicView.players.filter((p) => p.wordConfirmed)).toHaveLength(5)
    expect(publicView.players.every((p) => p.role === null && p.word === undefined)).toBe(true)
    expect(JSON.stringify(publicView)).not.toContain('苹果')
    expect(JSON.stringify(publicView)).not.toContain('梨')
    expect(applyAction(s, { type: 'acknowledgeWord', by: 'p1' }, { now: 90_000 }).state).toBe(s)
    const started = applyAction(s, { type: 'acknowledgeWord', by: 'p6' }, { now: 100_000 })
    expect(started.state.phase).toBe('describe')
    expect(started.state.phaseDeadline).toBe(140_000)
    expect(applyAction(started.state, { type: 'acknowledgeWord', by: 'p6' }, { now: 110_000 }))
      .toEqual({ state: started.state, events: [] })
  })

  it('六人完整领词、发言、投票、平民胜利，只产生一次结束事件', () => {
    let s = waitingGame().state
    const originalAssignments = s.players.map(({ id, role, word }) => ({ id, role, word }))
    for (const by of ids(6)) s = act(s, { type: 'acknowledgeWord', by })
    expect(s.players.map(({ id, role, word }) => ({ id, role, word }))).toEqual(originalAssignments)
    s = finishDescribe(s)
    const undercover = bad(s)[0]
    const result = voteAll(s, (id) => id === undercover ? good(s)[0] : undercover)
    expect(result.state.winner).toBe('civilian')
    expect(result.events.filter((e) => e.type === 'ended')).toHaveLength(1)
    expect(tick(result.state, 1_000_000).events).toEqual([])
    expect(codeOf(() => applyAction(result.state, { type: 'vote', by: 'p1', targetId: 'p2' }, PLAYER))).toBe('WRONG_PHASE')
  })
})

describe('描述环节', () => {
  it('按座位顺序从某人开始轮一圈', () => {
    const s = newGame(6).state
    const start = s.players.findIndex((p) => p.id === s.speakOrder[0])
    const expected = ids(6).map((_, i) => `p${((start + i) % 6) + 1}`)
    expect(s.speakOrder).toEqual(expected)
    expect(currentSpeaker(s)).toBe(expected[0])
  })

  it('不是自己的回合不能结束；跳过只有主持人能用', () => {
    const s = newGame(5).state
    const notSpeaker = s.speakOrder[1]
    expect(codeOf(() => applyAction(s, { type: 'turnDone', by: notSpeaker }, PLAYER))).toBe('NOT_YOUR_TURN')
    expect(codeOf(() => applyAction(s, { type: 'skipTurn' }, PLAYER))).toBe('HOST_ONLY')
    expect(currentSpeaker(act(s, { type: 'skipTurn' }, HOST))).toBe(notSpeaker)
  })

  it('全部说完进入投票，倒计时 30 秒', () => {
    const s = finishDescribe(newGame(5).state)
    expect(s.phase).toBe('vote')
    expect(s.phaseDeadline).toBe(30_000)
  })
})

describe('投票', () => {
  it('不能投自己、不能重复投、不能投不存在的人', () => {
    const s = finishDescribe(newGame(5).state)
    expect(codeOf(() => applyAction(s, { type: 'vote', by: 'p1', targetId: 'p1' }, PLAYER))).toBe('INVALID_TARGET')
    expect(codeOf(() => applyAction(s, { type: 'vote', by: 'p1', targetId: 'nobody' }, PLAYER))).toBe('UNKNOWN_PLAYER')
    const voted = act(s, { type: 'vote', by: 'p1', targetId: 'p2' })
    expect(codeOf(() => applyAction(voted, { type: 'vote', by: 'p1', targetId: 'p3' }, PLAYER))).toBe('ALREADY_VOTED')
  })

  it('投票过程中只公开谁投了，不公开投给谁', () => {
    const s = act(finishDescribe(newGame(5).state), { type: 'vote', by: 'p1', targetId: 'p2' })
    const view = toPublicView(s)
    expect(view.players.find((p) => p.id === 'p1')!.hasVoted).toBe(true)
    expect(view.lastResult).toBeNull()
    expect(JSON.stringify(view)).not.toContain('"p1":"p2"')
  })

  it('最高票出局，身份公开，词不公开', () => {
    let s = finishDescribe(newGame(7).state)
    const target = good(s)[0]
    s = voteAll(s, (id) => (id === target ? good(s)[1] : target)).state
    expect(s.phase).toBe('reveal')
    expect(s.lastResult!.eliminatedId).toBe(target)
    const p = toPublicView(s).players.find((x) => x.id === target)!
    expect(p.role).toBe('civilian')
    expect(p.word).toBeUndefined()
  })

  it('全部弃权没人出局，揭晓后进入下一轮', () => {
    let s = voteAll(finishDescribe(newGame(5).state), () => null).state
    expect(s.lastResult!.eliminatedId).toBeNull()
    s = act(s, { type: 'next' }, HOST)
    expect(s.round).toBe(2)
    expect(s.phase).toBe('describe')
  })
})

describe('平票加赛', () => {
  it('平票的人也能投票，但只能投给候选人', () => {
    let { s, a, b, others } = tiedGame()
    expect(s.phase).toBe('reveal')
    expect(new Set(s.lastResult!.tied)).toEqual(new Set([a, b]))
    s = act(s, { type: 'next' }, HOST)
    expect(s.round).toBe(1)
    expect(new Set(s.pkCandidates)).toEqual(new Set([a, b]))
    expect(new Set(s.speakOrder)).toEqual(new Set([a, b]))
    expect(currentTurnKey(s)).toBe('1-pk')
    s = finishDescribe(s)
    // 加时赛候选人同样有投票权（否则四人全平票时没人能投，只会全员弃权）
    expect(eligibleVoterIds(s).sort()).toEqual([a, b, ...others].sort())
    expect(codeOf(() => applyAction(s, { type: 'vote', by: a, targetId: b }, PLAYER))).toBeUndefined()
    // 但目标仍然只能是候选人
    expect(codeOf(() => applyAction(s, { type: 'vote', by: others[0], targetId: others[1] }, PLAYER))).toBe(
      'INVALID_TARGET',
    )
  })

  it('加赛再平票没人出局，进入下一轮', () => {
    let { s, a, b, others } = tiedGame()
    s = finishDescribe(act(s, { type: 'next' }, HOST))
    s = voteAll(s, (id) => (id === others[0] ? a : id === others[1] ? b : null)).state
    expect(s.lastResult!.pk).toBe(true)
    expect(s.lastResult!.eliminatedId).toBeNull()
    s = act(s, { type: 'next' }, HOST)
    expect(s.round).toBe(2)
    expect(s.pkCandidates).toBeNull()
  })

  it('加赛有最高票就出局', () => {
    let { s, a, b } = tiedGame()
    s = finishDescribe(act(s, { type: 'next' }, HOST))
    // 候选人自己也要投票，且不能投自己
    s = voteAll(s, (id) => (id === a ? b : a)).state
    expect(s.lastResult!.eliminatedId).toBe(a)
  })
})

describe('胜负和计分', () => {
  it('卧底被投出去，平民胜', () => {
    const s = finishDescribe(newGame(5).state)
    const [u] = bad(s)
    const civilians = good(s)
    const { state, events } = voteAll(s, (id) => (id === u ? civilians[0] : u))
    expect(state.phase).toBe('ended')
    expect(state.winner).toBe('civilian')
    expect(scored(events, 'uc_win_civilian')).toEqual(civilians.sort())
    expect(scored(events, 'uc_survive')).toEqual(civilians.sort())
    expect(scored(events, 'uc_correct_vote')).toEqual(civilians.sort())
    expect(scored(events, 'uc_win_undercover')).toEqual([])
  })

  it('四人局投错一个平民不结束；只剩两人时才判卧底胜', () => {
    const s = finishDescribe(newGame(4).state)
    const [u] = bad(s)
    const [c1, c2, c3] = good(s)

    // 只出局一个平民：还剩 2 平民 + 1 卧底，游戏必须继续
    const first = voteAll(s, (id) => (id === c1 ? c2 : c1)).state
    expect(first.winner).toBeNull()
    expect(first.players.filter((p) => p.alive).length).toBe(3)

    // 再出局一个平民：剩 1 平民 + 1 卧底，卧底胜
    const next = finishDescribe(act(first, { type: 'next' }, HOST))
    const { state, events } = voteAll(next, (id) => (id === c2 ? c3 : c2))
    expect(state.winner).toBe('undercover')
    expect(scored(events, 'uc_win_undercover')).toEqual([u])
  })

  it('7 人局开白板，投错一个平民不会直接结束；白板不出局平民赢不了', () => {
    let s = finishDescribe(newGame(7, { blankEnabled: true }).state)
    const [c1, c2] = good(s)
    s = voteAll(s, (id) => (id === c1 ? c2 : c1)).state
    expect(s.phase).toBe('reveal')
    expect(s.winner).toBeNull()

    const undercovers = s.players.filter((p) => p.role === 'undercover').map((p) => p.id)
    for (const u of undercovers) {
      s = finishDescribe(act(s, { type: 'next' }, HOST))
      s = voteAll(s, (id) => (id === u ? good(s)[1] : u)).state
    }
    expect(s.players.find((p) => p.role === 'blank')!.alive).toBe(true)
    expect(s.winner).toBeNull()
  })

  it('打满轮数卧底还在，卧底胜', () => {
    let s = voteAll(finishDescribe(newGame(5, { maxRounds: 1 }).state), () => null).state
    s = act(s, { type: 'next' }, HOST)
    expect(s.phase).toBe('ended')
    expect(s.endedReason).toBe('max_rounds')
    expect(s.winner).toBe('undercover')
  })

  it('主持人提前结束不计分', () => {
    const s = newGame(5).state
    expect(codeOf(() => applyAction(s, { type: 'endGame' }, PLAYER))).toBe('HOST_ONLY')
    const t = applyAction(s, { type: 'endGame' }, HOST)
    expect(t.state.endedReason).toBe('host_ended')
    expect(t.state.winner).toBeNull()
    expect(scores(t.events)).toEqual([])
  })
})

describe('倒计时', () => {
  it('没到点原样返回，到点换下一个人', () => {
    const s = newGame(5, {}, 1, 1000).state
    expect(s.phaseDeadline).toBe(41_000)
    const early = tick(s, 40_999)
    expect(early.state).toBe(s)
    expect(early.events).toEqual([])
    const due = tick(s, 41_000)
    expect(currentSpeaker(due.state)).toBe(s.speakOrder[1])
  })

  it('投票超时，没投的算弃权', () => {
    let s = finishDescribe(newGame(5).state)
    s = act(s, { type: 'vote', by: 'p1', targetId: 'p2' })
    const { state } = tick(s, 30_000)
    expect(state.lastResult!.ballots.filter((b) => b.targetId === null)).toHaveLength(4)
    expect(state.lastResult!.eliminatedId).toBe('p2')
  })

  it('揭晓超时自动进下一轮；结束后 tick 无效', () => {
    const s = voteAll(finishDescribe(newGame(5).state), () => null).state
    expect(tick(s, s.phaseDeadline).state.round).toBe(2)
    const ended = applyAction(s, { type: 'endGame' }, HOST).state
    expect(tick(ended, 10 ** 13).state).toBe(ended)
  })
})

describe('可见性', () => {
  it('公开视图不含任何人的词，结束后全部公开', () => {
    const s = newGame(7, { blankEnabled: true }).state
    const view = toPublicView(s)
    expect(JSON.stringify(view)).not.toContain('苹果')
    expect(JSON.stringify(view)).not.toContain('梨')
    expect(view.players.every((p) => p.role === null)).toBe(true)
    expect(view.roleCounts).toEqual({ civilian: 4, undercover: 2, blank: 1 })
    const ended = toPublicView(applyAction(s, { type: 'endGame' }, HOST).state)
    expect(ended.pair).toEqual(PAIR)
    expect(ended.players.every((p) => p.role !== null && p.word !== undefined)).toBe(true)
  })

  it('私密视图只给自己的词', () => {
    const s = newGame(7, { blankEnabled: true }).state
    const blank = s.players.find((p) => p.role === 'blank')!
    expect(toSecretView(s, blank.id)).toEqual({ playerId: blank.id, word: null, isBlank: true })
    expect(codeOf(() => toSecretView(s, 'stranger'))).toBe('UNKNOWN_PLAYER')
  })

  it('局面可以原样存成 JSON', () => {
    const { s } = tiedGame()
    expect(JSON.parse(JSON.stringify(s))).toEqual(s)
  })
})

describe('你画我猜谁是卧底', () => {
  it('每人一个画作位，只能交自己的，可以补交，不能覆盖', () => {
    let s = newGame(5, { variant: 'draw' }).state
    const [first, second] = s.speakOrder
    expect(s.phaseDeadline).toBe(25_000)
    expect(s.drawings['1']).toEqual({ [first]: null })
    s = act(s, { type: 'drawingSubmitted', by: first, turnKey: '1', drawingRef: 'img_1' })
    expect(
      codeOf(() => applyAction(s, { type: 'drawingSubmitted', by: second, turnKey: '1', drawingRef: 'x' }, PLAYER)),
    ).toBe('NOT_YOUR_TURN')
    s = act(s, { type: 'turnDone', by: first })
    s = act(s, { type: 'turnDone', by: second })
    s = act(s, { type: 'drawingSubmitted', by: second, turnKey: '1', drawingRef: 'img_2' })
    s = act(s, { type: 'drawingSubmitted', by: first, turnKey: '1', drawingRef: 'img_other' })
    expect(s.drawings['1'][first]).toBe('img_1')
    expect(s.drawings['1'][second]).toBe('img_2')
  })

  it('AI 分数结束前不公开，结束时按分数发奖励，晚到的立刻发', () => {
    let s = newGame(5, { variant: 'draw' }).state
    const [first, second] = s.speakOrder
    s = act(s, { type: 'aiScored', playerId: first, turnKey: '1', score: 85 })
    s = act(s, { type: 'aiScored', playerId: first, turnKey: '1', score: 10 })
    expect(s.aiScores[`1:${first}`]).toBe(85)
    expect(toPublicView(s).aiScores).toBeNull()
    expect(codeOf(() => applyAction(s, { type: 'aiScored', playerId: first, turnKey: '9', score: 50 }, PLAYER))).toBe(
      'UNKNOWN_PLAYER',
    )

    s = finishDescribe(s)
    const [u] = bad(s)
    const { state, events } = voteAll(s, (id) => (id === u ? good(s)[0] : u))
    expect(state.phase).toBe('ended')
    expect(scores(events).filter((e) => e.reason === 'uc_ai_bonus')).toEqual([
      { type: 'score', playerId: first, reason: 'uc_ai_bonus', points: 2 },
    ])
    const late = applyAction(state, { type: 'aiScored', playerId: second, turnKey: '1', score: 65 }, PLAYER)
    expect(late.events).toEqual([{ type: 'score', playerId: second, reason: 'uc_ai_bonus', points: 1 }])
    expect(toPublicView(late.state).aiScores).toEqual({ [`1:${first}`]: 85, [`1:${second}`]: 65 })
  })
})

describe('中途退出', () => {
  it('正在发言的人退出，轮到下一个', () => {
    const s = newGame(7).state
    const [speaker, next] = s.speakOrder
    const t = applyAction(s, { type: 'playerLeft', playerId: speaker }, PLAYER)
    expect(currentSpeaker(t.state)).toBe(next)
    expect(t.events[0]).toEqual({ type: 'eliminated', playerId: speaker, role: s.players.find((p) => p.id === speaker)!.role, reason: 'left' })
  })

  it('唯一的卧底退出，平民胜', () => {
    const s = newGame(5).state
    const t = applyAction(s, { type: 'playerLeft', playerId: bad(s)[0] }, PLAYER)
    expect(t.state.winner).toBe('civilian')
  })

  it('投给退出者的票作废，可以重投', () => {
    let s = finishDescribe(newGame(7).state)
    const [target, voter] = good(s)
    s = act(s, { type: 'vote', by: voter, targetId: target })
    s = act(s, { type: 'playerLeft', playerId: target })
    expect(s.votes[voter]).toBeUndefined()
    expect(codeOf(() => applyAction(s, { type: 'vote', by: voter, targetId: bad(s)[0] }, PLAYER))).toBeUndefined()
  })

  it('加赛只剩一人时取消加赛', () => {
    let { s, a } = tiedGame()
    s = act(s, { type: 'next' }, HOST)
    s = act(s, { type: 'playerLeft', playerId: a })
    expect(s.pkCandidates).toBeNull()
    expect(s.round).toBe(2)
    expect(s.phase).toBe('describe')
  })
})

describe('LocalUcBackend 单机模式', () => {
  it('切换 me 扮演不同玩家走完一轮', async () => {
    const scoreEvents: UcEvent[] = []
    const backend = new LocalUcBackend({
      playerIds: ids(4),
      hostId: 'p1',
      pickPair: () => PAIR,
      rng: createRng(3),
      now: () => 0,
      onScore: (e) => scoreEvents.push(e),
    })
    const { gameId } = await backend.start({ roomId: 'r1', variant: 'classic', config: { swapWords: false } })
    const seen: number[] = []
    backend.subscribe(gameId, (v) => seen.push(v.version))

    backend.me = 'p2'
    expect((await backend.getMyWord(gameId)).playerId).toBe('p2')
    await expect(backend.act(gameId, { type: 'skipTurn' })).rejects.toMatchObject({ code: 'HOST_ONLY' })

    let view = await backend.getView(gameId)
    for (const player of view.players) {
      backend.me = player.id
      view = await backend.act(gameId, { type: 'acknowledgeWord' })
    }
    while (view.phase === 'describe') {
      backend.me = view.currentSpeakerId!
      view = await backend.act(gameId, { type: 'turnDone' })
    }
    expect(view.phase).toBe('vote')
    for (const p of view.players) {
      backend.me = p.id
      view = await backend.act(gameId, { type: 'vote', targetId: null })
    }
    expect(view.phase).toBe('reveal')
    backend.me = 'p1'
    view = await backend.act(gameId, { type: 'endGame' })
    expect(view.phase).toBe('ended')
    expect(view.pair).toEqual(PAIR)
    expect(seen.length).toBeGreaterThan(4)
    expect(scoreEvents).toEqual([])
  })
})


