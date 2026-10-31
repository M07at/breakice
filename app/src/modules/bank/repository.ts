import { GAME_TYPES } from './types'
import type { Bank, BankItem, BankMeta, GameType, ItemDraft } from './types'
import { itemKey, validateBankMeta, validateDraft } from './validate'

export type BankErrorCode = 'NOT_FOUND' | 'READ_ONLY' | 'NOT_OWNER' | 'INVALID'

export class BankError extends Error {
  readonly code: BankErrorCode

  constructor(code: BankErrorCode, message: string) {
    super(message)
    this.name = 'BankError'
    this.code = code
  }
}

/**
 * C 的题库页面和 B、D 的抽题都只依赖这个接口。
 * 现在用 MemoryBankRepository；接入 A 的数据库后换成 Supabase 实现（权限由 RLS 兜底）。
 */
export interface BankRepository {
  /** 系统题库 + viewerId 自己的私有题库 */
  listBanks(viewerId: string | null, gameType?: GameType): Promise<Bank[]>
  getBank(bankId: string): Promise<Bank>
  listItems(bankId: string): Promise<BankItem[]>
  createBank(meta: BankMeta, ownerId: string): Promise<Bank>
  updateBank(bankId: string, patch: { name?: string; description?: string }, actorId: string): Promise<Bank>
  deleteBank(bankId: string, actorId: string): Promise<void>
  /** 和题库里已有的重复的会跳过 */
  addItems(bankId: string, drafts: ItemDraft[], actorId: string): Promise<{ added: BankItem[]; duplicates: number }>
  updateItem(itemId: string, draft: ItemDraft, actorId: string): Promise<BankItem>
  deleteItem(itemId: string, actorId: string): Promise<void>
}

export interface MemoryRepositoryOptions {
  clock?: () => Date
  /** 自建题库有任何改动后调用，单机模式用它把题库存到手机上 */
  onChange?: () => void
}

/** 自建题库的存档（系统题库不存，每次从代码加载） */
export interface BankSnapshot {
  version: 1
  seq: number
  banks: Bank[]
  items: BankItem[]
}

export class MemoryBankRepository implements BankRepository {
  private banks = new Map<string, Bank>()
  private items = new Map<string, BankItem>()
  private seq = 1
  private readonly clock: () => Date
  private readonly onChange?: () => void

  constructor(options: MemoryRepositoryOptions = {}) {
    this.clock = options.clock ?? (() => new Date())
    this.onChange = options.onChange
  }

  /** 预置系统题库（真实环境由迁移脚本写入）。ID 固定为 sys_<游戏>，和自建题库永不冲突 */
  seedSystemBank(meta: BankMeta, drafts: ItemDraft[]): Bank {
    let id = `sys_${meta.gameType}`
    for (let n = 2; this.banks.has(id); n++) id = `sys_${meta.gameType}_${n}`
    const now = this.now()
    const bank: Bank = { id, ...meta, visibility: 'system', ownerId: null, createdAt: now, updatedAt: now }
    this.banks.set(id, bank)
    drafts.forEach((d, i) => this.items.set(`${id}_${i + 1}`, { id: `${id}_${i + 1}`, bankId: id, ...d }))
    return bank
  }

  snapshot(): BankSnapshot {
    const banks = [...this.banks.values()].filter((b) => b.visibility === 'private')
    const ids = new Set(banks.map((b) => b.id))
    return { version: 1, seq: this.seq, banks, items: [...this.items.values()].filter((i) => ids.has(i.bankId)) }
  }

  /** 恢复自建题库；数据不对的条目直接跳过，不影响系统题库。返回恢复了几个题库 */
  restore(raw: unknown): number {
    const snap = raw as Partial<BankSnapshot> | null
    if (!snap || snap.version !== 1 || !Array.isArray(snap.banks) || !Array.isArray(snap.items)) return 0
    const restored = new Set<string>()
    for (const b of snap.banks) {
      if (!b || b.visibility !== 'private' || !GAME_TYPES.includes(b.gameType) || this.banks.has(b.id)) continue
      if (!validateBankMeta(b).ok || typeof b.ownerId !== 'string') continue
      this.banks.set(b.id, { ...b })
      restored.add(b.id)
    }
    for (const it of snap.items) {
      const bank = it && this.banks.get(it.bankId)
      if (!bank || !restored.has(bank.id) || this.items.has(it.id)) continue
      const r = validateDraft(bank.gameType, it)
      if (r.ok) this.items.set(it.id, { id: it.id, bankId: bank.id, ...r.value })
    }
    this.seq = Math.max(this.seq, Number(snap.seq) || 0)
    return restored.size
  }

