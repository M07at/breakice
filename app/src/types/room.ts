export type RoomPhase = 'lobby' | 'playing' | 'ended'
export type GameType = 'truth-or-dare' | 'drawing' | 'undercover'

export type AvatarOption =
  | 'light'
  | 'warm'
  | 'tan'
  | 'deep'
  | 'round'
  | 'happy'
  | 'wink'
  | 'dot'
  | 'small'
  | 'triangle'
  | 'smile'
  | 'open'
  | 'line'
  | 'short'
  | 'bob'
  | 'curly'
  | 'cap'
  | 'none'
  | 'glasses'
  | 'star'
  | 'headphones'

export interface AvatarConfig {
  skin: Extract<AvatarOption, 'light' | 'warm' | 'tan' | 'deep'>
  eyes: Extract<AvatarOption, 'round' | 'happy' | 'wink'>
  nose: Extract<AvatarOption, 'dot' | 'small' | 'triangle'>
  mouth: Extract<AvatarOption, 'smile' | 'open' | 'line'>
  hair: Extract<AvatarOption, 'short' | 'bob' | 'curly' | 'cap'>
  accessory: Extract<AvatarOption, 'none' | 'glasses' | 'star' | 'headphones'>
}

export interface Player {
  id: string
  nickname: string
  avatar: AvatarConfig
  isHost: boolean
  isReady: boolean
  online: boolean
}

export interface Room {
  id: string
  code: string
  name: string
  hostId: string
  maxPlayers: number
  phase: RoomPhase
  gameType: GameType | null
  players: Player[]
}

export interface TruthOrDarePrompt {
  id: string
  type: 'truth' | 'dare'
  text: string
  difficulty: '轻松' | '进阶'
}
