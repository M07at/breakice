/** draw = 你画我猜（B）；undercover = 谁是卧底和融合玩法（C）；truth / dare = 真心话大冒险（D） */
export type GameType = 'draw' | 'undercover' | 'truth' | 'dare'

export const GAME_TYPES: GameType[] = ['draw', 'undercover', 'truth', 'dare']

export const GAME_TYPE_LABEL: Record<GameType, string> = {
  draw: '你画我猜',
  undercover: '谁是卧底',
  truth: '真心话',
  dare: '大冒险',
}

export interface DrawContent {
  word: string
  hint?: string
  emoji?: string
}

export interface PairContent {
  civilian: string
  undercover: string
  /** 能不能用在你画我猜谁是卧底 */
  drawable?: boolean
}

export interface TextContent {
  text: string
}

export interface ContentByType {
  draw: DrawContent
  undercover: PairContent
  truth: TextContent
  dare: TextContent
}

export type Difficulty = 1 | 2 | 3

export const DIFFICULTY_LABEL: Record<Difficulty, string> = { 1: '易', 2: '中', 3: '难' }

export interface ItemDraft<T extends GameType = GameType> {
  content: ContentByType[T]
  tags: string[]
  difficulty: Difficulty
}

export interface BankItem<T extends GameType = GameType> extends ItemDraft<T> {
  id: string
  bankId: string
}

/** system = 迁移脚本预置、所有人只读；private = 主持人自建 */
export type Visibility = 'system' | 'private'

export interface Bank {
  id: string
  name: string
  gameType: GameType
  visibility: Visibility
  ownerId: string | null
  description: string
  createdAt: string
  updatedAt: string
}

export interface BankMeta {
  name: string
  gameType: GameType
  description: string
}
