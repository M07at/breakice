import type { TruthOrDarePrompt } from '../types/room'

const truthPrompts: TruthOrDarePrompt[] = [
  { id: 'truth-1', type: 'truth', text: '最近一次让你觉得“今天真不错”的小事是什么？', difficulty: '轻松' },
  { id: 'truth-2', type: 'truth', text: '如果明天不用上课或上班，你最想怎么度过？', difficulty: '轻松' },
  { id: 'truth-3', type: 'truth', text: '在场的人里，谁给你的第一印象最特别？为什么？', difficulty: '进阶' },
  { id: 'truth-4', type: 'truth', text: '你做过最勇敢的一次决定是什么？', difficulty: '进阶' },
]

const darePrompts: TruthOrDarePrompt[] = [
  { id: 'dare-1', type: 'dare', text: '用三种不同的语气说“我今天超有魅力”。', difficulty: '轻松' },
  { id: 'dare-2', type: 'dare', text: '邀请一位玩家和你一起摆一个最有创意的姿势。', difficulty: '轻松' },
  { id: 'dare-3', type: 'dare', text: '用动作演示一种交通工具，让大家猜一分钟。', difficulty: '进阶' },
  { id: 'dare-4', type: 'dare', text: '对下一位玩家说一句具体而真诚的夸奖。', difficulty: '轻松' },
]

export function pickPrompt(type: TruthOrDarePrompt['type']): TruthOrDarePrompt {
  const prompts = type === 'truth' ? truthPrompts : darePrompts
  return prompts[Math.floor(Math.random() * prompts.length)]
}

export function pickRandomPlayer<T extends { id: string }>(players: T[]): T | null {
  if (!players.length) return null
  return players[Math.floor(Math.random() * players.length)]
}

export function getPromptPoolSize(type: TruthOrDarePrompt['type']) {
  return type === 'truth' ? truthPrompts.length : darePrompts.length
}
