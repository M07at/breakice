# 数据库设计

迁移文件是唯一事实来源：`supabase/migrations/0001_schema.sql` ~ `0005_storage.sql`。
本文只解释意图与不变量，字段以 SQL 为准。

## 关系

```
auth.users 1─1 profiles
profiles 1─n rooms(host_id)
rooms 1─n room_members n─1 profiles
rooms 1─n games
games 1─n game_secrets   (每人一行，仅本人可读)
games 1─n game_receipts  (幂等回执)
games 1─n artworks
artworks 1─1 ai_scores
games 1─n scores
profiles 1─n word_banks 1─n word_bank_items   (owner_id 为空 = 系统题库)
```

## 关键不变量

| 不变量 | 实现 |
| --- | --- |
| 一房同时只有一局进行中 | 部分唯一索引 `uq_games_active_room` |
| 局次号按房间递增 | `uc_start_game` 中 `max(game_number)+1` |
| 同一 `requestId` 只能产生一次效果 | `game_receipts` 主键 `(game_id, user_id, request_id)` + 指纹比对 |
| 同一 `requestId` 不能用于不同参数 | 指纹不同 → `REQUEST_CONFLICT` |
| 同一回合只能有一张画 | `artworks` 唯一约束 `(game_id, turn_key)` |
| 一幅画只有一条 AI 评分 | `ai_scores.artwork_id` 唯一 |
| 同一计分事件只记一次 | `scores` 唯一约束 `(game_id, user_id, reason, ref)` |
| 客户端拿不到完整状态 | `games.state` 无任何读策略；客户端只读 `game_public` 视图 |
| 玩家只拿到自己的词 | `game_secrets` RLS：`user_id = auth.uid()`；另提供 `get_my_word()` |
| 房间码唯一且不易混淆 | 6 位、去掉 `I/O/0/1`，`create_room` 循环重试 |

## 公开视图 `game_public`

```sql
select id, room_id, game_number, variant, status, version, view, started_at, ended_at, ended_reason
from game_public
where room_id = $1;
```

- `view` 即 C 的 `UcPublicView`，前端直接渲染；
- `state`、词牌、投票明细都不在这个视图里；
- 视图用 `security_barrier`，避免谓词下推绕过 `is_room_member()`。

## 房间状态机

```
lobby ──(uc_start_game)──▶ playing ──(uc_commit_action status=ended)──▶ lobby
   └──(close_room)──▶ ended
```

- 只有 `lobby` 能加入、准备、改设置；
- 房主离开时 `leave_room` 自动把房主交给座位最靠前的在房成员；
- `close_room` 之后房间不可再进入。

## Storage

- 桶：`artworks`（私有）；
- 路径：`{game_id}/{turn_key}/{user_id}.png`；
- 策略：同房间成员可上传/读取，本人可删除；
- 展示用 `createSignedUrl`，不要把公共 URL 存进库。

## 命名与公共字段

所有表都有 `created_at`；可变表有 `updated_at` 并由触发器维护。主键统一 `uuid`，
`profiles.id` 直接引用 `auth.users.id`，业务表不存 openid（openid 只在 `profiles`）。
