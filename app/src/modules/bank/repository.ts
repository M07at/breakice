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

export class MemoryBankRepository implements BankRepository {
  private banks = new Map<string, Bank>()
  private items = new Map<string, BankItem>()
  private seq = 1

  constructor(private readonly clock: () => Date = () => new Date()) {}

  /** 预置系统题库（真实环境由迁移脚本写入） */
  seedSystemBank(meta: BankMeta, drafts: ItemDraft[]): Bank {
    const bank = this.insertBank(meta, 'system', null)
    for (const d of drafts) this.insertItem(bank, d)
    return bank
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
    return this.insertBank(r.value, 'private', ownerId)
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
    return updated
  }

  async deleteBank(bankId: string, actorId: string) {
    await this.writable(bankId, actorId)
    this.banks.delete(bankId)
    for (const [id, item] of this.items) if (item.bankId === bankId) this.items.delete(id)
  }

  async addItems(bankId: string, drafts: ItemDraft[], actorId: string) {
    const bank = await this.writable(bankId, actorId)
    const keys = new Set((await this.listItems(bankId)).map((i) => itemKey(bank.gameType, i.content)))
    const added: BankItem[] = []
    let duplicates = 0
    for (const d of drafts) {
      const r = validateDraft(bank.gameType, d)
      if (!r.ok) throw new BankError('INVALID', r.error)
      const key = itemKey(bank.gameType, r.value.content)
      if (keys.has(key)) {
        duplicates++
        continue
      }
      keys.add(key)
      added.push(this.insertItem(bank, r.value))
    }
    return { added, duplicates }
  }

  async updateItem(itemId: string, draft: ItemDraft, actorId: string) {
    const item = this.items.get(itemId)
    if (!item) throw new BankError('NOT_FOUND', '题目不存在或已删除')
    const bank = await this.writable(item.bankId, actorId)
    const r = validateDraft(bank.gameType, draft)
    if (!r.ok) throw new BankError('INVALID', r.error)
    const updated: BankItem = { ...item, ...r.value }
    this.items.set(itemId, updated)
    return updated
  }

  async deleteItem(itemId: string, actorId: string) {
    const item = this.items.get(itemId)
    if (!item) throw new BankError('NOT_FOUND', '题目不存在或已删除')
    await this.writable(item.bankId, actorId)
    this.items.delete(itemId)
  }

  private async writable(bankId: string, actorId: string) {
    const bank = await this.getBank(bankId)
    if (bank.visibility === 'system') throw new BankError('READ_ONLY', '系统题库不能修改，可以导出后另建一个')
    if (bank.ownerId !== actorId) throw new BankError('NOT_OWNER', '只能修改自己创建的题库')
    return bank
  }

  private insertBank(meta: BankMeta, visibility: Bank['visibility'], ownerId: string | null): Bank {
    const now = this.now()
    const bank: Bank = { id: `bank_${this.seq++}`, ...meta, visibility, ownerId, createdAt: now, updatedAt: now }
    this.banks.set(bank.id, bank)
    return bank
  }

  private insertItem(bank: Bank, draft: ItemDraft): BankItem {
    const item: BankItem = { id: `item_${this.seq++}`, bankId: bank.id, ...draft }
    this.items.set(item.id, item)
    return item
  }

  private now() {
    return this.clock().toISOString()
  }
}
