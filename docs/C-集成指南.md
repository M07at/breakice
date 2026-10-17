# C 集成指南：C 的代码怎么和 A、B、D 合到一起

这份文档站在 C 的角度写：**C 提供什么、C 需要别人提供什么、按什么顺序合并**。
标了「待确认」的地方是 C 的假设，需要对应的同学确认或修改，确认后把「待确认」删掉。

## 1. 总体思路

C 的纯逻辑已经写完，不依赖任何人：

- `app/src/modules/undercover/`：谁是卧底和你画我猜谁是卧底的引擎，输入「当前局面 + 一个操作」，输出「新局面 + 事件」。
- `app/src/modules/bank/`：题库的校验、导入导出、抽题。

合并时 C 只需要给两个接口写「远程实现」，页面和逻辑都不用改：

| 接口 | 现在的实现 | 接入后的实现 | 依赖 |
|---|---|---|---|
| `UcBackend`（`undercover/backend.ts`） | `LocalUcBackend`，单机内存 | `RemoteUcBackend`，调服务端函数 + 订阅房间频道 | A |
| `BankRepository`（`bank/repository.ts`） | `MemoryBankRepository` | `SupabaseBankRepository`，读写 C 的表，权限靠 RLS | A |

## 2. Git 合并流程（全组通用）

### 仓库结构

```
app/                     uni-app 工程（所有人）
  src/pages/             D：大厅、房间（主包）
  src/pages-uc/          C：谁是卧底（分包）
  src/pages-hybrid/      C：你画我猜谁是卧底（分包）
  src/pages-bank/        C：题库管理（分包）
  src/pages-draw/        B：你画我猜（分包）
  src/pages-truth/       D：真心话大冒险（分包）
  src/modules/<模块>/    各自的逻辑代码
  src/components/        D：公共组件
  src/platform/          A：Supabase 客户端、登录、频道封装
supabase/migrations/     数据库迁移（A 维护，C 加自己的表）
supabase/rollback/       每个迁移对应的回滚脚本
supabase/functions/      A：Edge Functions（仓库里已有 ai-score）；C 的 uc-act 等也放这里
cloudfunctions/          A：微信云函数（如果登录走云开发）
docs/                    文档；docs/会议记录/ 放会议纪要
.gitee/                  PR 和 Issue 模板
scripts/                 C：包体积检查、密钥扫描
```

### 分支和 PR（Gitee）

仓库：<https://gitee.com/amadys/break-ice-hall>，主分支 `master`。

1. 仓库管理员在「管理 → 保护分支」把 `master` 设为保护分支：不能直接推送，只能通过 Pull Request 合并。
2. 每人从最新的 `master` 拉分支，名字带自己的字母：`c/feat-uc-vote-page`、`a/feat-room-rpc`。
3. 一个 PR 只做一件事，尽量 1–2 天内合并，别攒大 PR。
4. 提 PR 时把改到的目录的负责人设为审查人（目录归属见 `README.md`）；改到别人的目录必须对方同意。Gitee 也支持用 `.gitee/CODEOWNERS` 自动指定审查人，管理员可以按 Gitee 帮助文档配置。
5. 合并时选「扁平化合并（Squash）」，提交信息写清楚做了什么。
6. 每天开工前：`git fetch origin && git rebase origin/master`。

### 合并前自查（贴到 PR 描述里）

- [ ] 在 `app/` 里运行 `npm run verify` 全部通过（类型检查、单测、构建、包体积、密钥扫描）
- [ ] 只改了自己负责的目录；改到别人的目录已经请对方审查
- [ ] 改了接口（RPC、表结构、频道事件、组件 props）已经同步更新文档
- [ ] 新增数据库迁移是新文件，没有改已合并的迁移
- [ ] 没有提交 `.env.local`、密钥、`dist/`
- [ ] 改了 `pages.json` 只动了自己的分包

### CI（Gitee 上没有 GitHub Actions）

