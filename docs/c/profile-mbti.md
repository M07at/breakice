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

## 2026-11-06 线上部署与验收

- 已向 `qfgyotxmcqmrbpjktuzo` 单独应用 0023；没有重跑历史迁移。
- 已部署 `uc-command` v30，应用版本 `uc-2026-11-06-bots5-mbti`，保留网关 JWT 校验。
- `node scripts/check-profile-bots.mjs` 验证真实后端：昵称和 MBTI 保存、大小写规范化、非法值和未登录写入拒绝、清空字段、跨玩家房间名单、v2 榜单调用及非房主开局拒绝。
- 显式请求 5 个或 99 个机器人均得到 5 个；未指定时单真人补 3 个。开局等待真人领词，快照保留房主 MBTI。
- 脚本使用两个临时匿名账号，结束时关闭验收房间；账号及房间 ID 记录在忽略的 `app/reports/profile-bots-live-*.json`，不记录会话密钥。
- 全量 `verify` 通过：273 个应用测试、3 个工程检查测试、类型检查、H5/小程序构建及包体积/密钥检查。
- HTTPS 健康检查 200、TLS 1.2 证书校验通过、WSS 连接成功。这些是电脑网络结果，不代表微信真机验收。

真机关闭调试后的验收仍需在微信公众平台保存服务器域名：request、uploadFile、downloadFile 使用
`https://qfgyotxmcqmrbpjktuzo.supabase.co`，socket 使用
`wss://qfgyotxmcqmrbpjktuzo.supabase.co`。如平台拒绝该域名，应记录实际拒绝原因再决定域名方案。
保存后在开发者工具刷新项目信息并重新生成预览，关闭手机调试后测试登录、建房、加入、同步和画作上传/读取。
