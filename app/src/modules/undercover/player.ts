import { UcError } from './errors'
import type { UcClientAction, UcCommandMeta } from './backend'
import type { UcPublicView, UcSecretView } from './view'

export type MockScoreMode = 'success' | 'failed' | 'timeout'
export interface HybridArtwork { id: string; playerId: string; turnKey: string; preview: string; status: 'pending' | MockScoreMode; score?: number }
export interface DrawingSubmission {
  /** 模拟适配器放图形符号；真实画布放 Storage 路径 {game_id}/{turn_key}/{user_id}.png */
  preview: string
  scoreMode: MockScoreMode
  /** 真实画布上传后拿到的 artworks.id，端口用它触发 AI 评分 */
  artworkId?: string
}
export interface UcPlayerSnapshot {
  sessionId: string
  gameId: string
  gameNumber: number
  playerId: string
  hostId: string
  players: { id: string; name: string }[]
  view: UcPublicView
  bankNotice?: string
  artworks?: HybridArtwork[]
  serverNow: number
}

/** 每个客户端实例只代表一个固定身份；调用方法时不接收可切换的操作者。 */
export interface UcPlayerPort {
  readonly label: string
  readonly resumeUrl?: string
  load(): Promise<UcPlayerSnapshot>
  getMyWord(gameId: string): Promise<UcSecretView>
  act(gameId: string, action: UcClientAction, meta: UcCommandMeta): Promise<UcPlayerSnapshot>
  submitDrawing?(gameId: string, drawing: DrawingSubmission, meta: UcCommandMeta): Promise<UcPlayerSnapshot>
  replay(requestId: string): Promise<UcPlayerSnapshot>
  getInvites?(): Promise<{ name: string; url: string }[]>
}

/** A/D可在进入player页面前装配自己的适配器；这里不创建真实平台服务。 */
const installedPorts = new Map<'classic' | 'draw', UcPlayerPort>()
export function installPlayerPort(port: UcPlayerPort, variant: 'classic' | 'draw' = 'classic') { installedPorts.set(variant, port) }
export function getPlayerPort(variant: 'classic' | 'draw' = 'classic') { return installedPorts.get(variant) ?? null }

export function playerPermissions(snapshot: UcPlayerSnapshot) {
  const me = snapshot.view.players.find(p => p.id === snapshot.playerId)
  return {
    me,
    isHost: snapshot.playerId === snapshot.hostId,
    canAcknowledge: snapshot.view.phase === 'word' && !!me?.alive && !me.wordConfirmed,
    canFinish: snapshot.view.phase === 'describe' && !!me?.alive && snapshot.view.currentSpeakerId === snapshot.playerId,
    canVote: snapshot.view.phase === 'vote' && !!me?.canVote && !me.hasVoted,
    canEnd: snapshot.view.phase !== 'ended' && snapshot.playerId === snapshot.hostId,
  }
}

export function checkPlayerSnapshot(next: UcPlayerSnapshot, previous?: UcPlayerSnapshot | null) {
  if (!Number.isInteger(next.gameNumber) || next.gameNumber < 1) throw new UcError('BAD_REQUEST', '局次序号无效')
  if (!next.view.players.some(p => p.id === next.playerId) || !next.players.some(p => p.id === next.playerId)) {
    throw new UcError('UNKNOWN_PLAYER', '当前身份不属于这场游戏')
  }
  if (previous && (previous.playerId !== next.playerId || previous.sessionId !== next.sessionId)) {
    throw new UcError('BAD_REQUEST', '玩家身份发生变化，请重新打开自己的加入链接')
  }
}

export function shouldAcceptPlayerSnapshot(next: UcPlayerSnapshot, previous?: UcPlayerSnapshot | null) {
  checkPlayerSnapshot(next, previous)
  if (!previous) return true
  if (next.gameNumber < previous.gameNumber) return false
  if (next.gameNumber === previous.gameNumber && next.gameId !== previous.gameId) throw new UcError('BAD_REQUEST', '局次信息不一致，请刷新')
  return next.gameNumber > previous.gameNumber || next.view.version >= previous.view.version
}