- **现在**：每人提交前在 `app/` 里运行 `npm run verify`，PR 描述里写上结果。
- **仓库管理员开通 Gitee Go 后**：在仓库的「流水线」页面新建一条 Node.js 流水线，Node 版本 22，构建命令 `cd app && npm ci && npm run verify`，触发条件选「PR 到 master」和「推送到 master」。C 负责维护这条命令，命令本身不依赖任何平台。

### 共享文件的冲突怎么解

| 文件 | 规则 |
|---|---|
| `app/src/pages.json` | 主包页面归 D；每人只在 `subPackages` 里加自己的分包。冲突时两边的分包都保留 |
| `app/package.json` | 加依赖要在 PR 里说明为什么。冲突时先合 `package.json`，再 `npm install` 重新生成 lock 文件 |
| `app/package-lock.json` | **不要手动合并**：`git checkout origin/master -- app/package-lock.json && cd app && npm install` |
| `app/src/manifest.json` | 只有 C（构建配置）和 D（页面配置）改，改前在群里说一声 |
| `supabase/migrations/` | 只加新文件，不改已经合并的迁移。命名 `20261020120000_c_qb_tables.sql`（时间戳 + 成员字母 + 内容）。同时在 `supabase/rollback/` 放同名回滚脚本 |

### 接口变更

先改文档（这份或对应成员的文档），在 PR 描述里 @ 受影响的人，再改代码。

## 3. C 提供给别人的

### 给 D（大厅、页面）

| 接口 | 说明 |
|---|---|
| `uc_start(room_id, variant, bank_ids?, config?)` → `{ game_id }` | 大厅里主持人选「谁是卧底」或「你画我猜谁是卧底」后调用。`variant` 是 `classic` 或 `draw` |
| 页面路由 `/pages-uc/play?roomId=&gameId=` | 开始后所有人跳到这里（D 收到开始广播后跳转） |
| 页面路由 `/pages-bank/index` | 题库管理入口，主持人可以从大厅或「我的」进入 |
| `qb_pick_items(room_id, game_type, bank_ids, n)` | 真心话大冒险抽题（`truth` / `dare`），同一房间不重复 |
| 人数限制 | 谁是卧底 4–20 人，你画我猜谁是卧底 4–12 人，大厅可以据此禁用按钮（`PLAYER_LIMITS`） |

### 给 B（计分、你画我猜）

计分事件，每发生一次发一条（C 已经在引擎里产生，接入时转发给 B）：

```ts
{ roomId, gameId, playerId, reason, points }
```

| reason | 什么时候 | 建议分值 |
|---|---|---|
| `uc_win_civilian` | 平民胜，每个平民 | 2 |
| `uc_win_undercover` | 卧底胜，每个卧底和白板 | 4 |
| `uc_survive` | 获胜方活到最后 | 1 |
| `uc_correct_vote` | 投中了被淘汰的卧底 | 1 |
| `uc_ai_bonus` | 融合玩法 AI 分数 ≥60 得 1 倍、≥80 得 2 倍 | 1 |

B 可以按自己的权重配置重新算分，`points` 只是建议值。你画我猜的抽词用 `qb_pick_items(room_id, 'draw', bank_ids, n)`。

### 给 A

C 的表、RLS 和服务端函数草案见第 7 节，请 A 按统一规范 review。

## 4. C 需要 A 提供的

