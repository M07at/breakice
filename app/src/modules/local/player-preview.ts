import { isUcError, UcError } from '../undercover/errors'
import type { UcPlayerPort, UcPlayerSnapshot } from '../undercover/player'

export function previewOrigin() {
  // #ifdef H5
  return location.origin
  // #endif
  // #ifndef H5
  return ''
  // #endif
}

async function request<T>(origin: string, path: string, ticket?: string, body?: unknown): Promise<T> {
  if (!/^https?:\/\/[^/]+$/.test(origin)) throw new Error('请在H5预览中启动多设备测试，或由大厅接入游戏服务。')
  return new Promise((resolve, reject) => {
    uni.request({
      url: `${origin}/__c1_mock${path}`,
      method: body === undefined ? 'GET' : 'POST',
      data: body as Record<string, unknown> | undefined,
      header: { 'Content-Type': 'application/json', ...(ticket ? { Authorization: `Bearer ${ticket}` } : {}) },
      timeout: 8000,
      success: (result) => {
        const data = result.data as { error?: unknown }
        if (result.statusCode >= 200 && result.statusCode < 300) resolve(result.data as T)
        else if (isUcError(data?.error)) reject(new UcError(data.error.code, data.error.message))
        else reject(new Error('联调服务暂不可用，请确认电脑上的H5预览仍在运行。'))
      },
      fail: () => reject(new Error('暂时无法连接，正在等待恢复。请检查手机与电脑是否在同一网络。')),
    })
  })
}

export async function createPlayerPreview(names: string[], blankEnabled: boolean, variant: 'classic' | 'draw' = 'classic', language: 'zh' | 'en' = 'zh', bankIds: string[] = ['sys_undercover']) {
  const origin = previewOrigin()
  const credentials = await request<{ sessionId: string; ticket: string }>(origin, '/sessions', undefined, { names, blankEnabled, variant, language, bankIds })
  return createPlayerPreviewPort(origin, credentials.sessionId, credentials.ticket, variant)
}

export function createPlayerPreviewPort(origin: string, sessionId: string, ticket: string, variant: 'classic' | 'draw' = 'classic'): UcPlayerPort {
  const query = `?sid=${encodeURIComponent(sessionId)}`
  const route = (credential: string) => `/pages-uc/${variant === 'draw' ? 'hybrid-player' : 'player'}?session=${encodeURIComponent(sessionId)}&ticket=${encodeURIComponent(credential)}`
  return {
    label: '每人一台手机 · 本地联调',
    resumeUrl: route(ticket),
    load: () => request<UcPlayerSnapshot>(origin, `/session${query}`, ticket),
    getMyWord: gameId => request(origin, `/word${query}&gameId=${encodeURIComponent(gameId)}`, ticket),
    act: (gameId, action, meta) => request(origin, `/act${query}`, ticket, { gameId, action, meta }),
    submitDrawing: (gameId, drawing, meta) => request(origin, `/drawing${query}`, ticket, { gameId, drawing, meta }),
    replay: requestId => request(origin, `/replay${query}`, ticket, { requestId }),
    getInvites: async () => {
      const invites = await request<{ name: string; ticket: string }[]>(origin, `/invites${query}`, ticket)
      return invites.map(invite => ({ name: invite.name, url: `${origin}/#${route(invite.ticket)}` }))
    },
  }
}
