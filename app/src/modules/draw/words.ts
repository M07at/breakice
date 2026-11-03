/**
 * 题面与调色板。B 不拥有题库：词从 C 的 bank 模块抽（`qb_pick_items(room_id,'draw',...)`），
 * 这里只负责「按版本挑合适的词」和界面要用的常量。
 */
import { pickItems } from '../bank'
import type { BankItem } from '../bank'
import { randomInt, shuffle } from '../shared/random'
import type { Rng } from '../shared/random'
import type { DrawVariant, DrawWord } from './types'

export const DRAW_VARIANT_LABEL: Record<DrawVariant, string> = {
  classic: '常规版',
  emoji: 'Emoji 版',
  custom: '自定义版',
}

export const DRAW_VARIANT_HINT: Record<DrawVariant, string> = {
  classic: '自由画，想怎么画怎么画',
  emoji: '只能贴 emoji 贴纸，不许用画笔',
  custom: '题面由房主给文字或图片',
}

/** 画笔颜色，16 种，界面上排两行。白色可以当橡皮：画布底色是白的 */
export const BRUSH_COLORS = [
  '#000000',
  '#6b7280',
  '#a16207',
  '#d93025',
  '#f97316',
  '#facc15',
  '#84cc16',
  '#16a34a',
  '#0d9488',
  '#06b6d4',
  '#2563eb',
  '#4f46e5',
  '#7c3aed',
  '#db2777',
  '#f9a8d4',
  '#ffffff',
] as const

export const BRUSH_WIDTHS = [2, 4, 8, 16] as const

/**
 * Emoji 版的贴纸池。**不是每回合全给**——每回合从这里随机抽 10–20 个（`pickEmojiPalette`）。
 *
 * 全给的话每个人都一样，玩两局就腻；随机抽还有个额外好处：同一道题两次玩，
 * 手上有什么贴纸不一样，画出来也不一样。
 */
const EMOJI_POOL_RAW: readonly string[] = [
  // 表情
  '😀', '😃', '😄', '😁', '😆', '😅', '😂', '🤣', '😊', '😇',
  '🙂', '😉', '😍', '🥰', '😘', '😋', '😛', '😜', '🤪', '😝',
  '🤗', '🤭', '🤔', '😐', '😏', '😒', '😞', '😔', '😟', '😕',
  '🙁', '😣', '😖', '😫', '😩', '🥺', '😢', '😭', '😤', '😠',
  '😡', '🤯', '😳', '🥵', '🥶', '😱', '😨', '😰', '😥', '😴',
  '🤤', '😪', '🤢', '🤮', '🥳', '😎', '🤓', '🧐', '👻', '💀',
  '👽', '🤖', '🎃', '😈', '👿', '💩', '🙈', '🙉', '🙊',
  // 动物
  '🐶', '🐱', '🐭', '🐹', '🐰', '🦊', '🐻', '🐼', '🐨', '🐯',
  '🦁', '🐮', '🐷', '🐸', '🐵', '🐔', '🐧', '🐦', '🐤', '🦆',
  '🦅', '🦉', '🦇', '🐺', '🐗', '🐴', '🦄', '🐝', '🐛', '🦋',
  '🐌', '🐞', '🐜', '🕷', '🐢', '🐍', '🦎', '🐙', '🦑', '🦐',
  '🦀', '🐡', '🐠', '🐟', '🐬', '🐳', '🐋', '🦈', '🐊', '🦓',
  '🦍', '🐘', '🦛', '🦏', '🐪', '🐫', '🦒', '🦘', '🐄', '🐎',
  '🐖', '🐏', '🐑', '🦌', '🐕', '🐈', '🐓', '🦃', '🦚', '🦜',
  '🦢', '🕊', '🐇', '🦔', '🐿',
  // 吃的
  '🍏', '🍎', '🍐', '🍊', '🍋', '🍌', '🍉', '🍇', '🍓', '🍒',
  '🍑', '🍍', '🥥', '🥝', '🍅', '🥑', '🥦', '🥒', '🌽', '🥕',
  '🥔', '🍠', '🍞', '🥖', '🧀', '🥚', '🍳', '🥞', '🍔', '🍟',
  '🍕', '🌭', '🥪', '🌮', '🌯', '🥗', '🍝', '🍜', '🍲', '🍣',
  '🍱', '🥟', '🍤', '🍙', '🍚', '🍡', '🍧', '🍨', '🍦', '🥧',
  '🍰', '🎂', '🍭', '🍬', '🍫', '🍿', '🍩', '🍪', '☕', '🍵',
  '🍺', '🍻', '🍷', '🍹', '🥤',
  // 自然与天气
  '🌞', '🌙', '⭐', '🌟', '✨', '⚡', '🔥', '💥', '🌈', '☀️',
  '⛅', '☁️', '🌧️', '⛈️', '❄️', '⛄', '💧', '🌊', '🌫️', '🌪️',
  '🌱', '🌿', '☘️', '🍀', '🍃', '🍂', '🍁', '🌾', '🌵', '🌴',
  '🌳', '🌲', '🌸', '🌻', '🌹', '🌷', '💐',
  // 用品与运动
  '⚽', '🏀', '🏈', '⚾', '🎾', '🏐', '🎱', '🏓', '🏸', '⛳',
  '🎣', '🥊', '🛹', '🎿', '🎯', '🎲', '🎮', '🧩', '🎨', '🎭',
  '🎬', '🎤', '🎧', '🎼', '🎹', '🥁', '🎷', '🎺', '🎸', '🎻',
  '📱', '💻', '⌨️', '💡', '🔦', '🕯️', '📷', '📺', '⏰', '⌛',
  '🔋', '💰', '💳', '🔧', '🔨', '⚙️', '📎', '📌', '✂️', '✏️',
  '🖊️', '🖌️', '📏', '🗑️', '🔒', '🔑', '🚪', '🛏️', '🛋️', '🚿',
  '🛁', '🧴', '🧻', '🧹', '🧺', '🧼',
  // 交通与建筑
  '🚗', '🚕', '🚙', '🚌', '🚎', '🚓', '🚑', '🚒', '🚚', '🚜',
  '🛵', '🏍️', '🚲', '🛴', '🚨', '🚄', '🚂', '🚇', '✈️', '🚀',
  '🚁', '🛶', '⛵', '🚤', '🛳️', '🚢', '⚓', '🚧', '⛽', '🗺️',
  '🗿', '🗽', '🗼', '🏰', '🎡', '🎢', '🎠', '⛲', '🏖️', '🏝️',
  '🌋', '⛰️', '🏔️', '🏕️', '🏠', '🏡', '🏢', '🏦', '🏨', '🏫',
  '⛪', '🕌', '⛩️',
  // 符号与物件
  '❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '💔', '💕', '💖',
  '💘', '💝', '🎁', '🎈', '🎉', '🎊', '🕯️', '🧸', '🎀', '🔔',
  '📚', '📖', '📝', '✉️', '📦', '🧲', '🔍', '🔭', '🔬', '💊',
  '💉', '🧬', '🧪', '🩺', '🪑', '🪟', '🧯', '🗂️', '💼', '🎓',
]

