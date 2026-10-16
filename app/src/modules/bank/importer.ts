import { CsvError, parseCsv, toCsv, unescapeCell } from './csv'
import { GAME_TYPES, GAME_TYPE_LABEL } from './types'
import type { BankMeta, GameType, ItemDraft } from './types'
import { LIMITS, cleanText, itemKey, validateDraft } from './validate'

type Column = 'word' | 'hint' | 'emoji' | 'civilian' | 'undercover' | 'drawable' | 'text' | 'tags' | 'difficulty'

const COLUMNS: Record<GameType, Column[]> = {
  draw: ['word', 'hint', 'emoji', 'tags', 'difficulty'],
  undercover: ['civilian', 'undercover', 'drawable', 'tags', 'difficulty'],
  truth: ['text', 'tags', 'difficulty'],
  dare: ['text', 'tags', 'difficulty'],
}

const REQUIRED: Record<GameType, Column[]> = {
  draw: ['word'],
  undercover: ['civilian', 'undercover'],
  truth: ['text'],
  dare: ['text'],
}

/** 导出和模板用第一个（中文）列名，导入时都认 */
const ALIASES: Record<Column, string[]> = {
  word: ['词语', 'word', '词', '题目'],
  hint: ['提示', 'hint'],
  emoji: ['emoji', '表情'],
  civilian: ['平民词', 'civilian', '平民'],
  undercover: ['卧底词', 'undercover', '卧底'],
  drawable: ['可画', 'drawable', '能画'],
  text: ['内容', 'text', '题目', '问题'],
  tags: ['标签', 'tags', '分类'],
  difficulty: ['难度', 'difficulty'],
}

const EXAMPLES: Record<GameType, Partial<Record<Column, string>>[]> = {
  draw: [
    { word: '长颈鹿', hint: '动物', emoji: '🦒', tags: '动物', difficulty: '1' },
    { word: '火锅', hint: '', emoji: '🍲', tags: '食物|冬天', difficulty: '2' },
  ],
  undercover: [
    { civilian: '苹果', undercover: '梨', drawable: '是', tags: '食物', difficulty: '1' },
    { civilian: '图书馆', undercover: '自习室', drawable: '否', tags: '校园', difficulty: '2' },
  ],
  truth: [{ text: '你来这个社团最想认识什么样的人？', tags: '破冰', difficulty: '1' }],
  dare: [{ text: '用三个词介绍你右边的人', tags: '破冰', difficulty: '1' }],
}

export const JSON_FORMAT = 'pobingju-bank'
export const JSON_VERSION = 1

export interface ImportIssue {
  /** CSV 为文件行号；JSON 为第几条 */
  row: number
  message: string
}

export interface ImportReport {
  drafts: ItemDraft[]
  errors: ImportIssue[]
  /** 和已有题目或文件内重复而跳过的条数 */
  duplicates: number
  /** 文件级问题（编码、格式、列名、条数），有它时 drafts 为空 */
  fatal: string | null
  /** JSON 文件自带的题库名称和简介 */
  meta?: Partial<BankMeta>
}

const fatalReport = (fatal: string): ImportReport => ({ drafts: [], errors: [], duplicates: 0, fatal })

function precheck(text: string): string | null {
  if (text.length > LIMITS.importChars) return '文件太大了（上限约 200KB），请拆成几个文件导入'
  if (text.includes('�')) return '文件不是 UTF-8 编码。用 Excel 时请「另存为 → CSV UTF-8（逗号分隔）」'
  return null
}

function collect(
  gameType: GameType,
  rows: { row: number; raw: { content: unknown; tags?: unknown; difficulty?: unknown } }[],
  existingKeys: ReadonlySet<string>,
): Omit<ImportReport, 'fatal'> {
  const drafts: ItemDraft[] = []
  const errors: ImportIssue[] = []
  const seen = new Set(existingKeys)
  let duplicates = 0
  for (const { row, raw } of rows) {
    const r = validateDraft(gameType, raw)
    if (!r.ok) {
      errors.push({ row, message: r.error })
      continue
    }
    const key = itemKey(gameType, r.value.content)
    if (seen.has(key)) {
      duplicates++
      continue
    }
    seen.add(key)
    drafts.push(r.value)
  }
  return { drafts, errors, duplicates }
}

