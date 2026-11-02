export type UcErrorCode =
  | 'PLAYER_COUNT'
  | 'DUPLICATE_PLAYER'
  | 'BAD_CONFIG'
  | 'BAD_PAIR'
  | 'WRONG_PHASE'
  | 'NOT_YOUR_TURN'
  | 'NOT_ELIGIBLE'
  | 'ALREADY_VOTED'
  | 'INVALID_TARGET'
  | 'HOST_ONLY'
  | 'UNKNOWN_PLAYER'
  | 'DEADLINE_PASSED'
  | 'STALE_STATE'
  | 'BAD_REQUEST'
  | 'REQUEST_CONFLICT'
  | 'GAME_ACTIVE'
  | 'GAME_NOT_FOUND'

/** message 直接给玩家看，所以写成中文提示 */
export class UcError extends Error {
  readonly code: UcErrorCode

  constructor(code: UcErrorCode, message: string) {
    super(message)
    this.name = 'UcError'
    this.code = code
  }
}

/** 远程适配器可以返回同结构错误；网络错误不能冒充已确认失败的业务错误。 */
export function isUcError(error: unknown): error is UcError {
  if (!error || typeof error !== 'object' || !('code' in error) || !('message' in error) || typeof error.message !== 'string') return false
  return [
    'PLAYER_COUNT', 'DUPLICATE_PLAYER', 'BAD_CONFIG', 'BAD_PAIR', 'WRONG_PHASE',
    'NOT_YOUR_TURN', 'NOT_ELIGIBLE', 'ALREADY_VOTED', 'INVALID_TARGET', 'HOST_ONLY',
    'UNKNOWN_PLAYER', 'DEADLINE_PASSED', 'STALE_STATE', 'BAD_REQUEST', 'REQUEST_CONFLICT',
    'GAME_ACTIVE', 'GAME_NOT_FOUND',
  ].includes(String(error.code))
}
