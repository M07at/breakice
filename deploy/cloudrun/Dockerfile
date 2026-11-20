# 微信云托管：Supabase 单容器镜像
#
# 组成：PostgreSQL + PostgREST + GoTrue + storage-shim(deno) + Edge Functions(deno) + nginx
# 端口：80（nginx），云托管「端口」一栏填 80
#
# 注意：多处 COPY --from 假设了官方镜像内的二进制路径，
# 若构建报 "no such file"，按 docs/云托管部署决策.md 第 5 节修正路径。

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

# GoTrue：官方镜像入口为 /usr/local/bin/auth（若报错改为 /bin/auth 或 /gotrue）
COPY --from=gotrue /usr/local/bin/auth /usr/local/bin/gotrue

# Deno：跑 storage-shim 与边缘函数
COPY --from=deno /usr/bin/deno /usr/local/bin/deno

# ---------- 应用内容 ----------
ENV PGDATA=/var/lib/postgresql/data
ENV STORAGE_DIR=/var/lib/storage

RUN mkdir -p /opt/app /etc/nginx/conf.d "$STORAGE_DIR" \
    && chown -R postgres:postgres "$PGDATA" "$STORAGE_DIR"

WORKDIR /opt/app

# 迁移脚本、shim、边缘函数、nginx 配置
COPY supabase/migrations /opt/app/migrations
COPY supabase/local/00-supabase-shim.sql /opt/app/00-supabase-shim.sql
COPY supabase/functions /opt/app/functions
COPY deploy/cloudrun/nginx.conf /etc/nginx/conf.d/default.conf
COPY deploy/cloudrun/entrypoint.sh /opt/app/entrypoint.sh
COPY deploy/cloudrun/storage-shim.ts /opt/app/storage-shim.ts

RUN chmod +x /opt/app/entrypoint.sh && nginx -t

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --start-period=60s \
  CMD curl -fsS http://127.0.0.1/healthz || exit 1

CMD ["/opt/app/entrypoint.sh"]
