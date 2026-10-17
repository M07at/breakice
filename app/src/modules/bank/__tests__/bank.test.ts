import { describe, expect, it } from 'vitest'
import { createRng } from '../../shared/random'
import {
  BankError,
  GAME_TYPES,
  MemoryBankRepository,
  createSeededRepository,
  csvTemplate,
  exportBank,
  exportCsv,
  exportJson,
  importCsv,
  importIntoBank,
  importJson,
  itemKey,
  loadSystemBanks,
  parseCsv,
  pickItems,
  pickUndercoverPair,
  toCsv,
  validateDraft,
} from '..'
import type { BankItem, ItemDraft } from '..'
import { unescapeCell } from '../csv'

const pair = (civilian: string, undercover: string, drawable?: boolean): ItemDraft<'undercover'> => ({
  content: { civilian, undercover, ...(drawable === undefined ? {} : { drawable }) },
  tags: [],
  difficulty: 2,
})

async function bankError(p: Promise<unknown>): Promise<string | undefined> {
  try {
    await p
  } catch (e) {
    return e instanceof BankError ? e.code : 'NOT_BANK_ERROR'
  }
  return undefined
}

describe('CSV 解析', () => {
  it('处理 BOM、CRLF、引号、逗号、引号内换行，跳过空行', () => {
    const text = '﻿平民词,卧底词\r\n"苹果,红的",梨\r\n\r\n"说""你好""",嗨\n"第一行\n第二行",x\n'
    const rows = parseCsv(text)
    expect(rows.map((r) => r.cells)).toEqual([
      ['平民词', '卧底词'],
      ['苹果,红的', '梨'],
      ['说"你好"', '嗨'],
      ['第一行\n第二行', 'x'],
    ])
    expect(rows.map((r) => r.line)).toEqual([1, 2, 4, 5])
  })

  it('引号没闭合报出行号', () => {
    expect(() => parseCsv('a,b\n"oops,c')).toThrow('第 2 行的引号没有闭合')
  })

  it('导出再解析内容不变，公式前缀能还原', () => {
    const rows = [
      ['a,b', 'say "hi"'],
      ['多\n行', ' 前后空格 '],
      ['=SUM(A1)', '@me'],
    ]
    const back = parseCsv(toCsv(rows)).map((r) => r.cells.map(unescapeCell))
    expect(back).toEqual(rows)
    expect(toCsv([['=1+1']])).toContain("'=1+1")
  })
})

describe('校验', () => {
  it('难度、标签、可画都能用中文填', () => {
    const r = validateDraft('undercover', {
      content: { civilian: ' 苹果 ', undercover: '梨', drawable: '是' },
      tags: '食物|水果|食物',
      difficulty: '难',
    })
    expect(r).toEqual({
      ok: true,
      value: { content: { civilian: '苹果', undercover: '梨', drawable: true }, tags: ['食物', '水果'], difficulty: 3 },
    })
  })

  it.each([
    [{ content: { civilian: '猫', undercover: '猫' } }, '平民词和卧底词不能一样'],
    [{ content: { civilian: '', undercover: '狗' } }, '「平民词」不能为空'],
    [{ content: { civilian: '一二三四五六七八九十一二三', undercover: '狗' } }, '「平民词」最多 12 个字'],
    [{ content: { civilian: '猫', undercover: '狗' }, difficulty: '超难' }, '「难度」只能填 1、2、3（或 易、中、难）'],
    [{ content: { civilian: '猫', undercover: '狗' }, tags: 'a|b|c|d|e|f' }, '最多 5 个标签'],
    [{ content: { civilian: '猫', undercover: '狗', drawable: '也许' } }, '「可画」只能填 是 或 否'],
  ])('卧底词对报错 %#', (raw, error) => {
    expect(validateDraft('undercover', raw)).toEqual({ ok: false, error })
  })

  it('emoji 按一个字算，文本题太短会拒绝', () => {
    expect(validateDraft('draw', { content: { word: '火锅', emoji: '🍲🔥' } }).ok).toBe(true)
    expect(validateDraft('truth', { content: { text: '嗯' } })).toEqual({ ok: false, error: '「内容」至少 2 个字' })
  })

  it('去重键：词对不分顺序，文本忽略标点空格大小写', () => {
    expect(itemKey('undercover', { civilian: '苹果', undercover: '梨' })).toBe(
      itemKey('undercover', { civilian: '梨', undercover: '苹果' }),
    )
    expect(itemKey('truth', { text: 'Who are you?' })).toBe(itemKey('truth', { text: 'who are you' }))
  })
})

