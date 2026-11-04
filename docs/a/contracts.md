# RPC / 实时频道契约

客户端用 `supabase-js` 直接调 RPC；所有身份来自登录态，**任何接口都不接收「我是谁」参数**。

```ts
import { createClient } from '@supabase/supabase-js'
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '@/config/env'

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true },
})
```

## 1. 登录

```ts
const { data, error } = await supabase.functions.invoke('wechat-auth', {
  body: { code }, // wx.login 拿到的 code
})
await supabase.auth.setSession({
  access_token: data.access_token,
  refresh_token: data.refresh_token,
})
// data.profile = { id, nickname, avatar_url, mbti, intro }
```

## 2. 房间（`0003_rpc_room.sql`）

| RPC | 参数 | 返回 |
| --- | --- | --- |
| `create_room` | `p_title`, `p_game_type`, `p_max_players`, `p_settings` | `[{ room_id, room_code }]` |
| `join_room` | `p_code` | `[{ room_id, seat, already_member }]` |
| `leave_room` | `p_room_id` | `void` |
| `set_ready` | `p_room_id`, `p_ready` | `void` |
| `heartbeat` | `p_room_id` | `serverNow`（timestamptz） |
| `transfer_host` | `p_room_id`, `p_to` | `void` |
| `set_room_settings` | `p_room_id`, `p_game_type`, `p_settings` | `void` |
| `close_room` | `p_room_id` | `void` |

```ts
const { data: room } = await supabase.rpc('create_room', {
  p_title: '社团招新',
  p_game_type: 'undercover',
  p_max_players: 12,
})
const { data: joined } = await supabase.rpc('join_room', { p_code: room[0].room_code })
```

成员列表（RLS 已限制为同房可见）：

```ts
const { data: members } = await supabase
  .from('room_members')
  .select('user_id, seat, role, ready, online, profiles(nickname, avatar_url)')
  .eq('room_id', roomId)
  .is('left_at', null)
  .order('seat')
```

## 3. 局次（`0004_rpc_game.sql`）

客户端可调用：

| RPC | 参数 | 返回 |
| --- | --- | --- |
| `get_my_word` | `p_game_id` | `[{ word, camp, acknowledged }]` |
| `acknowledge_my_word` | `p_game_id` | `void` |
| `submit_artwork` | `p_game_id`, `p_turn_key`, `p_storage_path` | `artwork_id` |

只允许 service_role（Edge Function 内部用）：

| 函数 | 作用 |
| --- | --- |
| `uc_start_game(actor, room, variant, state, view, secrets, requestId)` | 建房内新一局，分配词牌 |
| `uc_commit_action(game, actor, requestId, fingerprint, state, view, version, status, endedReason)` | 落库一次指令 + 回执 |
| `uc_tick(game, state, view, version)` | 倒计时结算 |

快照（**唯一**允许客户端读取局次状态的入口）：

```ts
const { data: snapshot } = await supabase
  .from('game_public')
  .select('id, game_number, variant, version, view, status')
  .eq('room_id', roomId)
  .eq('status', 'active')
  .maybeSingle()
```

## 4. `uc-command`（下一步，A 待实现）

约定好的请求／响应，实现时不要再改字段：

```
POST /functions/v1/uc-command
Authorization: Bearer <access_token>

{ "op": "start", "room_id": "...", "variant": "classic", "request_id": "...", "config": {...} }
{ "op": "act",   "game_id": "...", "action": {...}, "meta": { "requestId": "...", "expectedVersion": 12, "expectedPhase": "vote", "expectedRound": 2, "expectedTurnKey": "r2-turn3" } }
{ "op": "tick",  "game_id": "..." }
{ "op": "word",  "game_id": "..." }
{ "op": "replay","game_id": "...", "request_id": "..." }
```

响应直接对齐 C 的 `UcPlayerSnapshot`：

```json
{
  "sessionId": "…", "gameId": "…", "gameNumber": 3,
  "playerId": "…", "hostId": "…",
  "players": [{ "id": "…", "name": "小明" }],
  "view": { "...": "UcPublicView" },
  "serverNow": 1760000000000
}
```

实现步骤（给下一个做 A 的人）：

1. 在 `supabase/functions/_shared/uc/` 放一份 C 的 `engine.ts`、`rules.ts`、`view.ts`、`types.ts`（纯 TS，无 uni 依赖）；
2. 用脚本 `scripts/sync-uc-engine.mjs` 从 `app/src/modules/undercover/` 同步，避免手改两份；
3. Function 内 `getUser(jwt)` → 查房间成员/房主 → 读 `games.state` → 跑引擎 → 调 `uc_commit_action`；
4. 用 service_role 广播 `view`（见 §5），并返回快照。

## 5. 私有实时频道

- 频道名：`room:{room_id}`，私有（`private: true`）；
- 事件：`view`（新快照）、`room`（成员变化）、`score`（AI 评分完成）；
- 授权：Supabase Realtime Authorization，策略要求 `is_room_member(topic 里的 room_id)`；
- 降级：客户端每 2s 轮询 `game_public`，断线重连后先拉一次快照再订阅。

```ts
const channel = supabase
  .channel(`room:${roomId}`, { config: { private: true, broadcast: { self: false } } })
  .on('broadcast', { event: 'view' }, ({ payload }) => applySnapshot(payload))
  .subscribe()
```

## 6. 题库仓库（C 的 `BankRepository`）

| 方法 | 表操作 |
| --- | --- |
| `listBanks()` | `word_banks` where `owner_id is null or owner_id = auth.uid()` |
| `getBank(id)` | `word_banks` + `word_bank_items` |
| `listItems(bankId)` | `word_bank_items` |
| `createItem/updateItem/deleteItem` | `word_bank_items`（RLS 限制到本人题库） |
| `import` | 批量 insert，失败整体回滚（用 RPC 包一层事务） |

## 7. 错误码

| 码 | 含义 | 客户端处理 |
| --- | --- | --- |
| `AUTH_REQUIRED` | 未登录 | 重新走 `wechat-auth` |
| `ROOM_NOT_FOUND` / `ROOM_NOT_JOINABLE` | 房间不存在／已开局 | 提示并回大厅 |
| `ROOM_FULL` | 人数已满 | 提示换房 |
| `NOT_A_MEMBER` | 不在该房间 | 重新加入 |
| `HOST_ONLY` | 需要房主 | 隐藏入口 |
| `GAME_ACTIVE` | 本房已有进行中的局 | 提示等待或结束 |
| `REQUEST_CONFLICT` | 同一 requestId 用于不同参数 | 换新 requestId |
| `STALE_STATE` | 版本／阶段已过期 | 拉最新快照 |
| `TURN_TAKEN` | 该回合已有别人的画 | 只读展示 |
