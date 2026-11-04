# Changes

## Unreleased
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
