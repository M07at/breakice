export type DrawErrorCode =
  /** 画布节点还没拿到（组件没渲染完，或者这个端不支持 Canvas 2D） */
  | 'CANVAS_NOT_READY'
  /** 当前是观看模式，不允许画 */
  | 'MODE_NOT_ALLOWED'
  /** 还没落笔就想结束笔画 */
  | 'NO_STROKE'
  /** Emoji 版贴纸到上限了 */
  | 'EMOJI_LIMIT'
  /** 一次触摸没有有效坐标 */
  | 'NO_POINT'
  /** 导出图片失败 */
  | 'EXPORT_FAILED'
  /** AI 评分返回的东西解析不了 */
  | 'BAD_SCORE'

/** message 会直接显示给玩家，所以写中文 */
export class DrawError extends Error {
  readonly code: DrawErrorCode

  constructor(code: DrawErrorCode, message: string) {
    super(message)
    this.name = 'DrawError'
    this.code = code
  }
}
