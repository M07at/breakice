import { env } from '../config/env'
import { getSavedProfile, normalizeAvatar } from '../services/avatarService'
import type { AvatarConfig, GameType, Player, Room } from '../types/room'
import { PlatformError } from './types'
import type { CreateRoomInput, Identity, RoomApi, Unsubscribe } from './types'

/**
 * Supabase 房间实现 —— 对接 A 的迁移（`supabase/migrations`）。
 *
 * 只用 uni.request 走 PostgREST / Edge Function，不额外引入 @supabase/supabase-js：
 * 小程序端没有 fetch/localStorage，手写这一层反而更可控，包体积也小。
 *
 * 依赖的接口（见 docs/a/contracts.md）：
 *   POST /functions/v1/wechat-auth      登录换会话
 *   POST /rest/v1/rpc/create_room|join_room|leave_room|set_ready|close_room|heartbeat
 *   GET  /rest/v1/rooms, /rest/v1/room_members
 *   PATCH /rest/v1/rooms                房主改 status / game_type（rooms_update_host 策略允许）
 *   POST /auth/v1/token?grant_type=refresh_token
 */

const SESSION_KEY = 'break-ice-supabase-session-v1'

interface Session {
  userId: string
  accessToken: string
  refreshToken: string
  expiresAt: number
}

const TO_DB: Record<GameType, string> = {
  'truth-or-dare': 'truth',
  drawing: 'draw',
  undercover: 'undercover',
  hybrid: 'hybrid',
}

const FROM_DB: Record<string, GameType | null> = {
  lobby: null,
  truth: 'truth-or-dare',
  draw: 'drawing',
  undercover: 'undercover',
  hybrid: 'hybrid',
}

function baseUrl(): string {
  return env.supabaseUrl.replace(/\/+$/, '')
}

function readSession(): Session | null {
  try {
    const raw = uni.getStorageSync(SESSION_KEY)
    if (!raw) return null
    const parsed = JSON.parse(String(raw)) as Session
    if (!parsed?.accessToken || !parsed?.userId) return null
    return parsed
  } catch {
    return null
  }
}

function writeSession(session: Session | null): void {
  try {
    if (session) uni.setStorageSync(SESSION_KEY, JSON.stringify(session))
    else uni.removeStorageSync(SESSION_KEY)
  } catch (error) {
    console.warn('保存登录态失败', error)
  }
}

function uniRequest<T>(options: {
  path: string
  method?: 'GET' | 'POST' | 'DELETE'
  body?: unknown
  token?: string
}): Promise<T> {
  return new Promise((resolve, reject) => {
    uni.request({
      url: `${baseUrl()}${options.path}`,
      method: options.method ?? 'GET',
      data: options.body as Record<string, unknown> | undefined,
      timeout: 10000,
      header: {
        apikey: env.supabaseAnonKey,
        Authorization: `Bearer ${options.token ?? env.supabaseAnonKey}`,
        'Content-Type': 'application/json',
      },
      success: (response) => {
        const status = response.statusCode
        if (status >= 200 && status < 300) {
          resolve(response.data as T)
          return
        }
        reject(new PlatformError(mapErrorCode(response.data, status), describeError(response.data, status)))
      },
      fail: () => reject(new PlatformError('NETWORK', '连不上服务器，请检查网络')),
    })
  })
}

function errorText(data: unknown): string {
  if (!data || typeof data !== 'object') return ''
  const record = data as Record<string, unknown>
  const parts = [record.message, record.error_description, record.error, record.msg, record.details]
  // Edge Function 的错误形状是 { error: { code, message } }
  const nested = record.error
  if (nested && typeof nested === 'object') {
    const inner = nested as Record<string, unknown>
    if (typeof inner.message === 'string') parts.push(inner.message)
    if (typeof inner.code === 'string') parts.push(inner.code)
  }
  return parts.filter((value) => typeof value === 'string').join(' ')
}

function mapErrorCode(data: unknown, status: number): PlatformError['code'] {
  const text = errorText(data).toUpperCase()
  if (text.includes('AUTH_REQUIRED') || status === 401) return 'AUTH_REQUIRED'
  if (text.includes('ROOM_NOT_FOUND')) return 'ROOM_NOT_FOUND'
  if (text.includes('ROOM_NOT_JOINABLE')) return 'ROOM_NOT_JOINABLE'
  if (text.includes('ROOM_FULL')) return 'ROOM_FULL'
  if (text.includes('NOT_A_MEMBER')) return 'NOT_A_MEMBER'
  if (text.includes('HOST_ONLY')) return 'HOST_ONLY'
  return 'UNKNOWN'
}

