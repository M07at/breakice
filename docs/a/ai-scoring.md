# AI 评分服务

实现：`supabase/functions/ai-score/index.ts`（部署名 `ai-score`）。
按需求文档，评分维度为 **构图 / 创意 / 契合度**，由多模态模型给出，失败可降级。

## 请求

```
POST /functions/v1/ai-score
Authorization: Bearer <access_token>
Content-Type: application/json

{ "artwork_id": "8f2c…" }
```

前置条件：调用者必须是该画作所属房间的成员，否则 `403 NOT_A_MEMBER`。

## 响应

成功：

```json
{
  "status": "success",
  "composition": 82,
  "creativity": 74,
  "relevance": 90,
  "total": 82,
  "comment": "椅子结构清楚，构图饱满。"
}
```

失败（HTTP 仍为 200，便于前端按业务状态降级）：

```json
{ "status": "failed", "error": "provider 429: rate limited" }
```

`total = composition × 0.4 + creativity × 0.3 + relevance × 0.3`，四项都限制在 0–100。

## 幂等与并发

- `ai_scores.artwork_id` 唯一：一幅画只有一条评分；
- 已有 `success` 直接返回缓存结果（不重复计费）；
- `pending` 且创建不足 2×超时时间时直接返回 `pending`，避免并发请求打爆模型；
- 回执与降级都写库，客户端刷新后仍能拿到同一结果。

## 超时与降级

- 默认超时 5s（`AI_TIMEOUT_MS`），覆盖需求中的「AI 评分 < 5s」；
- 超时 → `status:"timeout"`，其他异常 → `status:"failed"`；
- 两种情况都会把 `artworks.status` 置 `failed`，游戏流程继续（评分只是可选加分，不决定阵营胜负）；
- 没有配置 `AI_API_KEY` 时返回 `AI_NOT_CONFIGURED`，不会让对局卡住。

## 提示词策略

- 明确给出本轮题目（取自 `game_secrets`，服务端读取，不暴露给其他玩家）；
- 要求「只输出 JSON」，并用 `response_format: json_object`；
- 明确「空白、乱划、与题目无关 → 三项都低分」，与 C 的 hybrid 规则一致；
- 解析失败按 `BAD_PROVIDER_JSON` 处理，不信任模型输出，全部数值做 0–100 截断。

## 安全

- `AI_API_KEY` 只放在 Supabase Function Secrets，不进小程序、不进仓库；
- 画作用私有桶 `artworks` + `createSignedUrl(60s)`，不产生公开链接；
- 任何玩家都能触发自己房间画作的评分，但无法为别人房间的画作评分（成员校验）；
- 提示词与返回内容都会截断长度，避免异常内容撑爆数据库。

## 部署

```powershell
supabase secrets set AI_BASE_URL=https://api.openai.com/v1 AI_API_KEY=sk-... AI_MODEL=gpt-4o-mini
supabase functions deploy ai-score
```

换成其他兼容 OpenAI Chat Completions 的多模态供应商时，只需改 `AI_BASE_URL` / `AI_MODEL`。
