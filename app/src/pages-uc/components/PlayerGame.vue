<template>
  <view class="uc-page">
    <view class="uc-header"><text class="uc-eyebrow">破冰局 / {{ snapshot?.view.variant === 'draw' ? '你画我猜谁是卧底' : '谁是卧底' }}</text><view class="uc-row"><text class="uc-title">{{ title }}</text><text v-if="snapshot?.view.phaseDeadline" class="player-clock">{{ remaining }}秒</text></view><text class="uc-subtitle">{{ port?.label ?? '个人游戏界面' }}</text></view>
    <view v-if="snapshot" class="uc-note identity">你是 {{ seatOf(snapshot.playerId) }} 号 · <PlayerIdentity :name="nameOf(snapshot.playerId)" :mbti="mbtiOf(snapshot.playerId)" /> <text v-if="rights?.isHost">（主持人）</text></view>
    <view v-if="snapshot && snapshot.view.phaseDeadline" class="phase-countdown" :class="{ urgent: remaining <= 5 }" role="timer">
      <text>{{ timerLabel }}</text><text class="countdown-number">{{ remaining }}<text class="countdown-unit"> 秒</text></text>
    </view>
    <view v-if="!connected" class="uc-note" role="status">{{ snapshot ? '连接暂时中断，显示的是上次进度；正在重试连接…' : '正在连接游戏…' }}</view>
    <view v-if="busy" class="uc-note" role="status">正在提交，请稍候…</view>
    <view v-if="notice" class="uc-note" role="status">{{ notice }}</view>
    <view v-if="error" class="uc-error" role="alert"><text>{{ error }}</text><button v-if="retry" class="uc-button" :disabled="busy || !connected" @tap="retryCommand">重试上次提交</button><button class="uc-button uc-secondary" :disabled="busy" @tap="refresh">刷新当前进度</button></view>
    <template v-if="snapshot && rights"><view v-if="snapshot.bankNotice" class="uc-note">{{ snapshot.bankNotice }}</view>
      <view v-if="snapshot.view.phase !== 'ended' && !rights.me?.alive" class="uc-note">你已出局，可以继续旁观。当前无法发言或投票。</view>

      <view v-if="snapshot.view.phase === 'word'" class="uc-card personal-word">
        <text class="uc-badge">{{ confirmedCount }} / {{ aliveCount }} 人已确认</text>
        <text class="person">这是你自己的词卡</text>
        <text class="uc-muted">请遮好屏幕。其他玩家只会看到他们自己的词。</text>
        <text v-if="secret" class="secret-word">{{ secret.isBlank ? '你是白板' : secret.word }}</text>
        <view v-else class="sealed">秘密词语已遮住</view>
        <button v-if="!secret && rights.me?.alive" class="uc-button uc-secondary" :disabled="locked" @tap="reveal">查看我的词语</button>
        <button v-if="secret && rights.canAcknowledge" class="uc-button" :disabled="locked" @tap="acknowledge">我记住了，确认并遮住</button>
        <button v-if="secret" class="uc-link" @tap="hideSecret">遮住词语</button>
        <view v-if="rights.me?.wordConfirmed" class="uc-note personal-wait">你已确认。等待其他玩家在各自手机上领词。</view>
        <text class="uc-muted">全部确认后，程序自动开始第一轮。</text>
      </view>

      <template v-if="snapshot.view.phase === 'describe'">
        <view class="uc-card">
          <text class="uc-badge">第 {{ snapshot.view.round }} 轮{{ snapshot.view.pkCandidates ? ' · 平票加赛' : '' }}</text>
          <text class="person">{{ seatOf(snapshot.view.currentSpeakerId) }} 号 · <PlayerIdentity :name="nameOf(snapshot.view.currentSpeakerId)" :mbti="mbtiOf(snapshot.view.currentSpeakerId)" /></text>
          <text class="uc-label">{{ snapshot.view.variant === 'draw' ? rights.canFinish ? '轮到你作画了' : '正在作画，请等待回顾' : rights.canFinish ? '轮到你发言了' : '正在发言，请认真听' }}</text>
          <text class="uc-muted">{{ snapshot.view.variant === 'draw' ? '当前画手用图形表达自己的词。提交后自动轮到下一位，所有作品在回顾阶段展示。' : rights.canFinish ? '先介绍一下名字，再描述自己的词，不要直接念出词语。' : '在自己的手机上等待。倒计时结束自动轮到下一位。' }}</text>
          <button v-if="rights.canFinish && snapshot.view.variant === 'classic'" class="uc-button" :disabled="locked" @tap="send({ type: 'turnDone' })">我说完了 →</button>
          <view v-if="!rights.canFinish" class="uc-hint-block"><text class="uc-note">{{ rights.me?.alive ? '等待你的发言回合' : '你正在旁观' }}</text></view>
        </view>
        <view v-if="snapshot.view.variant === 'draw' && !rights.canFinish && snapshot.view.phase === 'describe'" class="uc-card">
          <text class="uc-label"><PlayerIdentity :name="nameOf(snapshot.view.currentSpeakerId)" :mbti="mbtiOf(snapshot.view.currentSpeakerId)" /> 正在画</text>
          <DrawCanvas ref="hybridCanvas" :engine="hybridViewer" mode="watch" variant="classic" @error="error = $event" />
        </view>
        <HybridDrawAdapter ref="hybridAdapter" v-if="snapshot.view.variant === 'draw' && rights.canFinish" :seed-ops="roundOps" :key="snapshot.gameId + snapshot.view.turnKey + snapshot.playerId" :game-id="snapshot.gameId" :turn-key="snapshot.view.turnKey" :player-id="snapshot.playerId" :editable="!locked" @submit="submitDrawing" />
        <view v-if="rights.me?.alive" class="uc-card"><text class="uc-label">我的词卡</text><text v-if="secret" class="secret-word small">{{ secret.isBlank ? '你是白板' : secret.word }}</text><button class="uc-button uc-secondary" :disabled="locked" @tap="secret ? hideSecret() : reveal()">{{ secret ? '遮住我的词语' : '私密查看我的词语' }}</button></view>
        <view class="uc-card"><text class="uc-label">发言顺序</text><view v-for="(id, i) in snapshot.view.speakOrder" :key="id" class="player-line"><text>{{ seatOf(id) }} 号 · <PlayerIdentity :name="nameOf(id)" :mbti="mbtiOf(id)" /></text><text class="uc-muted">{{ i < speakerIndex ? '已发言' : id === snapshot.view.currentSpeakerId ? '正在发言' : '等待' }}</text></view></view>
      </template>

      <view v-if="snapshot.view.variant === 'draw' && ['review', 'vote', 'reveal', 'ended'].includes(snapshot.view.phase)" class="uc-card">
        <text class="uc-label">{{ snapshot.view.phase === 'review' ? '作品回顾 · 倒计时后自动投票' : '本轮画作' }}</text>
        <text class="uc-muted">缺席或超时未交的画手没有作品。AI 评分失败或超时不会阻塞投票。</text>
        <view v-for="(art, index) in galleryArtworks" :key="art.id" class="final-player"><text>第 {{ index + 1 }} 位 · <PlayerIdentity :name="nameOf(art.playerId)" :mbti="mbtiOf(art.playerId)" /></text><image v-if="artworkUrls[art.id]" class="gallery-image" :src="artworkUrls[art.id]" mode="widthFix" /><view v-else class="gallery-placeholder">画作加载中…</view><text v-if="guessText(art)" class="uc-muted">{{ guessText(art) }}</text>
          <text class="uc-muted">{{ art.status === 'pending' ? 'AI 评分中…' : art.status === 'success' ? 'AI 评分完成' : art.status === 'failed' ? '评分失败，已跳过' : '评分超时，已跳过' }}{{ art.score !== undefined ? ' · ' + art.score + '分' : '' }}</text></view>
        <view v-for="id in playersWithoutArtwork" :key="'na-' + id" class="final-player"><text><PlayerIdentity :name="nameOf(id)" :mbti="mbtiOf(id)" /> · 本轮没有作画</text><text class="uc-muted">只有轮到发言的人才会画</text></view>
        <text v-if="!snapshot.artworks?.length && !playersWithoutArtwork.length" class="uc-muted">本轮暂无已提交画作，仍会按时进入投票。</text>
      </view>
      <view v-if="snapshot.view.phase === 'vote'" class="uc-card">
        <view class="uc-row"><text class="uc-label">投出你认为的卧底</text><text class="uc-badge">{{ votedCount }} / {{ voterCount }} 人已投</text></view>
        <template v-if="rights.canVote">
          <text class="uc-muted">{{ snapshot.view.pkCandidates ? '只能投平票加赛玩家。' : '请选择一位存活玩家。' }}不能自投，也可以弃权。各位玩家可在各自手机上投票。</text>
          <view class="uc-grid vote-options"><button v-for="p in candidates" :key="p.id" class="uc-choice" :class="{ active: selected === p.id }" :disabled="locked" @tap="selected = p.id"><text class="uc-muted">{{ p.seat + 1 }} 号</text><PlayerIdentity :name="nameOf(p.id)" :mbti="mbtiOf(p.id)" /></button><button class="uc-choice" :class="{ active: selected === null }" :disabled="locked" @tap="selected = null">这一票弃权</button></view>
          <button class="uc-button" :disabled="locked || confirming || selected === undefined" @tap="confirmVote">{{ selected === undefined ? '先选择，再确认' : selected === null ? '确认弃权' : `确认投给 ${nameOf(selected)}` }}</button>
        </template>
        <view v-else class="uc-note personal-wait">{{ rights.me?.hasVoted ? '你的票已提交。等待其他玩家投票。' : rights.me?.alive ? '你是本次加赛候选人，这次不参与投票。' : '你已出局，本轮旁观投票。' }}</view>
        <view v-for="p in snapshot.view.players.filter(p => p.canVote)" :key="p.id" class="player-line"><text>{{ p.seat + 1 }} 号 · <PlayerIdentity :name="nameOf(p.id)" :mbti="mbtiOf(p.id)" /></text><text class="uc-muted">{{ p.hasVoted ? '已提交' : '等待投票' }}</text></view>
      </view>

      <view v-if="snapshot.view.phase === 'reveal' && snapshot.view.lastResult" class="uc-card">
        <text class="uc-badge">第 {{ snapshot.view.round }} 轮结果</text><text class="person">{{ roundResult }}</text>
        <text v-if="snapshot.view.lastResult.eliminatedId" class="uc-muted">身份：{{ roleOf(snapshot.view.lastResult.eliminatedId) }}。词语在终局揭晓。</text>
        <view v-for="p in snapshot.view.players.filter(p => (snapshot!.view.lastResult!.tally[p.id] ?? 0) > 0)" :key="p.id" class="player-line"><text><PlayerIdentity :name="nameOf(p.id)" :mbti="mbtiOf(p.id)" /></text><text>{{ snapshot.view.lastResult.tally[p.id] }} 票</text></view>
        <text class="uc-note personal-wait">{{ snapshot.view.lastResult.tied && !snapshot.view.lastResult.pk ? '接下来平票玩家加赛。' : snapshot.view.round >= snapshot.view.maxRounds ? '轮数已到上限，接下来结算。' : '接下来存活玩家进入下一轮。' }}程序自动推进，大家留在自己的界面即可。</text>
      </view>

      <template v-if="snapshot.view.phase === 'ended'">
        <view class="uc-card"><text class="uc-badge">第 {{ snapshot.view.round }} 轮 · 本局结束</text><text class="person">{{ ending }}</text><text v-if="snapshot.view.endedReason === 'max_rounds'" class="uc-muted">已达到轮数上限。</text><text v-if="snapshot.view.pair" class="uc-note personal-wait">平民词：{{ snapshot.view.pair.civilian }} / 卧底词：{{ snapshot.view.pair.undercover }}</text></view>
        <view class="uc-card"><text class="uc-label">揭晓所有人的词</text><view v-for="p in snapshot.view.players" :key="p.id" class="final-player"><view class="uc-row"><text>{{ p.seat + 1 }} 号 · <PlayerIdentity :name="nameOf(p.id)" :mbti="mbtiOf(p.id)" /></text><text class="uc-badge">{{ p.role ? ROLE_LABEL[p.role] : '' }}</text></view><text class="uc-muted">{{ p.word === null ? '没有词语' : p.word }} · {{ p.alive ? '存活到最后' : '已出局' }}</text></view></view>
        <button class="uc-button" :disabled="busy" @tap="backToLobby">退出，回到大厅 →</button><view class="uc-note">本局已结束，结算会一直保留；主持人结束本局后所有人回到大厅并重新准备。</view>
      </template>

      <button class="uc-link" @tap="exitToLobby">退出，回到大厅（游戏继续）</button>
      <template v-if="rights.isHost && port?.getInvites">
        <button class="uc-link" :disabled="busy" @tap="toggleInvites">{{ showInvites ? '收起联调邀请链接' : '分发每位玩家的联调邀请链接' }}</button>
        <view v-if="showInvites" class="uc-card"><text class="uc-label">每位玩家打开自己的链接</text><text class="uc-muted">这是本地测试入口。请将不同座位链接分别发给对应玩家，勿把同一链接发给多人。手机与电脑使用同一网络。</text><view v-for="(invite, i) in invites" :key="invite.url" class="player-line"><text>{{ i + 1 }} 号 · {{ invite.name }}</text><button class="uc-small" @tap="copyInvite(invite.url)">复制链接</button></view></view>
      </template>
    </template>
    <button v-if="!snapshot" class="uc-link" @tap="settings">返回游戏测试入口</button>
  </view>
