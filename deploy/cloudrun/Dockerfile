# 微信云托管：Supabase 单容器镜像
#
# 构建上下文 = 上传的 zip 解压后的根目录（扁平结构）。
#
# 设计取舍：只保留一处 COPY --from（GoTrue，它的二进制没有独立发布），
# PostgREST 与 Deno 改为构建时 curl 下载——多阶段的数量看起来会影响该构建器。
# WORKDIR 必须在所有相对路径 COPY 之前。
FROM supabase/gotrue:v2.151.0 AS gotrue

FROM supabase/postgres:15.8.1.060

USER root

RUN apt-get update && apt-get install -y --no-install-recommends nginx curl ca-certificates xz-utils unzip && rm -rf /var/lib/apt/lists/*

# PostgREST：官方静态二进制
RUN curl -fsSL -o /tmp/postgrest.tar.xz https://github.com/PostgREST/postgrest/releases/download/v12.2.3/postgrest-v12.2.3-linux-static-x64.tar.xz && tar -xJf /tmp/postgrest.tar.xz -C /usr/local/bin && rm -f /tmp/postgrest.tar.xz && chmod +x /usr/local/bin/postgrest

# Deno：官方发布包
RUN curl -fsSL -o /tmp/deno.zip https://github.com/denoland/deno/releases/download/v1.44.0/deno-x86_64-unknown-linux-gnu.zip && unzip -q /tmp/deno.zip -d /usr/local/bin && rm -f /tmp/deno.zip && chmod +x /usr/local/bin/deno

COPY --from=gotrue /usr/local/bin/auth /usr/local/bin/gotrue

RUN mkdir -p /app/cert /opt/app /etc/nginx/conf.d /var/lib/storage
RUN printf '#!/bin/sh\nexit 0\n' > /app/cert/initenv.sh && chmod +x /app/cert/initenv.sh

ENV PGDATA=/var/lib/postgresql/data
ENV STORAGE_DIR=/var/lib/storage

WORKDIR /opt/app

COPY entrypoint.sh ./entrypoint.sh
COPY storage-shim.ts ./storage-shim.ts
COPY migrations ./migrations
COPY functions ./functions
COPY local/00-supabase-shim.sql ./00-supabase-shim.sql
COPY nginx.conf /etc/nginx/conf.d/default.conf

RUN chmod +x /opt/app/entrypoint.sh
RUN nginx -t
RUN postgrest --version && deno --version
RUN test -f /opt/app/entrypoint.sh && test -d /opt/app/migrations && test -f /opt/app/functions/wechat-auth/index.ts
RUN head -1 /opt/app/entrypoint.sh | grep -q '^#!'

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --start-period=120s CMD curl -fsS http://127.0.0.1/healthz || exit 1

ENTRYPOINT ["/opt/app/entrypoint.sh"]