/**
 * Emoji 版的贴纸池（已去重）：每回合从这里随机抽 10–20 个。
 *
 * 全部给的话每个人都一样，玩两局就腻了；随机抽还有个额外好处：
 * 同一道题两次玩，手上有什么贴纸不一样，画出来也不一样。
 */
export const EMOJI_POOL: readonly string[] = [...new Set(EMOJI_POOL_RAW)]

export interface EmojiPaletteOptions {
  /** 抽几个。不填就随机 10–20 个 */
  count?: number
  /** 一定不要出现的贴纸，比如这道题的答案 emoji——否则贴一下就猜中了 */
  exclude?: readonly string[]
}

/**
 * 每回合随机抽一份贴纸面板。
 * 用同一个 rng 就能复现（服务端要重放的时候用得上）。
 */
export function pickEmojiPalette(rng: Rng, options: EmojiPaletteOptions = {}): string[] {
  const banned = new Set((options.exclude ?? []).filter(Boolean))
  const pool = EMOJI_POOL.filter((emoji) => !banned.has(emoji))
  if (pool.length === 0) return []
  // 10–20 个，不能用同一个 rng 抽两次（会偏），所以先定数量再洗牌
  const wanted = options.count ?? 10 + randomInt(rng, 11)
  const count = Math.max(1, Math.min(wanted, pool.length))
  return shuffle(pool, rng).slice(0, count)
}

export interface PickedWord {
  /** 出自哪个题库题目；自定义题面时为 null */
  item: BankItem<'draw'> | null
  word: DrawWord
}

/**
 * 按版本抽一道题。
 * - 三个版本都从**整个词库**里抽，不按 emoji 字段过滤：Emoji 版只是「画法受限」，
 *   题面不该因此变窄（以前只抽带 emoji 的 164 个词，是错的）
 * - `emoji` 字段现在只有一个用途：把这道题的 emoji 从贴纸面板里剔掉（见 `pickEmojiPalette`）
 * - 自定义版不抽词，题面由房主给，这里返回 null
 * 同一房间不重复由 usedIds 保证，和 C 的抽题规则一致。
 */
export function pickDrawWord(
  pool: readonly BankItem<'draw'>[],
  variant: DrawVariant,
  usedIds: ReadonlySet<string>,
  rng: Rng,
): PickedWord | null {
  if (variant === 'custom') return null
  const [item] = pickItems(pool, 1, usedIds, rng).items
  if (!item) return null
  return {
    item,
    word: {
      word: item.content.word,
      ...(item.content.hint ? { hint: item.content.hint } : {}),
      ...(item.content.emoji ? { emoji: item.content.emoji } : {}),
    },
  }
}

/** 自定义版：房主给的文字题面 */
export function customWord(text: string, imageRef?: string): DrawWord {
  const trimmed = text.trim()
  return {
    word: trimmed || '自定义题面',
    custom: imageRef ? { type: 'image', text: trimmed, imageRef } : { type: 'text', text: trimmed },
  }
}
