# B 集成指南：画布、AI 评分展示、统一计分怎么和 A、C、D 合到一起

负责人：B。对应 [`C-集成指南.md`](./C-集成指南.md) 第 5 节里点名的 **B1 / B2**。
C 的计划见 [`C-模块计划.md`](./C-模块计划.md)，全组顺序见 [`项目开发顺序.md`](./项目开发顺序.md)。

这份文档和 C 那份是同一个体例：**我提供什么、我需要别人提供什么、按什么顺序合并**。
标「待确认」的是我的假设，需要对应同学确认后改成定论。

---

## 1. 一句话结论

B 的代码已经按 README 划给我的三个目录落地，**没有改任何人的文件**：

| 目录 | 内容 |
|---|---|
| `app/src/modules/draw/` | 画布引擎、笔画分片、同步通道、题面挑选、AI 评分解析、单机会话 |
| `app/src/modules/score/` | 统一计分（含 AI 权重）、排行榜、幂等记账 |
| `app/src/pages-draw/` | 你画我猜的设置页与作画页（分包） |
| `app/src/components/` | `draw-canvas`、`score-card`、`leaderboard` |

对别人的文件只有两处**追加**，都已在 PR 里说明：

- `app/src/pages.json`：加了 `pages-draw` 分包（只加自己的，没动 D 的主包和 C 的分包）
- `app/src/pages/index/index.vue`：开发入口里加了一行按钮（D 的大厅做好后和另外两个入口一起删）

现在**没有**接的只有三件事，全部等 A：真上传、真 AI 评分、真频道。三件事都留了接口，换实现不用改页面。

---

## 2. 给 C（B1 画布 + B2 计分）

### 2.1 B1：画布组件的用法

C 的融合玩法页 `pages-uc/play.vue` 里现在写的是：

> 画布位置：接入 B 的画布组件后在这里作画 / 观看

把那行换成：

```vue
<draw-canvas
  v-if="turnEngine"
  ref="board"
  :engine="turnEngine"
  :mode="isMyTurn ? 'draw' : 'watch'"
  variant="classic"
  @change="onBoardChange"
  @error="onBoardError"
/>
```

```ts
import DrawCanvas from '@/components/draw-canvas/draw-canvas.vue'

// 作画者：自己这块产生操作流
const turnEngine = isMyTurn ? new DrawEngine({ by: myUserId }) : new DrawEngine({ by: 'viewer' })
```

组件 props：

| prop | 类型 | 说明 |
|---|---|---|
| `engine` | `DrawEngine` | **必填**。作画者传自己的引擎，观看者传一个只用来接收别人的引擎 |
| `mode` | `'draw' \| 'watch' \| 'readonly'` | 作画 / 只看 / 只读复盘。`watch` 和 `readonly` 都不响应触摸 |
| `variant` | `'classic' \| 'emoji' \| 'custom'` | `emoji` 会关掉画笔、打开贴纸面板 |
| `palette` | `readonly string[]` | Emoji 版这一回合的贴纸面板。**每回合从上层的贴纸池随机抽 10–20 个**（见 2.4），不传就用池子前 12 个 |

组件 events：

| 事件 | 载荷 | 什么时候触发 |
|---|---|---|
| `change` | 无 | 落笔、抬手、贴贴纸、撤销、清空、缩放旋转之后。用来刷新「已同步几条」这类统计 |
| `error` | `string` | 画布节点没拿到、贴纸到上限之类的可提示错误 |

组件对外方法（`ref` 拿）：

| 方法 | 返回 | 用途 |
|---|---|---|
| `exportPng()` | `Promise<string>` | 导出 PNG 的本地临时路径。**超过 100KB 会自动降一档分辨率重导** |
| `exportBase64()` | `Promise<string>` | `data:image/png;base64,...`。H5 走 `toDataURL`，小程序走文件系统读 base64 |
| `paint()` | 无 | 强制重绘。观看端收到分片应用完之后调（作画端不用管） |
| `reset()` | 无 | 换回合清空。**内部 seq 继续递增**，见 2.3 |

融合玩法里 C 需要的就是这一条链路：

