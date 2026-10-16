# Ice-breaking hall（破冰局）

#### 介绍

线下面对面多人破冰游戏小程序，支持你画我猜、谁是卧底、你画我猜谁是卧底、真心话大冒险和 AI 评分。
一部手机就够：主持人创建房间，大家扫码或从微信群加入；谁是卧底由程序当法官。

#### 软件架构

uni-app（Vue 3 + TypeScript + Vite）+ 微信小程序 + Supabase + 微信云开发。

| 目录 | 内容 | 负责 |
|---|---|---|
| `app/src/pages/`、`app/src/components/` | 大厅、房间、公共组件 | D |
| `app/src/pages-uc/`、`app/src/modules/undercover/` | 谁是卧底、你画我猜谁是卧底 | C |
| `app/src/pages-bank/`、`app/src/modules/bank/` | 题库管理 | C |
| `app/src/pages-draw/`、`app/src/modules/draw/`、`app/src/modules/score/` | 你画我猜、计分排行榜 | B |
| `app/src/pages-truth/`、`app/src/modules/truth/` | 真心话大冒险 | D |
| `app/src/platform/`、`supabase/`、`cloudfunctions/` | 登录、数据库、RLS、频道、RPC、AI 评分 | A |
| `scripts/`、`app/src/config/`、`app/.env.example` | 构建检查、环境变量 | C |
| `docs/` | 文档和会议记录 | 全组 |

#### 安装教程

需要 Node.js 22 和微信开发者工具。

```bash
cd app
npm install
cp .env.example .env.local   # 填 A 提供的开发配置；不填也能跑单机模式
npm run dev:mp-weixin        # 用微信开发者工具导入 app/dist/dev/mp-weixin
```

没装微信开发者工具时可以先用 H5 看页面：`npm run dev:h5`。

#### 使用说明

首页有「开发入口」（D 的大厅做好后删除）：

- 谁是卧底 / 你画我猜谁是卧底：单机模式，一部手机切换扮演所有玩家
- 题库管理：增删改查，CSV / JSON 导入导出

#### 参与贡献

1. 从最新的 `master` 新建自己的分支，名字带成员字母，例如 `c/feat-uc-vote`
2. 提交前在 `app/` 里运行 `npm run verify`（类型检查、单测、构建、包体积、密钥扫描）
3. 推送分支，新建 Pull Request，请改到的模块负责人 review
4. 详细规则见 [C 集成指南](docs/C-集成指南.md) 第 2 节

#### 文档

- [项目开发顺序](docs/项目开发顺序.md)：全组谁先做什么
- [C 模块计划](docs/C-模块计划.md)
- [C 集成指南](docs/C-集成指南.md)：合并规则、C 和 A/B/D 的接口、环境变量和密钥
