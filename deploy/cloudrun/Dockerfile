# 微信云托管：Supabase 单容器镜像
#
# 构建上下文 = 上传的 zip 解压后的根目录（扁平结构）。
# 注意：WORKDIR 必须在所有相对路径 COPY 之前设置，否则文件会落到 / 而不是 /opt/app。
FROM postgrest/postgrest:v12.2.3 AS postgrest
FROM supabase/gotrue:v2.151.0 AS gotrue
FROM denoland/deno:debian-1.44.0 AS deno

FROM supabase/postgres:15.8.1.060

USER root

RUN apt-get update && apt-get install -y --no-install-recommends nginx curl ca-certificates && rm -rf /var/lib/apt/lists/*

COPY --from=postgrest /bin/postgrest /usr/local/bin/postgrest
COPY --from=gotrue /usr/local/bin/auth /usr/local/bin/gotrue
COPY --from=deno /usr/bin/deno /usr/local/bin/deno

RUN mkdir -p /app/cert /opt/app /etc/nginx/conf.d /var/lib/storage
RUN printf '#!/bin/sh\nexit 0\n' > /app/cert/initenv.sh && chmod +x /app/cert/initenv.sh

ENV PGDATA=/var/lib/postgresql/data
ENV STORAGE_DIR=/var/lib/storage

# 先切工作目录，再 COPY 相对路径
WORKDIR /opt/app

COPY entrypoint.sh ./entrypoint.sh
COPY storage-shim.ts ./storage-shim.ts
COPY migrations ./migrations
COPY functions ./functions
COPY local/00-supabase-shim.sql ./00-supabase-shim.sql
COPY nginx.conf /etc/nginx/conf.d/default.conf

RUN chmod +x /opt/app/entrypoint.sh
RUN nginx -t
RUN test -f /opt/app/entrypoint.sh && test -d /opt/app/migrations && test -f /opt/app/functions/wechat-auth/index.ts

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --start-period=120s CMD curl -fsS http://127.0.0.1/healthz || exit 1

ENTRYPOINT ["/opt/app/entrypoint.sh"]