| 编号 | 需要什么 | C 用来做什么 | 什么时候要 |
|---|---|---|---|
| A1 | 登录后 `auth.uid()` 就是用户 ID；用户资料（昵称、头像、MBTI、自我介绍）能按用户 ID 查到 | 识别谁在操作；自我介绍卡 | 第 4 周 |
| A2 | 房间成员表：`room_id, user_id, seat（加入顺序）, is_host, 是否在线/已离开` | 发言顺序、判断主持人、退出处理 | 第 4 周 |
| A3 | **一个能跑 TypeScript 的服务端环境**（仓库里已有 `supabase/functions/ai-score`，看起来 A 会用 Supabase Edge Functions，待确认）：能拿到调用者的用户 ID、能用 service role 读写 C 的表、能往房间频道广播 | 引擎必须在服务端跑，否则玩家能改局面、看到别人的词。A 的 AI 评分本来就需要一个放 API Key 的服务端环境，C 用同一个。Edge Functions 跑在 Deno 上，C 的引擎接入时要补上 `.ts` 扩展名或加打包步骤 | 第 4 周 |
| A4 | 私有频道 `room:{room_id}`，只有房间成员能订阅；服务端广播工具 `broadcast(roomId, event, payload)` | 每次局面变化广播 `uc:view` | 第 4 周 |
| A5 | 统一 RPC 规范：命名、错误格式（待确认，C 建议 `{ code, message }`） | C 的 `UcError`、`BankError` 已经带 `code` 和中文 `message`，直接对上 | 第 4 周 |
| A6 | AI 评分：服务端调用 `scoreDrawing({ imageRef, word })` → `{ score: 0–100, ... }`，异步，同一张图不重复评 | 融合玩法的 AI 奖励分 | 第 7 周 |
| A7 | 房间事件：有人退出或掉线超时、房主转移时通知 C（回调或数据库触发器） | 引擎的 `playerLeft`；主持人操作用最新的 `is_host` 判断 | 第 5 周 |
| A8 | 数据库命名规范和公共字段（「大写命名」具体指什么，待确认） | C 的 SQL 草案先用小写下划线 + `id / created_at / updated_at / created_by / is_deleted`，A 定了以后统一改 | 第 1 周 |
| A9 | 画作图片存在哪（Supabase Storage 的 bucket 和路径规则，和 B 一起定） | 融合玩法的画廊和 AI 评分 | 第 6 周 |

## 5. C 需要 B 提供的

| 编号 | 需要什么 | 什么时候要 |
|---|---|---|
| B1 | 画布组件：`mode`（作画 / 观看 / 只读）、绑定房间频道做笔画同步、`export()` 返回图片引用；倒计时结束前自动导出 | 第 6 周 |
| B2 | 统一计分入口：接收第 3 节的计分事件 | 第 7 周 |
| B3 | 你画我猜的词库内容按 C 的 JSON 格式提供，C 放进系统题库 | 第 5 周 |

融合玩法里画作提交和结束回合是分开的（`drawingSubmitted` 和 `turnDone`），导出上传慢一点也没关系，回合结束后还能补交。

## 6. C 需要 D 提供的

| 编号 | 需要什么 | 什么时候要 |
|---|---|---|
| D1 | 大厅选游戏后调用 `uc_start`，收到开始广播后所有人跳转到 C 的页面 | 第 5 周 |
| D2 | 设计系统定下来（Vant Weapp 或 TDesign），C 的页面用同一套 | 第 2 周 |
| D3 | 自我介绍卡组件（按用户 ID 显示头像、昵称、MBTI、一句话介绍） | 第 3 周 |
| D4 | 真心话大冒险的题目按 C 的 JSON 格式提供，C 放进系统题库 | 第 5 周 |

## 7. C 的数据库和服务端草案（请 A review）

### 表

```sql
-- 题库
create table qb_bank (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(name) between 1 and 20),
  game_type   text not null check (game_type in ('draw', 'undercover', 'truth', 'dare')),
  visibility  text not null default 'private' check (visibility in ('system', 'private')),
  owner_id    uuid,                         -- 引用 A 的用户表；系统题库为 null
  description text not null default '',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  created_by  uuid,
  is_deleted  boolean not null default false
);

create table qb_item (
  id          uuid primary key default gen_random_uuid(),
  bank_id     uuid not null references qb_bank(id),
  content     jsonb not null,               -- 格式同 bank/types.ts 的 ContentByType
  item_key    text not null,                -- 去重键，算法同 validate.ts 的 itemKey
  tags        text[] not null default '{}',
  difficulty  smallint not null default 2 check (difficulty between 1 and 3),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  created_by  uuid,
  is_deleted  boolean not null default false,
  unique (bank_id, item_key)
);

-- 房间里用过的题，抽题时排除
create table qb_usage (
  room_id  uuid not null,                   -- 引用 A 的房间表
  item_id  uuid not null references qb_item(id),
  used_at  timestamptz not null default now(),
  primary key (room_id, item_id)
);

-- 谁是卧底：公开部分，房间成员可读
create table uc_game (
  id             uuid primary key default gen_random_uuid(),
  room_id        uuid not null,             -- 引用 A 的房间表
  variant        text not null check (variant in ('classic', 'draw')),
  version        int not null,
  phase          text not null,
  public_view    jsonb not null,            -- toPublicView 的结果，不含任何人的词
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  created_by     uuid,
  is_deleted     boolean not null default false
);

-- 谁是卧底：完整局面，含所有人的词。客户端不可访问，只有服务端函数读写
create table uc_game_secret (
  game_id  uuid primary key references uc_game(id),
  state    jsonb not null,                  -- UcState
  version  int not null
);
```

