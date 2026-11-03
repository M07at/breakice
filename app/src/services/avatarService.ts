import type { AvatarConfig, AvatarLayerKey } from '../types/room'

export interface AvatarLayer {
  key: AvatarLayerKey
  label: string
  /** static/avatar 下的子目录名，也是图片文件名前缀 */
  folder: string
  count: number
}

/**
 * 数组顺序 = 首页箭头的从上到下顺序 = 图层叠加的从上层到下层。
 * 叠加时真正的绘制顺序是倒序：color → main → body → mouth → eyes → hat。
 */
export const avatarLayers: AvatarLayer[] = [
  { key: 'hat', label: '帽子', folder: 'hat', count: 16 },
  { key: 'eyes', label: '眼睛', folder: 'eyes', count: 14 },
  { key: 'mouth', label: '嘴巴', folder: 'mouth', count: 20 },
  { key: 'body', label: '身体', folder: 'body', count: 15 },
  { key: 'color', label: '颜色', folder: 'color', count: 17 },
]

/** 固定框架，永远显示，位于 color 之上、body 之下 */
export const AVATAR_MAIN = '/static/avatar/main.png'

export const defaultAvatar: AvatarConfig = { color: 1, body: 1, mouth: 1, eyes: 1, hat: 1 }

const PROFILE_STORAGE_KEY = 'break-ice-profile-v2'
const LEGACY_AVATAR_KEY = 'break-ice-avatar'
export const DEFAULT_NICKNAME = '破冰玩家'
export const NICKNAME_MAX = 12

export interface UserProfile {
  nickname: string
  avatar: AvatarConfig
}

function layerOf(key: AvatarLayerKey): AvatarLayer {
  const layer = avatarLayers.find((item) => item.key === key)
  if (!layer) throw new Error(`未知的形象图层：${key}`)
  return layer
}

export function getAvatarLayer(key: AvatarLayerKey): AvatarLayer {
  return layerOf(key)
}

/** 第 n 号图层的图片地址，直接指向被复制进小程序的 static 目录 */
export function layerImage(key: AvatarLayerKey, value: number): string {
  const layer = layerOf(key)
  const index = clampIndex(value, layer.count)
  return `/static/avatar/${layer.folder}/${layer.folder}${index}.png`
}

/** 按图层从底到顶的绘制顺序返回图片地址，main 插在 color 之后 */
export function avatarImages(avatar: AvatarConfig): string[] {
  const safe = normalizeAvatar(avatar)
  return [layerImage('color', safe.color), AVATAR_MAIN, layerImage('body', safe.body), layerImage('mouth', safe.mouth), layerImage('eyes', safe.eyes), layerImage('hat', safe.hat)]
}

function clampIndex(value: unknown, count: number): number {
  const number = Number(value)
  if (!Number.isFinite(number)) return 1
  return Math.min(count, Math.max(1, Math.round(number)))
}

/** 把本地缓存或旧版本数据收敛到合法范围，避免引用到不存在的图片 */
export function normalizeAvatar(raw: unknown): AvatarConfig {
  const source = (raw ?? {}) as Partial<Record<AvatarLayerKey, unknown>>
  const next = { ...defaultAvatar }
  for (const layer of avatarLayers) next[layer.key] = clampIndex(source[layer.key], layer.count)
  return next
}

/** 向左 / 向右循环切换：到 1 再往前回到最大编号，到最大再往后回到 1 */
export function cycleValue(value: number, count: number, direction: 1 | -1): number {
  const current = clampIndex(value, count)
  if (direction === 1) return current === count ? 1 : current + 1
  return current === 1 ? count : current - 1
}

export function normalizeNickname(raw: unknown): string {
  if (typeof raw !== 'string') return DEFAULT_NICKNAME
  const name = raw.trim().slice(0, NICKNAME_MAX)
  return name || DEFAULT_NICKNAME
}

export function getSavedProfile(): UserProfile {
  try {
    const saved = uni.getStorageSync(PROFILE_STORAGE_KEY) as Partial<UserProfile> | '' | undefined
    if (saved && typeof saved === 'object') {
      return { nickname: normalizeNickname(saved.nickname), avatar: normalizeAvatar(saved.avatar) }
    }
    return { nickname: DEFAULT_NICKNAME, avatar: { ...defaultAvatar } }
  } catch {
    return { nickname: DEFAULT_NICKNAME, avatar: { ...defaultAvatar } }
  }
}

/** 每次改动都直接落盘：首页没有保存按钮 */
export function saveProfile(profile: UserProfile): void {
  try {
    uni.setStorageSync(PROFILE_STORAGE_KEY, {
      nickname: normalizeNickname(profile.nickname),
      avatar: normalizeAvatar(profile.avatar),
    })
  } catch (error) {
    console.warn('保存形象失败', error)
  }
}

/** 旧版本按肤色/发型存储的头像已经废弃，读取时清掉，避免继续占空间 */
export function clearLegacyAvatar(): void {
  try {
    if (uni.getStorageSync(LEGACY_AVATAR_KEY)) uni.removeStorageSync(LEGACY_AVATAR_KEY)
  } catch {
    // 忽略：旧缓存清理失败不影响使用
  }
}
