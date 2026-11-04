# A · 平台核心与 AI 基础设施

本目录说明 A 负责的部分：数据库、登录、RLS、房间与局次 RPC、私有频道、AI 评分服务，
以及 B / C / D 接入时的边界。

## 交付状态

| 项目 | 状态 | 位置 |
| --- | --- | --- |
| 数据库结构（用户/房间/成员/局次/词牌/画作/评分/题库） | ✅ 已交付 | `supabase/migrations/0001_schema.sql` |
| 跨房间隔离与 RLS（含词牌仅本人、`state` 不可读） | ✅ 已交付 | `0002_rls.sql` |
| 房间生命周期 RPC（建房/加入/离开/准备/心跳/移交/关闭） | ✅ 已交付 | `0003_rpc_room.sql` |
| 局次写入 RPC（开始/指令/倒计时/读词牌/交画） | ✅ 已交付 | `0004_rpc_game.sql` |
| 画作存储桶与访问策略 | ✅ 已交付 | `0005_storage.sql` |
| 微信登录 Edge Function | ✅ 已交付 | `supabase/functions/wechat-auth` |
| AI 评分 Edge Function（多模态、幂等、超时、降级） | ✅ 已交付 | `supabase/functions/ai-score` |
| **`uc-command` 权威指令服务**（把 C 的纯引擎跑在服务端） | 🚧 **下一步** | 见 `contracts.md` §4 |
| 私有实时频道（Realtime Authorization 策略） | 🚧 设计完成，待平台开启 | `contracts.md` §5 |
| 生产题库 `BankRepository` 适配 | 🚧 接口就绪，待接 C 的 repository | `contracts.md` §6 |

> 现状说明：表的写入函数 `uc_start_game` / `uc_commit_action` / `uc_tick` 已经是
> service_role-only 的落库接口；**但目前还没有调用它们的 `uc-command` Edge Function**，
> 所以真实对局还跑不通。C 的开发适配器（本地内存）仍然是现在唯一能完整走通的对局实现。
> 不要在联调文档里把它写成「已上线」。

## 为什么规则不在 SQL 里

C 已经写好并测试了纯规则引擎（`app/src/modules/undercover/{engine,rules,view,types}.ts`）。
按 C 的交接文档要求「不要重复实现规则」，A 的做法是：

1. 客户端 → `uc-command` Edge Function（校验 JWT、成员、房主、阶段）；
2. Function 内复用 C 的纯引擎计算下一状态；
3. 通过 `uc_commit_action` 把 `state` / `view` / 版本号 / 回执原子落库；
4. 通过 Realtime broadcast 通知同房间的客户端。

因此 SQL 只管权限、幂等与存储，规则只有一份。

## 快速自检

```powershell
# 结构是否可重放（需要 Docker）
supabase db reset

# 登录函数（部署后）
curl -X POST "$SUPABASE_URL/functions/v1/wechat-auth" -H "Content-Type: application/json" -d '{"code":"test"}'
# 未配置 WECHAT_* 时应返回 WECHAT_NOT_CONFIGURED，而不是 500 崩溃
```

## 文档

- [数据库设计](database.md)
- [RPC / 实时频道契约](contracts.md)
- [AI 评分服务](ai-scoring.md)
- [B/C/D 接入与合并指南](integration.md)