```ts
// 1. 回合结束或倒计时到点前，把画导出来
const localPath = await board.value.exportPng()
// 2. 上传到 A 的 Storage，拿 fileID（等 A 的路径规则，第 6 节）
const fileId = await uploadDrawing(localPath)
// 3. 用 C 引擎里已有的动作提交，回合结束后还能补交
await backend.act(gameId, { type: 'drawingSubmitted', turnKey, drawingRef: fileId })
```

C 的引擎里 `drawingSubmitted`、`drawings`、`aiScores` 已经齐了，所以这条链路 C 这边**不用改逻辑**，只是把占位换掉。

**这件事已经做了**，见 2.5——我直接改了 `pages-uc/play.vue`，请 C review 那一处。

### 2.2 B2：计分入口

C 的引擎每次产生 `{ type: 'score', playerId, reason, points }` 时，转成下面这个形状交给 B：

```ts
interface ScoreEvent {
  roomId: string
  gameId: string
  playerId: string
  reason: ScoreReason
  points: number          // 建议值，B 会乘权重
  roundKey?: string       // ⚠️ 见下面的警告，会重复的 reason 必须带
}
```

```ts
import { LocalScoreSink } from '@/modules/score'
const sink = new LocalScoreSink({ names, seats })
await sink.submit(events)         // 返回最新排行榜
```

单机模式下 C 已经在 `LocalUcBackend` 里挂了 `onScore`，把里面的 `scores[...] += points` 换成 `sink.book.apply([...])` 就行，页面读 `sink.book.rows()`。

**⚠️ `roundKey` 必须带的情况**：幂等键是 `roundKey ?? gameId : playerId : reason`。

| reason | 一局里会发生几次 | 要不要 `roundKey` |
|---|---|---|
| `uc_win_civilian` / `uc_win_undercover` | 1 次 | 不带也行 |
| `uc_survive` | 1 次 | 不带也行 |
| `uc_ai_bonus` | 每局每人 1 次 | 不带也行 |
| **`uc_correct_vote`** | **每轮都可能有** | **必须带当前轮次** |

`uc_correct_vote` 如果每轮都不带 `roundKey`，第 2 轮开始就会被幂等挡掉、不再加分——这是最容易踩的一个坑。

B 这边的权重表（`DEFAULT_SCORE_CONFIG.weights`）默认全是 1，也就是**照 C 的建议分值记账**。想调（比如把卧底获胜从 4 调到 6）只改一处，C 那边不用动。

### 2.3 换回合时的一条铁律

`DrawEngine.reset()` 清画面但**故意不重置 `seq`**。如果重置成 0，观看端手里的 `maxSeq` 会把新回合的操作全部当成「旧分片」丢掉，画面就永远空着。

所以：

- 换人作画 → 同一个引擎 `reset()`，或者新建引擎时保证 `by` 换了
- **不要**给两个引擎的 `by` 传同一个值，否则分片会被当成自己发的回显丢掉

### 2.4 Emoji 版：贴纸面板每回合随机抽

不是把池子全砸给你，而是**每回合随机发 10–20 个**：

```ts
import { pickEmojiPalette } from '@/modules/draw'

const palette = pickEmojiPalette(rng, {
  // 可选：不填就随机 10–20 个
  count: undefined,
  // 一定要剔掉这道题自己的 emoji，否则贴一下就猜中了
  exclude: word.emoji ? [word.emoji] : [],
})
```

- 池子在 `modules/draw/words.ts` 的 `EMOJI_POOL`，**403 个**（已去重），分表情 / 动物 / 吃的 / 自然 / 用品 / 交通 / 符号七类；
- 同一个 `rng` 能复现同一份面板，服务端要重放的时候用得上；
- 面板只对**作画者**有意义，观看端拿不到也不用拿；
- 融合玩法（`variant: 'draw'`）是轮流用画笔，不走 Emoji 版。

**题面不按 emoji 过滤**：三个版本都从整个词库里抽。词库里那个 `emoji` 字段现在只有一个用途——**把这道题的 emoji 从贴纸面板里剔掉**，绝不出现在界面上（它就是答案本身）。

