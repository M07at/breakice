# 名字与 MBTI

首页保留自动保存，昵称上方显示「请你填你的游戏名字」，MBTI 可选 16 种类型或「暂不填写」。
分析家 NT 为紫色，外交家 NF 为绿色，守护者 SJ 为蓝绿色，探险家 SP 为黄色。
MBTI 单独存储，不写进昵称或用户 ID；旧档案没有此字段时不显示徽标。

## 部署顺序

1. 在 Supabase SQL Editor 执行 `supabase/migrations/0023_profile_mbti.sql`，或通过团队迁移流程应用它。
2. 部署重新生成的 `supabase/functions/uc-command/index.ts`；它同时包含五机器人上限与 MBTI 快照。
3. 构建小程序开发版。`app/.env.local` 仅保留公开配置，不能放服务端 secret。

现有 `profiles.mbti` 列直接复用。新 RPC `set_my_profile_v2` 只更新调用者自己的档案，
规范化和校验 MBTI；`room_leaderboard_v2` 只向房间成员返回榜单。旧 RPC 保留，供旧客户端使用。
新前端遇到未部署 v2 RPC 的后端时会兼容旧昵称/形象与排行榜，并提示 MBTI 尚未同步；
其他网络与鉴权错误不会作为旧版本忽略。尚未升级的游戏快照可从当前房间名单补充徽标。

## 验收

- 旧缓存可读取；MBTI 可以选择、重启后恢复、清空。
- 两位玩家分别选不同分组，进入同一房间后双方看到一致的名字/徽标。
- 卧底领词、发言、投票、结果，真心话目标，以及绘画/聊天/排行榜显示同一份资料。
- 非法 MBTI 被 RPC 拒绝，不能通过传入其他用户 ID 修改他人资料。
- 小屏幕检查昵称与徽标换行，四种徽标均保留文字与可读对比度。

回滚 RPC：执行 `supabase/rollback/0023_profile_mbti.sql`。它保留已有 MBTI 数据与旧 RPC。