</template>

<script setup lang="ts">
import HybridDrawAdapter from './HybridDrawAdapter.vue'
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { onHide, onLoad, onShow } from '@dcloudio/uni-app'
import { isUcError, ROLE_LABEL } from '@/modules/undercover'
import type { UcClientAction, UcCommandMeta, UcSecretView } from '@/modules/undercover'
import { getPlayerPort, installPlayerPort, playerPermissions, shouldAcceptPlayerSnapshot } from '@/modules/undercover/player'
import type { DrawingSubmission, UcPlayerPort, UcPlayerSnapshot } from '@/modules/undercover/player'
import { createPlayerPreviewPort, previewOrigin } from '@/modules/local/player-preview'
import { onLivePoke, pokeRoom } from '@/services/liveRoom'
import DrawCanvas from '@/components/draw-canvas/draw-canvas.vue'
import PlayerIdentity from '@/components/PlayerIdentity.vue'
import { useRoomStore } from '@/stores/room'
import { DrawEngine } from '@/modules/draw/engine'
import type { DrawChunk } from '@/modules/draw/types'
import { resolveArtworkUrls } from '@/services/ucGame'

const props = defineProps<{ query: Record<string,string|undefined>; variant: 'classic' | 'draw' }>()
const roomStore = useRoomStore()
const port = ref<UcPlayerPort | null>(null)
const snapshot = ref<UcPlayerSnapshot | null>(null)
const secret = ref<UcSecretView | null>(null)
const selected = ref<string | null | undefined>()
const busy = ref(false)
const connected = ref(false)
const confirming = ref(false)
const error = ref('')
const notice = ref('')
const showInvites = ref(false)
const invites = ref<{ name: string; url: string }[]>([])
const retry = ref<{ gameId: string; action?: UcClientAction; drawing?: DrawingSubmission; replayId?: string; meta?: UcCommandMeta } | null>(null)
const clock = ref(Date.now())
let serverOffset = 0
let timer: ReturnType<typeof setInterval> | undefined
let polling = false
let active = true
let disposed = false
let secretRequest = 0
let sequence = 0
const requestPrefix = `player-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
const rights = computed(() => snapshot.value ? playerPermissions(snapshot.value) : null)
const locked = computed(() => busy.value || !connected.value || !!retry.value)
const aliveCount = computed(() => snapshot.value?.view.players.filter(p => p.alive).length ?? 0)
const confirmedCount = computed(() => snapshot.value?.view.players.filter(p => p.alive && p.wordConfirmed).length ?? 0)
const voterCount = computed(() => snapshot.value?.view.players.filter(p => p.canVote).length ?? 0)
const votedCount = computed(() => snapshot.value?.view.players.filter(p => p.canVote && p.hasVoted).length ?? 0)
/** 这一局里从未作画的人（机器人、没轮到过的、已出局的） */
/**
 * 画作展示范围：
 * - 投票/回顾：本轮所有人的作品（每轮每位玩家在自己的回合里各画一幅）
 * - 结束：整局所有轮次
 */
const galleryArtworks = computed(() => {
  const all = snapshot.value?.artworks ?? []
  if (snapshot.value?.view.phase === 'ended') return all
  const view = snapshot.value?.view
  const round = String(view?.round ?? '')
  // 加时赛的作品键是 <轮次>-pk#玩家，必须和普通轮分开，否则两批画混在一起
  const wantPk = Boolean(view?.pkCandidates)
  return all.filter((art) => {
    const isPk = art.turnKey.includes('-pk')
    if (isPk !== wantPk) return false
    return art.turnKey.split(/[-#]/)[0] === round
  })
})

/**
 * 画作上的 AI 猜测信息。服务端接上画图识别后，artworks 行会带 aiGuess / aiSeconds；
 * 现在没有就返回空串，不占位置。
 */
function guessText(art: { comment?: string; aiGuess?: string; aiSeconds?: number }) {
  if (art.comment) return art.comment
  const guess = art.aiGuess as string | undefined
  const seconds = art.aiSeconds as number | undefined
  if (!guess && seconds === undefined) return ''
  const parts: string[] = []
  if (guess) parts.push('AI 猜：' + guess)
  if (seconds !== undefined) parts.push('用时 ' + seconds.toFixed(1) + ' 秒')
  return parts.join(' · ')
}

const playersWithoutArtwork = computed(() => {
  const drawn = new Set(galleryArtworks.value.map((a) => a.playerId))
  return (snapshot.value?.view.players ?? []).map((p) => p.id).filter((id) => !drawn.has(id))
})

const remaining = computed(() => Math.max(0, Math.ceil(((snapshot.value?.view.phaseDeadline ?? 0) - clock.value - serverOffset) / 1000)))
const timerLabel = computed(() => ({ describe: props.variant === 'draw' ? '本次作画剩余' : '本次发言剩余', review: '查看画作，随后投票', vote: '投票剩余', reveal: '下一轮开始前' })[snapshot.value?.view.phase as 'describe' | 'review' | 'vote' | 'reveal'] ?? '剩余时间')
const speakerIndex = computed(() => snapshot.value?.view.speakOrder.indexOf(snapshot.value.view.currentSpeakerId ?? '') ?? -1)
const candidates = computed(() => snapshot.value?.view.players.filter(p => p.alive && p.id !== snapshot.value!.playerId && (!snapshot.value!.view.pkCandidates || snapshot.value!.view.pkCandidates.includes(p.id))) ?? [])
const title = computed(() => ({ word: '领好你的秘密词', describe: '认真听，慢慢猜', review: '一起看看画作', vote: '你觉得会是谁？', reveal: '这一轮，揭晓', ended: '秘密终于揭晓' })[snapshot.value?.view.phase ?? 'word'])
const mbtiOf = (id: string | null) => snapshot.value?.players.find(p => p.id === id)?.mbti ?? roomStore.members.find(p => p.id === id)?.mbti
const nameOf = (id: string | null) => snapshot.value?.players.find(p => p.id === id)?.name ?? ''
const seatOf = (id: string | null) => (snapshot.value?.view.players.find(p => p.id === id)?.seat ?? 0) + 1
const roleOf = (id: string) => { const role = snapshot.value?.view.players.find(p => p.id === id)?.role; return role ? ROLE_LABEL[role] : '' }
const roundResult = computed(() => {
  const result = snapshot.value?.view.lastResult
  if (!result) return ''
  if (result.eliminatedId) return `${nameOf(result.eliminatedId)} 出局`
  return result.tied ? result.pk ? '再次平票，无人出局' : '平票！进入加赛' : '全部弃权，无人出局'
})
const ending = computed(() => snapshot.value?.view.winner === 'civilian' ? '平民阵营获胜！' : snapshot.value?.view.winner === 'undercover' ? '卧底阵营获胜！' : '主持人结束了本局')

function hideSecret() { secretRequest++; secret.value = null }
function receive(next: UcPlayerSnapshot) {
  if (disposed) return
  if (next.view.variant !== props.variant) throw new Error('游戏类型与当前页面不匹配，请打开对应游戏的加入链接。')
  const previous = snapshot.value
  if (!shouldAcceptPlayerSnapshot(next, previous)) return
  if (!previous || previous.gameId !== next.gameId || previous.view.phase !== next.view.phase) { hideSecret(); selected.value = undefined }
  if (previous && previous.gameId !== next.gameId) { retry.value = null; error.value = ''; notice.value = '主持人已开始新局，你仍使用自己的身份参加。' }
  snapshot.value = next
  if (next.view.phase === 'ended' && previous?.view.phase !== 'ended') active = false
  if (!previous || previous.gameId !== next.gameId || previous.view.phase !== next.view.phase) void nextTick(() => uni.pageScrollTo({ scrollTop: 0, duration: 0 }))
  serverOffset = next.serverNow - Date.now()
  clock.value = Date.now()
  connected.value = true
  if (rights.value?.me?.hasVoted || (selected.value && !candidates.value.some(p => p.id === selected.value))) selected.value = undefined
    // 换一轮就清空观战画布，别把上一轮的笔画带过来
  if (next.view.turnKey !== lastHybridTurn) {
    lastHybridTurn = next.view.turnKey
    hybridViewer.reset()
    hybridCanvas.value?.paint()
    // 请画手把当前画布整份补发一次，避免重置前的笔画丢失
    pokeRoom('hybrid-sync')
  }
  void syncArtworkUrls(next)

  
}

/** 真实画作在私有桶里，拿到 artworks 后换成临时地址；拿不到就退回占位文本 */
const artworkUrls = ref<Record<string, string>>({})
async function syncArtworkUrls(next: UcPlayerSnapshot) {
  const items = (next.artworks ?? []).filter((art) => !artworkUrls.value[art.id])
  if (items.length === 0) return
  try {
    const resolved = await resolveArtworkUrls(items.map((art) => ({ id: art.id, preview: art.preview })))
    if (Object.keys(resolved).length > 0) artworkUrls.value = { ...artworkUrls.value, ...resolved }
  } catch (error) {
    console.warn('解析画作地址失败', error)
  }
}
async function load() {
  if (!port.value || polling || disposed) return
  polling = true
  try { receive(await port.value.load()) }
  catch (e) { connected.value = false; if (!snapshot.value) error.value = isUcError(e) || e instanceof Error ? e.message : '读取游戏失败' }
  finally { polling = false }
}
async function refresh() { hideSecret(); await load() }
async function perform(operation: () => Promise<void>) {
  if (busy.value) return
  busy.value = true; error.value = ''
  try { await operation() }
  catch (e) { error.value = isUcError(e) || e instanceof Error ? e.message : '操作失败，请重试' }
  finally { busy.value = false }
}
async function reveal() {
  if (!snapshot.value || locked.value) return
  const id = ++secretRequest
  const gameId = snapshot.value.gameId
  await perform(async () => {
    const result = await port.value!.getMyWord(gameId)
    if (result.playerId !== snapshot.value!.playerId) throw new Error('词卡身份不匹配，请重新连接')
    if (active && !disposed && id === secretRequest && gameId === snapshot.value?.gameId) secret.value = result
  })
}
async function execute(command: NonNullable<typeof retry.value>) {
  await perform(async () => {
    hideSecret()
    try {
      const next = command.drawing ? await port.value!.submitDrawing!(command.gameId, command.drawing, command.meta!) : command.action ? await port.value!.act(command.gameId, command.action, command.meta!) : await port.value!.replay(command.replayId!)
      receive(next); retry.value = null
    } catch (e) {
      if (!isUcError(e)) { retry.value = command; throw new Error('提交结果尚未确认。请重试，不会重复计票或推进回合。') }
      retry.value = null
      await load()
      if (e.code === 'STALE_STATE') throw new Error('其他玩家已更新进度。请查看当前页面，再次确认你的选择。')
      throw e
    }
  })
}
async function send(action: UcClientAction, version = snapshot.value?.view.version) {
  if (!snapshot.value || locked.value || version === undefined) return
  await execute({ gameId: snapshot.value.gameId, action, meta: { requestId: `${requestPrefix}-${++sequence}`, expectedVersion: version, expectedPhase: snapshot.value.view.phase, expectedRound: snapshot.value.view.round, expectedTurnKey: snapshot.value.view.turnKey } })
}
async function submitDrawing(drawing: DrawingSubmission) {
  if (!snapshot.value || locked.value || !rights.value?.canFinish || !port.value?.submitDrawing) return
  const v = snapshot.value.view
  await execute({ gameId: snapshot.value.gameId, drawing, meta: { requestId: requestPrefix + '-drawing-' + (++sequence), expectedVersion: v.version, expectedPhase: v.phase, expectedRound: v.round, expectedTurnKey: v.turnKey } })
}
async function retryCommand() { if (retry.value && !busy.value) await execute(retry.value) }
async function acknowledge() { if (secret.value && rights.value?.canAcknowledge) await send({ type: 'acknowledgeWord' }) }
function confirmVote() {
  if (!snapshot.value || !rights.value?.canVote || selected.value === undefined || locked.value || confirming.value) return
  const targetId = selected.value
  const captured = { gameId: snapshot.value.gameId, round: snapshot.value.view.round, turnKey: snapshot.value.view.turnKey, version: snapshot.value.view.version }
  confirming.value = true
  uni.showModal({ title: targetId === null ? '确认弃权？' : `投给 ${nameOf(targetId)}？`, content: '提交后不能更改。你只能提交自己的这一票。', success: r => {
    if (!r.confirm) return
    if (snapshot.value?.gameId === captured.gameId && snapshot.value.view.round === captured.round && snapshot.value.view.turnKey === captured.turnKey && rights.value?.canVote) void send({ type: 'vote', targetId }, captured.version)
    else notice.value = '阶段已经变化，这次选择没有提交。'
  }, complete: () => { confirming.value = false } })
}
function confirmEnd() {
  if (!rights.value?.canEnd || locked.value || confirming.value) return
  confirming.value = true
  uni.showModal({ title: '提前结束本局？', content: '所有玩家会同步看到结果和词语。', success: r => { if (r.confirm) void send({ type: 'endGame' }) }, complete: () => { confirming.value = false } })
}
/** 一局结束回大厅：房间已由服务端置回 lobby 并清空准备状态 */
/** 退出回大厅：房间仍是 playing，随时可以点「回到游戏」继续 */
function exitToLobby() {
  uni.navigateBack({ delta: 1, fail: () => uni.reLaunch({ url: '/pages/room/index' }) })
}

function backToLobby() {
  if (endedTimer) clearTimeout(endedTimer)
  uni.reLaunch({ url: '/pages/room/index' })
}

async function replay() {
  if (!rights.value?.isHost || locked.value || !snapshot.value) return
  await execute({ gameId: snapshot.value.gameId, replayId: `${requestPrefix}-replay-${++sequence}` })
}
async function toggleInvites() {
  showInvites.value = !showInvites.value
  if (showInvites.value && port.value?.getInvites) await perform(async () => { invites.value = await port.value!.getInvites!() })
}
function copyInvite(url: string) { uni.setClipboardData({ data: url }) }
function settings() { uni.redirectTo({ url: '/pages-uc/setup' }) }
onMounted(async () => {
  const query = props.query
  try {
    if (query?.session && query?.ticket) installPlayerPort(createPlayerPreviewPort(previewOrigin(), String(query.session), String(query.ticket), props.variant), props.variant)
    port.value = getPlayerPort(props.variant)
    if (!port.value) { error.value = '请打开分配给自己的加入链接，或返回测试入口创建联调游戏。'; return }
    await load()
    offLive = onLivePoke((event, payload) => {
      // 融合玩法：画手的笔画实时重放到观战画布
      if (event === 'hybrid-clear') {
        hybridViewer.reset()
        hybridCanvas.value?.paint()
        return
      }
      if (event === 'hybrid-snapshot') {
        const ops = (payload as { ops?: import('@/modules/draw/types').DrawOp[] }).ops
        if (Array.isArray(ops)) {
          roundOps.value = ops
          hybridViewer.loadSnapshot(ops)
          hybridCanvas.value?.paint()
        }
        return
      }
      if (event === 'hybrid-stroke') {
        const chunk = (payload as { chunk?: DrawChunk }).chunk
        if (chunk && hybridViewer.applyChunk(chunk) > 0) hybridCanvas.value?.paint()
        return
      }
      if (!disposed && !polling) void load()
    })
    let ticks = 0
    timer = setInterval(() => { clock.value = Date.now(); if (active && ++ticks % 3 === 0) void load() }, 250)
  } catch (e) { error.value = isUcError(e) || e instanceof Error ? e.message : '连接游戏失败' }
})
onHide(() => { active = false; hideSecret() })
onShow(() => { active = true; if (port.value) void load() })
watch(
      () => roomStore.room?.phase,
      (phase) => {
        // 房主结束本局 → 房间回 lobby，游戏页自动退回
        if (phase === 'lobby' && snapshot.value?.view.phase !== 'ended') {
          uni.navigateBack({ delta: 1, fail: () => uni.reLaunch({ url: '/pages/room/index' }) })
        }
      },
    )

onUnmounted(() => { disposed = true; hideSecret(); if (timer) clearInterval(timer); if (endedTimer) clearTimeout(endedTimer); offLive?.() })
/** 同房间有人行动时立刻拉一次，不用等轮询 */
let offLive: (() => void) | null = null
/** 结束后自动回大厅的定时器 */
let endedTimer: ReturnType<typeof setTimeout> | null = null
/** 融合玩法的观战画布：重放画手广播来的笔画 */
const hybridViewer = new DrawEngine({ by: 'hybrid-viewer' })
/** 融合玩法画布：倒计时结束时自动提交，不再让玩家点按钮 */
const hybridAdapter = ref<{ submitNow: () => void } | null>(null)
let hybridSubmitted = false
const autoSubmitTimer = setInterval(() => checkAutoSubmit(), 1000)

// 观战端每 4 秒要一次全量快照：丢片、清空、重连都能在 4 秒内自愈
const hybridSyncTimer = setInterval(() => {
  const view = snapshot.value?.view
  if (!view || view.variant !== 'draw' || view.phase !== 'describe') return
  if (rights.value?.canFinish) return
  pokeRoom('hybrid-sync')
}, 4000)
onUnmounted(() => { clearInterval(autoSubmitTimer); clearInterval(hybridSyncTimer) })

function checkAutoSubmit() {
  const value = remaining.value
  const view = snapshot.value?.view
  if (!view || view.variant !== 'draw' || !rights.value?.canFinish) return
  // 提前 1 秒提交：卡在归零那一刻发，请求到达时回合往往已经翻页，会被判成「不是你在画」
  if (value > 1 || hybridSubmitted) return
  hybridSubmitted = true
  try {
    hybridAdapter.value?.submitNow()
    console.log('[hybrid] 倒计时结束，已触发自动提交', view.turnKey)
  } catch (issue) {
    hybridSubmitted = false
    error.value = '自动提交失败：' + (issue instanceof Error ? issue.message : String(issue))
    console.error('[hybrid] 自动提交失败', issue)
  }
}
watch(() => snapshot.value?.view.turnKey, () => { hybridSubmitted = false })
const hybridCanvas = ref<{ paint(): void } | null>(null)
let lastHybridTurn = ''
/** 本轮已经画好的笔画：轮到下一位时作为接力起点 */
const roundOps = ref<import('@/modules/draw/types').DrawOp[]>([])
</script>

<style>
@import '../classic.css';
.gallery-picture { display:block; text-align:center; font-size:64rpx; padding:24rpx; }
.gallery-image { display:block; width:100%; margin:12rpx 0; border-radius:12rpx; background:#fff; }
.identity { font-weight: 700; }
.person { display: block; margin: 28rpx 0; font-size: 38rpx; font-weight: 800; line-height: 1.5; }
.personal-word { text-align: center; }
.secret-word { display: block; padding: 36rpx 0; font-size: 64rpx; color: #a14b2c; font-weight: 800; }
.secret-word.small { font-size: 44rpx; }
.sealed { padding: 56rpx 12rpx; margin: 24rpx 0; border: 2rpx dashed #bacaba; border-radius: 18rpx; color: #65776f; }
.personal-wait { margin: 24rpx 0 0; }
.player-line { display: flex; align-items: center; justify-content: space-between; gap: 16rpx; padding: 20rpx 0; border-bottom: 2rpx solid #edf0e7; }
.vote-options { margin: 24rpx 0; }
.player-clock { font-size: 40rpx; font-weight: 700; white-space: nowrap; }
.phase-countdown { position: sticky; top: 0; z-index: 20; display: flex; align-items: center; justify-content: space-between; padding: 22rpx 28rpx; margin-bottom: 24rpx; border: 3rpx solid #4f8ef7; border-radius: 20rpx; background: #edf4ff; color: #2455a5; font-size: 28rpx; font-weight: 700; }
.countdown-number { font-size: 76rpx; line-height: 1; font-weight: 900; font-variant-numeric: tabular-nums; }
.countdown-unit { font-size: 28rpx; }
.phase-countdown.urgent { background: #fff0ec; border-color: #d75535; color: #b53d24; }
.gallery-placeholder { display: flex; align-items: center; justify-content: center; min-height: 300rpx; margin: 12rpx 0; border-radius: 12rpx; background: #f1f4f8; color: #65738a; font-size: 26rpx; }
.final-player { padding: 20rpx 0; border-bottom: 2rpx solid #edf0e7; }
</style>