function describeError(data: unknown, status: number): string {
  const text = errorText(data).toUpperCase()
  if (text.includes('ROOM_NOT_FOUND')) return '没有找到这个房间号'
  if (text.includes('ROOM_NOT_JOINABLE')) return '这个房间已经开始了'
  if (text.includes('ROOM_FULL')) return '房间人数已满'
  if (text.includes('HOST_ONLY')) return '只有主持人可以这么做'
  if (text.includes('NOT_A_MEMBER')) return '你不在这个房间里'
  if (text.includes('NOT_ALL_READY')) return '还有玩家没有准备'
  if (text.includes('AUTH_REQUIRED') || status === 401) {
    // 把服务端原话带上，方便区分「token 过期」「没带 key」「token 无效」
    const detail = errorText(data).slice(0, 80)
    return detail ? `登录失效：${detail}` : `登录失效（HTTP ${status}）`
  }
  // 引擎/业务错误（至少需要 4 名玩家、还有玩家没有准备……）直接把服务端原话给用户
  const detail = errorText(data).slice(0, 100)
  return detail || `服务器返回 ${status}`
}

/** 没有头像字段时，按座位号生成一个稳定的形象，保证列表里不出现空白 */
export function avatarForSeat(seat: number): AvatarConfig {
  return {
    color: ((seat - 1) % 17) + 1,
    body: ((seat * 3) % 15) + 1,
    mouth: ((seat * 5) % 20) + 1,
    eyes: ((seat * 2) % 14) + 1,
    hat: ((seat * 7) % 16) + 1,
  }
}

/** 只解出 JWT 的声明部分用于排查，不做验签，也不打印签名 */
function decodeClaims(token: string): Record<string, unknown> | null {
  const parts = token.split('.')
  if (parts.length !== 3) return null
  try {
    const payload = parts[1].replace(/-/g, '+').replace(/_/g, '/')
    const json = decodeURIComponent(
      payload
        .split('')
        .map((char) => `%${`00${char.charCodeAt(0).toString(16)}`.slice(-2)}`)
        .join(''),
    )
    const claims = JSON.parse(json) as Record<string, unknown>
    return { role: claims.role, aud: claims.aud, iss: claims.iss, exp: claims.exp, sub: claims.sub }
  } catch {
    return null
  }
}

export class SupabaseRoomApi implements RoomApi {
  readonly mode = 'supabase' as const
  readonly label = 'Supabase 房间'
  private session: Session | null = readSession()

  identity(): Identity {
    const profile = getSavedProfile()
    return {
      id: this.session?.userId ?? 'unauthenticated',
      nickname: profile.nickname,
      avatar: profile.avatar,
    }
  }

  /** 微信开发者工具里用 wx.login 换会话；网页端退回匿名登录（需要在项目里开启） */
  async ensureSession(): Promise<Session> {
    const current = this.session ?? readSession()
    if (current && current.expiresAt > Date.now() + 30_000) {
      this.session = current
      return current
    }
    if (current?.refreshToken) {
      const refreshed = await this.refresh(current.refreshToken).catch(() => null)
      if (refreshed) {
        this.session = refreshed
        return refreshed
      }
    }
    const next = await this.signIn()
    this.session = next
    return next
  }

  /**
   * 登录：微信小程序走 A 的 wechat-auth 函数；
   * 网页端没有 wx.login，退回 Supabase 匿名登录（项目设置里需要开启）。
   */
  private async signIn(): Promise<Session> {
    const platform = (uni.getSystemInfoSync() as unknown as { uniPlatform?: string }).uniPlatform
    if (platform === 'mp-weixin') return this.signInWithWechat()
    return this.signInAnonymously()
  }

