/**
 * 你画我猜的「房间」：谁在画、还剩多少时间、谁交了什么、最后怎么排名。
 *
 * 页面只依赖 `DrawRoomBackend` 这个接口。现在的实现是本机内存版
 * （`LocalDrawRoomBackend`，只有「我」能画，别人那一轮到点自动过去），
 * 接入 A 的房间 RPC 和私有频道之后换成远程实现，**页面一行都不用改**——
 * 和 C 的 `UcBackend` / `LocalUcBackend` 是同一个套路。
 */
import { createRng } from '../shared/random'
import type { Rng } from '../shared/random'
import { LOCAL_USER_ID, bankRepo } from '../local/session'
import { ScoreBook } from '../score'
import type { LeaderboardRow } from '../score/types'
import type { BankItem } from '../bank'
import { MockAiScorer } from './ai'
import type { AiScorer } from './ai'
import { DrawEngine } from './engine'
import { ChunkPump, LoopbackTransport } from './sync'
import { customWord, pickDrawWord, pickEmojiPalette } from './words'
import type { AiScoreResult, DrawVariant, DrawWord } from './types'

/** 每人作画时长 */
export const DRAW_SECONDS = 90
/** 每张画揭晓（能看到答案、送花、点差评）持续多久；这段时间不开始下一位 */
export const REVEAL_SECONDS = 8

export interface DrawRoomPlayer {
  id: string
  name: string
}

/**
 * - `drawing`：有人正在画
 * - `reveal`：刚画完，公开这一张的答案和评分，**暂停 8 秒**，期间不开始下一位
 * - `ended`：所有人都画完了
 */
export type DrawRoomPhase = 'drawing' | 'reveal' | 'ended'

export interface DrawRoomDrawing {
  playerId: string
  imageRef: string
  /** 结算前不公开给别的玩家，本地实现里只在结束时才放进视图 */
  ai: AiScoreResult | null
}

/** 公开答案面板里的一行：答案、画、AI 分、收到的花和差评 */
export interface DrawPanelEntry {
  playerId: string
  name: string
  shortId: string
  /** 这一位当时要画的词，结算后公开 */
  answer: string
  imageRef: string
  ai: AiScoreResult | null
  flowers: number
  dislikes: number
}

/** 聊天 / 抢答里的一条消息 */
export interface DrawMessage {
  id: string
  playerId: string
  playerName: string
  /** 玩家的短号，界面上用来区分同名 */
  shortId: string
  /** 发出去的内容（已经遮罩过，答到词的字会被替换成冰块） */
  text: string
  /** correct = 抢答正确，界面上单独显示成「XXX 回答正确」 */
  kind: 'chat' | 'correct'
  at: number
}

export interface DrawRoomView {
  roomId: string
  gameId: string
  variant: DrawVariant
  phase: DrawRoomPhase
  players: DrawRoomPlayer[]
  /** 这一轮该谁画 */
  painterId: string
  roundIndex: number
  roundKey: string
  /** 只有本人就是作画者时才有值；别人的题面不下发 */
  word: DrawWord | null
  /**
   * 公开提示：几个字 + 类别。**所有人都有**，猜的人也需要；
   * 只给字数和分类，不给 emoji（emoji 等于答案）。
   */
  hint: { chars: number; category?: string } | null
  /** Emoji 版的贴纸面板（只有作画者需要） */
  palette: string[]
  /** 这一轮什么时候结束（服务端时钟） */
  endsAt: number
  /** 这一轮什么时候开始的（服务端时钟），提示按它算"已经过了多少秒" */
  startedAt: number
  /** 服务端当前时间，客户端用它校正本机时钟偏差 */
  serverTime: number
  /** 已交的画。作画过程中别人的画不在这里（只有画者自己能看到自己的） */
  drawings: DrawRoomDrawing[]
  /** 结算后的排名 */
  ranking: LeaderboardRow[]
  /** 我这一轮交过了没有 */
  submittedByMe: boolean
  /** 所有该猜的人都猜对了 —— 页面收到就该立刻交画，不用等倒计时 */
  allGuessed: boolean
  /** 聊天和抢答记录（我猜对了会多一条 correct） */
  messages: DrawMessage[]
  /**
   * 公开答案面板：
   * - `reveal` 阶段只放**刚画完的那一张**
   * - `ended` 阶段放所有人的（汇总）
   * - 其他阶段为空（答案不外泄）
   */
  panel: DrawPanelEntry[]
}

