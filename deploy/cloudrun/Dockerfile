# 微信云托管：Supabase 单容器镜像
#
# 构建上下文 = 上传的 zip 解压后的根目录（扁平结构）：
#   Dockerfile  nginx.conf  entrypoint.sh  storage-shim.ts
#   migrations/  functions/  local/
#
# 组成：PostgreSQL + PostgREST + GoTrue + storage-shim(deno) + Edge Functions(deno) + nginx
# 端口：80（nginx），云托管「端口」一栏填 80

# ---------- 取各组件二进制 ----------
FROM postgrest/postgrest:v12.2.3 AS postgrest
FROM supabase/gotrue:v2.151.0 AS gotrue
FROM denoland/deno:debian-1.44.0 AS deno

# ---------- 运行环境 ----------
FROM supabase/postgres:15.8.1.060

USER root

RUN apt-get update \
    && apt-get install -y --no-install-recommends nginx curl ca-certificates gettext-base \
    && rm -rf /var/lib/apt/lists/*

# PostgREST：官方镜像里的二进制
COPY --from=postgrest /bin/postgrest /usr/local/bin/postgrest

# GoTrue：官方镜像入口（若报 no such file，改 /bin/auth 或 /usr/local/bin/gotrue）
COPY --from=gotrue /usr/local/bin/auth /usr/local/bin/gotrue

# Deno：跑 storage-shim 与边缘函数
COPY --from=deno /usr/bin/deno /usr/local/bin/deno

# ---------- 云托管要求的证书初始化目录 ----------
# 平台会向 /app/cert/initenv.sh 注入生命周期钩子；目录与脚本必须先存在，
# 否则会报 "Exec lifecycle hook ... exited with 137"。
RUN mkdir -p /app/cert \
    && printf '#!/bin/sh\nexit 0\n' > /app/cert/initenv.sh \
    && chmod +x /app/cert/initenv.sh

# ---------- 应用内容（扁平路径，与 zip 根目录一致） ----------
ENV PGDATA=/var/lib/postgresql/data
ENV STORAGE_DIR=/var/lib/storage

RUN mkdir -p /opt/app /etc/nginx/conf.d "$STORAGE_DIR" \
    && chown -R postgres:postgres "$PGDATA" "$STORAGE_DIR"

WORKDIR /opt/app

COPY migrations ./migrations
COPY functions ./functions
COPY local/00-supabase-shim.sql ./00-supabase-shim.sql
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY entrypoint.sh ./entrypoint.sh
COPY storage-shim.ts ./storage-shim.ts

RUN chmod +x /opt/app/entrypoint.sh && nginx -t

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --start-period=120s \
  CMD curl -fsS http://127.0.0.1/healthz || exit 1

ENTRYPOINT ["/opt/app/entrypoint.sh"]
# 基础镜像自带 ENTRYPOINT docker-entrypoint.sh，必须覆盖，否则 nginx 不会启动
