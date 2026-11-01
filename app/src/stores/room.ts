import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { createRoom, joinRoom, startGame } from '../services/roomService'
import type { GameType, Room } from '../types/room'

export const useRoomStore = defineStore('room', () => {
  const room = ref<Room | null>(null)
  const currentPlayerId = ref('player-host')
  const busy = ref(false)

  const currentPlayer = computed(() => room.value?.players.find((player) => player.id === currentPlayerId.value))
  const isHost = computed(() => currentPlayer.value?.isHost ?? false)
  const readyCount = computed(() => room.value?.players.filter((player) => player.isReady).length ?? 0)

  async function create(input: Parameters<typeof createRoom>[0]) {
    busy.value = true
    try {
      room.value = await createRoom(input)
      currentPlayerId.value = room.value.hostId
    } finally {
      busy.value = false
    }
  }

  async function join(input: Parameters<typeof joinRoom>[0]) {
    busy.value = true
    try {
      room.value = await joinRoom(input)
      currentPlayerId.value = 'current-player'
    } finally {
      busy.value = false
    }
  }

  function toggleReady() {
    if (!room.value || isHost.value) return
    room.value = {
      ...room.value,
      players: room.value.players.map((player) =>
        player.id === currentPlayerId.value ? { ...player, isReady: !player.isReady } : player,
      ),
    }
  }

  async function begin(gameType: GameType) {
    if (!room.value) return
    busy.value = true
    try {
      room.value = await startGame(room.value, gameType)
    } finally {
      busy.value = false
    }
  }

  function clear() {
    room.value = null
    currentPlayerId.value = 'player-host'
  }

  return { room, currentPlayer, currentPlayerId, busy, isHost, readyCount, create, join, toggleReady, begin, clear }
})
