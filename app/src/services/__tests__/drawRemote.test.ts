import { describe, expect, it, vi } from 'vitest'
import { createDrawPublisher, createRemoteDrawRoom } from '../drawRemote'
import type { DrawAction, DrawRemoteApi } from '../drawRemote'
import type { DrawRoomBackend, DrawRoomView } from '../../modules/draw/room'

function view(round: number): DrawRoomView {
  return { phase: 'drawing', round, painterId: 'p1', word: '长颈鹿', messages: [] } as unknown as DrawRoomView
}

/** 记录调用的假 API，队列可以手工塞 */
function fakeApi() {
  const published: { view: DrawRoomView }[] = []
  const posted: { kind: string; payload?: Record<string, unknown> }[] = []
  let queue: DrawAction[] = []
  let current: { view: DrawRoomView; version: number } | null = { view: view(1), version: 1 }
  let version = 1

  const api: DrawRemoteApi = {
    async publishView(_roomId, next) {
      published.push({ view: next })
      version += 1
      current = { view: next, version }
      return version
    },
    async readView() {
      return current
    },
    async postAction(_roomId, kind, payload) {
      posted.push({ kind, payload })
      version += 1
      return 1
    },
    async takeActions() {
      const taken = queue
      queue = []
      return taken
    },
  }

  return {
    api,
    published,
    posted,
    push(...actions: DrawAction[]) {
      queue = [...queue, ...actions]
    },
  }
}

function fakeBackend() {
  const calls: string[] = []
  const listeners = new Set<(v: DrawRoomView) => void>()
  const backend: DrawRoomBackend = {
    meId: 'host',
    view: async () => view(1),
    subscribe(onView) {
      listeners.add(onView)
      return () => listeners.delete(onView)
    },
    submitDrawing: async (imageRef) => {
      calls.push(`submit:${imageRef}`)
      return view(1)
    },
    tick: async () => {
      calls.push('tick')
      return view(1)
    },
    sendMessage: async (text) => {
      calls.push(`message:${text}`)
      return view(1)
    },
    sendReaction: async (target, kind) => {
      calls.push(`reaction:${target}:${kind}`)
      return view(1)
    },
    dispose: () => listeners.clear(),
  }
  return { backend, calls, emit: () => listeners.forEach((fn) => fn(view(1))) }
}

function action(kind: DrawAction['kind'], payload: Record<string, unknown> = {}): DrawAction {
  return { id: 1, userId: 'guest', kind, payload, createdAt: new Date().toISOString() }
}

describe('drawRemote 主持人发布器', () => {
  it('把别人的操作按顺序喂回本机后端', async () => {
    const { api, push } = fakeApi()
    const { backend, calls } = fakeBackend()

    push(
      action('submitDrawing', { imageRef: 'room/game/1/p1.png' }),
      action('message', { text: '是长颈鹿吧' }),
      action('reaction', { targetPlayerId: 'p2', kind: 'flower' }),
      action('tick'),
    )

    const publisher = createDrawPublisher({ roomId: 'r1', api, backend })
    await publisher.flush()

    expect(calls).toEqual([
      'submit:room/game/1/p1.png',
      'message:是长颈鹿吧',
      'reaction:p2:flower',
      'tick',
    ])
  })

  it('队列为空时不发布视图，也不重复处理', async () => {
    const { api, published } = fakeApi()
    const { backend } = fakeBackend()

    const publisher = createDrawPublisher({ roomId: 'r1', api, backend })
    await publisher.flush()

    // 第一次 flush 会发布一次（初始为脏），再 flush 没有新变化就不再发
    const afterFirst = published.length
    await publisher.flush()
    expect(published.length).toBe(afterFirst)
  })

  it('后端变化会触发发布', async () => {
    const { api, published } = fakeApi()
    const { backend, emit } = fakeBackend()

    const publisher = createDrawPublisher({ roomId: 'r1', api, backend, publishMs: 10 })
    publisher.start()
    emit()
    await new Promise((resolve) => setTimeout(resolve, 40))
    publisher.stop()

    expect(published.length).toBeGreaterThan(0)
  })

  it('后端报错不影响后续动作', async () => {
    const { api, push } = fakeApi()
    const { backend, calls } = fakeBackend()
    const broken: DrawRoomBackend = {
      ...backend,
      sendMessage: async () => {
        throw new Error('后端炸了')
      },
    }

    push(action('message', { text: '第一条' }), action('tick'))
    const onError = vi.fn()
    const publisher = createDrawPublisher({ roomId: 'r1', api, backend: broken, onError })
    await publisher.flush()

    expect(onError).toHaveBeenCalled()
    // 第一条失败后，后面的 tick 仍然要执行
    expect(calls).toContain('tick')
  })
})

describe('drawRemote 观战端', () => {
  it('does not publish the host painter answer or answer emoji to guessers', async () => {
    const { api, published } = fakeApi()
    const { backend } = fakeBackend()
    const original = await backend.view()
    backend.view = async () => ({ ...original, word: { word: '苹果' }, palette: ['🍎'] })
    const publisher = createDrawPublisher({ roomId: 'r1', api, backend })
    publisher.start()
    await publisher.flush()
    publisher.stop()
    expect(published[0].view).toMatchObject({ word: null, palette: [] })
    expect((await backend.view()).word?.word).toBe('苹果')
  })
  it('读到视图并只在版本变化时通知订阅者', async () => {
    const { api } = fakeApi()
    const room = createRemoteDrawRoom({ roomId: 'r1', api, meId: 'guest' })
    const seen: number[] = []

    room.subscribe((v) => seen.push((v as unknown as { round: number }).round ?? 0))
    await room.view()
    await room.view()

    expect(seen.length).toBe(1)
    room.dispose()
  })

  it('动作会写进队列，并把最新视图返回', async () => {
    const { api, posted } = fakeApi()
    const room = createRemoteDrawRoom({ roomId: 'r1', api, meId: 'guest' })

    await room.sendMessage('是长颈鹿吧')
    await room.submitDrawing('room/game/1/g1.png')
    await room.sendReaction('p2', 'flower')

    expect(posted.map((item) => item.kind)).toEqual(['message', 'submitDrawing', 'reaction'])
    expect(posted[1].payload).toEqual({ imageRef: 'room/game/1/g1.png' })
    room.dispose()
  })

  it('主持人还没开局时给出明确错误', async () => {
    const api: DrawRemoteApi = {
      publishView: async () => 1,
      readView: async () => null,
      postAction: async () => 1,
      takeActions: async () => [],
    }
    const room = createRemoteDrawRoom({ roomId: 'r1', api, meId: 'guest' })
    await expect(room.view()).rejects.toThrow('还没开始')
    room.dispose()
  })
})

