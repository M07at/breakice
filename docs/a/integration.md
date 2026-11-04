# B / C / D 接入与合并指南

目标：四个人在同一个仓库里并行开发，互不覆盖。本文只写**边界和顺序**，规则细节看各自文档。

## 1. 先明确谁改哪里

| 目录 | 归属 | 说明 |
| --- | --- | --- |
| `app/src/modules/undercover/` | **C** | 纯规则引擎；A 只能引用，不能改逻辑 |
| `app/src/modules/bank/` | **C** | 题库读写；生产实现对接 `word_banks` / `word_bank_items` |
| `app/src/pages-uc/` | **C** | 谁是卧底与融合玩法的页面 |
| `app/src/pages/`、设计系统、`pages-truth/` | **D** | 大厅、房间、主持/玩家外壳、真心话 |
| `app/src/modules/draw/`（B 新建） | **B** | 画布、笔迹同步、AI 评分展示、计分排行榜 |
| `supabase/`、`docs/a/`、登录与房间状态 | **A** | 数据库、RLS、RPC、函数、频道 |

冲突高发文件：`app/src/pages.json`、`app/package.json`、`app/src/config/env.ts`、
`README.md`。改这些文件前先 `git pull --rebase`，一次只动自己需要的几行。

## 2. 每个人要接的入口

### C（规则与题库）

- 规则引擎保持纯函数：A 的 `uc-command` 会原样复用；
- 题库仓库：把 `app/src/modules/local/session.ts` 里的 `bankRepo()` 换成 Supabase 实现
  （表结构见 `docs/a/contracts.md` §6），开发用 HTTP 代理保留；
- 不要新增 `games.state` 的读写路径——客户端只读 `game_public` 视图。

### D（大厅与房间）

- 建房：`supabase.rpc('create_room', …)`，把返回的 `room_code` 做成分享卡片；
- 加入：`supabase.rpc('join_room', { p_code })`，成功后 `installPlayerPort(realPort, variant)`
  再 `navigateTo(PLAY_GAME_URL)`；
- 成员列表读 `room_members`（RLS 已限定同房）；
- 开赛按钮只对房主显示，但**不要只靠隐藏**：真正的权限在服务端 RPC。

### B（画布与计分）

- 画作上传：`storage.from('artworks').upload('{game_id}/{turn_key}/{user_id}.png', file)`，
  然后 `rpc('submit_artwork', { p_game_id, p_turn_key, p_storage_path })`；
- 评分：`functions.invoke('ai-score', { body: { artwork_id } })`，按
  `status: success | failed | timeout` 三态展示（见 `docs/a/ai-scoring.md`）；
- 计分：写 `scores` 时用 `(game_id, user_id, reason, ref)` 唯一约束保证只加一次；
  排行榜按 `game_id` 聚合。

## 3. 分支与合并

仓库主干是 `master`，当前还有 `dev`、`feat/b-drawcanvas`。

```powershell
git checkout master
git pull --rebase
git checkout -b feat/<你的模块>-<简短说明>
# 开发、自测
npm --prefix app run verify        # 必须本地通过
git add -A
git commit -m "feat(a): 平台数据库与 AI 评分服务"
git push -u origin feat/<你的模块>-<简短说明>
# 到 Gitee 发起 PR → master，按模板填写，等 review
```

规则：

1. 一个 PR 只做一件事，标题带模块前缀（`feat(a):` / `fix(b):` / `docs(d):`）；
2. 不提交 `app/.env.local`、`app/.c3-data/`、`dist/`、`reports/`、`node_modules/`；
3. 改 `supabase/migrations/` 只能**新增**文件，不改历史迁移；
4. 合并前跑 `npm --prefix app run verify`，把 `app/reports/verify.json` 附在 PR；
5. 涉及 RPC/字段变更，先在 `docs/a/contracts.md` 里改契约，再改代码。

## 4. 联调顺序（建议）

1. **A + D**：真实登录 → 建房 → 加入 → 成员列表 → 心跳/重连；
2. **A + C**：`uc-command` 跑通 classic 一局（开始 → 领词 → 描述 → 投票 → 结算）；
3. **B + A**：画布上传 → `submit_artwork` → `ai-score` → 三态展示；
4. **C + D**：融合玩法在真实房间里的完整走查；
5. 最后再统一计分与排行榜。

任何一步没跑通，都按「未集成」记录，不要写成已完成。

## 5. 环境变量

| 位置 | 变量 | 用途 |
| --- | --- | --- |
| `app/.env.local` | `VITE_SUPABASE_URL`、`VITE_SUPABASE_ANON_KEY` | 前端公开配置（anon key 可公开） |
| Supabase Secrets | `WECHAT_APPID`、`WECHAT_APPSECRET`、`WECHAT_LOGIN_SECRET` | 登录函数 |
| Supabase Secrets | `AI_BASE_URL`、`AI_API_KEY`、`AI_MODEL`、`AI_TIMEOUT_MS` | 评分函数 |

`service_role` 只能出现在 Edge Function 环境，前端永远拿不到。

## 6. 验收清单（合并前逐条打勾）

- [ ] 未登录时所有 RPC 返回 `AUTH_REQUIRED`，不泄露房间数据
- [ ] A 房间成员看不到 B 房间的 `game_public`、成员、画作、评分
- [ ] 玩家只能读到自己的 `game_secrets` 行
- [ ] 同一 `requestId` 重放不会产生第二次效果
- [ ] 非房主调用 `close_room` / `set_room_settings` 返回 `HOST_ONLY`
- [ ] 房主离开后房主身份自动转移，且旧房主不能再操作
- [ ] AI 失败/超时后，投票与结算照常进行
- [ ] 画作路径与 `submit_artwork` 记录一致，重复提交只更新自己那张
