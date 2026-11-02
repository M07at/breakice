# 破冰局 / Break Ice Hall

线下面对面多人破冰游戏微信小程序，支持真心话大冒险、谁是卧底、你画我猜谁是卧底和 AI 评分。**每位玩家使用自己的手机**，主持人同时也是玩家，游戏控制发言顺序、投票和结算。

**接手的开发者或 AI 请先读 [README-C-HANDOFF.md](README-C-HANDOFF.md)**，再读本文的整合状态。部分早期规划文档描述的是已被取代的单机原型；实现以当前代码和 handoff 为准。

#### 软件架构

- `app/`：uni-app + Vue 3 + TypeScript 前端（微信小程序为主，H5 仅作辅助预览）。
- `supabase/`：数据库迁移和 Edge Function 目录，由其他成员负责。
- `docs/`：项目过程文档和模块联调约定。
- `scripts/`：工程质量脚本（环境检查、类型检查、测试、分包体积、密钥扫描、发布清单）。

前端当前使用本地 Mock / 预览服务完成后端边界之前的所有页面与流程；真实 Supabase RPC、Realtime、微信登录和 AI 评分属于 A / B 模块尚未接入的部分，详见 `docs/D模块开发任务清单.md`。

#### 目录与模块归属

```
app/src/
├── components/        D：大厅及通用组件（头像、玩家列表、房间码卡片）
├── pages/             D：大厅、创建/加入房间、房间等待区、真心话大冒险
├── modules/
│   ├── undercover/    C：谁是卧底引擎、规则、玩家端与后端契约
│   ├── bank/          C：题库系统、导入导出、校验、488 条原创题库
│   ├── local/         C：本地会话与玩家预览适配
│   └── shared/        C：公共工具
├── pages-uc/          C：谁是卧底 / 你画我猜谁是卧底页面（分包）
├── pages-bank/        C：题库管理页面（分包）
├── services/          D：房间与游戏服务
├── stores/            D：房间状态（Pinia）
├── styles/            D：设计系统 token
└── types/             D：数据类型
```

## Current member C delivery

- 谁是卧底: fixed-player private words, speaking turns, timers, voting, elimination, results and replay.
- 你画我猜谁是卧底: separate pages, synchronized mock drawing submission, artwork review, voting and scoring failure/timeout paths. B's real canvas and A's real AI are still integration work.
- Shared question bank: 157 Chinese and 60 English default pairs, word-language selection, custom-bank CRUD, filtering and JSON/CSV import/export. Both games use one `undercover` collection; hybrid additionally filters drawable pairs.
- Engineering: environment checks, fail-fast verification, JUnit/JSON reports, WeChat and H5 builds, package limits, secret scanning and release hashes.

## Current member D delivery

- 大厅首页、创建房间、加入房间、房间等待区（主持人 / 玩家端布局）。
- 玩家列表、房间码卡片、分享入口。
- 自定义头像系统（肤色 / 眼睛 / 鼻子 / 嘴巴 / 发型 / 配饰，CSS 分层绘制，本地缓存保存）。
- 真心话大冒险页面与题库服务、房间状态管理。
- Vant / TDesign 风格设计系统 token。

## Quick start

1. 安装 Node.js 22+、微信开发者工具（可选 HBuilderX）。
2. 进入 `app` 目录并安装依赖：`npm install`。
3. 启动 H5 预览：`npm run dev:h5`。
4. 构建微信小程序：`npm run build:mp-weixin`，然后把 `app/dist/build/mp-weixin` 导入微信开发者工具。
5. 微信小程序 AppID 在 `app/src/manifest.json` 的 `mp-weixin.appid` 中填写；留空时用微信开发者工具的「测试号」也能预览。

如果使用 HBuilderX，直接打开 `app` 目录即可识别为 uni-app 项目。

多设备联调（仅 H5 / 浏览器预览）：

```powershell
Set-Location app
npm ci
npm run doctor
npm run dev:players
```

