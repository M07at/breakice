/**
 * 词 → drawzy 的英文类别（Quick, Draw! 45 类）。
 *
 * drawzy 的识别模型只认识英文标签，而我们的题库是中文，所以必须有一层映射，
 * 否则「AI 猜中」永远不成立、所有人都是 0 分。
 *
 * 规则：
 * - 一个中文词映射到一个英文类别；成语取其中**最主要的可画物体**
 * - 映射不到的返回 null，这类词不参与 AI 评分（按「没猜中」处理或直接跳过）
 * - 英文类别必须和 drawzy 的 45 类拼写一致（见 top_five_sketch_classes）
 */

/** drawzy 支持的 45 个类别（Quick, Draw! 子集，拼写以此为准） */
export const DRAWZY_CLASSES = [
  'airplane',
  'alarm clock',
  'apple',
  'axe',
  'banana',
  'bicycle',
  'book',
  'bucket',
  'bus',
  'camera',
  'car',
  'cat',
  'chair',
  'cloud',
  'cup',
  'diamond',
  'dog',
  'door',
  'eye',
  'fish',
  'flower',
  'foot',
  'fork',
  'guitar',
  'hammer',
  'hat',
  'house',
  'key',
  'knife',
  'ladder',
  'leaf',
  'moon',
  'mountain',
  'mushroom',
  'pants',
  'pencil',
  'pig',
  'pizza',
  'scissors',
  'shirt',
  'shoe',
  'spoon',
  'star',
  'sun',
  'tree',
  'umbrella',
  'wheel',
] as const

/** 中文词 → 英文类别。命中不了就返回 null。 */
const WORD_TO_CLASS: Record<string, string> = {
  // 单字 / 日常物体
  苹果: 'apple',
  香蕉: 'banana',
  自行车: 'bicycle',
  单车: 'bicycle',
  书: 'book',
  书本: 'book',
  水桶: 'bucket',
  公交车: 'bus',
  巴士: 'bus',
  相机: 'camera',
  照相机: 'camera',
  汽车: 'car',
  小汽车: 'car',
  猫: 'cat',
  小猫: 'cat',
  椅子: 'chair',
  云: 'cloud',
  白云: 'cloud',
  杯子: 'cup',
  钻石: 'diamond',
  狗: 'dog',
  小狗: 'dog',
  门: 'door',
  眼睛: 'eye',
  鱼: 'fish',
  花: 'flower',
  脚: 'foot',
  叉子: 'fork',
  吉他: 'guitar',
  锤子: 'hammer',
  帽子: 'hat',
  房子: 'house',
  钥匙: 'key',
  刀: 'knife',
  梯子: 'ladder',
  叶子: 'leaf',
  月亮: 'moon',
  山: 'mountain',
  蘑菇: 'mushroom',
  裤子: 'pants',
  铅笔: 'pencil',
  猪: 'pig',
  披萨: 'pizza',
  披萨饼: 'pizza',
  剪刀: 'scissors',
  衬衫: 'shirt',
  鞋: 'shoe',
  鞋子: 'shoe',
  勺子: 'spoon',
  星星: 'star',
  太阳: 'sun',
  树: 'tree',
  雨伞: 'umbrella',
  轮子: 'wheel',

  // 成语 / 短语：取最主要的可画物体
  对牛弹琴: 'cow',
  画蛇添足: 'snake',
  守株待兔: 'rabbit',
  井底之蛙: 'frog',
  狐假虎威: 'tiger',
  亡羊补牢: 'sheep',
  杯弓蛇影: 'snake',
  掩耳盗铃: 'bell',
  刻舟求剑: 'boat',
  草木皆兵: 'tree',
  火上浇油: 'fire',
  水滴石穿: 'water',
  三心二意: 'heart',
}

/**
 * 取某个词对应的英文类别。
 * 先查完整映射，再尝试「包含关系」（例如「一大苹果」→ apple），都没有就返回 null。
 */
export function expectedClassFor(word: string): string | null {
  const text = word.trim()
  if (!text) return null
  const direct = WORD_TO_CLASS[text]
  if (direct) return direct

  // 命中子串：最长优先，避免「小汽车」被「汽车」抢先
  const candidates = Object.keys(WORD_TO_CLASS)
    .filter((key) => text.includes(key) || key.includes(text))
    .sort((a, b) => b.length - a.length)
  return candidates.length > 0 ? WORD_TO_CLASS[candidates[0]] : null
}

/** 这个词能不能参与 AI 评分 */
export function canScoreWithAi(word: string): boolean {
  return expectedClassFor(word) !== null
}
