import { shuffle } from '../shared/random'
import type { Rng } from '../shared/random'
import type { BankItem, PairContent } from './types'

export interface PickResult<T> {
  items: T[]
  /** 没用过的不够了，混进了用过的 */
  recycled: boolean
}

/** 同一个房间里优先抽没出过的题；全用完才重复 */
export function pickItems<T extends { id: string }>(
  pool: readonly T[],
  n: number,
  usedIds: ReadonlySet<string>,
  rng: Rng,
): PickResult<T> {
  if (n <= 0 || pool.length === 0) return { items: [], recycled: false }
  const fresh = shuffle(
    pool.filter((i) => !usedIds.has(i.id)),
    rng,
  )
  if (fresh.length >= n) return { items: fresh.slice(0, n), recycled: false }
  const reused = shuffle(
    pool.filter((i) => usedIds.has(i.id)),
    rng,
  )
  return { items: [...fresh, ...reused].slice(0, n), recycled: reused.length > 0 }
}

/** 抽一对卧底词；融合玩法只抽能画的 */
export function pickUndercoverPair(
  pool: readonly BankItem<'undercover'>[],
  usedIds: ReadonlySet<string>,
  rng: Rng,
  options: { drawableOnly?: boolean } = {},
): { item: BankItem<'undercover'>; pair: Pick<PairContent, 'civilian' | 'undercover'> } | null {
  const candidates = options.drawableOnly ? pool.filter((i) => i.content.drawable) : pool
  const [item] = pickItems(candidates, 1, usedIds, rng).items
  if (!item) return null
  return { item, pair: { civilian: item.content.civilian, undercover: item.content.undercover } }
}
