import { afterEach, expect, it, vi } from 'vitest'
import { SupabaseRoomApi } from '../supabase'

interface Request {
  url: string
  timeout: number
  data?: Record<string, unknown>
  success(response: { statusCode: number; data: unknown }): void
  fail(error: { errMsg: string }): void
}

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

function setup(respond: (request: Request) => void, cached = true) {
  const request = vi.fn(respond)
  vi.stubGlobal('uni', {
    getStorageSync: (key: string) => key.includes('supabase-session')
      ? cached ? JSON.stringify({ userId: 'host', accessToken: 'user-token', expiresAt: Date.now() + 3600000 }) : ''
      : { nickname: '阿冰', avatar: { color: 1, body: 1, mouth: 1, eyes: 1, hat: 1 }, mbti: 'ENFP' },
    setStorageSync: vi.fn(),
    getSystemInfoSync: () => ({ uniPlatform: 'mp-weixin' }),
    login: (options: { success(result: { code: string }): void }) => options.success({ code: 'wechat-code' }),
    request,
  })
  return { api: new SupabaseRoomApi(), request }
}

it('allows a fresh WeChat login that takes longer than the former ten-second deadline', async () => {
  vi.useFakeTimers()
  const { api, request } = setup(options => {
    const deadline = setTimeout(() => options.fail({ errMsg: 'request:fail fail:time out' }), options.timeout)
    setTimeout(() => {
      clearTimeout(deadline)
      options.success({ statusCode: 200, data: {
        user_id: 'phone', access_token: 'phone-token', refresh_token: 'phone-refresh', expires_in: 3600,
      } })
    }, 12000)
  }, false)
  const session = api.ensureSession()
  await vi.advanceTimersByTimeAsync(12000)
  expect(await session).toMatchObject({ userId: 'phone', accessToken: 'phone-token' })
  expect(request).toHaveBeenCalledOnce()
  expect(request.mock.calls[0][0].url).toContain('/functions/v1/wechat-auth')
})

it('reports a timed-out room creation and never automatically repeats its write', async () => {
  const { api, request } = setup(options => options.fail({ errMsg: 'request:fail fail:time out' }))
  await expect(api.createRoom({ title: '手机测试', maxPlayers: 8 })).rejects.toThrow('创建房间请求超时（30 秒）')
  expect(request).toHaveBeenCalledOnce()
})

it('identifies a join timeout separately from a login or profile failure', async () => {
  const { api, request } = setup(options => options.fail({ errMsg: 'request:fail timeout' }))
  await expect(api.joinRoom('ABCDEF')).rejects.toThrow('加入房间请求超时（30 秒）')
  expect(request).toHaveBeenCalledOnce()
})

it('does not treat profile network timeouts as an undeployed MBTI function', async () => {
  const { api, request } = setup(options => options.fail({ errMsg: 'request:fail fail:time out' }))
  await expect(api.setIdentity({ mbti: 'INTJ' })).rejects.toThrow('资料同步请求超时（30 秒）')
  expect(request).toHaveBeenCalledOnce()
  expect(request.mock.calls[0][0].url).toContain('/rpc/set_my_profile_v2')
})

it('keeps ordinary reads short and reports domain rejection without retrying it', async () => {
  const { api, request } = setup(options => options.fail({ errMsg: 'request:fail url not in domain list' }))
  await expect(api.getRoom('room')).rejects.toMatchObject({ code: 'NOT_CONFIGURED' })
  expect(request.mock.calls.every(([options]) => options.timeout === 10000)).toBe(true)
  expect(request).toHaveBeenCalledTimes(2) // rooms and members, each requested once
})
