import { loadSystemBanks } from '../modules/bank'
import { bankRepo, LOCAL_USER_ID } from '../modules/local/session'
import type { TruthOrDarePrompt } from '../types/room'

/**
 * 真心话大冒险的抽题。
 *
 * 题目来源优先级：C 模块的自建题库（同一套 BankRepository）→ C 模块的系统题库
 * （app/src/modules/bank/seed/truth.json、dare.json）→ 本文件内置的兜底 8 条。
 * 房间内的「自定义题目」仍然由页面自己管理，不写入题库。
 */

type PromptType = TruthOrDarePrompt['type']

const builtinPrompts: Record<PromptType, TruthOrDarePrompt[]> = {
  truth: [
    { id: 'truth-1', type: 'truth', text: '最近一次让你觉得“今天真不错”的小事是什么？', difficulty: '轻松' },
    { id: 'truth-2', type: 'truth', text: '如果明天不用上课或上班，你最想怎么度过？', difficulty: '轻松' },
    { id: 'truth-3', type: 'truth', text: '在场的人里，谁给你的第一印象最特别？为什么？', difficulty: '进阶' },
    { id: 'truth-4', type: 'truth', text: '你做过最勇敢的一次决定是什么？', difficulty: '进阶' },
  ],
  dare: [
    { id: 'dare-1', type: 'dare', text: '用三种不同的语气说“我今天超有魅力”。', difficulty: '轻松' },
    { id: 'dare-2', type: 'dare', text: '邀请一位玩家和你一起摆一个最有创意的姿势。', difficulty: '轻松' },
    { id: 'dare-3', type: 'dare', text: '用动作演示一种交通工具，让大家猜一分钟。', difficulty: '进阶' },
    { id: 'dare-4', type: 'dare', text: '对下一位玩家说一句具体而真诚的夸奖。', difficulty: '轻松' },
  ],
}

function toPrompt(type: PromptType, id: string, text: string, difficulty: number): TruthOrDarePrompt {
  return { id, type, text, difficulty: difficulty === 1 ? '轻松' : '进阶' }
}

/** 读 C 模块的系统题库；题目数量不够时回退到内置题目。 */
function buildSeedPools(): Record<PromptType, TruthOrDarePrompt[]> {
  const seed: Record<PromptType, TruthOrDarePrompt[]> = { truth: [], dare: [] }
  try {
    for (const bank of loadSystemBanks()) {
      const type = bank.meta.gameType
      if (type !== 'truth' && type !== 'dare') continue
      bank.drafts.forEach((draft, index) => {
        const content = draft.content as { text?: string }
        if (!content?.text) return
        seed[type].push(toPrompt(type, `sys_${type}_${index + 1}`, content.text, draft.difficulty))
      })
    }
  } catch (error) {
    console.warn('系统题库读取失败，改用内置题目', error)
  }
  return seed
}

let pools: Record<PromptType, TruthOrDarePrompt[]> | null = null

function ensurePools(): Record<PromptType, TruthOrDarePrompt[]> {
  if (pools) return pools
  const seed = buildSeedPools()
  pools = {
    truth: seed.truth.length ? seed.truth : builtinPrompts.truth,
    dare: seed.dare.length ? seed.dare : builtinPrompts.dare,
  }
  return pools
}

/**
 * 把主持人自建的真心话 / 大冒险题库并入候选池。
 * 后端或本地预览服务不可用时静默回退到系统题库，不阻塞游戏。
 */
export async function refreshPromptPools(): Promise<void> {
  const base = ensurePools()
  try {
    const repo = bankRepo()
    const next: Record<PromptType, TruthOrDarePrompt[]> = { truth: [...base.truth], dare: [...base.dare] }
    for (const type of ['truth', 'dare'] as const) {
      const seen = new Set(next[type].map((prompt) => prompt.text))
      const banks = await repo.listBanks(LOCAL_USER_ID, type)
      for (const bank of banks) {
        if (bank.visibility !== 'private') continue
        const items = await repo.listItems(bank.id)
        for (const item of items) {
          const content = item.content as { text?: string }
          if (!content?.text || seen.has(content.text)) continue
          seen.add(content.text)
          next[type].push(toPrompt(type, item.id, content.text, item.difficulty))
        }
      }
    }
    pools = next
  } catch (error) {
    console.warn('自建题库暂不可用，继续使用系统题库', error)
  }
}

export function pickPrompt(type: PromptType): TruthOrDarePrompt {
  const list = ensurePools()[type]
  return list[Math.floor(Math.random() * list.length)]
}

export function pickRandomPlayer<T extends { id: string }>(players: T[]): T | null {
  if (!players.length) return null
  return players[Math.floor(Math.random() * players.length)]
}

export function getPromptPoolSize(type: PromptType) {
  return ensurePools()[type].length
}
