# 自定义作画设置与真实 AI 评分

## 自定义作画倒计时

房间主持人选择「你画我猜 → 自定义词库」后进入设置页，填写题面并选择每人
30、60、90、120 或 180 秒。默认 90 秒。取消设置或未填题面时不开始对局。
开始时传入同一份题面和时长；非主持人根据共享视图的截止时间显示倒计时。

`DrawRoomView.drawSeconds` 是可选的新增元数据；旧视图仍可按 `endsAt` 运行。
后端设置回放保留所选时长，猜中用时从实际 `startedAt` 计算，避免改时长后偏移。
非法入口参数回落至 90 秒。此功能不需要数据库迁移。

验证：286 个测试及完整 verify 通过；新增用例覆盖配置校验、30 秒到期和下一轮沿用设置。
微信模拟器已检查设置页。真机不同玩家倒计时与自动交画仍需设备验收。

回滚：撤回本次设置页入口和 `drawSeconds` 参数即可恢复默认 90 秒，不涉及已存数据库数据。

## 普通联机模式的真实评分修复

已确认的故障：联机页未注入真实 scorer，默认使用 `MockAiScorer`；原 `ai-score` 的
`AI_BASE_URL` 指向已失效的临时域名，线上失败记录是 DNS 解析错误。
此外，原模型输出为 46 类，原标签表只有 45 类，漏掉了首项 `aircraft carrier`；
训练用的 QuickDraw 位图是黑底白线，与小程序导出的白底黑线相反。

修复后的链路：画布导出 → 私有 Storage → 主持人调用 `draw-score` → 私有题面和当前作画者校验
→ 原 Drawzy CNN → 缓存评分回执 → 主持人计分并发布揭晓视图。
普通画图局没有 `public.games` 记录，因此新增独立的 `draw_ai_scores` 回执表，
以 `(room_id, game_key, round_key)` 保证同局同轮只有一条记录；只有服务角色可读写。
房间成员不能通过表接口自行改分，非主持人的评分请求被拒绝。

- 线上已单独应用 `0024_draw_ai_scores.sql`，部署 `draw-score`，并更新 `ai-score` 的服务鉴权和 `total` 返回兼容字段。
- 题面使用 `draw_words` 私有通道；主持人作画时公开视图也剔除 `word` 和答案贴纸。
- 同一画作重复请求返回已有结果；并发请求得到 pending。旧轮次、其他房间或其他画者路径被拒绝。
- 真实评分期间暂停换人，避免截止时间经过后把结果写到下一轮；揭晓时间从评分完成时开始。
- AI 识别依据候选前 5 项，沿用现有猜中/用时计分规则；文案明确显示首选和前 5 项是否包含答案。
- 不支持的自定义题面、模型失败或超时明确标注「本轮未计 AI 分」，猜题分仍正常计算。联机不再使用假分。
- 模型并不覆盖任意中文题目；支持类别是 QuickDraw 前 46 类。它是简笔画分类器，不是绘画艺术质量评价器。

## 恢复的模型服务

原始代码和权重：[`MobAI-Hackathon/drawzy-ai`](https://github.com/MobAI-Hackathon/drawzy-ai)，
本机版本 `f7eb2987c404549b66db5ab39e8f81c929f7fe82`。
标签顺序通过 [Google 官方类别表](https://github.com/googlecreativelab/quickdraw-dataset/blob/master/categories.txt)
和官方 apple、airplane、banana、bucket 位图样本验证；预处理按训练数据反转前景背景。
运行入口是 `scripts/drawzy_server.py`，只加载原有 CNN，不重新训练模型、不安装 RL 训练依赖。

本机隔离运行目录：`D:\Software Project\.local-services`。
模型、虚拟环境、cloudflared、服务凭据和日志均保留在该目录，不进入小程序或本仓库。
服务仅监听 `127.0.0.1:8787`；推理接口要求服务令牌，只有 Supabase Edge Function 携带它。
手机仍只请求原 Supabase 域名，不需要再把隧道域名加入小程序白名单。

当前服务和测试隧道已经启动。重启电脑后，在 PowerShell 7.4+ 中执行：

```powershell
pwsh -File scripts/start-drawzy-demo.ps1
```

脚本复用健康的进程，或启动后台进程，等待模型预热和隧道健康，再自动更新 Supabase 的
`AI_BASE_URL` 与 `DRAWZY_TOKEN`。需要先有 Supabase CLI 登录态。令牌不会出现在命令参数或控制台。
初次换电脑需克隆上面的原始仓库到运行目录、用 Python 3.11 创建 `.venv`，
通过 `uv pip install --python <venv-python> -r scripts/requirements-drawzy.txt` 安装依赖，
并安装 [官方 cloudflared](https://developers.cloudflare.com/tunnel/downloads/) 到运行目录。

**演示期间这台电脑必须保持开机、联网、未休眠。** 隧道仍是测试用临时域名，
没有改成永久托管服务；脚本解决重启后重新连接，不提供生产可用性保证。

## 验证证据与回滚

- 完整 verify：297 个应用测试、3 个工程检查测试通过，H5/小程序均构建成功；总包约 0.98 MB。
- `node scripts/check-draw-scoring.mjs` 对线上项目创建临时测试账号和房间，用真实图片完成 Storage 上传、模型调用及回执缓存。
- 测试图得到 95/100，apple 在候选前 5 项中；首选并不是 apple，界面会如实区分这两种信息。
- 同时验证非主持人拒绝、跨房间图片拒绝、重复请求结果一致，以及不支持的自定义词明确跳过 AI 分。
- 临时验收房间已关闭；报告位于忽略的 `app/reports/draw-scoring-live-*.json`，不含会话令牌。
- 尚未把电脑/服务端验收当成真机验收；请用新预览在真实手机上检查计分卡和所选倒计时。

回滚新评分链路时应先让客户端显示 AI 不可用，不应切回假评分。可停用 `draw-score`；
确认无调用后再执行 `supabase/rollback/0024_draw_ai_scores.sql`，这只删除新增的 AI 回执缓存。
不需要删除房间、玩家资料或既有游戏数据。旧 `ai-score` 的部署前副本保留在忽略的 `app/reports/ai-backup`。
