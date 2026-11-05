import { afterEach, expect, it, vi } from 'vitest'
import { SupabaseRoomApi } from '../supabase'
import { defaultAvatar } from '../../services/avatarService'

interface Request {
  url: string
  data?: Record<string, unknown>
  header: Record<string, string>
  success(response: { statusCode: number; data: unknown }): void
}

afterEach(() => vi.unstubAllGlobals())

function setup(missingV2 = false) {
  const request = vi.fn((options: Request) => {
    let data: unknown = null
    let statusCode = 200
    if (missingV2 && options.url.endsWith('/rpc/set_my_profile_v2')) {
      statusCode = 404
      data = { message: 'Could not find the function public.set_my_profile_v2 in the schema cache' }
    } else if (options.url.includes('/room_members?')) {
      data = [{ user_id: 'host', seat: 1, role: 'host', ready: true, online: true, profiles: { nickname: '阿冰', avatar: defaultAvatar, mbti: ' enfp ' } }]
    } else if (options.url.includes('/rooms?')) {
      data = [{ id: 'room', code: 'ABCDEF', title: '测试房', host_id: 'host', max_players: 20, status: 'lobby', game_type: 'lobby' }]
    }
    options.success({ statusCode, data })
  })
  const toast = vi.fn()
  vi.stubGlobal('uni', {
    getStorageSync: (key: string) => key.includes('supabase-session')
      ? JSON.stringify({ userId: 'host', accessToken: 'user-token', refreshToken: 'refresh-token', expiresAt: Date.now() + 3600000 })
      : { nickname: '阿冰', avatar: defaultAvatar, mbti: 'INTJ' },
    request,
    showToast: toast,
  })
  return { api: new SupabaseRoomApi(), request, toast }
}

it('sends MBTI through the authenticated self-profile RPC and supports clearing it', async () => {
  const { api, request } = setup()
  expect(await api.setIdentity({ mbti: 'ENFP' })).toMatchObject({ id: 'host', nickname: '阿冰', mbti: 'ENFP' })
  expect(request).toHaveBeenCalledWith(expect.objectContaining({
    url: expect.stringContaining('/rpc/set_my_profile_v2'),
    data: { p_nickname: '阿冰', p_avatar: defaultAvatar, p_mbti: 'ENFP' },
    header: expect.objectContaining({ Authorization: 'Bearer user-token' }),
  }))
  await api.setIdentity({ mbti: null })
  expect(request.mock.calls.at(-1)?.[0].data?.p_mbti).toBeNull()
})

it('keeps nickname/avatar synchronization working until the migration is deployed', async () => {
  const { api, request, toast } = setup(true)
  await api.setIdentity({ mbti: 'ENFP' })
  expect(request.mock.calls.at(-1)?.[0].url).toContain('/rpc/set_my_profile')
  expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'MBTI 尚未同步，请更新服务端资料接口' }))
})

it('includes and normalizes MBTI in the shared room roster', async () => {
  const { api, request } = setup()
  const room = await api.getRoom('room')
  expect(room.players[0]).toMatchObject({ id: 'host', nickname: '阿冰', mbti: 'ENFP' })
  expect(request.mock.calls.some(([options]) => options.url.includes('profiles(nickname,avatar,mbti)'))).toBe(true)
})

it('preserves unavailable scoring outcomes so the drawing UI can explain them', async () => {
  const { api, request } = setup()
  request.mockImplementationOnce(options => options.success({ statusCode: 200, data: { status: 'unsupported', error: 'UNSUPPORTED_WORD' } }))
  expect(await api.invokeFunction('/functions/v1/draw-score', {})).toMatchObject({ status: 'unsupported', error: 'UNSUPPORTED_WORD' })
})