describe('导入导出', () => {
  it.each(GAME_TYPES)('%s 模板可以直接导入', (gameType) => {
    const r = importCsv(gameType, csvTemplate(gameType))
    expect(r.fatal).toBeNull()
    expect(r.errors).toEqual([])
    expect(r.drafts.length).toBeGreaterThan(0)
  })

  it('认英文列名，列顺序随意，多余列忽略', () => {
    const r = importCsv('undercover', 'note,undercover,civilian\nx,梨,苹果\n')
    expect(r.drafts).toEqual([{ content: { civilian: '苹果', undercover: '梨' }, tags: [], difficulty: 2 }])
  })

  it('缺必填列、乱码、行数超限都是文件级错误', () => {
    expect(importCsv('undercover', '平民词,难度\n苹果,1').fatal).toBe('缺少「卧底词」列，请下载谁是卧底模板对照')
    expect(importCsv('undercover', '平民词,卧底词\n��,梨').fatal).toContain('UTF-8')
    const many = ['平民词,卧底词', ...Array.from({ length: 501 }, (_, i) => `a${i},b${i}`)].join('\n')
    expect(importCsv('undercover', many).fatal).toBe('一次最多导入 500 条')
    expect(importCsv('undercover', '平民词,卧底词\n').fatal).toContain('没有题目')
  })

  it('逐行报错带行号，重复的跳过并计数', () => {
    const csv = '平民词,卧底词\n苹果,梨\n猫,猫\n梨,苹果\n狗,狼\n'
    const r = importCsv('undercover', csv, new Set([itemKey('undercover', { civilian: '狗', undercover: '狼' })]))
    expect(r.drafts).toHaveLength(1)
    expect(r.errors).toEqual([{ row: 3, message: '平民词和卧底词不能一样' }])
    expect(r.duplicates).toBe(2)
  })

  it('CSV 和 JSON 导出后再导入，内容一样', () => {
    const drafts: ItemDraft[] = [
      { content: { word: '火锅', emoji: '🍲', hint: '吃的, 辣' }, tags: ['食物', '冬天'], difficulty: 1 },
      { content: { word: '=长颈鹿' }, tags: [], difficulty: 3 },
    ]
    expect(importCsv('draw', exportCsv('draw', drafts)).drafts).toEqual(drafts)
    const json = exportJson({ name: '我的词库', gameType: 'draw', description: '测试' }, drafts)
    const r = importJson('draw', json)
    expect(r.drafts).toEqual(drafts)
    expect(r.meta).toEqual({ name: '我的词库', description: '测试' })
  })

  it('JSON 接受纯数组和平铺写法，拒绝别的游戏的题库', () => {
    expect(importJson('truth', '[{"text":"最近一次哭是什么时候？"},{"content":{"text":"你的 MBTI 是？"}}]').drafts).toHaveLength(2)
    expect(importJson('undercover', '{"gameType":"truth","items":[]}').fatal).toBe('这是「真心话」题库，不能导入到「谁是卧底」')
    expect(importJson('undercover', '{oops').fatal).toBe('不是有效的 JSON 文件')
    expect(importJson('undercover', '{"name":"x"}').fatal).toContain('items')
  })
})

