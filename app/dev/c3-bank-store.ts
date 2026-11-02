import { createSeededRepository } from '../src/modules/bank/seed'
import type { BankRepository, BankSnapshot } from '../src/modules/bank/repository'
import { filterPairs } from '../src/modules/bank/language'
import type { WordLanguage } from '../src/modules/bank/language'
import type { BankItem } from '../src/modules/bank/types'
import { itemKey } from '../src/modules/bank/validate'
import { UcError } from '../src/modules/undercover/errors'

export class C3BankStore {
  readonly repo: ReturnType<typeof createSeededRepository>
  private used = new Set<string>()
  constructor(saved?: unknown, persist?: (data: BankSnapshot) => void) {
    this.repo = createSeededRepository({ onChange: () => persist?.(this.repo.snapshot()) })
    if (saved) this.repo.restore(saved)
  }
  async pool(language: WordLanguage, variant: 'classic' | 'draw', bankIds = ['sys_undercover']) {
    if (!['zh', 'en'].includes(language) || !bankIds.length) throw new UcError('BAD_PAIR', '请选择语言和至少一个词库')
    const all: BankItem[] = []
    for (const id of bankIds) {
      let bank
      try { bank = await this.repo.getBank(id) } catch { throw new UcError('BAD_PAIR', '所选题库已删除，请回到设置重新选择') }
      if (bank.gameType !== 'undercover') throw new UcError('BAD_PAIR', '请选择卧底词对题库')
      all.push(...await this.repo.listItems(id))
    }
    const unique = new Map(filterPairs(all, language, variant === 'draw').map(item => [itemKey('undercover', item.content), item]))
    if (!unique.size) throw new UcError('BAD_PAIR', '所选题库没有该语言的可用词对；融合玩法还要求标记为可画')
    return [...unique.values()]
  }
  pick(pool: BankItem<'undercover'>[], random: () => number) {
    let choices = pool.filter(item => !this.used.has(itemKey('undercover', item.content)))
    const recycled = !choices.length
    if (recycled) { for (const item of pool) this.used.delete(itemKey('undercover', item.content)); choices = pool }
    const item = choices[Math.floor(random() * choices.length)]
    this.used.add(itemKey('undercover', item.content))
    return { pair: { civilian: item.content.civilian, undercover: item.content.undercover }, notice: recycled ? '该筛选范围已抽完，已重新洗牌。' : '' }
  }
  async invoke(operation: string, args: unknown[]) {
    const allowed = ['listBanks','getBank','listItems','createBank','updateBank','deleteBank','addItems','updateItem','deleteItem']
    if (!allowed.includes(operation) || !Array.isArray(args)) throw new UcError('BAD_REQUEST', '无效题库操作')
    // 开发工作区所有浏览器共用一个编辑身份；生产身份/RLS由A装配。
    const actorIndex: Record<string, number> = { listBanks: 0, createBank: 1, updateBank: 2, deleteBank: 1, addItems: 2, updateItem: 2, deleteItem: 1 }
    if (operation in actorIndex) args[actorIndex[operation]] = 'local-host'
    return (this.repo[operation as keyof BankRepository] as (...values: unknown[]) => unknown).apply(this.repo, args)
  }
}
