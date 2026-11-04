# Supabase（A 负责）

本目录是「破冰局」的服务端：数据库结构、RLS、RPC、Storage 策略与 Edge Functions。

## 目录

```
supabase/
├── migrations/
│   ├── 0001_schema.sql     表结构、公开投影视图、触发器
│   ├── 0002_rls.sql        行级安全与跨房间隔离
│   ├── 0003_rpc_room.sql   房间生命周期 RPC（客户端可调）
│   ├── 0004_rpc_game.sql   局次写入 / 词牌读取 / 交画 RPC
│   └── 0005_storage.sql    画作桶与访问策略
└── functions/
    ├── wechat-auth/        wx.login code → Supabase 会话
    └── ai-score/           多模态 AI 评分（幂等、超时、降级）
```

## 首次部署

```powershell
# 1. 关联项目（替换成你的 project ref）
supabase link --project-ref <project-ref>

# 2. 按顺序应用迁移
supabase db push

# 3. 部署函数
supabase functions deploy wechat-auth --no-verify-jwt   # 登录前调用，不能校验 JWT
supabase functions deploy ai-score                      # 需要登录态

# 4. 写入函数密钥（不要提交到仓库）
supabase secrets set WECHAT_APPID=wx... WECHAT_APPSECRET=... WECHAT_LOGIN_SECRET=<随机长字符串>
supabase secrets set AI_BASE_URL=https://api.openai.com/v1 AI_API_KEY=sk-... AI_MODEL=gpt-4o-mini AI_TIMEOUT_MS=5000
```

`SUPABASE_URL` / `SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` 由平台自动注入，不需要手动设置。

## 本地开发

```powershell
supabase start          # 需要 Docker
supabase db reset       # 重放 migrations
supabase functions serve ai-score --env-file .env.local
```

## 约定

- 客户端**不直接写表**：房间走 RPC，局次走 `uc-*` 函数（仅 service_role），画作走 `submit_artwork`。
- 客户端**不读 `games.state`**：只读 `public.game_public` 视图（公开投影）。
- 词牌只走 `get_my_word()`，或 RLS 限制到本人的 `game_secrets`。
- 迁移只追加，不改历史文件；需要回滚就新增 `0006_*.sql`。
