<template>
  <view v-if="bank" class="page">
    <view class="card">
      <view class="card-head">
        <text class="card-title">{{ bank.name }}</text>
        <text class="badge" :class="bank.visibility">{{ bank.visibility === 'system' ? '系统' : '我的' }}</text>
      </view>
      <text class="hint">{{ GAME_TYPE_LABEL[bank.gameType] }} · {{ items.length }} 条</text>
      <view v-if="readOnly" class="notice top">系统题库只读。可以导出后新建自己的题库，再导入修改。</view>
      <view class="actions">
        <button size="mini" @tap="exportAs('csv')">导出 CSV</button>
        <button size="mini" @tap="exportAs('json')">导出 JSON</button>
        <button size="mini" @tap="downloadTemplate">CSV 模板</button>
        <button v-if="!readOnly" size="mini" @tap="importFile">导入文件</button>
        <button v-if="!readOnly" size="mini" @tap="showPaste = !showPaste">粘贴导入</button>
        <button v-if="!readOnly" size="mini" @tap="rename">改名</button>
        <button v-if="!readOnly" size="mini" class="danger" @tap="removeBank">删除题库</button>
      </view>
    </view>

    <view v-if="showPaste" class="section">
      <view class="section-title">粘贴 CSV 或 JSON</view>
      <textarea v-model="pasteText" class="textarea" :maxlength="-1" :placeholder="pastePlaceholder" />
      <view class="actions">
        <button size="mini" @tap="importText(pasteText, 'csv')">按 CSV 导入</button>
        <button size="mini" @tap="importText(pasteText, 'json')">按 JSON 导入</button>
      </view>
    </view>

    <view v-if="report" class="section">
      <view class="section-title">导入结果</view>
      <text v-if="report.fatal" class="error">{{ report.fatal }}</text>
      <block v-else>
        <text>新增 {{ report.added }} 条，跳过重复 {{ report.duplicates }} 条，出错 {{ report.errors.length }} 条</text>
        <text v-for="e in report.errors.slice(0, 20)" :key="e.row" class="error">第 {{ e.row }} 行：{{ e.message }}</text>
        <text v-if="report.errors.length > 20" class="hint">还有 {{ report.errors.length - 20 }} 条错误没显示</text>
      </block>
    </view>

    <view v-if="!readOnly" class="section">
      <view class="section-title">{{ editingId ? '修改题目' : '添加题目' }}</view>
      <block v-if="bank.gameType === 'undercover'">
        <input v-model="form.civilian" class="input" placeholder="平民词" />
        <input v-model="form.undercover" class="input" placeholder="卧底词" />
        <view class="row">
          <text>能用在你画我猜谁是卧底</text>
          <switch :checked="form.drawable" @change="onDrawableChange" />
        </view>
      </block>
      <block v-else-if="bank.gameType === 'draw'">
        <input v-model="form.word" class="input" placeholder="词语" />
        <input v-model="form.hint" class="input" placeholder="提示（可选）" />
        <input v-model="form.emoji" class="input" placeholder="emoji（可选）" />
      </block>
      <textarea v-else v-model="form.text" class="textarea short" placeholder="题目内容" />
      <view v-if="bank.gameType === 'undercover'" class="row"><text>词语语言</text><button size="mini" @tap="form.language = 'zh'">{{ form.language === 'zh' ? '✓ ' : '' }}中文</button><button size="mini" @tap="form.language = 'en'">{{ form.language === 'en' ? '✓ ' : '' }}English</button></view>
      <input v-model="form.tags" class="input" placeholder="标签，用 | 分隔（可选）" />
      <view class="row">
        <text>难度</text>
        <view class="seg">
          <text
            v-for="d in difficulties"
            :key="d"
            class="seg-item"
            :class="{ active: form.difficulty === d }"
            @tap="form.difficulty = d"
          >
            {{ DIFFICULTY_LABEL[d] }}
          </text>
        </view>
      </view>
      <view class="actions">
        <button class="primary" size="mini" @tap="save">{{ editingId ? '保存' : '添加' }}</button>
        <button v-if="editingId" size="mini" @tap="resetForm">取消</button>
      </view>
    </view>

    <view class="section"><view class="section-title">筛选题目</view><input v-model="search" class="input" placeholder="搜索词语或分类标签" /><view class="row"><button size="mini" @tap="languageFilter=''">全部语言</button><button size="mini" @tap="languageFilter='zh'">中文</button><button size="mini" @tap="languageFilter='en'">English</button></view><view class="row"><button size="mini" @tap="difficultyFilter=0">全部难度</button><button v-for="d in difficulties" :key="d" size="mini" @tap="difficultyFilter=d">{{ DIFFICULTY_LABEL[d] }}</button></view><text class="hint">{{ filteredItems.length }} 条匹配 · {{ languageFilter || '全部语言' }} · 难度 {{ difficultyFilter || '全部' }}</text></view>
    <view class="section">
      <view class="section-title">题目</view>
      <button v-if="filteredItems.length > visibleCount" size="mini" @tap="visibleCount += 60">显示更多</button>
      <view v-if="filteredItems.length === 0" class="empty">还没有题目</view>
      <view v-for="it in filteredItems.slice(0, visibleCount)" :key="it.id" class="item">
        <view class="item-main" @tap="edit(it)">
          <text>{{ summary(it) }}</text>
          <text class="hint">{{ meta(it) }}</text>
        </view>
        <text v-if="!readOnly" class="item-del" @tap="removeItem(it)">删除</text>
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import {
  DIFFICULTY_LABEL,
  GAME_TYPE_LABEL,
  csvTemplate,
  exportBank,
  importIntoBank,
  validateDraft,
} from '@/modules/bank'
import type { Bank, BankItem, ContentByType, Difficulty, FileFormat, ImportReport } from '@/modules/bank'
import { CANCELLED, copyText, pickTextFile, saveTextFile } from '@/modules/bank/file-io'
import { languageOf } from '@/modules/bank/language'
import { switchValue } from '@/modules/local/events'
import { LOCAL_USER_ID, bankRepo } from '@/modules/local/session'