export function importCsv(gameType: GameType, text: string, existingKeys: ReadonlySet<string> = new Set()): ImportReport {
  const pre = precheck(text)
  if (pre) return fatalReport(pre)
  let rows
  try {
    rows = parseCsv(text)
  } catch (e) {
    return fatalReport(e instanceof CsvError ? e.message : 'CSV 格式不对')
  }
  if (rows.length < 2) return fatalReport('文件里没有题目。第一行是列名，从第二行开始写题目')

  const header = rows[0].cells.map((h) => cleanText(h).toLowerCase())
  const index = new Map<Column, number>()
  for (const col of COLUMNS[gameType]) {
    const at = header.findIndex((h) => ALIASES[col].includes(h))
    if (at >= 0) index.set(col, at)
  }
  const missing = REQUIRED[gameType].filter((c) => !index.has(c))
  if (missing.length > 0) {
    return fatalReport(`缺少「${missing.map((c) => ALIASES[c][0]).join('」「')}」列，请下载${GAME_TYPE_LABEL[gameType]}模板对照`)
  }
  const data = rows.slice(1)
  if (data.length > LIMITS.itemsPerImport) return fatalReport(`一次最多导入 ${LIMITS.itemsPerImport} 条`)

  const cell = (cells: string[], col: Column) => {
    const at = index.get(col)
    return at === undefined ? '' : unescapeCell(cells[at] ?? '')
  }
  const parsed = data.map(({ line, cells }) => {
    const content: Record<string, string> = {}
    for (const col of COLUMNS[gameType]) {
      if (col !== 'tags' && col !== 'difficulty') content[col] = cell(cells, col)
    }
    return { row: line, raw: { content, tags: cell(cells, 'tags'), difficulty: cell(cells, 'difficulty') } }
  })
  return { ...collect(gameType, parsed, existingKeys), fatal: null }
}

export function importJson(gameType: GameType, text: string, existingKeys: ReadonlySet<string> = new Set()): ImportReport {
  const pre = precheck(text)
  if (pre) return fatalReport(pre)
  let doc: unknown
  try {
    doc = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text)
  } catch {
    return fatalReport('不是有效的 JSON 文件')
  }

  let items: unknown[]
  let meta: Partial<BankMeta> | undefined
  if (Array.isArray(doc)) {
    items = doc
  } else if (doc && typeof doc === 'object' && Array.isArray((doc as { items?: unknown }).items)) {
    const d = doc as { gameType?: unknown; name?: unknown; description?: unknown; items: unknown[] }
    if (typeof d.gameType === 'string' && d.gameType !== gameType) {
      const label = GAME_TYPES.includes(d.gameType as GameType) ? GAME_TYPE_LABEL[d.gameType as GameType] : d.gameType
      return fatalReport(`这是「${label}」题库，不能导入到「${GAME_TYPE_LABEL[gameType]}」`)
    }
    items = d.items
    meta = { name: cleanText(d.name) || undefined, description: cleanText(d.description) || undefined }
  } else {
    return fatalReport('JSON 里找不到题目列表（items）')
  }
  if (items.length > LIMITS.itemsPerImport) return fatalReport(`一次最多导入 ${LIMITS.itemsPerImport} 条`)

  // 每条可以是 { content, tags, difficulty }，也可以直接把内容字段写在外层
  const parsed = items.map((it, i) => {
    const o = (it && typeof it === 'object' ? it : {}) as Record<string, unknown>
    const content = o.content && typeof o.content === 'object' ? o.content : o
    return { row: i + 1, raw: { content, tags: o.tags, difficulty: o.difficulty } }
  })
  return { ...collect(gameType, parsed, existingKeys), fatal: null, ...(meta ? { meta } : {}) }
}

function draftToRow(gameType: GameType, d: ItemDraft): string[] {
  const c = d.content as unknown as Record<string, unknown>
  return COLUMNS[gameType].map((col) => {
    if (col === 'tags') return d.tags.join('|')
    if (col === 'difficulty') return String(d.difficulty)
    if (col === 'drawable') return c.drawable === undefined ? '' : c.drawable ? '是' : '否'
    return c[col] === undefined ? '' : String(c[col])
  })
}

export function exportCsv(gameType: GameType, drafts: readonly ItemDraft[]): string {
  const header = COLUMNS[gameType].map((c) => ALIASES[c][0])
  return toCsv([header, ...drafts.map((d) => draftToRow(gameType, d))])
}

export function exportJson(meta: BankMeta, drafts: readonly ItemDraft[]): string {
  return JSON.stringify(
    {
      format: JSON_FORMAT,
      version: JSON_VERSION,
      gameType: meta.gameType,
      name: meta.name,
      description: meta.description,
      items: drafts.map((d) => ({ content: d.content, tags: d.tags, difficulty: d.difficulty })),
    },
    null,
    2,
  )
}

export function csvTemplate(gameType: GameType): string {
  const cols = COLUMNS[gameType]
  return toCsv([cols.map((c) => ALIASES[c][0]), ...EXAMPLES[gameType].map((ex) => cols.map((c) => ex[c] ?? ''))])
}