For phones, open the **Network address** printed by Vite while connected to the same reachable network as the computer. Create a test game, then distribute a different seat invitation to each participant. A localhost link works only on that same computer.

The development server synchronizes separate browser/phone clients. Custom banks persist in `app/.c3-data/banks.json`. This is a **local development data source**, not an implemented Supabase production database or WeChat login service. Game sessions are in memory and expire when the preview server restarts.

No real credentials are required for this preview. If configuring public platform values, copy `app/.env.example` to `app/.env.local`. Public configuration alone does not install a real platform adapter. Never put service-role, AI, AppSecret or upload credentials in frontend variables.

## 使用流程

1. 首页选择“创建一个房间”或“加入朋友的房间”。
2. 创建房间后复制房间号，或使用右上角分享入口邀请玩家。
3. 在房间等待区（`pages/room/index`）选择游戏：真心话大冒险、谁是卧底、你画我猜谁是卧底，或进入题库管理。
4. 玩家在大厅点击“准备”。
5. 当前阶段房间与在线状态为本地 Mock 演示，真实多人同步需要等待 Supabase RPC、Realtime 和二维码接口联调。

## Independent game routes

- 大厅（主包入口）：`/pages/home/index`
- 真心话大冒险（主包）：`/pages/game/index`
- Classic setup: `/pages-uc/setup`; personal game: `/pages-uc/player`.
- Hybrid setup: `/pages-uc/hybrid`; personal game: `/pages-uc/hybrid-player`.
- Shared bank management: `/pages-bank/index` and `/pages-bank/detail`.

`pages-uc` 与 `pages-bank` 是微信小程序分包，由大厅与房间等待区进入。The separate routes reuse internal components and one bank repository. There is no phone-handoff mode or player switcher.

## Verification

```powershell
npm --prefix app run verify
```

This runs environment checks, TypeScript, application tests, quality-gate tests, both production builds, package-size and secret checks, and a release manifest. Any failed stage stops the pipeline and returns a nonzero exit code.

Single steps:

```powershell
npm --prefix app run type-check
npm --prefix app run test
npm --prefix app run build:mp-weixin
```

Reports: `app/reports/verify.json`, `tests.xml`, `release-manifest.json`. Builds: `app/dist/build/mp-weixin` and `app/dist/build/h5`. Reports, builds and local bank data are not committed.

## Remaining CI activation

The repository is hosted on Gitee. `scripts/ci.sh` is runnable; `.gitee/ci-job.json` is a setup recipe, **not an automatically loaded workflow**. A repository administrator must activate the job, configure triggers and require its result before merge. See the exact checklist in [the handoff](README-C-HANDOFF.md) and [engineering guide](docs/c/engineering.md). Hosted CI status has not been inspected or changed by this work.

## Ownership and integration

- **A:** production database, login/authentication, RLS, room membership, private channels, RPC and AI service.
- **B:** real drawing canvas/stroke synchronization, AI presentation, unified scoring and rankings.
- **C:** both undercover game flows and specific pages, question-bank management, engineering scripts and contracts.
- **D:** lobby/room UI, shared design system, host/player shells, Truth or Dare and sharing.

Replace C's development adapters at their boundaries; preserve the game rules, per-user privacy and shared bank semantics. Follow [the handoff](README-C-HANDOFF.md) for the integration order and concrete files.

## Current documentation

- [C integration handoff](README-C-HANDOFF.md)
- [D 模块开发任务清单](docs/D模块开发任务清单.md)
- [Classic rules](docs/c/undercover-rules.md)
- [Hybrid rules and mock adapter](docs/c/hybrid-rules.md)
- [Fixed-player backend contract](docs/c/undercover-backend-contract.md)
- [Shared bank model and pages](docs/c/shared-question-bank.md)
- [Multi-device preview](docs/c/fixed-player-preview.md)
- [Engineering and CI](docs/c/engineering.md)
- [Release checklist](docs/c/release-checklist.md)
- [Changelog](CHANGELOG.md)