export interface DrawRoomBackend {
  meId: string
  view(): Promise<DrawRoomView>
  subscribe(onView: (view: DrawRoomView) => void): () => void
  /** 交画。服务端负责：只接受当前作画者的提交、同一轮只收一次、触发 AI 评分 */
  submitDrawing(imageRef: string): Promise<DrawRoomView>
  /** 倒计时归零时调用，重复调用安全 */
  tick(): Promise<DrawRoomView>
  /**
   * 发一条聊天 / 抢答。
   * 服务端负责：判断是不是答对了、把答案里的字替换成冰块、答对时记一次抢答。
   */
  sendMessage(text: string): Promise<DrawRoomView>
  /** 发花或差评。一人一次随便送，服务端只负责累加 */
  sendReaction(targetPlayerId: string, kind: DrawReaction): Promise<DrawRoomView>
  /** 页面卸载时释放监听和定时器 */
  dispose(): void
}

/** 对别人的画表示态度：送花 = 好看，点差评 = 画得离谱 */
export type DrawReaction = 'flower' | 'dislike'

export interface LocalDrawRoomOptions {
  playerCount: number
  variant: DrawVariant
  customText?: string
  scorer?: AiScorer
  now?: () => number
  /**
   * 抽词的数据源，默认用系统题库（`sys_draw`）。
   * 单测里注入假数据，就不用依赖题库的具体实现。
   */
  listItems?: () => Promise<BankItem<'draw'>[]>
}

/** 同一个房间不重复抽题 */
const usedWordIds = new Set<string>()

/** 一个房间里保留多少条消息 */
const MAX_MESSAGES = 200

/** 冰块：答到答案里的字要替换成它，不能让旁边的人直接看到答案 */
const ICE = '🧊'

/**
 * 把消息里**和答案重复的字**换成冰块。
 * 比如答案是「长颈鹿」，发「是长颈鹿吧」就会变成「是🧊🧊🧊吧」。
 */
export function maskAnswer(text: string, answer: string): string {
  if (!answer) return text
  const chars = new Set(Array.from(answer.toLowerCase()))
  return Array.from(text)
    .map((ch) => (chars.has(ch.toLowerCase()) ? ICE : ch))
    .join('')
}

/**
 * 本机房间：**只有「我」能画**，别人那一轮到点就自动过（他们的画在别人的手机上）。
 * 用来开发和单机演示；真正的联机是 A 的远程实现。
 */
export class LocalDrawRoomBackend implements DrawRoomBackend {
  readonly meId = LOCAL_USER_ID

  /** 我在这块画布上画 */
  readonly actor: DrawEngine
  /** 别人手机上看到的画面（本机用回环通道模拟） */
  readonly viewer: DrawEngine
  readonly transport: LoopbackTransport
  readonly pump: ChunkPump
  /** 别人的笔画同步过来之后要重画画布，页面在这里挂一个回调 */
  onStrokeChange: (() => void) | null = null

  private readonly roomId = 'local'
  private readonly gameId: string
  private readonly variant: DrawVariant
  private readonly customText: string
  private readonly scorer: AiScorer
  private readonly now: () => number
  private readonly listItems: () => Promise<BankItem<'draw'>[]>
  private readonly players: DrawRoomPlayer[]
  private readonly board: ScoreBook
  private readonly listeners = new Set<(view: DrawRoomView) => void>()

