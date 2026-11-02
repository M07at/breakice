import type { BankMeta, ContentByType, Difficulty, GameType, ItemDraft } from './types'

export const LIMITS = {
  wordMax: 12,
  hintMax: 30,
  emojiMax: 8,
  textMin: 2,
  textMax: 100,
  tagMax: 8,
  tagsMax: 5,
  bankNameMax: 20,
  descriptionMax: 100,
  itemsPerImport: 500,
  /** 约 200KB */
  importChars: 200_000,
}

export type Result<T> = { ok: true; value: T } | { ok: false; error: string }

const ok = <T>(value: T): Result<T> => ({ ok: true, value })
const fail = <T>(error: string): Result<T> => ({ ok: false, error })

/** 去掉首尾空白、零宽空格和 BOM，合并连续空白 */
export function cleanText(v: unknown): string {
  if (typeof v !== 'string' && typeof v !== 'number') return ''
  return String(v)
    .normalize('NFC')
    .replace(/[​﻿]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** 按字符算长度，emoji 不会被算成两个 */
export function charLength(s: string): number {
  return Array.from(s).length
}

function requiredText(v: unknown, label: string, max: number, min = 1): Result<string> {
  const s = cleanText(v)
  if (charLength(s) < min) return fail(min > 1 ? `「${label}」至少 ${min} 个字` : `「${label}」不能为空`)
  if (charLength(s) > max) return fail(`「${label}」最多 ${max} 个字`)
  return ok(s)
}

function optionalText(v: unknown, label: string, max: number): Result<string | undefined> {
  const s = cleanText(v)
  if (!s) return ok(undefined)
  if (charLength(s) > max) return fail(`「${label}」最多 ${max} 个字`)
  return ok(s)
}

export function parseDifficulty(v: unknown): Result<Difficulty> {
  const s = cleanText(v).toLowerCase()
  if (s === '') return ok(2)
  if (['1', '易', '简单', 'easy'].includes(s)) return ok(1)
  if (['2', '中', '普通', 'medium', 'normal'].includes(s)) return ok(2)
  if (['3', '难', '困难', 'hard'].includes(s)) return ok(3)
  return fail('「难度」只能填 1、2、3（或 易、中、难）')
}

export function parseTags(v: unknown): Result<string[]> {
  const parts = Array.isArray(v) ? v : cleanText(v).split(/[|、，;；]/)
  const tags: string[] = []
  for (const part of parts) {
    const t = cleanText(part)
    if (!t || tags.includes(t)) continue
    if (charLength(t) > LIMITS.tagMax) return fail(`标签「${t}」太长，最多 ${LIMITS.tagMax} 个字`)
    tags.push(t)
  }
  if (tags.length > LIMITS.tagsMax) return fail(`最多 ${LIMITS.tagsMax} 个标签`)
  return ok(tags)
}

export function parseBool(v: unknown): Result<boolean | undefined> {
  if (typeof v === 'boolean') return ok(v)
  const s = cleanText(v).toLowerCase()
  if (s === '') return ok(undefined)
  if (['1', '是', 'true', 'yes', 'y'].includes(s)) return ok(true)
  if (['0', '否', 'false', 'no', 'n'].includes(s)) return ok(false)
  return fail('「可画」只能填 是 或 否')
}

export function validateContent<T extends GameType>(gameType: T, raw: unknown): Result<ContentByType[T]> {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  switch (gameType) {
    case 'draw': {
      const word = requiredText(r.word, '词语', LIMITS.wordMax)
      if (!word.ok) return word
      const hint = optionalText(r.hint, '提示', LIMITS.hintMax)
      if (!hint.ok) return hint
      const emoji = optionalText(r.emoji, 'emoji', LIMITS.emojiMax)
      if (!emoji.ok) return emoji
      return ok({
        word: word.value,
        ...(hint.value ? { hint: hint.value } : {}),
        ...(emoji.value ? { emoji: emoji.value } : {}),
      } as ContentByType[T])
    }
    case 'undercover': {
      const civilian = requiredText(r.civilian, '平民词', LIMITS.wordMax)
      if (!civilian.ok) return civilian
      const undercover = requiredText(r.undercover, '卧底词', LIMITS.wordMax)
      if (!undercover.ok) return undercover
      if (civilian.value === undercover.value) return fail('平民词和卧底词不能一样')
      const drawable = parseBool(r.drawable)
      if (!drawable.ok) return drawable
      return ok({
        civilian: civilian.value,
        undercover: undercover.value,
        ...(drawable.value !== undefined ? { drawable: drawable.value } : {}),
      } as ContentByType[T])
    }
    default: {
      const text = requiredText(r.text, '内容', LIMITS.textMax, LIMITS.textMin)
      if (!text.ok) return text
      return ok({ text: text.value } as ContentByType[T])
    }
  }
}

export function validateDraft<T extends GameType>(
  gameType: T,
  raw: { content?: unknown; tags?: unknown; difficulty?: unknown },
): Result<ItemDraft<T>> {
  const content = validateContent(gameType, raw.content)
  if (!content.ok) return content
  const tags = parseTags(raw.tags)
  if (!tags.ok) return tags
  if (gameType === 'undercover' && tags.value.some(t => t === 'lang:en' || t === 'lang:zh')) {
    if (tags.value.includes('lang:en') && tags.value.includes('lang:zh')) return fail('同一词对只能指定一种语言')
    const pair = content.value as { civilian: string; undercover: string }
    const han = (text: string) => /[\u3400-\u9fff]/.test(text)
    if (tags.value.includes('lang:en') && (han(pair.civilian) || han(pair.undercover))) return fail('English词对不能包含中文')
    if (tags.value.includes('lang:zh') && (!han(pair.civilian) || !han(pair.undercover))) return fail('中文词对的两端都应包含中文')
  }
  const difficulty = parseDifficulty(raw.difficulty)
  if (!difficulty.ok) return difficulty
  return ok({ content: content.value, tags: tags.value, difficulty: difficulty.value })
}

export function validateBankMeta(raw: { name?: unknown; description?: unknown; gameType: GameType }): Result<BankMeta> {
  const name = requiredText(raw.name, '题库名称', LIMITS.bankNameMax)
  if (!name.ok) return name
  const description = optionalText(raw.description, '简介', LIMITS.descriptionMax)
  if (!description.ok) return description
  return ok({ name: name.value, gameType: raw.gameType, description: description.value ?? '' })
}

/** 去重用的键：词对不分顺序（苹果/梨 = 梨/苹果），文本题忽略大小写、空格和标点 */
export function itemKey(gameType: GameType, content: ContentByType[GameType]): string {
  // 不用 \p{P}：老机型的小程序 JS 引擎不一定支持 Unicode 属性转义
  const norm = (s: string) =>
    s.toLowerCase().replace(/[\s,.!?;:'"()[\]{}<>~`@#$%^&*_+=|\\/\-，。！？；：、“”‘’（）【】《》…—·]/g, '')
  switch (gameType) {
    case 'draw':
      return norm((content as ContentByType['draw']).word)
    case 'undercover': {
      const c = content as ContentByType['undercover']
      return [norm(c.civilian), norm(c.undercover)].sort().join('|')
    }
    default:
      return norm((content as ContentByType['truth']).text)
  }
}