  async listBanks(viewerId: string | null, gameType?: GameType) {
    return [...this.banks.values()].filter(
      (b) => (!gameType || b.gameType === gameType) && (b.visibility === 'system' || b.ownerId === viewerId),
    )
  }

  async getBank(bankId: string) {
    const bank = this.banks.get(bankId)
    if (!bank) throw new BankError('NOT_FOUND', '题库不存在或已删除')
    return bank
  }

  async listItems(bankId: string) {
    await this.getBank(bankId)
    return [...this.items.values()].filter((i) => i.bankId === bankId)
  }

  async createBank(meta: BankMeta, ownerId: string) {
    const r = validateBankMeta(meta)
    if (!r.ok) throw new BankError('INVALID', r.error)
    const now = this.now()
    const bank: Bank = {
      id: `bank_${this.seq++}`,
      ...r.value,
      visibility: 'private',
      ownerId,
      createdAt: now,
      updatedAt: now,
    }
    this.banks.set(bank.id, bank)
    this.changed()
    return bank
  }

  async updateBank(bankId: string, patch: { name?: string; description?: string }, actorId: string) {
    const bank = await this.writable(bankId, actorId)
    const r = validateBankMeta({
      name: patch.name ?? bank.name,
      description: patch.description ?? bank.description,
      gameType: bank.gameType,
    })
    if (!r.ok) throw new BankError('INVALID', r.error)
    const updated: Bank = { ...bank, name: r.value.name, description: r.value.description, updatedAt: this.now() }
    this.banks.set(bankId, updated)
    this.changed()
    return updated
  }

  async deleteBank(bankId: string, actorId: string) {
    await this.writable(bankId, actorId)
    this.banks.delete(bankId)
    for (const [id, item] of this.items) if (item.bankId === bankId) this.items.delete(id)
    this.changed()
  }

  async addItems(bankId: string, drafts: ItemDraft[], actorId: string) {
    const bank = await this.writable(bankId, actorId)
    const keys = new Set((await this.listItems(bankId)).map((i) => itemKey(bank.gameType, i.content)))
    const added: BankItem[] = []
    let duplicates = 0
    for (const draft of drafts) { const checked = validateDraft(bank.gameType, draft); if (!checked.ok) throw new BankError('INVALID', checked.error) }
    for (const d of drafts) {
      const r = validateDraft(bank.gameType, d)
      if (!r.ok) throw new BankError('INVALID', r.error)
      const key = itemKey(bank.gameType, r.value.content)
      if (keys.has(key)) {
        duplicates++
        continue
      }
      keys.add(key)
      const item: BankItem = { id: `item_${this.seq++}`, bankId, ...r.value }
      this.items.set(item.id, item)
      added.push(item)
    }
    if (added.length > 0) this.changed()
    return { added, duplicates }
  }

  async updateItem(itemId: string, draft: ItemDraft, actorId: string) {
    const item = this.items.get(itemId)
    if (!item) throw new BankError('NOT_FOUND', '题目不存在或已删除')
    const bank = await this.writable(item.bankId, actorId)
    const r = validateDraft(bank.gameType, draft)
    if (!r.ok) throw new BankError('INVALID', r.error)
    if ([...this.items.values()].some(other => other.bankId === item.bankId && other.id !== itemId && itemKey(bank.gameType, other.content) === itemKey(bank.gameType, r.value.content))) throw new BankError('INVALID', '这道题已经有了')
    const updated: BankItem = { ...item, ...r.value }
    this.items.set(itemId, updated)
    this.changed()
    return updated
  }

  async deleteItem(itemId: string, actorId: string) {
    const item = this.items.get(itemId)
    if (!item) throw new BankError('NOT_FOUND', '题目不存在或已删除')
    await this.writable(item.bankId, actorId)
    this.items.delete(itemId)
    this.changed()
  }

  private async writable(bankId: string, actorId: string) {
    const bank = await this.getBank(bankId)
    if (bank.visibility === 'system') throw new BankError('READ_ONLY', '系统题库不能修改，可以导出后另建一个')
    if (bank.ownerId !== actorId) throw new BankError('NOT_OWNER', '只能修改自己创建的题库')
    return bank
  }

  private changed() {
    this.onChange?.()
  }

  private now() {
    return this.clock().toISOString()
  }
}