describe('抽题', () => {
  const pool = Array.from({ length: 5 }, (_, i) => ({ id: `i${i}` }))

  it('优先抽没用过的', () => {
    const used = new Set(['i0', 'i1', 'i2'])
    const r = pickItems(pool, 2, used, createRng(1))
    expect(r.recycled).toBe(false)
    expect(new Set(r.items.map((i) => i.id))).toEqual(new Set(['i3', 'i4']))
  })

  it('没用过的不够时混入用过的，并标记', () => {
    const r = pickItems(pool, 3, new Set(['i0', 'i1', 'i2']), createRng(1))
    expect(r.recycled).toBe(true)
    expect(r.items).toHaveLength(3)
    expect(r.items.map((i) => i.id)).toEqual(expect.arrayContaining(['i3', 'i4']))
    expect(pickItems(pool, 0, new Set(), createRng(1)).items).toEqual([])
  })

  it('融合玩法只抽能画的词对', () => {
    const items: BankItem<'undercover'>[] = [
      { id: 'a', bankId: 'b', ...pair('图书馆', '自习室', false) },
      { id: 'b', bankId: 'b', ...pair('苹果', '梨', true) },
    ]
    for (let seed = 1; seed <= 5; seed++) {
      expect(pickUndercoverPair(items, new Set(), createRng(seed), { drawableOnly: true })!.item.id).toBe('b')
    }
    expect(pickUndercoverPair([], new Set(), createRng(1))).toBeNull()
  })
})

describe('题库仓库', () => {
  it('系统题库只读，私有题库只有创建者能改，别人看不到', async () => {
    const repo = new MemoryBankRepository()
    const sys = repo.seedSystemBank({ name: '系统', gameType: 'undercover', description: '' }, [pair('猫', '狗')])
    const mine = await repo.createBank({ name: '社团专用', gameType: 'undercover', description: '' }, 'u1')

    expect(await bankError(repo.addItems(sys.id, [pair('a', 'b')], 'u1'))).toBe('READ_ONLY')
    expect(await bankError(repo.addItems(mine.id, [pair('a', 'b')], 'u2'))).toBe('NOT_OWNER')
    expect(await bankError(repo.createBank({ name: '', gameType: 'undercover', description: '' }, 'u1'))).toBe('INVALID')
    expect((await repo.listBanks('u1')).map((b) => b.id)).toEqual([sys.id, mine.id])
    expect((await repo.listBanks('u2')).map((b) => b.id)).toEqual([sys.id])
    expect(await repo.listBanks('u1', 'truth')).toEqual([])
  })

  it('增删改查，重复题目跳过', async () => {
    const repo = new MemoryBankRepository()
    const bank = await repo.createBank({ name: '测试', gameType: 'undercover', description: '' }, 'u1')
    const { added, duplicates } = await repo.addItems(bank.id, [pair('猫', '狗'), pair('狗', '猫'), pair('牛', '羊')], 'u1')
    expect(added).toHaveLength(2)
    expect(duplicates).toBe(1)
    const updated = await repo.updateItem(added[0].id, pair('猫', '老虎'), 'u1')
    expect(updated.content).toEqual({ civilian: '猫', undercover: '老虎' })
    await repo.deleteItem(added[1].id, 'u1')
    expect(await repo.listItems(bank.id)).toHaveLength(1)
    await repo.updateBank(bank.id, { name: '改名了' }, 'u1')
    expect((await repo.getBank(bank.id)).name).toBe('改名了')
    await repo.deleteBank(bank.id, 'u1')
    expect(await bankError(repo.getBank(bank.id))).toBe('NOT_FOUND')
  })

  it('导入到题库给出报告，导出文件名去掉非法字符', async () => {
    const repo = new MemoryBankRepository()
    const bank = await repo.createBank({ name: '社团/招新', gameType: 'undercover', description: '' }, 'u1')
    await repo.addItems(bank.id, [pair('猫', '狗')], 'u1')
    const report = await importIntoBank(repo, bank.id, '平民词,卧底词\n狗,猫\n牛,羊\n马,马\n', 'csv', 'u1')
    expect(report.added).toBe(1)
    expect(report.duplicates).toBe(1)
    expect(report.errors).toHaveLength(1)
    const file = await exportBank(repo, bank.id, 'json')
    expect(file.fileName).toBe('社团_招新.json')
    expect(importJson('undercover', file.text).drafts).toHaveLength(2)
  })
})