const difficulties: Difficulty[] = [1, 2, 3]

const bankId = ref('')
const bank = ref<Bank | null>(null)
const items = ref<BankItem[]>([])
const search = ref('')
const languageFilter = ref('')
const difficultyFilter = ref(0)
const visibleCount = ref(60)
const filteredItems = computed(() => items.value.filter(it => (!languageFilter.value || languageOf(it) === languageFilter.value) && (!difficultyFilter.value || it.difficulty === difficultyFilter.value) && (summary(it) + ' ' + it.tags.join(' ')).toLowerCase().includes(search.value.toLowerCase())))
const report = ref<(ImportReport & { added: number }) | null>(null)
const showPaste = ref(false)
const pasteText = ref('')
const editingId = ref<string | null>(null)
const form = reactive({
  language: 'zh',
  civilian: '',
  undercover: '',
  drawable: true,
  word: '',
  hint: '',
  emoji: '',
  text: '',
  tags: '',
  difficulty: 2 as Difficulty,
})

const readOnly = computed(() => bank.value?.visibility !== 'private' || bank.value.ownerId !== LOCAL_USER_ID)
const pastePlaceholder = computed(() =>
  bank.value ? csvTemplate(bank.value.gameType).replace('﻿', '').split('\r\n')[0] + '\n（第一行是列名）' : '',
)

onLoad(async (query) => {
  bankId.value = String(query?.id ?? '')
  await load()
})

async function load() {
  try {
    bank.value = await bankRepo().getBank(bankId.value)
    items.value = await bankRepo().listItems(bankId.value)
    uni.setNavigationBarTitle({ title: bank.value.name })
  } catch (e) {
    toast(e)
    uni.navigateBack()
  }
}

function toast(e: unknown) {
  uni.showToast({ title: e instanceof Error ? e.message : String(e), icon: 'none' })
}

function summary(it: BankItem): string {
  const c = it.content as Partial<ContentByType['draw'] & ContentByType['undercover'] & ContentByType['truth']>
  if (c.civilian) return `${c.civilian} / ${c.undercover}`
  if (c.word) return `${c.emoji ? `${c.emoji} ` : ''}${c.word}${c.hint ? `（${c.hint}）` : ''}`
  return c.text ?? ''
}

function meta(it: BankItem): string {
  const c = it.content as Partial<ContentByType['undercover']>
  return [DIFFICULTY_LABEL[it.difficulty], it.tags.join('、'), c.drawable ? '可画' : '']
    .filter(Boolean)
    .join(' · ')
}

function onDrawableChange(e: Event) {
  form.drawable = switchValue(e)
}

function resetForm() {
  editingId.value = null
  Object.assign(form, { civilian: '', undercover: '', drawable: true, word: '', hint: '', emoji: '', text: '', tags: '', difficulty: 2 })
}

