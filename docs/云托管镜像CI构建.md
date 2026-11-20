# 云托管镜像：改由 CI 构建

> 背景：云托管自带构建器在本项目镜像上反复失败（9 次，多数在 17–30 秒失败且日志被截断）。
> 探测实验证明：单 COPY、apt、目录 COPY 单独都能过，唯独三处 `COPY --from` 的组合过不去。
> 因此把构建搬到 GitHub Actions，云托管只负责拉取运行。

---

## 整体流程

```
GitHub 仓库（从 Gitee 导入）
  → Actions 构建镜像（日志完整、可复现）
  → 推送到腾讯云 TCR（个人版免费）
  → 云托管「从镜像仓库拉取镜像」运行
```

---

## 一次性准备（约 15 分钟）

### 1. 在腾讯云开通 TCR 个人版

1. 打开 [容器镜像服务控制台](https://console.cloud.tencent.com/tcr)，选「个人版」
2. 首次进入会让你**设置登录密码**（用户名一般是腾讯云账号 ID，控制台会显示）
3. 新建**命名空间**，例如 `breakice`
4. 记下三样：`ccr.ccs.tencentyun.com`、命名空间、用户名

> 个人版免费，仓库数量与流量有额度，够用。

### 2. 把 Gitee 仓库导入 GitHub

1. GitHub → New repository → 名字随意（如 `break-ice-hall`）
2. 创建后选「import a repository」，填 Gitee 的 HTTPS 地址
3. 导入完成后，仓库里应该能看到 `.github/workflows/build-cloudrun-image.yml`

（也可以本地 `git remote add github <url> && git push github master`）

### 3. 配置 GitHub Secrets

仓库 → Settings → Secrets and variables → Actions → New repository secret：

| 名称 | 值 |
| --- | --- |
| `TCR_REGISTRY` | `ccr.ccs.tencentyun.com` |
| `TCR_NAMESPACE` | 你建的命名空间，如 `breakice` |
| `TCR_USERNAME` | TCR 控制台显示的用户名 |
| `TCR_PASSWORD` | 你在第 1 步设置的密码 |

---

## 构建

仓库 → Actions → `build-cloudrun-image` → Run workflow。

约 5–10 分钟（首次拉基础镜像慢）。成功后 TCR 里会出现：

```
ccr.ccs.tencentyun.com/breakice/breakice-backend:latest
```

**这一步的日志是完整可读的**——如果 Dockerfile 有问题，能直接看到哪一行错。

---

## 部署到云托管

1. 云托管 → 服务 `backend` → 新建版本
2. 部署方式选「**从镜像仓库拉取镜像**」
3. 填镜像地址：`ccr.ccs.tencentyun.com/breakice/breakice-backend:latest`
4. 如果要求凭据，填第 1 步的用户名/密码
5. 端口填 `80`
6. 环境变量照旧：

```json
{
  "JWT_SECRET": "<原来的值>",
  "POSTGRES_PASSWORD": "<原来的值>",
  "POSTGRES_DB": "breakice"
}
```

7. 挂载 CFS 到 `/var/lib/postgresql/data` 与 `/var/lib/storage`
8. 规格 2 核 4 G，开启「超限按量」

---

## 镜像里是什么

```
nginx :80
  ├─ /rest/v1/*       → PostgREST    :3000
  ├─ /auth/v1/*       → GoTrue       :9999
  ├─ /storage/v1/*    → storage-shim :9000（自写，落 CFS）
  └─ /functions/v1/*  → 5 个 Deno 函数（9101–9105）
      /healthz        → ok
```

启动顺序：先起 nginx（让探活立刻通过）→ 用基础镜像 entrypoint 初始化 Postgres →
建库并跑 26 支迁移 → 拉起各组件 → `tail -f /dev/null` 保活。

---

## 常见问题

| 现象 | 处理 |
| --- | --- |
| Actions 里 `docker login` 失败 | Secrets 填错，或 TCR 密码未设置 |
| 构建时 curl 下载超时 | GitHub 跑在境外，一般没问题；失败重跑一次 |
| 云托管拉取镜像失败 | 确认 TCR 是个人版且命名空间对；镜像地址要带 `:latest` |
| 容器起来但探活失败 | 看启动日志里的 `[entrypoint]` 行，定位卡在哪一步 |

---

## 为什么不继续用云托管构建

9 次尝试的结论：

| 实验 | 结果 |
| --- | --- |
| 仅 nginx:alpine + 1 个 COPY | ✅ 成功 |
| 4 个 FROM + 无 COPY | ✅ 成功 |
| apt + 单文件 COPY | ✅ 成功 |
| 完整目录 + apt + 无 `COPY --from` | ✅ 成功（并给出真实错误） |
| 完整目录 + 3 处 `COPY --from` | ❌ 反复失败、日志被截断 |

继续在这条路上试，成本高于换路。