  private async signInWithWechat(): Promise<Session> {
    const code = await new Promise<string>((resolve, reject) => {
      uni.login({
        provider: 'weixin',
        success: (result) => resolve(result.code),
        fail: () => reject(new PlatformError('AUTH_REQUIRED', '微信登录失败，请重试')),
      })
    })
    const raw = await uniRequest<Record<string, unknown>>({
      path: '/functions/v1/wechat-auth',
      method: 'POST',
      body: { code, nickname: getSavedProfile().nickname },
    })
    // 线上部署的函数版本可能和仓库里的返回结构不一致：
    // 可能在顶层，也可能包在 session / data / result / payload 里，甚至再嵌套一层。
    const data = (raw ?? {}) as Record<string, any>
    const layers: Record<string, any>[] = [
      data,
      data.session,
      data.data,
      data.result,
      data.payload,
      data.data?.session,
      data.result?.session,
      data.payload?.session,
      data.data?.data,
    ].filter((item): item is Record<string, any> => Boolean(item) && typeof item === 'object')

    const pick = (...keys: string[]): unknown => {
      for (const layer of layers) {
        for (const key of keys) {
          const value = layer[key]
          if (value !== undefined && value !== null && value !== '') return value
        }
      }
      return undefined
    }

    const accessToken = pick('access_token', 'accessToken', 'token', 'jwt')
    const refreshToken = pick('refresh_token', 'refreshToken') ?? ''
    const expiresIn = Number(pick('expires_in', 'expiresIn') ?? 3600)
    const userId = pick('user_id', 'userId') ?? pick('id') ?? data.user?.id ?? data.profile?.id ?? data.data?.user?.id

    if (!accessToken || !userId) {
      console.warn('[wechat-auth] 返回结构无法识别', raw)
      throw new PlatformError(
        'AUTH_REQUIRED',
        `微信登录返回缺少字段（顶层 keys：${Object.keys(data).join(', ') || '空'}）`,
      )
    }
    // 只打印 JWT 的声明部分（role / exp / iss），不含签名，用来判断 PostgREST 为什么拒绝
    console.log('[wechat-auth] 会话', { userId, tokenLen: String(accessToken).length, claims: decodeClaims(String(accessToken)) })
    return this.store(String(userId), String(accessToken), String(refreshToken), expiresIn)
  }

  private async signInAnonymously(): Promise<Session> {
    const data = await uniRequest<{
      user?: { id: string }
      access_token?: string
      refresh_token?: string
      expires_in?: number
    }>({
      path: '/auth/v1/signup',
      method: 'POST',
      body: {},
    })
    if (!data?.access_token || !data.user?.id) {
      throw new PlatformError('NOT_CONFIGURED', '网页端需要开启 Supabase 匿名登录，或改用微信开发者工具')
    }
    return this.store(data.user.id, data.access_token, data.refresh_token ?? '', data.expires_in ?? 3600)
  }

  private store(userId: string, accessToken: string, refreshToken: string, expiresIn: number): Session {
    const session: Session = {
      userId,
      accessToken,
      refreshToken,
      expiresAt: Date.now() + Math.max(60, expiresIn || 3600) * 1000,
    }
    writeSession(session)
    return session
  }

  private async refresh(refreshToken: string): Promise<Session> {
    const data = await uniRequest<{ user: { id: string }; access_token: string; refresh_token: string; expires_in: number }>({
      path: '/auth/v1/token?grant_type=refresh_token',
      method: 'POST',
      body: { refresh_token: refreshToken },
    })
    return this.store(data.user.id, data.access_token, data.refresh_token, data.expires_in)
  }

  /** 调用 Edge Function（带登录态），给 uc-command 这类游戏指令用 */
  async invokeFunction<T>(path: string, body: unknown): Promise<T> {
    const result = await this.call<{ error?: { code?: string; message?: string } }>(path, { method: 'POST', body })
    if (result && typeof result === 'object' && result.error) {
      throw new PlatformError('UNKNOWN', result.error.message ?? '游戏服务返回错误')
    }
    return result as T
  }

  private async call<T>(path: string, options: { method?: 'GET' | 'POST' | 'DELETE'; body?: unknown } = {}): Promise<T> {
    const session = await this.ensureSession()
    try {
      return await uniRequest<T>({ path, token: session.accessToken, ...options })
    } catch (error) {
      if (error instanceof PlatformError && error.code === 'AUTH_REQUIRED') {
        writeSession(null)
        this.session = null
        const next = await this.ensureSession()
        return uniRequest<T>({ path, token: next.accessToken, ...options })
      }
      throw error
    }
  }