### RLS

- `qb_bank`：读 = `visibility = 'system' or owner_id = auth.uid()`；写 = `visibility = 'private' and owner_id = auth.uid()`。
- `qb_item`：跟着所属题库的权限走。
- `uc_game`：读 = 当前用户是该房间成员（用 A 的 `is_room_member(room_id)`）；客户端不能写。
- `uc_game_secret`：不开任何策略，只有 service role 能访问。
- 自己的词：RPC `uc_my_word(game_id)`（`security definer`），只返回调用者自己那一项。

### 服务端函数（跑在 A 提供的环境里）

```ts
// uc_act：玩家和主持人的所有操作
async function ucAct(userId: string, gameId: string, clientAction: UcClientAction) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const { state, version, roomId } = await loadSecret(gameId)
    const isHost = await isRoomHost(roomId, userId)
    const action = withActor(clientAction, userId)       // by 一律用登录态，不信任客户端
    const { state: next, events } = applyAction(state, action, { now: Date.now(), isHost })
    // 乐观锁：版本号没变才写入，两个人同时投票时后到的重试
    if (!(await saveIfVersion(gameId, version, next, toPublicView(next)))) continue
    await broadcast(roomId, 'uc:view', toPublicView(next))
    await forwardScores(roomId, gameId, events)           // 转给 B 的统一计分
    return toPublicView(next)
  }
  throw { code: 'CONFLICT', message: '操作太快了，请再试一次' }
}
// uc_start：从房间成员按 seat 排序取玩家，从题库抽词对，createGame
// uc_tick：客户端倒计时归零时调用，重复调用安全
```

倒计时以服务端时间为准：客户端拿到 `phaseDeadline` 后，用服务端返回的当前时间算出本机时钟偏差再显示倒计时。所有人的手机都会在到点时调用 `uc_tick`，只有第一次生效。

### 断线重连

重连后调用 `uc_get_view(game_id)` 和 `uc_my_word(game_id)`，再重新订阅频道，用 `version` 丢弃比当前旧的广播。

## 8. 环境变量和密钥

| 名称 | 放哪里 | 公开吗 | 谁提供 |
|---|---|---|---|
| `VITE_APP_ENV` | `app/.env.*` | 公开 | C |
| `VITE_SUPABASE_URL` | `app/.env.*` | 公开 | A |
| `VITE_SUPABASE_ANON_KEY` | `app/.env.*` | 公开（anon / publishable key） | A |
| `VITE_WX_CLOUD_ENV` | `app/.env.*` | 公开 | A |
| `SUPABASE_SERVICE_ROLE_KEY` | 云函数 / Edge Function 环境变量 | **密钥** | A |
| `SUPABASE_JWT_SECRET` | 登录云函数环境变量 | **密钥** | A |
| `WX_APPSECRET` | 登录云函数环境变量 | **密钥** | 小程序管理员 |
| `AI_API_KEY` | AI 评分服务环境变量 | **密钥** | A |
| `SUPABASE_ACCESS_TOKEN`、`SUPABASE_DB_PASSWORD`、`SUPABASE_PROJECT_REF` | Gitee Go 流水线的加密变量（推迁移） | **密钥** | A 提供，C 配置 |
| `MP_UPLOAD_PRIVATE_KEY` | Gitee Go 流水线的加密变量（`miniprogram-ci` 上传体验版） | **密钥** | 小程序管理员提供，C 配置 |

规则：