  private phase: DrawRoomPhase = 'drawing'
  private roundIndex = 0
  private startedAt = 0
  private endsAt = 0
  /** 揭晓阶段的结束时刻（这一张看完就换下一位） */
  private revealEndsAt = 0
  private word: DrawWord | null = null
  private palette: string[] = []
  private drawings: Record<string, DrawRoomDrawing> = {}
  private messages: DrawMessage[] = []
  private messageSeq = 0
  /** 每人当时要画的词，结算后进公开面板 */
  private answers: Record<string, string> = {}
  /** 每人收到的花和差评 */
  private reactions: Record<string, { flowers: number; dislikes: number }> = {}
  /** 这一轮谁答对了、用了多少秒；交画结算时按它算抢答分 */
  private guesses: Array<{ playerId: string; seconds: number }> = []
  private pendingSubmit: Promise<void> | null = null

  constructor(options: LocalDrawRoomOptions) {
    this.variant = options.variant
    this.customText = options.customText ?? ''
    this.scorer = options.scorer ?? new MockAiScorer()
    this.now = options.now ?? (() => Date.now())
    this.listItems =
      options.listItems ?? (() => bankRepo().listItems('sys_draw') as Promise<BankItem<'draw'>[]>)
    this.gameId = `local-draw-${this.now().toString(36)}`
    this.players = Array.from({ length: Math.max(2, options.playerCount) }, (_, i) =>
      i === 0 ? { id: LOCAL_USER_ID, name: '我' } : { id: `local-${i + 1}`, name: `玩家${i + 1}` },
    )

    const names: Record<string, string> = {}
    const seats: Record<string, number> = {}
    this.players.forEach((player, index) => {
      names[player.id] = player.name
      seats[player.id] = index
    })
    this.board = new ScoreBook({ names, seats })

    this.actor = new DrawEngine({ by: this.meId })
    this.viewer = new DrawEngine({ by: 'viewer' })
    this.transport = new LoopbackTransport({ delayMs: 300 })
    this.pump = new ChunkPump(this.actor, this.transport)
    this.transport.subscribe((chunk) => {
      const applied = this.viewer.applyChunk(chunk)
      if (applied > 0) this.onStrokeChange?.()
    })
  }

  async start(): Promise<DrawRoomView> {
    this.roundIndex = 0
    await this.openRound()
    return this.view()
  }

  /** 开下一局时沿用同一套设置（版本 / 人数 / 自定义题面） */
  get settings(): LocalDrawRoomOptions {
    return {
      variant: this.variant,
      playerCount: this.players.length,
      customText: this.customText,
    }
  }

  async view(): Promise<DrawRoomView> {
    const isPainter = this.painterId() === this.meId
    const ended = this.phase === 'ended'
    const revealing = this.phase === 'reveal'
    return {
      roomId: this.roomId,
      gameId: this.gameId,
      variant: this.variant,
      phase: this.phase,
      players: this.players,
      painterId: this.painterId(),
      roundIndex: this.roundIndex,
      roundKey: this.roundKey(),
      // 词只下发给作画者自己
      word: isPainter ? this.word : null,
      hint: this.word
        ? { chars: Array.from(this.word.word).length, ...(this.word.hint ? { category: this.word.hint } : {}) }
        : null,
      palette: isPainter && this.variant === 'emoji' ? this.palette : [],
      // 揭晓阶段用揭晓的倒计时，其他阶段用这一轮的作画倒计时
      endsAt: revealing ? this.revealEndsAt : this.endsAt,
      startedAt: this.startedAt,
      serverTime: this.now(),
      // 别人的画只在揭晓和结算时才公开
      drawings: ended || revealing
        ? Object.values(this.drawings)
        : Object.values(this.drawings).filter((d) => d.playerId === this.meId),
      ranking: ended ? this.board.rows() : [],
      submittedByMe: Boolean(this.drawings[this.meId]) && this.painterId() === this.meId,
      allGuessed: this.isAllGuessed(),
      messages: this.messages,
      panel: ended ? this.buildPanel() : revealing ? this.buildPanel(this.painterId()) : [],
    }
  }