function edit(it: BankItem) {
  if (readOnly.value) return
  const c = it.content as Partial<ContentByType['draw'] & ContentByType['undercover'] & ContentByType['truth']>
  editingId.value = it.id
  Object.assign(form, {
    language: languageOf(it),
    civilian: c.civilian ?? '',
    undercover: c.undercover ?? '',
    drawable: c.drawable ?? false,
    word: c.word ?? '',
    hint: c.hint ?? '',
    emoji: c.emoji ?? '',
    text: c.text ?? '',
    tags: it.tags.filter(t=>!t.startsWith('lang:')).join('|'),
    difficulty: it.difficulty,
  })
}

function formContent() {
  switch (bank.value?.gameType) {
    case 'undercover':
      return { civilian: form.civilian, undercover: form.undercover, drawable: form.drawable }
    case 'draw':
      return { word: form.word, hint: form.hint, emoji: form.emoji }
    default:
      return { text: form.text }
  }
}

async function save() {
  if (!bank.value) return
  const r = validateDraft(bank.value.gameType, { content: formContent(), tags: bank.value.gameType === 'undercover' ? [...form.tags.split('|').filter(t=>t.trim() && !t.trim().startsWith('lang:')), 'lang:' + form.language] : form.tags, difficulty: form.difficulty })
  if (!r.ok) return toast(r.error)
  try {
    if (editingId.value) {
      await bankRepo().updateItem(editingId.value, r.value, LOCAL_USER_ID)
    } else {
      const { duplicates } = await bankRepo().addItems(bankId.value, [r.value], LOCAL_USER_ID)
      if (duplicates) toast('这道题已经有了')
    }
    resetForm()
    await load()
  } catch (e) {
    toast(e)
  }
}

function removeItem(it: BankItem) {
  uni.showModal({
    title: '删除题目',
    content: summary(it),
    success: async (r) => {
      if (!r.confirm) return
      await bankRepo().deleteItem(it.id, LOCAL_USER_ID).catch(toast)
      if (editingId.value === it.id) resetForm()
      await load()
    },
  })
}

async function importText(text: string, format: FileFormat) {
  if (!text.trim()) return toast('先粘贴内容')
  try {
    report.value = await importIntoBank(bankRepo(), bankId.value, text, format, LOCAL_USER_ID)
    if (!report.value.fatal) {
      pasteText.value = ''
      showPaste.value = false
    }
    await load()
  } catch (e) {
    toast(e)
  }
}

async function importFile() {
  try {
    const file = await pickTextFile()
    await importText(file.text, file.name.toLowerCase().endsWith('.json') ? 'json' : 'csv')
  } catch (e) {
    if (!(e instanceof Error && e.message === CANCELLED)) toast(e)
  }
}

async function share(fileName: string, text: string) {
  try {
    await saveTextFile(fileName, text)
  } catch (e) {
    uni.showModal({
      title: '导出失败',
      content: `${(e as Error).message}。要把内容复制到剪贴板吗？`,
      success: (r) => {
        if (r.confirm) copyText(text).catch(toast)
      },
    })
  }
}

async function exportAs(format: FileFormat) {
  const file = await exportBank(bankRepo(), bankId.value, format)
  await share(file.fileName, file.text)
}

async function downloadTemplate() {
  if (bank.value) await share(`${GAME_TYPE_LABEL[bank.value.gameType]}模板.csv`, csvTemplate(bank.value.gameType))
}

function rename() {
  if (!bank.value) return
  uni.showModal({
    title: '题库改名',
    editable: true,
    content: bank.value.name,
    success: async (r) => {
      if (!r.confirm) return
      await bankRepo().updateBank(bankId.value, { name: r.content ?? '' }, LOCAL_USER_ID).catch(toast)
      await load()
    },
  })
}

function removeBank() {
  uni.showModal({
    title: '删除题库',
    content: '题库里的题目会一起删除，确定吗？',
    success: async (r) => {
      if (!r.confirm) return
      try {
        await bankRepo().deleteBank(bankId.value, LOCAL_USER_ID)
        uni.navigateBack()
      } catch (e) {
        toast(e)
      }
    },
  })
}
</script>

<style>
@import '../styles/c-temp.css';

.notice.top {
  margin: 16rpx 0 0;
}
.item {
  display: flex;
  align-items: center;
  padding: 16rpx 0;
  border-bottom: 1rpx solid #eef0f5;
}
.item-main {
  flex: 1;
}
.item-del {
  padding-left: 24rpx;
  color: #d93025;
  font-size: 24rpx;
}
</style>
