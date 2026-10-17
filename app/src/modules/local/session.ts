/**
 * 单机模式：一部手机轮流扮演所有玩家，用来开发页面和离线演示。
 * 接入 A 的房间后，游戏由大厅开始、题库存到数据库，这个文件只在开发时用。
 */
import { createSeededRepository, pickUndercoverPair } from '../bank'
import type { BankItem, BankRepository } from '../bank'
import { createRng } from '../shared/random'
import { LocalUcBackend } from '../undercover'
import type { Variant } from '../undercover'

/** 单机模式里的「我」：主持人，也是自建题库的主人 */
export const LOCAL_USER_ID = 'local-host'

/** 自建题库存在手机本地；系统题库每次从代码加载，不占存储 */
const BANK_STORAGE_KEY = 'pobingju:my-banks:v1'

let repo: BankRepository | null = null

export function bankRepo(): BankRepository {
  if (repo) return repo
  const seeded = createSeededRepository({
    onChange: () => {
      try {
        uni.setStorageSync(BANK_STORAGE_KEY, JSON.stringify(seeded.snapshot()))
      } catch (e) {
        console.warn('自建题库保存失败', e)
      }
    },
  })
  try {
    const saved = uni.getStorageSync(BANK_STORAGE_KEY)
    if (saved) seeded.restore(JSON.parse(String(saved)))
  } catch (e) {
    console.warn('自建题库读取失败，已忽略', e)
  }
  repo = seeded
  return repo
}

export interface LocalPlayer {
  id: string
  name: string
}

export interface LocalGameOptions {
  playerCount: number
  variant: Variant
  blankEnabled: boolean
  bankIds: string[]
}

export interface LocalGame {
  backend: LocalUcBackend
  gameId: string
  players: LocalPlayer[]
  /** 代替 B 的统一计分：playerId -> 本局得分 */
  scores: Record<string, number>
  options: LocalGameOptions
}

let current: LocalGame | null = null
/** 同一次打开小程序里抽过的词对，下一局不重复 */
const usedPairIds = new Set<string>()

export function currentGame(): LocalGame | null {
  return current
}

export async function startLocalGame(options: LocalGameOptions): Promise<LocalGame> {
  const lists = await Promise.all(options.bankIds.map((id) => bankRepo().listItems(id)))
  const pool = lists.flat() as BankItem<'undercover'>[]
  const rng = createRng(Date.now() >>> 0)
  const picked = pickUndercoverPair(pool, usedPairIds, rng, { drawableOnly: options.variant === 'draw' })
  if (!picked) {
    throw new Error(options.variant === 'draw' ? '选中的题库里没有标了「可画」的词对' : '选中的题库里没有词对')
  }
  usedPairIds.add(picked.item.id)

  const players: LocalPlayer[] = Array.from({ length: options.playerCount }, (_, i) =>
    i === 0 ? { id: LOCAL_USER_ID, name: '我（主持人）' } : { id: `local-${i + 1}`, name: `玩家${i + 1}` },
  )
  const scores: Record<string, number> = {}
  const backend = new LocalUcBackend({
    playerIds: players.map((p) => p.id),
    hostId: LOCAL_USER_ID,
    pickPair: () => picked.pair,
    rng,
    onScore: (e) => {
      scores[e.playerId] = (scores[e.playerId] ?? 0) + e.points
    },
  })
  const { gameId } = await backend.start({
    roomId: 'local',
    variant: options.variant,
    config: { blankEnabled: options.blankEnabled },
  })
  current = { backend, gameId, players, scores, options }
  return current
}
