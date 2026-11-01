import type { AvatarConfig } from '../types/room'

export const defaultAvatar: AvatarConfig = {
  skin: 'warm',
  eyes: 'round',
  nose: 'dot',
  mouth: 'smile',
  hair: 'short',
  accessory: 'none',
}

const avatarStorageKey = 'break-ice-avatar'

export function getSavedAvatar(): AvatarConfig {
  const saved = uni.getStorageSync(avatarStorageKey) as Partial<AvatarConfig> | undefined
  return { ...defaultAvatar, ...(saved ?? {}) }
}

export function saveAvatar(avatar: AvatarConfig): void {
  uni.setStorageSync(avatarStorageKey, avatar)
}