- 以 `VITE_` 开头的变量会打包进小程序，任何人都能看到。**密钥绝不能用 `VITE_` 开头。**
- `.env.local` 不提交。`npm run verify` 里的密钥扫描（`scripts/check-secrets.mjs`）会检查代码和打包产物，发现 service_role JWT、Supabase secret key、`sk-` 密钥、私钥就报错。
- 环境：开发用一个 Supabase 项目，演示 / 正式用另一个，迁移先在开发库跑通再推正式库。

### 依赖安全（npm audit）

`npm install` 会报大约 25 个漏洞（0 个严重），**不要运行 `npm audit fix --force`**：它会把 `@dcloudio/*` 降到几年前的 0.x 版本，项目直接坏掉。

- 已处理：uni-app 升到最新正式版；删掉没用到的 `vue-i18n`、`@dcloudio/uni-app-plus`；vitest 升到 3.2.7；`app/package.json` 的 `overrides` 把 DCloud 锁死的旧依赖（express、qs、ws、postcss、babel、vue-i18n 内部包等）换成已修复的版本。换之前和换之后打出来的小程序包和 H5 包逐字节一致。
- 剩下的都在 DCloud 锁死的构建工具里，修不了也不会进手机：
  - `vite` 5.2.8、`esbuild`：只影响本机的开发服务器（`npm run dev:*`），不要把开发服务器暴露到公网
  - `@vue/server-renderer`：只用于服务端渲染（SSR），小程序不用
  - `braces`：目前没有修复版本
  - `vitest`、`@vitest/mocker`：只影响 Vitest 的网页界面和浏览器模式，我们不用；修复要 vitest 4，而 vitest 4 需要 vite 6，和 uni-app 冲突
  - 上面这些会让依赖它们的 `@dcloudio/*` 包也显示为有漏洞
- 以后 DCloud 发新版时：把 `@dcloudio/*` 全部升到同一个新版本，删掉 `overrides` 里已经不需要的条目，跑 `npm run verify` 确认。

## 9. 合并步骤（按顺序）

| 步骤 | 内容 | 前提 | 完成标志 |
|---|---|---|---|
| 1 | C 的骨架、检查脚本、引擎、题库逻辑和单机页面合入 `master` | 无 | 全组 clone 后 `npm install && npm test` 通过 |
| 2 | C 的页面用单机后端完成 | 1 | 一部手机走完一整局谁是卧底；题库导入导出走通 |
| 3 | C 的迁移（第 7 节）合入 | A1、A2、A8 | 开发库里有 C 的表，RLS 测试通过 |
| 4 | C 的服务端函数上线 | A3、A4、A5 | 4 台手机能在同一房间玩一局，各自只看到自己的词 |
| 5 | 页面切到远程后端 | 4 | 配好 `.env.local` 后自动用远程，没配仍是单机 |
| 6 | 接 D 的大厅 | D1、D3 | 从大厅开始游戏、结束后回到房间 |
| 7 | 融合玩法接 B 的画布和 A 的 AI | B1、A6、A9 | 4 人画完能看画廊、投票，结束后显示 AI 分数 |
| 8 | 计分接 B | B2 | 排行榜实时显示 C 的计分 |
| 9 | 开通 Gitee Go，加自动部署 | 第 8 节的 Secrets | 合并到 `master` 自动推开发库迁移、上传体验版 |
| 10 | 20 台手机实测 | 全部 | 对照验收标准 |

## 10. 待和组员确认

| 问谁 | 问题 |
|---|---|
| A | 服务端 TS 环境确定用 Supabase Edge Functions 吗（仓库里已有 `supabase/functions/ai-score`）？ |
| A | 「大写命名」是表名列名全大写，还是只指常量？公共字段有哪些？ |
| A | 用户资料表有哪些字段（自我介绍卡要用）？ |
| A + B | 画作图片存哪里、路径怎么定？ |
| B | 画布组件的 props 和导出方法怎么设计？计分入口是表还是 RPC？ |
| D | 用 Vant Weapp 还是 TDesign？自我介绍卡组件叫什么、传什么参数？ |
| 全组 | 演示用体验版还是正式发布？有没有 ICP 备案域名？（见 `项目开发顺序.md` 风险部分） |
