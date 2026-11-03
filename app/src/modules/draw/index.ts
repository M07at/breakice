export { DrawEngine, clamp, countPoints, replay, toCanvasPoint, toNormalizedPoint } from './engine'
export type { DrawEngineOptions, DrawStats } from './engine'
export { DrawError } from './errors'
export type { DrawErrorCode } from './errors'
export {
  normalizeAiScore,
  degradedScore,
  MockAiScorer,
  HttpAiScorer,
  createUniAiTransport,
} from './ai'
export type { AiScorer, AiScoreRequest, AiScoreTransport, HttpAiScorerOptions } from './ai'
export { ChunkPump, LoopbackTransport } from './sync'
export type { ChunkPumpOptions, LoopbackOptions, StrokeTransport } from './sync'
export {
  DRAW_SECONDS,
  LocalDrawRoomBackend,
  currentDrawRoom,
  disposeDrawRoom,
  startLocalDrawRoom,
} from './room'
export type {
  DrawRoomBackend,
  DrawRoomDrawing,
  DrawRoomPhase,
  DrawRoomPlayer,
  DrawRoomView,
  LocalDrawRoomOptions,
} from './room'
export {
  BRUSH_COLORS,
  BRUSH_WIDTHS,
  DRAW_VARIANT_HINT,
  DRAW_VARIANT_LABEL,
  EMOJI_POOL,
  customWord,
  pickDrawWord,
  pickEmojiPalette,
} from './words'
export type { EmojiPaletteOptions, PickedWord } from './words'
export { CANVAS, DEFAULT_DRAW_CONFIG } from './types'
export type {
  AiScoreDimensions,
  AiScoreResult,
  ClearOp,
  DrawChunk,
  DrawConfig,
  DrawMode,
  DrawOp,
  DrawVariant,
  DrawWord,
  EmojiOp,
  EmojiUpdateOp,
  Point,
  RenderItem,
  StrokeOp,
  StrokeStyle,
  UndoOp,
} from './types'
