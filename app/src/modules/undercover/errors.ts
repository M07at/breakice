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

/** message 直接给玩家看，所以写成中文提示 */
export class UcError extends Error {
  readonly code: UcErrorCode

  constructor(code: UcErrorCode, message: string) {
    super(message)
    this.name = 'UcError'
    this.code = code
  }
}