**提示口径**（作画页那张题面卡）：前 30 秒只显示「3 个字」，30 秒后再补上类别「3 个字 · 动物」。不显示 emoji。题面卡是带颜色的卡片、贴在画布正上方，最后 10 秒变红。

**选中贴纸之后**有三种调整方式，都会合成一条 `emoji-update` 操作发出去：
1. 双指旋转 + 缩放（先点一下贴纸选中，再两指捏合）；
2. 滑块分别调大小（24–260）和角度（0–359，1° 步进）；
3. 两个按钮一次转 ±15°，方便微调。

### 2.5 融合玩法已经接上了（改了 C 的文件）

**这个玩法和语言版不是一个游戏**，按产品要求重做了流程：

| 规则 | 实现 |
|---|---|
| **没有主持人** | 单机后端 `isHost` 一律 `true`；页面上不再有「主持人」字样，玩家名就叫「我」「玩家2」… |
| **谁都不能提前结束一局** | 页面上的「结束游戏」按钮和 `confirmEnd` 已删除；引擎里的 `endGame` 动作还在，但**没有任何界面入口**能触发 |
| 有人不画画怎么办 | **不做投票跳过**（这是线下游戏，谁没画大家看得见）：轮到某人 25 秒还没交，引擎到点自动轮下一位，他的画作位留空，投票阶段的轮播显示「这张没交画」 |
| **每人一台手机，只看得见自己的词** | 这台设备固定是「我」的身份（`LOCAL_USER_ID`），不切换、不认领；词卡点开只显示我自己的词。别人的词根本不在这台机器上 |
| 每人轮流画自己的词 | 沿用 C 引擎的 `describe` 阶段，一回合一块画布（换人即换引擎），**每人 25 秒** |
| **到点自动交画** | 25 秒一到，如果正在画的是我，先把画导出并 `drawingSubmitted`（顺带调 AI 打分），再把回合推给下一位——**不点「画完了」也不会丢画**。同一回合只交一次，按了按钮又到点也不会重复提交/重复计分。「画完了」按钮保留，用来提前结束 |
| **全部画作在页面上轮流显示** | 投票阶段顶部加画作轮播：每 1.6 秒切一张，也可以点小圆点手动翻；没交画的显示「这张没交画」 |
| 最后一起投票 | 沿用 C 引擎的 `vote` 阶段；**所有有票权的人都投过就立刻揭晓**（弃权也算投过），没投满就等 30 秒超时。投票对象下面有一个单独的整行「弃权」按钮 |
| **最后由 AI 给每个玩家打分** | 每人交完画立刻调 AI，按**契合度**（这张画和画者自己的词有多像）写回 `aiScored`；分数结束前不公开，结算页每人一行「AI 87」 |

改了 C 的这几个文件，**必须他 review**：

| 文件 | 改了什么 | 为什么 |
|---|---|---|
| `modules/undercover/backend.ts` | `UcClientAction` 加 `aiScored`；`act()` 的 `isHost` 改成恒 `true` | 页面要把 AI 分写回局面；这个玩法没有主持人 |
| `modules/undercover/__tests__/engine.test.ts` | 一条断言从「非主持人跳过要被拒绝」改成「谁都能跳过」 | 规则变了，旧断言描述的是语言版的主持人规则 |
| `pages-uc/play.vue` | 画布接入、真交画、轮播、结算页 AI 列、去掉主持人门槛 | 见上表 |

**还是没做的**：画作没上传——`drawingRef` 是本机临时路径，**只在同一台手机上能显示**，多设备要等 A 的 Storage（A9）。多设备时观看端的同步也没接，现在是单机轮流画。

### 2.6 你画我猜是**联机**的：`DrawRoomBackend`

这一页按「每人一台手机」写，**这台设备只是「我」一个玩家**：轮到我画就能画、有题面和提示；不是我的回合只看（笔画走频道同步）；全部画完由服务端算分，页面显示每个人的 AI 分和排名。一局里每人画一次。

页面不认识"谁在手机间传递"这件事，只依赖一个接口（`modules/draw/room.ts`）：

