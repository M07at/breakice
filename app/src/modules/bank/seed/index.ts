import { importJson } from '../importer'
import { MemoryBankRepository } from '../repository'
import type { MemoryRepositoryOptions } from '../repository'
import type { BankMeta, GameType, ItemDraft } from '../types'
import dare from './dare.json'
import drawWords from './draw-words.json'
import truth from './truth.json'
import undercoverPairs from './undercover-pairs.json'

export interface SeedBank {
  meta: BankMeta
  drafts: ItemDraft[]
}

/** 破冰局原创的系统题库，每个游戏一套。改内容直接改同目录的 JSON，格式见 README.md */
const SOURCES: [GameType, unknown][] = [
  ['undercover', undercoverPairs],
  ['draw', drawWords],
  ['truth', truth],
  ['dare', dare],
]

export function loadSystemBanks(): SeedBank[] {
  return SOURCES.map(([gameType, doc]) => {
    const r = importJson(gameType, JSON.stringify(doc))
    if (r.fatal || r.errors.length > 0 || r.duplicates > 0) {
      const detail = r.fatal ?? r.errors.map((e) => `第 ${e.row} 条 ${e.message}`).join('；')
      throw new Error(`系统题库「${gameType}」有问题：${detail || `${r.duplicates} 条重复`}`)
    }
    return {
      meta: { name: r.meta?.name ?? '系统题库', gameType, description: r.meta?.description ?? '' },
      drafts: r.drafts,
    }
  })
}

/** 单机模式和页面开发用：系统题库每次启动从代码加载，自建题库由调用方恢复 */
export function createSeededRepository(options: MemoryRepositoryOptions = {}): MemoryBankRepository {
  const repo = new MemoryBankRepository(options)
  for (const b of loadSystemBanks()) repo.seedSystemBank(b.meta, b.drafts)
  return repo
}
