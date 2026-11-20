# 云托管容器入口：初始化数据库 → 跑迁移 → 拉起各进程 → nginx 前台
set -euo pipefail

log() { echo "[entrypoint] $*"; }

DB_NAME="${POSTGRES_DB:-breakice}"
DB_PASS="${POSTGRES_PASSWORD:-postgres}"

# ---------- 1. 初始化数据目录 ----------
if [ ! -s "$PGDATA/PG_VERSION" ]; then
  log "初始化数据目录 $PGDATA"
  mkdir -p "$PGDATA"
  chown -R postgres:postgres "$PGDATA"
  su postgres -c "initdb -D '$PGDATA' -U postgres --auth=trust -E UTF8 --locale=C"
fi

# ---------- 2. 启动 Postgres ----------
log "启动 PostgreSQL"
su postgres -c "pg_ctl -D '$PGDATA' -o '-p 5432 -c listen_addresses=127.0.0.1' -l /tmp/pg.log start"

for i in $(seq 1 60); do
  if pg_isready -h 127.0.0.1 -p 5432 -q; then break; fi
  sleep 1
done
pg_isready -h 127.0.0.1 -p 5432 || { log "PostgreSQL 未就绪"; cat /tmp/pg.log; exit 1; }

# ---------- 3. 建库 ----------
if ! psql -h 127.0.0.1 -U postgres -tAc "select 1 from pg_database where datname='$DB_NAME'" | grep -q 1; then
  log "创建数据库 $DB_NAME"
  createdb -h 127.0.0.1 -U postgres "$DB_NAME"
fi

export PGPASSWORD="$DB_PASS"

# ---------- 4. 结构初始化（只在首次执行） ----------
MARKER=$(psql -h 127.0.0.1 -U postgres -d "$DB_NAME" -tAc \
  "select to_regclass('public.rooms') is not null" 2>/dev/null || echo "false")

if [ "$MARKER" != "t" ]; then
  log "首次启动：应用 Supabase 兼容层"
  psql -h 127.0.0.1 -U postgres -d "$DB_NAME" -v ON_ERROR_STOP=1 -q -f /opt/app/00-supabase-shim.sql

  log "依次执行迁移"
  for f in $(ls /opt/app/migrations/*.sql | sort); do
    log "  $(basename "$f")"
    psql -h 127.0.0.1 -U postgres -d "$DB_NAME" -v ON_ERROR_STOP=1 -q -f "$f"
  done
  log "迁移完成"
else
  log "检测到已有结构，跳过迁移"
fi

# ---------- 5. 拉起业务组件 ----------
log "启动 PostgREST"
PGRST_DB_URI="postgres://postgres:${DB_PASS}@127.0.0.1:5432/${DB_NAME}" \
PGRST_DB_SCHEMAS=public \
PGRST_DB_ANON_ROLE=anon \
PGRST_JWT_SECRET="${JWT_SECRET:?JWT_SECRET 未设置}" \
PGRST_SERVER_PORT=3000 \
postgrest > /tmp/postgrest.log 2>&1 &

log "启动 GoTrue"
GOTRUE_JWT_SECRET="${JWT_SECRET}" \
GOTRUE_JWT_EXP=3600 \
GOTRUE_DB_DRIVER=postgres \
GOTRUE_DB_DATABASE_URL="postgres://postgres:${DB_PASS}@127.0.0.1:5432/${DB_NAME}?search_path=auth" \
GOTRUE_API_HOST=127.0.0.1 \
PORT=9999 \
GOTRUE_SITE_URL="https://example.com" \
GOTRUE_DISABLE_SIGNUP=false \
GOTRUE_ENABLE_ANONYMOUS_SIGNINS=true \
gotrue > /tmp/gotrue.log 2>&1 &

log "启动 storage-shim"
STORAGE_DIR="${STORAGE_DIR}" JWT_SECRET="${JWT_SECRET}" PORT=9000 \
  deno run --allow-net --allow-read --allow-write --allow-env /opt/app/storage-shim.ts \
  > /tmp/storage.log 2>&1 &

log "启动 Edge Functions"
deno run --allow-net --allow-env --allow-read --allow-import /opt/app/functions/deno-server.ts \
  > /tmp/functions.log 2>&1 &

sleep 3

# ---------- 6. nginx 前台 ----------
log "启动 nginx（80）"
exec nginx -g 'daemon off;'