| 方法 | 谁实现 | 说明 |
|---|---|---|
| `view()` | A | 房间快照：谁在画、第几位、这一轮什么时候结束、**服务端时间**、我交过没有、结算后的排名 |
| `subscribe(cb)` | A | 房间状态变化（轮次、交画、结束）推送 |
| `submitDrawing(imageRef)` | A | 只接受**当前作画者**的提交；同一轮只收一次；触发 AI 评分 |
| `tick()` | A | 倒计时归零时客户端调用，重复调用安全（和 C 的 `uc_tick` 同款） |
| `sendMessage(text)` | A | 聊天/抢答：判断答没答对、把答案里的字遮成冰块、答对时记一次抢答用时（用来算抢答分） |
| `sendReaction(targetId, kind)` | A | 送花 / 点差评：只累加计数（`flower` / `dislike`） |

两条硬规则：

1. **题面只下发给作画者**（`view.word` 对别人必须是 `null`）——不然谁都能看到别人的词；
2. **别人的画在结算前不下发**（`view.drawings` 里只有自己那张），结算后才一起公开。

笔画同步还是 `StrokeTransport`（3.3 节）：作画者把分片广播出去，其他人 `applyChunk` 重放。所以 A 一共要给两样东西：**房间状态**（RPC + 频道）和**笔画频道**（广播）。

现在用的是 `LocalDrawRoomBackend`：单机内存实现，**只有「我」能画**，别人那一轮到点自动过去（他们的画在别人的手机上）。和 C 的 `LocalUcBackend` 同一个套路，接入 A 之后换实现，**页面一行都不用改**。

---

## 3. 笔画数据契约

### 3.1 操作流，不是位图

画面 = 把 `DrawOp[]` 重放一遍。撤销、清空、Emoji 拖动都是流里的一条记录，所以远端只要收到同一条流，就能重放出同一幅画。

| 字段 | 说明 |
|---|---|
| `kind` | `stroke` / `emoji` / `emoji-update` / `undo` / `clear` |
| `seq` | 自增序号，回合内唯一。重放和去重全靠它 |
| `points` | `stroke` 专用。**归一化坐标** `{x,y}`，**0–1000 的整数** |
| `color` / `width` | `stroke` 专用。颜色是 `#rrggbb`，宽度 1–40（逻辑画布 px） |
| `emoji` / `x` / `y` / `size` / `rotate` | `emoji` 专用。`size` 是逻辑画布 px，`rotate` 是 0–360 度 |
| `target` | `emoji-update` / `undo` 专用，指向被改或被撤的那条 `seq` |

坐标为什么不是物理像素：逻辑画布固定 800×600，触摸点先除以 canvas 的**屏幕显示尺寸**再乘 1000。谁在什么机型上画，别人看到的都是同一幅画。

### 3.2 分片：5 秒一个

```ts
interface DrawChunk {
  chunkId: string     // 去重
  by: string          // 服务端必须用登录态覆盖，不能信客户端
  ops: DrawOp[]
  seqTo: number       // 分片里最大的 seq，接收方丢旧分片用
  at: number
}
```

规则：

- 每人每 **5 秒** 合并成 1 个分片；操作条数到 60 条或点数到 1200 个就提前发
- 画到一半的笔画**不进分片**，等抬手进下一片（否则远端收到半条线）
- 提交画作时 `pump.flushAll()` 把剩下的发完

为什么要分片：原设计文档 `C-06` 说的是云开发实时监听单次 5000 条记录上限。换成 Supabase 之后这个具体数字不适用了，但**结论不变**——一笔一条会产生写放大和广播风暴，分片是对的。

### 3.3 接到 A 的频道只需要 3 行

```ts
import type { StrokeTransport } from '@/modules/draw'

class ChannelTransport implements StrokeTransport {
  constructor(private roomId: string, private me: string) {}
  send(chunk) { supabase.channel(`room:${this.roomId}`).send({ type: 'broadcast', event: 'draw:chunk', payload: chunk }) }
  subscribe(onChunk) {
    const ch = supabase.channel(`room:${this.roomId}`)
      .on('broadcast', { event: 'draw:chunk' }, ({ payload }) => onChunk(payload))
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }
}
```

