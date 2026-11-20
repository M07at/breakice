#!/bin/sh
# 云托管容器入口
#
# 关键顺序（踩过的坑）：
#   1. 先起 nginx，让 80 端口立刻可用 —— 否则云托管探活连接被拒，容器会被判失败；
#   2. 再用基础镜像自带的 docker-entrypoint 初始化并启动 Postgres
#      （它负责建角色、装扩展、跑 /docker-entrypoint-initdb.d 里的 Supabase 初始化脚本）；
#   3. 最后拉起 PostgREST / GoTrue / storage-shim / 边缘函数。
set -u

log() { echo "[entrypoint] $*"; }

DB_NAME="${POSTGRES_DB:-breakice}"
DB_PASS="${POSTGRES_PASSWORD:-postgres}"
DB_USER="${POSTGRES_SUPERUSER:-supabase_admin}"
APP=/opt/app

# 云托管的证书钩子需要这个目录
mkdir -p /app/cert

# ---------- 1. 先让 80 端口可用 ----------
log "启动 nginx（探活先行）"
nginx -g 'daemon on;' || { log "nginx 启动失败"; nginx -t; exit 1; }

# ---------- 2. 用基础镜像的 entrypoint 初始化并启动 Postgres ----------
if [ -x /usr/local/bin/docker-entrypoint.sh ]; then
  log "以基础镜像 entrypoint 启动 PostgreSQL"
  /usr/local/bin/docker-entrypoint.sh postgres > /tmp/pg.log 2>&1 &
else
  log "未找到基础 entrypoint，直接启动 postgres"
  su postgres -c "postgres -D /var/lib/postgresql/data" > /tmp/pg.log 2>&1 &
fi

log "等待 PostgreSQL 就绪"
for i in $(seq 1 180); do
  if pg_isready -h 127.0.0.1 -p 5432 -q; then log "PostgreSQL 就绪（${i}s）"; break; fi
  sleep 1
done
pg_isready -h 127.0.0.1 -p 5432 || { log "PostgreSQL 未就绪"; tail -n 50 /tmp/pg.log; }

# ---------- 3. 建库 + 迁移 ----------
if pg_isready -h 127.0.0.1 -p 5432 -q; then
  export PGPASSWORD="$DB_PASS"
  if ! psql -h 127.0.0.1 -U "$DB_USER" -tAc "select 1 from pg_database where datname='$DB_NAME'" | grep -q 1; then
    log "创建数据库 $DB_NAME"
    createdb -h 127.0.0.1 -U "$DB_USER" "$DB_NAME" || log "建库失败（可能已存在）"
  fi

  HAS_ROOMS=$(psql -h 127.0.0.1 -U "$DB_USER" -d "$DB_NAME" -tAc "select to_regclass('public.rooms') is not null" 2>/dev/null || echo "f")
  # 兼容层每次都跑：语句全是幂等的，补列不用清数据目录
  log "补 Supabase 兼容对象（幂等）"
  psql -h 127.0.0.1 -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=0 -q -f "$APP/00-supabase-shim.sql" || log "兼容层有报错，继续"

  if [ "$HAS_ROOMS" != "t" ]; then
    log "首次启动：执行迁移"

    log "依次执行迁移"
    for f in $(ls "$APP"/migrations/*.sql 2>/dev/null | sort); do
      log "  $(basename "$f")"
      psql -h 127.0.0.1 -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 -q -f "$f" || log "  迁移失败：$(basename "$f")"
    done
  else
    log "检测到已有结构，跳过迁移"
  fi
fi

# ---------- 4. 业务组件 ----------
log "启动 PostgREST"
PGRST_DB_URI="postgres://${DB_USER}:${DB_PASS}@127.0.0.1:5432/${DB_NAME}" \
PGRST_DB_SCHEMAS=public \
PGRST_DB_ANON_ROLE=anon \
PGRST_JWT_SECRET="${JWT_SECRET:-insecure-dev-secret-insecure-dev-secret}" \
PGRST_SERVER_PORT=3000 \
postgrest > /tmp/postgrest.log 2>&1 &

# 让 GoTrue 重新执行自带迁移：镜像里的 auth schema 只到初始版本
psql -h 127.0.0.1 -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=0 -q \
  -c "drop table if exists auth.schema_migrations" \
  || log "清理 auth 迁移记录失败（继续）"

log "启动 GoTrue"
API_EXTERNAL_URL="${PUBLIC_URL:-http://127.0.0.1:9999}" \
GOTRUE_API_EXTERNAL_URL="${PUBLIC_URL:-http://127.0.0.1:9999}" \
GOTRUE_JWT_SECRET="${JWT_SECRET:-insecure-dev-secret-insecure-dev-secret}" \
GOTRUE_JWT_EXP=3600 \
GOTRUE_DB_DRIVER=postgres \
GOTRUE_DB_DATABASE_URL="postgres://supabase_auth_admin:${DB_PASS}@127.0.0.1:5432/${DB_NAME}?search_path=auth" \
GOTRUE_API_HOST=127.0.0.1 \
PORT=9999 \
GOTRUE_SITE_URL="https://example.com" \
GOTRUE_DISABLE_SIGNUP=false \
GOTRUE_ENABLE_ANONYMOUS_SIGNINS=true \
GOTRUE_ANONYMOUS_USERS_ENABLED=true \
GOTRUE_EXTERNAL_ANONYMOUS_USERS_ENABLED=true \
gotrue > /tmp/gotrue.log 2>&1 &

log "启动 storage-shim"
STORAGE_DIR="${STORAGE_DIR:-/var/lib/storage}" JWT_SECRET="${JWT_SECRET:-}" PORT=9000 \
  deno run --allow-net --allow-read --allow-write --allow-env "$APP/storage-shim.ts" \
  > /tmp/storage.log 2>&1 &

log "启动边缘函数"
start_fn() {
  PORT="$2" deno run --allow-net --allow-env --allow-read "$APP/functions/$1/index.ts" \
    > "/tmp/fn-$1.log" 2>&1 &
}
start_fn wechat-auth 9101
start_fn uc-command 9102
start_fn ai-score 9103
start_fn draw-score 9104
start_fn wechat-qrcode 9105

log "全部组件已拉起，保持容器存活"
exec tail -f /dev/null