  /** 公开答案面板：给 id 就只出那一张（揭晓阶段），不给就出全部（结算汇总） */
  private buildPanel(onlyPlayerId?: string): DrawPanelEntry[] {
    return this.players
      .map((player, index) => {
        const drawing = this.drawings[player.id]
        const reaction = this.reactions[player.id] ?? { flowers: 0, dislikes: 0 }
        return {
          playerId: player.id,
          name: player.name,
          shortId: `#${index + 1}`,
          answer: this.answers[player.id] ?? '',
          imageRef: drawing?.imageRef ?? '',
          ai: drawing?.ai ?? null,
          flowers: reaction.flowers,
          dislikes: reaction.dislikes,
        }
      })
      .filter((entry) => !onlyPlayerId || entry.playerId === onlyPlayerId)
  }

  subscribe(onView: (view: DrawRoomView) => void): () => void {
    this.listeners.add(onView)
    return () => {
      this.listeners.delete(onView)
    }
  }

  async submitDrawing(imageRef: string): Promise<DrawRoomView> {
    if (this.phase === 'ended') return this.view()
    if (this.painterId() !== this.meId) throw new Error('现在不是你画')
    if (this.drawings[this.meId]) return this.view()
    // 同一轮只处理一次
    if (this.pendingSubmit) {
      await this.pendingSubmit
      return this.view()
    }
    this.pendingSubmit = (async () => {
      const word = this.word?.word ?? ''
      let ai: AiScoreResult
      try {
        ai = await this.scorer.score({ imageRef, word, roundKey: this.roundKey() })
      } catch {
        ai = {
          score: 0,
          dimensions: { composition: 0, creativity: 0, relevance: 0 },
          comment: '',
          degraded: true,
        }
      }
      this.drawings[this.meId] = { playerId: this.meId, imageRef, ai }
      this.answers[this.meId] = word
      this.board.settleRound({
        roomId: this.roomId,
        gameId: this.gameId,
        roundKey: this.roundKey(),
        painterId: this.meId,
        ai,
        guesses: this.guesses,
      })
      // 画完先揭晓这一张（8 秒），期间不开始下一位
      this.enterReveal()
    })()
    await this.pendingSubmit
    this.pendingSubmit = null
    return this.view()
  }

  /**
   * 到点了：作画阶段 → 进入揭晓（没交画也照样揭晓，显示「没交画」）；
   * 揭晓阶段 → 换下一位，或者全部结束。
   */
  async tick(): Promise<DrawRoomView> {
    if (this.phase === 'drawing' && this.now() >= this.endsAt) {
      this.enterReveal()
    } else if (this.phase === 'reveal' && this.now() >= this.revealEndsAt) {
      await this.advance()
    }
    return this.view()
  }

  /**
   * 聊天 / 抢答。
   * - 内容等于本轮题面 → 记一条「回答正确」，并记下抢答用时；
   * - 否则当普通聊天发出去，但**和答案重复的字会被冰块遮住**（防止直接剧透）。
   * 画的人不能抢自己的题，所以轮到自己在画时只当聊天。
   */
  async sendMessage(text: string): Promise<DrawRoomView> {
    const raw = text.trim()
    if (!raw) return this.view()
    const player = this.players.find((p) => p.id === this.meId) ?? this.players[0]
    const answer = this.word?.word ?? ''
    const canGuess = this.phase === 'drawing' && this.painterId() !== this.meId && Boolean(answer)
    const isCorrect = canGuess && raw.toLowerCase() === answer.toLowerCase()

    if (isCorrect && !this.guesses.some((g) => g.playerId === this.meId)) {
      const seconds = Math.max(0, Math.round((this.now() - (this.endsAt - DRAW_SECONDS * 1000)) / 1000))
      this.guesses.push({ playerId: this.meId, seconds })
    }

    this.messageSeq += 1
    const message: DrawMessage = {
      id: `m${this.messageSeq}`,
      playerId: this.meId,
      playerName: player.name,
      shortId: `#${this.players.indexOf(player) + 1}`,
      text: isCorrect ? `${player.name} 回答正确` : maskAnswer(raw, answer),
      kind: isCorrect ? 'correct' : 'chat',
      at: this.now(),
    }
    this.messages = [...this.messages, message].slice(-MAX_MESSAGES)

    await this.emit()
    return this.view()
  }