把 `startLocalDraw` 里的 `LoopbackTransport` 换成它，页面、组件、引擎一行都不用改。

---

## 4. 给 A（AI 评分的前端契约）

### 4.1 我需要的返回形状

```ts
// 服务端：supabase/functions/ai-score（或 RPC）
scoreDrawing(input: {
  imageRef: string   // Storage 里的路径 / fileID
  word: string       // 本轮题面
  roundKey?: string  // 幂等用，同一张图不要重复计费
}): Promise<{
  score: number                       // 综合 0–100
  dimensions: {
    composition: number               // 构图 0–100
    creativity: number                // 创意 0–100
    relevance: number                 // 契合度 0–100
  }
  comment: string                     // 一段评语
  degraded?: boolean                  // 兜底结果请置 true
  provider?: string                   // 模型名，只用来小字标注
  latencyMs?: number
}>
```

字段名不用完全一致——`modules/draw/ai.ts` 的解析器接受 `score`/`total`、`dimensions`/`dims`、`comment`/`review`、中文键 `构图`/`创意`/`契合度`、以及外面包一层 `data`/`result`。
但**解析不了时会明确失败**，不会把原始文本直接显示给玩家（需求 FR-04 的要求）。

请求体只有三个字段，这是唯一需要 A 对齐的地方：

```ts
POST <endpoint>
{ "imageRef": "room/8f3/r1-bob.png", "word": "长颈鹿", "roundKey": "r1" }
```

`HttpAiScorer` 已经写好了（`modules/draw/ai.ts`），接上只差一个地址：

```ts
startLocalDraw({ variant: 'classic', playerCount: 4, aiEndpoint: <A 给的地址> })
```

不传 `aiEndpoint` 就用 `MockAiScorer`（本地假评分），页面和计分逻辑完全一样。
非 2xx、超时（默认 8 秒）、返回体解析不了，三种情况都会抛 `DrawError('BAD_SCORE')`，由调用方转成降级结果。

### 4.2 降级语义（重要）

| 情况 | 谁来判 | 结果 |
|---|---|---|
| 模型超时 / 5xx / 熔断 | A 的服务端 | 返回 `degraded: true` + `score: 0`，或直接抛错 |
| 返回的不是合法 JSON | B 的解析器 | 抛 `DrawError('BAD_SCORE')`，前端改用兜底 |
| 评语没过内容安全 | A 的服务端 | 保留分数，`comment` 传空字符串 |

三种情况前端都会：**保留分数、丢掉评语、排行榜标注「本轮未含 AI 评分」、游戏照常继续**，不会卡住下一轮。

### 4.3 我还需要的（等 A 确认）

| 编号 | 需要什么 | 我用它做什么 |
|---|---|---|
| A9（和 C 一起） | 画作存哪：Storage 的 bucket 名、路径规则、上传方式（前端直传还是走服务端签名的 URL） | `exportPng()` 出来的是手机本地临时路径，必须先上传才能评分 |
| A6 | `scoreDrawing` 的实际部署地址与调用方式（Edge Function URL 还是 RPC） | 换掉 `MockAiScorer`：`HttpAiScorer` 已就绪，只差地址与鉴权头 |
| A4 | 私有频道 `room:{room_id}` 的订阅方式与广播工具 | 换掉 `LoopbackTransport` |
| — | 排行榜要不要落库。落库的话 B 的 `ScoreEvent` 就是写入形状，幂等键可以直接当唯一索引 | 现在只在内存里记账，重连会丢 |

---

## 5. 计分公式与可调参数

默认值在 `modules/score/rules.ts` 的 `DEFAULT_SCORE_CONFIG`，全部可改：

| 参数 | 默认 | 含义 |
|---|---|---|
| `aiWeight` | 0.5 | AI 总分在作画者得分里的权重 |
| `painterCap` | 100 | 单轮作画者上限 |
| `perGuesser` | 10 | 每被一个人猜中，作画者加多少 |
| `guesserBase` | 50 | 猜中者基础分 |
| `guesserPerSecond` | 0.5 | 猜中者每用掉一秒扣多少 |
| `manualWeight` | 5 | AI 降级时人工评分（0–10）的换算系数 |
| `weights` | 全 1 | C 的事件按这里加权 |

