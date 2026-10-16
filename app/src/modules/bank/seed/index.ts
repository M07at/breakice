import { importJson } from '../importer'
import { MemoryBankRepository } from '../repository'
import type { BankMeta, ItemDraft } from '../types'
import undercoverPairs from './undercover-pairs.json'

export interface SeedBank {
  meta: BankMeta
  drafts: ItemDraft[]
}

/**
 * 系统题库只放 C 自己游戏的词对。你画我猜词库（B）、真心话大冒险题库（D）按同样的 JSON 格式
 * 放进这个目录，再加到下面的列表里即可。
 */
export function loadSystemBanks(): SeedBank[] {
  const r = importJson('undercover', JSON.stringify(undercoverPairs))
  if (r.fatal || r.errors.length > 0) {
    throw new Error(`系统词库有问题：${r.fatal ?? r.errors.map((e) => `第 ${e.row} 条 ${e.message}`).join('；')}`)
  }
  return [
    {
      meta: { name: r.meta?.name ?? '系统词库', gameType: 'undercover', description: r.meta?.description ?? '' },
      drafts: r.drafts,
    },
  ]
}

/** 单机模式和页面开发用 */
export function createSeededRepository(): MemoryBankRepository {
  const repo = new MemoryBankRepository()
  for (const b of loadSystemBanks()) repo.seedSystemBank(b.meta, b.drafts)
  return repo
}