  /** 送花 / 点差评：只累加计数，不满意谁都能送 */
  async sendReaction(targetPlayerId: string, kind: DrawReaction): Promise<DrawRoomView> {
    if (!this.players.some((p) => p.id === targetPlayerId)) return this.view()
    const current = this.reactions[targetPlayerId] ?? { flowers: 0, dislikes: 0 }
    this.reactions[targetPlayerId] = {
      flowers: current.flowers + (kind === 'flower' ? 1 : 0),
      dislikes: current.dislikes + (kind === 'dislike' ? 1 : 0),
    }
    await this.emit()
    return this.view()
  }

  dispose(): void {
    this.pump.stop()
    this.transport.dispose()
    this.listeners.clear()
  }

  private painterId(): string {
    return this.players[this.roundIndex]?.id ?? this.players[0].id
  }

  private roundKey(): string {
    return `r${this.roundIndex + 1}`
  }

  /** 画的人以外，所有人都猜对了 */
  private isAllGuessed(): boolean {
    if (this.phase !== 'drawing') return false
    const guessers = this.players.filter((p) => p.id !== this.painterId())
    if (guessers.length === 0) return false
    return guessers.every((p) => this.guesses.some((g) => g.playerId === p.id))
  }

  /** 轮到他画时就把答案记下来：到点没交画，揭晓时也要能看到答案 */
  private async openRound(): Promise<void> {
    const rng = createRng((this.now() ^ ((this.roundIndex + 1) * 0x9e3779b1)) >>> 0)
    if (this.variant === 'custom') {
      this.word = customWord(this.customText)
      this.palette = []
    } else {
      const items = await this.listItems()
      const picked = pickDrawWord(items, this.variant, usedWordIds, rng)
      if (!picked) throw new Error('系统词库里没有可用的词')
      if (picked.item) usedWordIds.add(picked.item.id)
      this.word = picked.word
      this.palette =
        this.variant === 'emoji' ? pickEmojiPalette(rng, { exclude: picked.word.emoji ? [picked.word.emoji] : [] }) : []
    }
    // 换一块干净画布；引擎的 seq 继续递增
    this.actor.reset()
    this.viewer.reset()
    this.guesses = []
    // 答案先记下来：到点没交画，揭晓时也要把答案给出来
    this.answers[this.painterId()] = this.word?.word ?? ''
    const startedAt = this.now()
    this.startedAt = startedAt
    this.endsAt = startedAt + DRAW_SECONDS * 1000
    this.phase = 'drawing'
    this.emit()
  }

  /** 这一张画完 → 揭晓 8 秒（答案和评分公开，可以送花点差评），之后才换人 */
  private enterReveal(): void {
    this.revealEndsAt = this.now() + REVEAL_SECONDS * 1000
    this.phase = 'reveal'
    this.emit()
  }

  /** 轮到下一位；没人了就结算 */
  private async advance(): Promise<void> {
    if (this.roundIndex + 1 >= this.players.length) {
      this.phase = 'ended'
      this.endsAt = 0
      this.revealEndsAt = 0
      this.emit()
      return
    }
    this.roundIndex += 1
    await this.openRound()
  }

  private async emit(): Promise<void> {
    if (this.listeners.size === 0) return
    const view = await this.view()
    for (const fn of [...this.listeners]) fn(view)
  }
}

let current: LocalDrawRoomBackend | null = null

export function currentDrawRoom(): LocalDrawRoomBackend | null {
  return current
}

export async function startLocalDrawRoom(options: LocalDrawRoomOptions): Promise<LocalDrawRoomBackend> {
  const room = new LocalDrawRoomBackend(options)
  await room.start()
  current = room
  return room
}

export function disposeDrawRoom(room: LocalDrawRoomBackend | null = current): void {
  if (!room) return
  room.dispose()
  if (current === room) current = null
}
