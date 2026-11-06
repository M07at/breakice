# Changes

The current feature comparison is [feature/integration clone → current master](./CHANGELOG-FEATURE-INTEGRATION-TO-MASTER.md).
It compares baseline `e64a6da` with the v23 DeepSeek implementation. Entries below retain their historical context.

## Unreleased
- Integration: **服务端谁是卧底引擎**（`functions/uc-command`）。C 的纯规则引擎被内联成单文件函数，
  提供 start / act / tick / current / word 五个操作；开局校验房主与全员准备，动作身份只认 token，
  结算事件写进 `scores`（唯一约束去重）。客户端 `services/ucGame.ts` 实现 `UcPlayerPort`。
- Integration: **中途退出同步**。`op=tick` / `op=act` 前按房间成员表对账，把已离场玩家按
  `playerLeft` 摘掉，避免轮到他发言时整局卡到倒计时。
- Integration: **融合玩法真实画布**。B 的 `draw-canvas` 替换 C 的模拟适配器：导出 PNG →
  上传 `artworks` 私有桶 → `submit_artwork` 建档 → AI 评分（未配 key 自动降级）→ 画廊签名地址渲染。
- Integration: **真心话回合共享**（`0014`）。`rooms.settings.truth` 存「轮到谁 + 什么题」，
  转盘/换题/下一轮/自定义题都会写共享状态，所有人看到同一份。
- Integration: **Realtime 广播**。小程序没有浏览器 WebSocket，手写 Phoenix 协议最小客户端
  （`platform/realtime.ts`），房间与对局变化即时推送，断线回退到 2 秒轮询。
- Integration: **微信小程序码**（`functions/wechat-qrcode` + `0016`）。校验本房成员后调
  `wxacode.getUnlimited`，access_token 落库缓存，失效自动刷新；二维码页优先展示小程序码，
  失败回退到普通二维码。
- Integration: **数据备份与回退**（`0015` + `docs/备份与回退.md`）。快照 profiles 与自建题库，
  回灌是合并式（只补缺失），函数只对 SQL Editor / service_role 开放。
- Integration: **你画我猜联机底座**（`0017` + `services/drawRemote.ts`）。主持人发布权威视图、
  其他人在指令队列投操作；客户端远程层含 7 个单测。页面接线仍待完成，见
  `docs/你画我猜联机方案.md`。
- Fix: 房间页二维码原用旧版 canvas（原生组件）浮在上层吃掉点击，导致「谁是卧底」卡片点不动；
  已改为独立页面 + `canvas type="2d"`。
- Fix: `showModal` 的 `confirmText` 超过 4 个字符会直接失败，造成点击无反应；已改为自动补位提示。
- Integration: **A 的平台后端接入**。`supabase/migrations/0001…0005`、`functions/wechat-auth`、
  `functions/ai-score` 与 `docs/a/` 进入仓库；新增 `0006_rpc_lobby_integration.sql` 补上小程序端
  无法 PATCH 的开局/结束/改昵称 RPC。
- Integration: **房间成为游戏单位**。新增 `app/src/platform`（`RoomApi` + 本机实现 + Supabase 实现），
  `stores/room` 与 `services/roomService` 全部改走平台层：建房 → 加入 → 全员准备 → 房主选玩法 →
  房间进入 playing → 各端进入游戏 → 房主结束本局回到大厅。C/B/D 的开局都从房间名单驱动。
- Integration: merged D's WeChat mini-program lobby base with C's modules on `feature/integration`;
  unified package/pages/manifest/vite/tsconfig, kept D's uni-app runtime, wired lobby and room entries
  to `pages-uc` and `pages-bank`, prefilled undercover seats from the room roster, and moved
  truth-or-dare prompts onto C's shared bank (69 truth + 52 dare). Multi-device realtime inside the
  mini program still needs A's `UcPlayerPort`; the H5 preview service remains development-only.
- Integration: merged B's `feat/b-drawcanvas` (ddbb310) into the same branch — `pages-draw` subpackage
  registered as a third subpackage and reachable from the room lobby. B's draw room is a local,
  single-device backend and its canvas only works in WeChat DevTools, not in the H5 preview.
- B1: draw engine (strokes / undo / redo / emoji), chunked stroke transport, AI scoring client with mock
  fallback, classic / emoji / custom variants, chat answering, reveal and settlement.
- B2: unified scoring (configurable AI weight, cap, idempotency) and leaderboard.
- C1: fixed-player classic game, private reveal, deadlines, voting, replay and command protection.
- C2: synchronized hybrid mock drawings, review stage and scoring fallback; actual canvas/AI not integrated.
- C3: independent game routes, Chinese/English defaults and shared persistent development question bank.
- C4: environment doctor, reproducible checks/reports, release hashes and Gitee activation recipe. Hosted CI activation remains pending.


---

## 2026-11-05 · 收尾（AI 评分闭环）

- **AI 评分接入 drawzy**（本地 FastAPI + cloudflared 隧道）：
  `ai-score` 的 `AI_MODE=guess` 分支调 `/predict/sketch`，用「AI 猜中与否 + 用时」算分：
  猜中 `80 + 20×(1−t/60)`，没猜中 `80×(1−t/60)`，t 夹在 0–60 秒。
  结果写 `ai_scores`（`total` / `ai_guess` / `ai_seconds`），画廊显示「AI 猜：xxx · 用时 x.x 秒」。
- **词库清洗**：映射表按 drawzy 真实的 45 类（`airplane`…`bucket`）重写，
  删除此前猜错的 cat/dog/tree 等；新增 `DRAW_WORD_POOL` 与 `filterScorable`，
  你画我猜抽词只从能评分的词里挑。
- **打包产物检查**：`npm run verify` 新增 `check:bundle`，引擎/词库/handler 比产物新就报红。
- 测试 249 个全过，产物 0.96 MB。

## 已知未完成

| 项 | 说明 |
| --- | --- |
| 4 人真机全流程 | 规则与接力只在 2 真人 + 2 人机下验证 |
| B 的布局层统一 | 颜色已 token 化，圆角/间距未调 |
| ICP 备案 | 正式发布前必须 |
| drawzy 隧道地址 | 每次重启会变，需同步 `AI_BASE_URL` 并重新部署 `ai-score` |
