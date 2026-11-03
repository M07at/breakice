# PR 说明：你画我猜（B1）+ 统一计分（B2）

> 这份是 PR 正文的草稿，提 PR 时整段粘到 Gitee 的描述框里。
> 分支建议：`b/feat-draw-page` → `master`。审查人：C（因为动了 `pages.json`）。

## 做了什么

按 `README.md` 划给 B 的目录，实现「你画我猜」的前端部分和统一计分。**没有新增任何 npm 依赖。**

| 类别 | 内容 |
|---|---|
| 新增模块 | `modules/draw/`：画布引擎、笔画分片、同步通道、Emoji 版（每回合随机器 10–20 个贴纸）、AI 评分解析与 HTTP 调用、单机会话 |
| 新增模块 | `modules/score/`：统一计分（AI 权重 + 幂等）、排行榜 |
| 新增页面 | `pages-draw/setup.vue`、`pages-draw/play.vue`（分包） |
| 新增组件 | `components/draw-canvas/`、`components/score-card/`、`components/leaderboard/` |
| 新增文档 | `docs/B-模块计划.md`、`docs/B-集成指南.md`、`docs/B-PR说明.md`（本 PR 一起合） |
| **追加（请重点看）** | `app/src/pages.json` 加 `pages-draw` 分包；`app/src/pages/index/index.vue` 开发入口加一行按钮 |
| **改了 C 的文件（必须他 review）** | `pages-uc/play.vue`：画布接入、真交画、投票阶段画作轮播、结算页 AI 分列、去掉主持人门槛<br>`modules/undercover/backend.ts`：`UcClientAction` 加 `aiScored`、`isHost` 恒 `true`（这个玩法没有主持人）<br>`modules/undercover/__tests__/engine.test.ts`：一条断言随规则更新（非主持人不再被拒） |

## 文件清单

```
app/src/modules/draw/
  types.ts        笔画 / 操作流 / 分片 / AI 评分结果的数据结构
  errors.ts       DrawError（code + 中文 message）
  engine.ts       画布引擎：落笔/撤销/重做/清空/Emoji、分片聚合、接收分片、快照
  sync.ts         StrokeTransport 接口 + LoopbackTransport + ChunkPump
  ai.ts           normalizeAiScore / MockAiScorer / HttpAiScorer / createUniAiTransport
  words.ts        挑词、调色板、Emoji 面板
  session.ts      单机一局：actor + viewer 两个引擎 + 回环通道
  index.ts        统一出口
  __tests__/engine.test.ts   43 个用例

app/src/modules/score/
  types.ts  rules.ts  engine.ts  backend.ts  index.ts
  __tests__/engine.test.ts   21 个用例

app/src/components/
  draw-canvas/draw-canvas.vue     作画 / 观看 / 只读三种模式
  score-card/score-card.vue       综合分 + 三维度 + 评语 + 降级提示
  leaderboard/leaderboard.vue     排名、+N 动画、旧版本丢弃

app/src/pages-draw/
  setup.vue   选版本（常规/Emoji/自定义）、人数、自定义题面
  play.vue    题面、90 秒倒计时、自动交画、评分卡、排行榜、视角切换
```

## 怎么验

```bash
cd app
npm install
npm run verify        # 类型检查 + 单测 + 构建 + 包体积 + 密钥扫描
```

手动看一遍：

```bash
npm run dev:mp-weixin
# 微信开发者工具导入 app/dist/dev/mp-weixin
```

首页 →「你画我猜」→ 选版本 → 开始作画。然后在作画页把 **「我在画 / 别人看到的」** 切一下——切过去看到的是同一幅画，就说明分片、序号、重放、去重这条链路是通的。这一步不需要任何后端。

> H5（`npm run dev:h5`）里画布不工作，会提示用开发者工具。`<canvas type="2d">` 的节点查询是微信小程序端能力，不是 bug，`docs/B-集成指南.md` 第 6 节写了。

## 接口变更

新增的四个契约，都已经写进 `docs/B-集成指南.md`，C 和 A 需要看：

| 契约 | 谁用 | 说明 |
|---|---|---|
| `DrawOp` / `DrawChunk` | A（频道）、C（融合玩法） | 操作流 + 每 5 秒一个分片；坐标是 0–1000 归一化整数 |
| `StrokeTransport` | A | 私有频道实现这个接口就能替换回环通道 |
| `ScoreEvent` | C、D | C 的 `uc_*` 事件直接送进来；**`uc_correct_vote` 必须带 `roundKey`** |
| AI 评分返回形状 | A | `{ score, dimensions{composition,creativity,relevance}, comment, degraded? }`，解析器对字段名容错 |

没有改任何已有接口。

## 请 reviewer 注意的地方

1. **`pages.json` 只加了自己的分包**，没动主包和 `pages-uc` / `pages-bank`。如果和 D 的分包冲突，两边的都保留。
2. **首页那行按钮**是开发入口，D 的大厅做好后要连另外两个入口一起删。
3. **`c-temp.css`**：`pages-draw` 的页面 `@import` 了 C 的临时样式表，D 的设计系统定下来后这个文件会整体删除，到时候我的页面要跟着换。
4. **没有碰 `package.json` / `package-lock.json`**，所以不需要重新 `npm install`（除了首次）。
5. **没有碰 `supabase/`、`cloudfunctions/`、`scripts/`**。
6. `docs/` 下两份 B 的文档和代码一起合，别分开提，不然接口文档和实现对不上。

## 合并前自查（照 `C-集成指南.md` 第 2 节）

- [x] `cd app && npm run verify` 全部通过，结果贴在这里：

  ```
  type-check    vue-tsc --noEmit，零错误
  test          4 个文件 141 个用例全过（draw 48 / score 21 / undercover 39 / bank 33）
  build         uni build -p mp-weixin，Build complete（编译器 5.26 / vue3）
  check:size    主包 0.18 MB · pages-uc 0.02 MB · pages-bank 0.01 MB · pages-draw 0.01 MB · 总计 0.23 MB
  check:secrets 没有发现密钥
  ```

- [ ] 只改了自己负责的目录；改到 `pages.json` 与 `pages/index/index.vue` 已请 C 审查
- [ ] 接口（`DrawOp`、`DrawChunk`、`ScoreEvent`、AI 返回形状）已同步进 `docs/B-集成指南.md`
- [ ] 没有新增数据库迁移（B 这轮没有表结构变更；排行榜落库等和 A 定完再加）
- [ ] 没有提交 `.env.local`、密钥、`dist/`
- [ ] `pages.json` 只加了自己的分包

## 回滚

只删新增文件 + 撤掉 `pages.json` 的 `pages-draw` 分包和首页那一行按钮即可，不影响 C 和 D 的任何功能。

## 这轮没做的（都已写进 `docs/B-模块计划.md`）

真上传（等 A9）、真频道（等 A4）、排行榜落库、抢答与猜中判定（属 D）、页面级断线重连（等 A 的全量同步接口）。大屏展示页与人工评分面板已按第 2 版范围收窄移出本期。
