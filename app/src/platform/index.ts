import { backendConfigured, env } from '../config/env'
import { LocalRoomApi } from './local'
import { SupabaseRoomApi } from './supabase'
import type { RoomApi } from './types'

/**
 * 平台层入口。
 *
 * - 配好 `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` → 走 A 的 Supabase 后端；
 * - 没配 → 用本机房间，功能可用但只有一台设备能进房间。
 *
 * 游戏引擎（C 的谁是卧底、B 的你画我猜）目前仍在客户端运行，房间负责把他们组织起来。
 */
export const roomApi: RoomApi = backendConfigured ? new SupabaseRoomApi() : new LocalRoomApi()

export const platform = {
  mode: roomApi.mode,
  label: roomApi.label,
  supabaseUrl: env.supabaseUrl,
  configured: backendConfigured,
}

export * from './types'