算出来的分：

```
作画者 = min(painterCap, round(AI × aiWeight) + 猜中人数 × perGuesser)
猜中者 = max(0, round(guesserBase − 用时秒 × guesserPerSecond))
卧底   = C 的建议分值 × weights[reason]
```

排行榜排序：总分降序 → 座位先后 → id 字典序。同分并列同名次（1、2、2、4），保证两台手机排出来一样。

---

## 6. 单机演示怎么跑

```bash
cd app
npm run dev:mp-weixin          # 用微信开发者工具导入 app/dist/dev/mp-weixin
```

**导入时注意 AppID**：构建产物里的 `project.config.json` 是 `touristappid`（游客模式），因为 `src/manifest.json` 的 `mp-weixin.appid` 还空着。游客模式能看界面能画，但真机预览和上传体验版都不行——要真机测就把 AppID 填进 `manifest.json`（这个文件归 C，改前打招呼）。

首页「开发入口」→「你画我猜」→ 选版本 → 开始作画。

作画页上有一个 **「我在画 / 别人看到的」** 切换，这是这条链路唯一值得演示的地方：

- 「我在画」= `actor` 引擎，笔迹直接画在画布上
- 「别人看到的」= `viewer` 引擎，画面完全由回环通道投递过来的**分片重放**出来

切过去看到的东西和刚才画的一样，就说明分片格式、序号、重放、去重都是对的。接入 A 的频道之后，这两块就是两台手机。

H5（`npm run dev:h5`）里**画布不工作**：`<canvas type="2d">` 的节点查询是微信小程序端的能力。H5 会显示「正在准备画布…」并提示用微信开发者工具。C 的页面在 H5 里能跑，B 的这块不行，这不是 bug。

---

## 7. 已知限制（这些是真的没做）

| 没做的 | 原因 | 后续怎么办 |
|---|---|---|
| 真上传云存储 | 等 A 的 bucket 与路径规则（A9） | 换掉 `submitDrawRound` 里的 `imageRef` 来源 |
| 真 AI 评分 | 等 A 的 `scoreDrawing` 地址（A6） | 把 `MockAiScorer` 换成 `HttpAiScorer`，页面不动 |
| 真网络同步 | 等 A 的私有频道（A4） | 把 `LoopbackTransport` 换成 `ChannelTransport` |
| 抢答输入与猜中判定 | 属于 D 的大厅/房间与玩法壳 | 现在用「假装有 N 人猜中」的开关演示计分公式 |
| 大屏展示页 | 需求 FR-11，本期不做 | 已降级为后续版本，见需求文档第 2 版说明 |
| 页面级断线重连 | 引擎层已有 `snapshot()` / `loadSnapshot()`，页面层没接 | 等 A 的 `room.sync` 全量同步接口 |
| 人工评分面板 | FR-05 的兜底公式已实现，界面没做 | 后续版本；现在降级时作画者只拿猜中分 |
| 内容安全校验 | 评语与图片的校验在服务端（A） | 前端只负责「校验没过就不显示评语」 |
| 分享卡片、小程序码 | A / D 的范围 | — |

---

## 8. 合并检查清单

贴到 PR 描述里：

- [ ] `cd app && npm run verify` 全部通过（类型检查、单测、构建、包体积、密钥扫描）
- [ ] 只改了 `modules/draw/`、`modules/score/`、`pages-draw/`、三个组件，以及 `pages.json` / 首页入口这两处追加
- [ ] `npm run verify` 的包体积检查里，`pages-draw` 分包体积有数
- [ ] 没有提交 `.env.local`、密钥、`dist/`
- [ ] 接口变了（`DrawOp`、`DrawChunk`、`ScoreEvent`、AI 返回形状）已经同步更新这份文档
- [ ] 改到 `pages.json` 只加了自己的分包
