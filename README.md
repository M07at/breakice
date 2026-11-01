# break-ice-hall

#### 介绍
线下面对面多人破冰游戏小程序，支持真心话大冒险、你画我猜、谁是卧底和 AI 评分。

#### 软件架构

- `app/`：uni-app + Vue 3 + TypeScript 前端，当前由 D 模块负责大厅、用户体验和真心话大冒险。
- `supabase/`：数据库迁移和 Edge Function 目录，由其他成员负责。
- `docs/`：项目过程文档和模块联调约定。

当前前端先使用 Mock service 完成本地页面演示，真实 Supabase RPC 和 Realtime 接入点见 `docs/D模块开发任务清单.md`。


#### 安装教程

1. 安装 Node.js 22+、微信开发者工具和 HBuilderX（或使用命令行构建）。
2. 进入 `app` 目录并安装依赖：`npm install`。
3. 启动 H5 预览：`npm run dev:h5`。
4. 构建微信小程序：`npm run build:mp-weixin`，然后将生成目录导入微信开发者工具。

如果使用 HBuilderX，打开 `app` 目录即可识别为 uni-app 项目；微信小程序 AppID 在 `app/src/manifest.json` 中配置。

#### 使用说明

1. 首页选择“创建一个房间”或“加入朋友的房间”。
2. 创建房间后复制房间号，或使用右上角分享入口邀请玩家。
3. 主持人在房间大厅选择“真心话大冒险”开始游戏；玩家在大厅点击“准备”。
4. 当前阶段为 Mock 数据演示，真实多人同步需要等待 Supabase RPC、Realtime 和二维码接口联调。

模块任务、接口边界和验收清单见 `docs/D模块开发任务清单.md`。

#### 参与贡献

1.  Fork 本仓库
2.  新建 Feat_xxx 分支
3.  提交代码
4.  新建 Pull Request


#### 特技

1.  使用 Readme\_XXX.md 来支持不同的语言，例如 Readme\_en.md, Readme\_zh.md
2.  Gitee 官方博客 [blog.gitee.com](https://blog.gitee.com)
3.  你可以 [https://gitee.com/explore](https://gitee.com/explore) 这个地址来了解 Gitee 上的优秀开源项目
4.  [GVP](https://gitee.com/gvp) 全称是 Gitee 最有价值开源项目，是综合评定出的优秀开源项目
5.  Gitee 官方提供的使用手册 [https://gitee.com/help](https://gitee.com/help)
6.  Gitee 封面人物是一档用来展示 Gitee 会员风采的栏目 [https://gitee.com/gitee-stars/](https://gitee.com/gitee-stars/)
