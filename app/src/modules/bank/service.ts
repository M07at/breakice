import { exportCsv, exportJson, importCsv, importJson } from './importer'
import type { ImportReport } from './importer'
import type { BankRepository } from './repository'
import type { BankItem, ItemDraft } from './types'
import { itemKey } from './validate'

export type FileFormat = 'csv' | 'json'

export function draftsOf(items: readonly BankItem[]): ItemDraft[] {
  return items.map(({ content, tags, difficulty }) => ({ content, tags, difficulty }))
}

/** 把文件内容导入到题库：先校验和去重，再写入；返回给页面展示的报告 */
export async function importIntoBank(
  repo: BankRepository,
  bankId: string,
  text: string,
  format: FileFormat,
  actorId: string,
): Promise<ImportReport & { added: number }> {
  const bank = await repo.getBank(bankId)
  const existing = new Set((await repo.listItems(bankId)).map((i) => itemKey(bank.gameType, i.content)))
  const report = format === 'csv' ? importCsv(bank.gameType, text, existing) : importJson(bank.gameType, text, existing)
  if (report.fatal || report.drafts.length === 0) return { ...report, added: 0 }
  const { added, duplicates } = await repo.addItems(bankId, report.drafts, actorId)
  return { ...report, duplicates: report.duplicates + duplicates, added: added.length }
}

export async function exportBank(
  repo: BankRepository,
  bankId: string,
  format: FileFormat,
): Promise<{ fileName: string; text: string }> {
  const bank = await repo.getBank(bankId)
  const drafts = draftsOf(await repo.listItems(bankId))
  const text = format === 'csv' ? exportCsv(bank.gameType, drafts) : exportJson(bank, drafts)
  return { fileName: `${bank.name.replace(/[\\/:*?"<>|]/g, '_')}.${format}`, text }
}
