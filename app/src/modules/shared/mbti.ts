export const MBTI_TYPES = [
  'INTJ', 'INTP', 'ENTJ', 'ENTP',
  'INFJ', 'INFP', 'ENFJ', 'ENFP',
  'ISTJ', 'ISFJ', 'ESTJ', 'ESFJ',
  'ISTP', 'ISFP', 'ESTP', 'ESFP',
] as const

export type Mbti = typeof MBTI_TYPES[number]

export function normalizeMbti(value: unknown): Mbti | null {
  const text = typeof value === 'string' ? value.trim().toUpperCase() : ''
  return (MBTI_TYPES as readonly string[]).includes(text) ? text as Mbti : null
}

export function mbtiGroup(value: unknown): 'analyst' | 'diplomat' | 'sentinel' | 'explorer' | '' {
  const type = normalizeMbti(value)
  if (!type) return ''
  if (type.includes('NT')) return 'analyst'
  if (type.includes('NF')) return 'diplomat'
  return type.endsWith('J') ? 'sentinel' : 'explorer'
}
