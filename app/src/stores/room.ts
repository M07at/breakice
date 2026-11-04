import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import * as roomService from '../services/roomService'
import { toErrorMessage } from '../platform/types'
import type { Unsubscribe } from '../platform/types'
import type { GameType, Room } from '../types/room'

const ROOM_ID_KEY = 'break-ice-room-id-v1'

/**
 * 房间是整个小程序的游戏单位：
 * 大厅创建/加入 → 全员准备 → 主持人选玩法 → 房间进入 playing → 各端进入对应游戏。
 * 数据来自平台层（本机房间或 Supabase），页面不直接碰后端。
 */
export const useRoomStore = defineStore('room', () => {
  const room = ref<Room | null>(null)
  const currentPlayerId = ref('')
  const busy = ref(false)
  const error = ref('')
  const connecting = ref(false)

  let unsubscribe: Unsubscribe | null = null

  const platformLabel = computed(() => roomService.platformLabel())
  const members = computed(() => room.value?.players ?? [])
  const currentPlayer = computed(() => members.value.find((player) => player.id === currentPlayerId.value))
  const isHost = computed(() => currentPlayer.value?.isHost ?? false)
  const readyCount = computed(() => members.value.filter((player) => player.isReady).length)
  const memberCount = computed(() => members.value.length)
  /** 所有在房间里的玩家都准备好了，主持人才可以开局 */
  const allReady = computed(() => memberCount.value > 0 && members.value.every((player) => player.isReady))
  const playing = computed(() => room.value?.phase === 'playing')

  function persist(roomId: string | null) {
    try {
      if (roomId) uni.setStorageSync(ROOM_ID_KEY, roomId)
      else uni.removeStorageSync(ROOM_ID_KEY)
    } catch {
      // 存储不可用时忽略，房间仍可在本次运行里使用
    }
  }

  function attach(next: Room) {
    room.value = next
    currentPlayerId.value = roomService.currentIdentity().id
    persist(next.id)
  }

  function subscribe(roomId: string) {
    unsubscribe?.()
    unsubscribe = roomService.watchRoom(roomId, (next) => {
      room.value = next
      if (!currentPlayerId.value) currentPlayerId.value = roomService.currentIdentity().id
    })
  }

  /** 昵称同步只是锦上添花，失败不能挡住进房 */
  async function syncIdentityQuietly() {
    try {
      const profile = roomService.currentIdentity()
      await roomService.syncIdentity(profile.nickname, profile.avatar)
    } catch (issue) {
      console.warn('同步昵称失败，继续进房', issue)
    }
  }

  async function create(input: roomService.CreateRoomInput) {
    busy.value = true
    error.value = ''
    try {
      await syncIdentityQuietly()
      const created = await roomService.createRoom(input)
      attach(created)
      subscribe(created.id)
    } catch (issue) {
      error.value = toErrorMessage(issue)
      throw issue
    } finally {
      busy.value = false
    }
  }

  async function join(input: roomService.JoinRoomInput) {
    busy.value = true
    error.value = ''
    try {
      await syncIdentityQuietly()
      const joined = await roomService.joinRoom(input)
      attach(joined)
      subscribe(joined.id)
    } catch (issue) {
      error.value = toErrorMessage(issue)
      throw issue
    } finally {
      busy.value = false
    }
  }

  /** 从本地记录的 roomId 找回房间（重启小程序 / 从游戏页返回） */
  async function restore(): Promise<boolean> {
    if (room.value) return true
    let roomId = ''
    try {
      roomId = String(uni.getStorageSync(ROOM_ID_KEY) || '')
    } catch {
      roomId = ''
    }
    if (!roomId) return false
    connecting.value = true
    try {
      const next = await roomService.fetchRoom(roomId)
      attach(next)
      subscribe(next.id)
      return true
    } catch {
      persist(null)
      return false
    } finally {
      connecting.value = false
    }
  }

  async function toggleReady() {
    if (!room.value || !currentPlayer.value) return
    const next = !currentPlayer.value.isReady
    busy.value = true
    error.value = ''
    try {
      await roomService.setReady(room.value.id, next)
      room.value = {
        ...room.value,
        players: room.value.players.map((player) =>
          player.id === currentPlayerId.value ? { ...player, isReady: next } : player,
        ),
      }
    } catch (issue) {
      error.value = toErrorMessage(issue)
    } finally {
      busy.value = false
    }
  }

  /** 主持人开局：房间进入 playing，选中哪个玩法由 gameType 决定 */
  async function begin(gameType: GameType) {
    if (!room.value) return
    if (!allReady.value) {
      error.value = '还有玩家没有准备'
      return
    }
    busy.value = true
    error.value = ''
    try {
      await roomService.startGame(room.value.id, gameType)
      room.value = { ...room.value, phase: 'playing', gameType }
    } catch (issue) {
      error.value = toErrorMessage(issue)
      throw issue
    } finally {
      busy.value = false
    }
  }

  /** 主持人结束本局，房间回到大厅 */
  async function finishGame() {
    if (!room.value) return
    busy.value = true
    try {
      await roomService.endGame(room.value.id)
      room.value = {
        ...room.value,
        phase: 'lobby',
        gameType: null,
        players: room.value.players.map((player) => ({ ...player, isReady: player.isHost })),
      }
    } catch (issue) {
      error.value = toErrorMessage(issue)
    } finally {
      busy.value = false
    }
  }

  async function leave() {
    if (room.value) {
      try {
        if (isHost.value) await roomService.closeRoom(room.value.id)
        else await roomService.leaveRoom(room.value.id)
      } catch {
        // 离开失败也要清掉本地状态，避免卡在房间里
      }
    }
    clear()
  }

  function clear() {
    unsubscribe?.()
    unsubscribe = null
    room.value = null
    currentPlayerId.value = ''
    error.value = ''
    persist(null)
  }

  return {
    room,
    members,
    currentPlayer,
    currentPlayerId,
    isHost,
    readyCount,
    memberCount,
    allReady,
    playing,
    busy,
    connecting,
    error,
    platformLabel,
    create,
    join,
    restore,
    toggleReady,
    begin,
    finishGame,
    leave,
    clear,
  }
})