describe('系统题库（原创数据集）', () => {
  const banks = loadSystemBanks()
  const byType = Object.fromEntries(banks.map((b) => [b.meta.gameType, b]))

  it('四个游戏各有一套，条数够玩，每档难度都有', () => {
    expect(banks.map((b) => b.meta.gameType).sort()).toEqual([...GAME_TYPES].sort())
    const minimum = { undercover: 150, draw: 200, truth: 60, dare: 50 }
    for (const b of banks) {
      expect(b.drafts.length).toBeGreaterThanOrEqual(minimum[b.meta.gameType])
      expect(new Set(b.drafts.map((d) => d.difficulty))).toEqual(new Set([1, 2, 3]))
    }
  })

  it('卧底词对大部分能画，融合玩法有足够的词', () => {
    const drawable = byType.undercover.drafts.filter((d) => (d.content as { drawable?: boolean }).drawable)
    expect(drawable.length).toBeGreaterThanOrEqual(100)
  })

  it('真心话和大冒险不含不适合陌生人破冰的内容', () => {
    const banned = /喝酒|酒精|抽烟|吸烟|亲吻|亲一下|拥抱|前任|恋爱|表白|裸|脱衣|赌|工资|体重/
    for (const t of ['truth', 'dare'] as const) {
      for (const d of byType[t].drafts) expect((d.content as { text: string }).text).not.toMatch(banned)
    }
  })

  it('系统题库 ID 固定，融合玩法能从里面抽到能画的词', async () => {
    const repo = createSeededRepository()
    const all = await repo.listBanks(null)
    expect(all.map((b) => b.id).sort()).toEqual(['sys_dare', 'sys_draw', 'sys_truth', 'sys_undercover'])
    expect(all.every((b) => b.visibility === 'system')).toBe(true)
    const pool = (await repo.listItems('sys_undercover')) as BankItem<'undercover'>[]
    const picked = pickUndercoverPair(pool, new Set(), createRng(7), { drawableOnly: true })
    expect(picked?.item.content.drawable).toBe(true)
  })
})

describe('自建题库保存到手机', () => {
  it('每次改动都会通知保存；存档只含自建题库，恢复后 ID 和内容一致', async () => {
    let saves = 0
    const repo = createSeededRepository({ onChange: () => saves++ })
    const bank = await repo.createBank({ name: '社团专用', gameType: 'truth', description: '' }, 'u1')
    const { added } = await repo.addItems(bank.id, [{ content: { text: '你为什么想加入我们？' }, tags: [], difficulty: 1 }], 'u1')
    await repo.updateItem(added[0].id, { content: { text: '你为什么想加入社团？' }, tags: ['破冰'], difficulty: 2 }, 'u1')
    expect(saves).toBe(3)

    const snap = JSON.parse(JSON.stringify(repo.snapshot()))
    expect(snap.banks.map((b: { id: string }) => b.id)).toEqual([bank.id])

    const reopened = createSeededRepository()
    expect(reopened.restore(snap)).toBe(1)
    expect(await reopened.listItems(bank.id)).toEqual(await repo.listItems(bank.id))
    expect((await reopened.listBanks('u1', 'truth')).map((b) => b.id)).toEqual(['sys_truth', bank.id])

    // 恢复后新建的题库不会和旧的撞 ID
    const another = await reopened.createBank({ name: '第二个', gameType: 'truth', description: '' }, 'u1')
    expect([bank.id, added[0].id]).not.toContain(another.id)
  })

  it('存档坏了就忽略，系统题库不受影响', async () => {
    const repo = createSeededRepository()
    expect(repo.restore(null)).toBe(0)
    expect(repo.restore({ version: 2, banks: [], items: [] })).toBe(0)
    expect(
      repo.restore({
        version: 1,
        seq: 5,
        banks: [
          { id: 'bank_1', name: '', gameType: 'truth', visibility: 'private', ownerId: 'u1' },
          { id: 'sys_truth', name: '冒充系统', gameType: 'truth', visibility: 'private', ownerId: 'u1' },
          { id: 'bank_2', name: '正常', gameType: 'truth', visibility: 'private', ownerId: 'u1', description: '' },
        ],
        items: [
          { id: 'item_3', bankId: 'bank_2', content: { text: '嗯' }, tags: [], difficulty: 1 },
          { id: 'item_4', bankId: 'bank_2', content: { text: '最喜欢的歌？' }, tags: [], difficulty: 1 },
        ],
      }),
    ).toBe(1)
    expect((await repo.listItems('bank_2')).map((i) => i.id)).toEqual(['item_4'])
    expect((await repo.getBank('sys_truth')).visibility).toBe('system')
  })
})