  private rpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
    return this.call<T>(`/rest/v1/rpc/${name}`, { method: 'POST', body: args })
  }

  private select<T>(table: string, query: string): Promise<T> {
    return this.call<T>(`/rest/v1/${table}?${query}`)
  }

  async setIdentity(patch: Partial<Pick<Identity, 'nickname' | 'avatar'>>): Promise<Identity> {
    const current = getSavedProfile()
    const next = {
      nickname: patch.nickname ?? current.nickname,
      avatar: patch.avatar ?? current.avatar,
    }
    const session = await this.ensureSession()
    // 昵称和形象一起写进 profiles（0009），房间/游戏里才能和首页一致
    await this.rpc<void>('set_my_profile', { p_nickname: next.nickname, p_avatar: next.avatar })
    return { id: session.userId, nickname: next.nickname, avatar: next.avatar }
  }

  async createRoom(input: CreateRoomInput): Promise<Room> {
    const rows = await this.rpc<{ room_id: string; room_code: string }[]>('create_room', {
      p_title: input.title,
      p_game_type: 'lobby',
      p_max_players: input.maxPlayers,
      p_settings: {},
    })
    const created = rows?.[0]
    if (!created) throw new PlatformError('UNKNOWN', '创建房间失败')
    return this.getRoom(created.room_id)
  }

  async joinRoom(code: string): Promise<Room> {
    const rows = await this.rpc<{ room_id: string; seat: number; already_member: boolean }[]>('join_room', {
      p_code: code.trim().toUpperCase(),
    })
    const joined = rows?.[0]
    if (!joined) throw new PlatformError('UNKNOWN', '加入房间失败')
    return this.getRoom(joined.room_id)
  }

  async leaveRoom(roomId: string): Promise<void> {
    await this.rpc<void>('leave_room', { p_room_id: roomId })
  }

  async setReady(roomId: string, ready: boolean): Promise<void> {
    await this.rpc<void>('set_ready', { p_room_id: roomId, p_ready: ready })
  }

  async startGame(roomId: string, gameType: GameType): Promise<void> {
    await this.rpc<void>('start_room_game', { p_room_id: roomId, p_game_type: TO_DB[gameType] })
  }

  async endGame(roomId: string): Promise<void> {
    await this.rpc<void>('end_room_game', { p_room_id: roomId })
  }

  async closeRoom(roomId: string): Promise<void> {
    await this.rpc<void>('close_room', { p_room_id: roomId })
  }

  async getRoom(roomId: string): Promise<Room> {
    const session = await this.ensureSession()
    const [rooms, members] = await Promise.all([
      this.select<{ id: string; code: string; title: string; host_id: string; max_players: number; status: string; game_type: string }[]>(
        'rooms',
        `id=eq.${roomId}&select=id,code,title,host_id,max_players,status,game_type`,
      ),
      this.select<{
        user_id: string
        seat: number
        role: string
        ready: boolean
        online: boolean
        profiles?: { nickname?: string; avatar?: AvatarConfig | null }
      }[]>(
        'room_members',
        `room_id=eq.${roomId}&left_at=is.null&select=user_id,seat,role,ready,online,profiles(nickname,avatar)&order=seat`,
      ),
    ])
    const room = rooms?.[0]
    if (!room) throw new PlatformError('ROOM_NOT_FOUND', '房间不存在或已关闭')

    const players: Player[] = (members ?? []).map((member) => ({
      id: member.user_id,
      nickname: member.profiles?.nickname || `玩家${member.seat}`,
      // 用玩家在首页设置的形象；没设过（或老数据）才按座位号兜底生成
      avatar: member.profiles?.avatar ? normalizeAvatar(member.profiles.avatar) : avatarForSeat(member.seat),
      isHost: member.role === 'host' || member.user_id === room.host_id,
      isReady: member.ready,
      online: member.online,
    }))

    return {
      id: room.id,
      code: room.code,
      name: room.title,
      hostId: room.host_id,
      maxPlayers: room.max_players,
      phase: room.status === 'playing' ? 'playing' : room.status === 'ended' ? 'ended' : 'lobby',
      gameType: FROM_DB[room.game_type] ?? null,
      players: players.length
        ? players
        : [{ id: session.userId, nickname: getSavedProfile().nickname, avatar: getSavedProfile().avatar, isHost: true, isReady: false, online: true }],
    }
  }

  watch(roomId: string, onChange: (room: Room) => void): Unsubscribe {
    let stopped = false
    let timer: ReturnType<typeof setInterval> | undefined
    let last = ''

    const tick = async () => {
      if (stopped) return
      try {
        const room = await this.getRoom(roomId)
        const serialized = JSON.stringify(room)
        if (serialized !== last) {
          last = serialized
          onChange(room)
        }
        await this.rpc<unknown>('heartbeat', { p_room_id: roomId }).catch(() => undefined)
      } catch {
        // 网络抖动或房间已关闭：下一轮再试
      }
    }

    void tick()
    timer = setInterval(tick, 2000)

    return () => {
      stopped = true
      if (timer) clearInterval(timer)
    }
  }
}
