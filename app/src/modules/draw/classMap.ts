/**
 * 中文词 → drawzy 的英文类别。
 *
 * drawzy 的识别模型只认下面这 46 个英文标签（Quick, Draw! 子集，A–bucket），
 * 题库里对不上的词**永远不可能被判为猜中**，所以：
 * - 抽词只从能映射的词里挑（`canScoreWithAi`）
 * - 映射值必须逐字出现在 `DRAWZY_CLASSES` 里
 *
 * 按 Google QuickDraw 类别顺序补上上游遗漏的 aircraft carrier；真实模型有 46 个输出。
 * 服务端 `supabase/functions/ai-score/index.ts` 有一份精简副本，改这里要同步改那边。
 */

/** drawzy 支持的 46 个类别（顺序与训练文件排序一致） */
export const DRAWZY_CLASSES = [
  'aircraft carrier',
  'airplane',
  'alarm clock',
  'ambulance',
  'angel',
  'animal migration',
  'ant',
  'anvil',
  'apple',
  'arm',
  'asparagus',
  'axe',
  'backpack',
  'banana',
  'bandage',
  'barn',
  'baseball bat',
  'baseball',
  'basket',
  'basketball',
  'bat',
  'bathtub',
  'beach',
  'bear',
  'beard',
  'bed',
  'bee',
  'belt',
  'bench',
  'bicycle',
  'binoculars',
  'bird',
  'birthday cake',
  'blackberry',
  'blueberry',
  'book',
  'boomerang',
  'bottlecap',
  'bowtie',
  'bracelet',
  'brain',
  'bread',
  'bridge',
  'broccoli',
  'broom',
  'bucket',
] as const

/**
 * 能画的词 → 英文类别。
 * 优先挑「一个词就对应一个物体」的，尽量避免需要画多步的抽象词。
 */
const WORD_TO_CLASS: Record<string, string> = {
  航空母舰: 'aircraft carrier',
  航母: 'aircraft carrier',
  // 食物
  苹果: 'apple',
  香蕉: 'banana',
  面包: 'bread',
  西兰花: 'broccoli',
  芦笋: 'asparagus',
  蓝莓: 'blueberry',
  黑莓: 'blackberry',
  生日蛋糕: 'birthday cake',
  蛋糕: 'birthday cake',
  // 动物
  蚂蚁: 'ant',
  蜜蜂: 'bee',
  熊: 'bear',
  鸟: 'bird',
  蝙蝠: 'bat',
  // 交通与出行
  飞机: 'airplane',
  救护车: 'ambulance',
  自行车: 'bicycle',
  单车: 'bicycle',
  背包: 'backpack',
  望远镜: 'binoculars',
  // 生活物件
  闹钟: 'alarm clock',
  斧头: 'axe',
  斧子: 'axe',
  绷带: 'bandage',
  棒球: 'baseball',
  棒球棒: 'baseball bat',
  篮球: 'basketball',
  篮子: 'basket',
  浴缸: 'bathtub',
  床: 'bed',
  皮带: 'belt',
  长椅: 'bench',
  书: 'book',
  书本书: 'book',
  回旋镖: 'boomerang',
  瓶盖: 'bottlecap',
  领结: 'bowtie',
  手链: 'bracelet',
  大脑: 'brain',
  桥: 'bridge',
  扫帚: 'broom',
  水桶: 'bucket',
  桶: 'bucket',
  // 身体与他人
  手臂: 'arm',
  天使: 'angel',
  胡子: 'beard',
  // 场景
  海滩: 'beach',
  谷仓: 'barn',
  动物迁徙: 'animal migration',
  铁砧: 'anvil',
}

/**
 * 抽词候选：就是上面这些中文词。
 * 你画我猜只用这批词，保证 AI 评分能判"猜中"。
 */
export const DRAW_WORD_POOL: string[] = Object.keys(WORD_TO_CLASS)

/**
 * 取某个词对应的英文类别。
 * 先查完整映射，再尝试包含关系（最长键优先），都没有返回 null。
 */
export function expectedClassFor(word: string): string | null {
  const text = word.trim()
  if (!text) return null
  const direct = WORD_TO_CLASS[text]
  if (direct) return direct

  const candidates = Object.keys(WORD_TO_CLASS)
    .filter((key) => text.includes(key) || key.includes(text))
    .sort((a, b) => b.length - a.length)
  return candidates.length > 0 ? WORD_TO_CLASS[candidates[0]] : null
}

/** 这个词能不能参与 AI 评分 */
export function canScoreWithAi(word: string): boolean {
  return expectedClassFor(word) !== null
}

/** 从一个词表里筛出能参与 AI 评分的词 */
export function filterScorable(words: readonly string[]): string[] {
  return words.filter((word) => canScoreWithAi(word))
}
