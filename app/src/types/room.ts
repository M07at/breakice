export type RoomPhase = 'lobby' | 'playing' | 'ended'
import type { Mbti } from '../modules/shared/mbti'

/** 房间可选的玩法；hybrid = 你画我猜谁是卧底 */
export type GameType = 'truth-or-dare' | 'drawing' | 'undercover' | 'hybrid'

/** 形象图层的键：叠加顺序与切换顺序在 avatarService 里定义 */
export type AvatarLayerKey = 'color' | 'body' | 'mouth' | 'eyes' | 'hat'

/**
 * 自定义形象 = 每个图层选中的图片编号（从 1 开始）。
 * 图层从底到顶依次是 color、main、body、mouth、eyes、hat；main 是固定框架，没有编号。
 */
export interface AvatarConfig {
  color: number
  body: number
  mouth: number
  eyes: number
  hat: number
}

export interface Player {
  id: string
  nickname: string
  mbti?: Mbti | null
  avatar: AvatarConfig
  isHost: boolean
  isReady: boolean
  online: boolean
}

/** 真心话大冒险的共享回合：所有客户端读同一份，避免各转各的 */
export interface TruthTurn {
  round: number
  targetId: string | null
  promptId: string | null
  type: 'truth' | 'dare'
  text: string
  at: number
  by: string
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
  /** 真心话大冒险的共享状态（服务端 rooms.settings.truth） */
  truth?: TruthTurn | null
}

export interface TruthOrDarePrompt {
  id: string
  type: 'truth' | 'dare'
  text: string
  difficulty: '轻松' | '进阶'
}

