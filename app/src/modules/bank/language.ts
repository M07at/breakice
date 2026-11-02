import type { BankItem, ItemDraft, PairContent } from './types'
export type WordLanguage = 'zh' | 'en'
export function languageOf(item: ItemDraft): WordLanguage {
  const content = item.content as Partial<PairContent>
  return item.tags.includes('lang:en') ? 'en' : item.tags.includes('lang:zh') ? 'zh' : /[\u3400-\u9fff]/.test(content.civilian ?? '') ? 'zh' : 'en'
}
export function filterPairs(items: BankItem[], language: WordLanguage, drawable = false) {
  return items.filter(item => languageOf(item) === language && (!drawable || (item.content as PairContent).drawable)) as BankItem<'undercover'>[]
}
