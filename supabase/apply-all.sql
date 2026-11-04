-- 破冰局 · 建库前处理：把早期原型留下的同名表改名备份
-- 用法：先单独执行本文件，再按 0001 → 0006 顺序执行 migrations。
-- 只改名，不删数据；确认旧数据没用之后可以自己 drop table public.rooms_legacy_backup;

do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'rooms'
  ) and not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'rooms' and column_name = 'code'
  ) then
    if exists (
      select 1 from information_schema.tables
      where table_schema = 'public' and table_name = 'rooms_legacy_backup'
    ) then
      raise notice 'rooms_legacy_backup 已存在，跳过改名';
    else
      alter table public.rooms rename to rooms_legacy_backup;
      raise notice '旧 rooms 已改名为 rooms_legacy_backup';
    end if;
  else
    raise notice 'public.rooms 不存在或已经是新结构，无需处理';
  end if;
end $$;

-- =======================================================================
-- 0001_schema.sql
-- =======================================================================
-- 破冰局 · A：平台核心数据库结构与公共视图
-- 说明：客户端不直接读取 games.state（完整 UcState 含身份/词牌），
--       只通过 public.game_public 视图拿到公开投影（UcPublicView）。

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- 公共工具
-- ---------------------------------------------------------------------------

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.generate_room_code()
returns text
language plpgsql
as $$
declare
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  result text := '';
  i int;
begin
  for i in 1..6 loop
    result := result || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
  end loop;
  return result;
end;
$$;

-- ---------------------------------------------------------------------------
-- 用户与档案
-- ---------------------------------------------------------------------------

create table if not exists public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  openid      text unique,
  nickname    text not null default '玩家',
  avatar_url  text,
  mbti        text,
  intro       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

drop trigger if exists trg_profiles_touch on public.profiles;
create trigger trg_profiles_touch
before update on public.profiles
for each row execute function public.touch_updated_at();

-- 新用户自动建档（wechat-auth 会在 user_metadata 里写入昵称/头像）
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, nickname, avatar_url)
  values (
    new.id,
    coalesce(nullif(new.raw_user_meta_data ->> 'nickname', ''), '玩家'),
    new.raw_user_meta_data ->> 'avatar_url'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- 房间与成员
-- ---------------------------------------------------------------------------

create table if not exists public.rooms (
  id           uuid primary key default gen_random_uuid(),
  code         text not null unique check (code ~ '^[A-Z0-9]{6}$'),
  title        text not null default '破冰局',
  host_id      uuid not null references public.profiles (id) on delete restrict,
  game_type    text not null default 'lobby'
               check (game_type in ('lobby', 'draw', 'undercover', 'hybrid', 'truth')),
  status       text not null default 'lobby'
               check (status in ('lobby', 'playing', 'ended')),
  max_players  int not null default 12 check (max_players between 4 and 20),
  settings     jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  closed_at    timestamptz
);

drop trigger if exists trg_rooms_touch on public.rooms;
create trigger trg_rooms_touch
before update on public.rooms
for each row execute function public.touch_updated_at();

create table if not exists public.room_members (
  room_id       uuid not null references public.rooms (id) on delete cascade,
  user_id       uuid not null references public.profiles (id) on delete cascade,
  seat          int not null check (seat between 1 and 20),
  role          text not null default 'player' check (role in ('host', 'player')),
  ready         boolean not null default false,
  online        boolean not null default true,
  joined_at     timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),
  left_at       timestamptz,
  primary key (room_id, user_id),
  unique (room_id, seat)
);

create index if not exists idx_room_members_user on public.room_members (user_id) where left_at is null;

-- ---------------------------------------------------------------------------
-- 局次：完整状态与公开投影分离
-- ---------------------------------------------------------------------------

create table if not exists public.games (
  id            uuid primary key default gen_random_uuid(),
  room_id       uuid not null references public.rooms (id) on delete cascade,
  game_number   int not null check (game_number >= 1),
  variant       text not null check (variant in ('classic', 'draw')),
  status        text not null default 'active' check (status in ('active', 'ended')),
  version       bigint not null default 1,
  state         jsonb not null,   -- 私有：完整 UcState
  view          jsonb not null,   -- 公开：UcPublicView
  started_at    timestamptz not null default now(),
  ended_at      timestamptz,
  ended_reason  text,
  unique (room_id, game_number)
);

create index if not exists idx_games_room_status on public.games (room_id, status);

-- 每人只会读到自己那一行
create table if not exists public.game_secrets (
  game_id         uuid not null references public.games (id) on delete cascade,
  user_id         uuid not null references public.profiles (id) on delete cascade,
  word            text not null,
  camp            text not null check (camp in ('civilian', 'undercover')),
  acknowledged_at timestamptz,
  primary key (game_id, user_id)
);

-- 请求回执：重试使用同一 requestId 时返回同一结果
create table if not exists public.game_receipts (
  game_id        uuid not null references public.games (id) on delete cascade,
  user_id        uuid not null references public.profiles (id) on delete cascade,
  request_id     text not null check (char_length(request_id) between 1 and 100),
  fingerprint    text not null,
  result_version bigint not null,
  created_at     timestamptz not null default now(),
  primary key (game_id, user_id, request_id)
);

create table if not exists public.game_starts (
  room_id     uuid not null references public.rooms (id) on delete cascade,
  request_id  text not null check (char_length(request_id) between 1 and 100),
  fingerprint text not null,
  game_id     uuid not null references public.games (id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (room_id, request_id)
);

-- 一房同时只能有一局进行中
create unique index if not exists uq_games_active_room
  on public.games (room_id) where status = 'active';

-- ---------------------------------------------------------------------------
-- 画作与 AI 评分
-- ---------------------------------------------------------------------------

create table if not exists public.artworks (
  id            uuid primary key default gen_random_uuid(),
  game_id       uuid not null references public.games (id) on delete cascade,
  turn_key      text not null,
  user_id       uuid not null references public.profiles (id) on delete cascade,
  storage_path  text not null,
  status        text not null default 'pending'
                check (status in ('pending', 'scored', 'failed')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (game_id, turn_key)   -- 同一回合只能交一张画，重试需复用
);

drop trigger if exists trg_artworks_touch on public.artworks;
create trigger trg_artworks_touch
before update on public.artworks
for each row execute function public.touch_updated_at();

create table if not exists public.ai_scores (
  id            uuid primary key default gen_random_uuid(),
  artwork_id    uuid not null unique references public.artworks (id) on delete cascade,
  provider      text not null default 'multimodal',
  model         text,
  composition   int check (composition between 0 and 100),
  creativity    int check (creativity between 0 and 100),
  relevance     int check (relevance between 0 and 100),
  total         int check (total between 0 and 100),
  comment       text,
  status        text not null default 'pending'
                check (status in ('pending', 'success', 'failed', 'timeout')),
  error         text,
  latency_ms    int,
  created_at    timestamptz not null default now(),
  completed_at  timestamptz
);

-- 统一计分（B 使用）：同一事件只能记一次
create table if not exists public.scores (
  id          uuid primary key default gen_random_uuid(),
  game_id     uuid not null references public.games (id) on delete cascade,
  user_id     uuid not null references public.profiles (id) on delete cascade,
  points      int not null,
  reason      text not null,
  ref         text not null,
  created_at  timestamptz not null default now(),
  unique (game_id, user_id, reason, ref)
);

-- ---------------------------------------------------------------------------
-- 题库（C 的 BankRepository 生产实现）
-- ---------------------------------------------------------------------------

create table if not exists public.word_banks (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid references public.profiles (id) on delete cascade, -- null = 系统题库
  name        text not null,
  game_type   text not null check (game_type in ('undercover', 'draw', 'truth', 'dare')),
  lang        text not null default 'zh' check (lang in ('zh', 'en')),
  is_public   boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

drop trigger if exists trg_word_banks_touch on public.word_banks;
create trigger trg_word_banks_touch
before update on public.word_banks
for each row execute function public.touch_updated_at();

create table if not exists public.word_bank_items (
  id          uuid primary key default gen_random_uuid(),
  bank_id     uuid not null references public.word_banks (id) on delete cascade,
  civilian    text,
  undercover  text,
  word        text,
  drawable    boolean not null default false,
  tags        text[] not null default '{}',
  difficulty  smallint check (difficulty between 1 and 5),
  lang        text not null default 'zh' check (lang in ('zh', 'en')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint word_bank_items_shape check (
    (civilian is not null and undercover is not null and civilian <> undercover)
    or (civilian is null and undercover is null and word is not null)
  )
);

create index if not exists idx_bank_items_bank on public.word_bank_items (bank_id);

drop trigger if exists trg_bank_items_touch on public.word_bank_items;
create trigger trg_bank_items_touch
before update on public.word_bank_items
for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- 成员判定（security definer，避免策略递归）
-- ---------------------------------------------------------------------------

create or replace function public.is_room_member(p_room uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.room_members m
    where m.room_id = p_room and m.user_id = auth.uid() and m.left_at is null
  );
$$;

create or replace function public.is_room_host(p_room uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.rooms r where r.id = p_room and r.host_id = auth.uid());
$$;

create or replace function public.shares_room_with(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.room_members me
    join public.room_members other on other.room_id = me.room_id
    where me.user_id = auth.uid()
      and me.left_at is null
      and other.user_id = p_user
      and other.left_at is null
  );
$$;

-- ---------------------------------------------------------------------------
-- 公开投影视图：只暴露 UcPublicView，不暴露 state
-- ---------------------------------------------------------------------------

create or replace view public.game_public
with (security_barrier = true)
as
select
  g.id,
  g.room_id,
  g.game_number,
  g.variant,
  g.status,
  g.version,
  g.view,
  g.started_at,
  g.ended_at,
  g.ended_reason
from public.games g
where public.is_room_member(g.room_id);

revoke all on public.game_public from anon;
grant select on public.game_public to authenticated;

-- =======================================================================
-- 0002_rls.sql
-- =======================================================================
-- 破冰局 · A：行级安全（RLS）与跨房间隔离
-- 原则：
--   1. 客户端只能看到自己所在房间的数据；
--   2. 词牌（game_secrets）只有本人可读；
--   3. 局次完整状态（games.state）任何客户端都不可读，只走 game_public 视图；
--   4. 所有写操作只允许走 RPC / Edge Function，表上不给 insert/update/delete 策略。

alter table public.profiles        enable row level security;
alter table public.rooms           enable row level security;
alter table public.room_members    enable row level security;
alter table public.games           enable row level security;
alter table public.game_secrets    enable row level security;
alter table public.game_receipts   enable row level security;
alter table public.game_starts     enable row level security;
alter table public.artworks        enable row level security;
alter table public.ai_scores       enable row level security;
alter table public.scores          enable row level security;
alter table public.word_banks      enable row level security;
alter table public.word_bank_items enable row level security;

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------

drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
for select to authenticated
using (id = auth.uid() or public.shares_room_with(id));

drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles
for update to authenticated
using (id = auth.uid())
with check (id = auth.uid());

-- ---------------------------------------------------------------------------
-- rooms / room_members
-- ---------------------------------------------------------------------------

drop policy if exists rooms_select_member on public.rooms;
create policy rooms_select_member on public.rooms
for select to authenticated
using (public.is_room_member(id));

drop policy if exists rooms_update_host on public.rooms;
create policy rooms_update_host on public.rooms
for update to authenticated
using (public.is_room_host(id))
with check (public.is_room_host(id));

drop policy if exists room_members_select on public.room_members;
create policy room_members_select on public.room_members
for select to authenticated
using (public.is_room_member(room_id));

-- ---------------------------------------------------------------------------
-- games：无直接策略，客户端读 game_public 视图
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- game_secrets：只有本人
-- ---------------------------------------------------------------------------

drop policy if exists game_secrets_select_self on public.game_secrets;
create policy game_secrets_select_self on public.game_secrets
for select to authenticated
using (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- receipts：本人可读（用于 replay / 排查）
-- ---------------------------------------------------------------------------

drop policy if exists game_receipts_select_self on public.game_receipts;
create policy game_receipts_select_self on public.game_receipts
for select to authenticated
using (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- 画作 / AI 评分 / 计分：同房可见
-- ---------------------------------------------------------------------------

drop policy if exists artworks_select_room on public.artworks;
create policy artworks_select_room on public.artworks
for select to authenticated
using (
  exists (
    select 1 from public.games g
    where g.id = artworks.game_id and public.is_room_member(g.room_id)
  )
);

drop policy if exists ai_scores_select_room on public.ai_scores;
create policy ai_scores_select_room on public.ai_scores
for select to authenticated
using (
  exists (
    select 1
    from public.artworks a
    join public.games g on g.id = a.game_id
    where a.id = ai_scores.artwork_id and public.is_room_member(g.room_id)
  )
);

drop policy if exists scores_select_room on public.scores;
create policy scores_select_room on public.scores
for select to authenticated
using (
  exists (
    select 1 from public.games g
    where g.id = scores.game_id and public.is_room_member(g.room_id)
  )
);

-- ---------------------------------------------------------------------------
-- 题库：系统题库（owner_id is null）与公开题库所有人可读，自建题库仅本人可写
-- ---------------------------------------------------------------------------

drop policy if exists word_banks_select on public.word_banks;
create policy word_banks_select on public.word_banks
for select to authenticated
using (owner_id is null or is_public or owner_id = auth.uid());

drop policy if exists word_banks_write_own on public.word_banks;
create policy word_banks_write_own on public.word_banks
for insert to authenticated
with check (owner_id = auth.uid());

drop policy if exists word_banks_update_own on public.word_banks;
create policy word_banks_update_own on public.word_banks
for update to authenticated
using (owner_id = auth.uid())
with check (owner_id = auth.uid());

drop policy if exists word_banks_delete_own on public.word_banks;
create policy word_banks_delete_own on public.word_banks
for delete to authenticated
using (owner_id = auth.uid());

drop policy if exists word_bank_items_select on public.word_bank_items;
create policy word_bank_items_select on public.word_bank_items
for select to authenticated
using (
  exists (
    select 1 from public.word_banks b
    where b.id = word_bank_items.bank_id
      and (b.owner_id is null or b.is_public or b.owner_id = auth.uid())
  )
);

drop policy if exists word_bank_items_write on public.word_bank_items;
create policy word_bank_items_write on public.word_bank_items
for all to authenticated
using (
  exists (
    select 1 from public.word_banks b
    where b.id = word_bank_items.bank_id and b.owner_id = auth.uid()
  )
)
with check (
  exists (
    select 1 from public.word_banks b
    where b.id = word_bank_items.bank_id and b.owner_id = auth.uid()
  )
);

-- ---------------------------------------------------------------------------
-- 表权限：写操作只给 service_role（Edge Function）
-- ---------------------------------------------------------------------------

revoke insert, update, delete on public.games          from anon, authenticated;
revoke insert, update, delete on public.game_secrets   from anon, authenticated;
revoke insert, update, delete on public.game_receipts  from anon, authenticated;
revoke insert, update, delete on public.game_starts    from anon, authenticated;
revoke insert, update, delete on public.artworks       from anon, authenticated;
revoke insert, update, delete on public.ai_scores      from anon, authenticated;
revoke insert, update, delete on public.scores         from anon, authenticated;
revoke insert, update, delete on public.room_members   from anon, authenticated;
revoke insert, delete on public.rooms                  from anon, authenticated;

-- =======================================================================
-- 0003_rpc_room.sql
-- =======================================================================
-- 破冰局 · A：房间生命周期 RPC（客户端可直接调用）
-- 所有函数 security definer，权限来自 auth.uid()，不信任客户端传入的身份。

-- ---------------------------------------------------------------------------
-- 创建房间（创建者自动成为房主与 1 号座）
-- ---------------------------------------------------------------------------
create or replace function public.create_room(
  p_title text default '破冰局',
  p_game_type text default 'lobby',
  p_max_players int default 12,
  p_settings jsonb default '{}'::jsonb
)
returns table (room_id uuid, room_code text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_code text;
  v_room uuid;
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED' using errcode = '28000';
  end if;
  if p_max_players < 4 or p_max_players > 20 then
    raise exception 'BAD_MAX_PLAYERS' using errcode = '22023';
  end if;
  if p_game_type not in ('lobby', 'draw', 'undercover', 'hybrid', 'truth') then
    raise exception 'BAD_GAME_TYPE' using errcode = '22023';
  end if;

  loop
    v_code := public.generate_room_code();
    exit when not exists (select 1 from public.rooms r where r.code = v_code);
  end loop;

  insert into public.rooms (code, title, host_id, game_type, max_players, settings)
  values (
    v_code,
    coalesce(nullif(btrim(p_title), ''), '破冰局'),
    v_uid,
    p_game_type,
    p_max_players,
    coalesce(p_settings, '{}'::jsonb)
  )
  returning id into v_room;

  insert into public.room_members (room_id, user_id, seat, role)
  values (v_room, v_uid, 1, 'host');

  return query select v_room, v_code;
end;
$$;

-- ---------------------------------------------------------------------------
-- 用 6 位房间码加入（幂等：重复加入返回原座位）
-- ---------------------------------------------------------------------------
create or replace function public.join_room(p_code text)
returns table (room_id uuid, seat int, already_member boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_room public.rooms%rowtype;
  v_existing public.room_members%rowtype;
  v_count int;
  v_seat int;
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED' using errcode = '28000';
  end if;

  select * into v_room from public.rooms where code = upper(btrim(p_code)) for update;
  if not found then
    raise exception 'ROOM_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_room.status <> 'lobby' or v_room.closed_at is not null then
    raise exception 'ROOM_NOT_JOINABLE' using errcode = 'P0001';
  end if;

  select * into v_existing from public.room_members
  where room_id = v_room.id and user_id = v_uid;

  if found then
    update public.room_members
    set online = true, left_at = null, last_seen_at = now()
    where room_id = v_room.id and user_id = v_uid;
    return query select v_room.id, v_existing.seat, true;
    return;
  end if;

  select count(*) into v_count
  from public.room_members
  where room_id = v_room.id and left_at is null;

  if v_count >= v_room.max_players then
    raise exception 'ROOM_FULL' using errcode = 'P0001';
  end if;

  select coalesce(max(seat), 0) + 1 into v_seat
  from public.room_members where room_id = v_room.id;

  insert into public.room_members (room_id, user_id, seat)
  values (v_room.id, v_uid, v_seat);

  return query select v_room.id, v_seat, false;
end;
$$;

-- ---------------------------------------------------------------------------
-- 离开房间；房主离开自动移交（按座位顺序）
-- ---------------------------------------------------------------------------
create or replace function public.leave_room(p_room_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_host uuid;
  v_next uuid;
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED' using errcode = '28000';
  end if;
  if not exists (
    select 1 from public.room_members
    where room_id = p_room_id and user_id = v_uid and left_at is null
  ) then
    raise exception 'NOT_A_MEMBER' using errcode = 'P0001';
  end if;

  update public.room_members
  set left_at = now(), online = false
  where room_id = p_room_id and user_id = v_uid;

  select host_id into v_host from public.rooms where id = p_room_id;

  if v_host = v_uid then
    select user_id into v_next
    from public.room_members
    where room_id = p_room_id and left_at is null
    order by seat
    limit 1;

    if v_next is not null then
      update public.rooms set host_id = v_next where id = p_room_id;
      update public.room_members set role = 'host'
        where room_id = p_room_id and user_id = v_next;
      update public.room_members set role = 'player'
        where room_id = p_room_id and user_id = v_uid;
    end if;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 准备状态（仅大厅）
-- ---------------------------------------------------------------------------
create or replace function public.set_ready(p_room_id uuid, p_ready boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED' using errcode = '28000';
  end if;
  update public.room_members m
  set ready = coalesce(p_ready, false)
  where m.room_id = p_room_id
    and m.user_id = auth.uid()
    and m.left_at is null
    and exists (
      select 1 from public.rooms r
      where r.id = p_room_id and r.status = 'lobby'
    );
end;
$$;

-- ---------------------------------------------------------------------------
-- 心跳 / 重连（更新在线状态）
-- ---------------------------------------------------------------------------
create or replace function public.heartbeat(p_room_id uuid)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := now();
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED' using errcode = '28000';
  end if;
  update public.room_members
  set online = true, left_at = null, last_seen_at = v_now
  where room_id = p_room_id and user_id = auth.uid();
  return v_now;
end;
$$;

-- ---------------------------------------------------------------------------
-- 房主移交
-- ---------------------------------------------------------------------------
create or replace function public.transfer_host(p_room_id uuid, p_to uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED' using errcode = '28000';
  end if;
  if not exists (select 1 from public.rooms r where r.id = p_room_id and r.host_id = auth.uid()) then
    raise exception 'HOST_ONLY' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.room_members
    where room_id = p_room_id and user_id = p_to and left_at is null
  ) then
    raise exception 'TARGET_NOT_MEMBER' using errcode = 'P0001';
  end if;

  update public.rooms set host_id = p_to where id = p_room_id;
  update public.room_members set role = case when user_id = p_to then 'host' else 'player' end
  where room_id = p_room_id and left_at is null;
end;
$$;

-- ---------------------------------------------------------------------------
-- 大厅设置（仅房主、仅大厅阶段）
-- ---------------------------------------------------------------------------
create or replace function public.set_room_settings(
  p_room_id uuid,
  p_game_type text default null,
  p_settings jsonb default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED' using errcode = '28000';
  end if;
  if not exists (select 1 from public.rooms r where r.id = p_room_id and r.host_id = auth.uid()) then
    raise exception 'HOST_ONLY' using errcode = '42501';
  end if;
  if p_game_type is not null and p_game_type not in ('lobby', 'draw', 'undercover', 'hybrid', 'truth') then
    raise exception 'BAD_GAME_TYPE' using errcode = '22023';
  end if;

  update public.rooms
  set game_type = coalesce(p_game_type, game_type),
      settings = coalesce(p_settings, settings)
  where id = p_room_id and status = 'lobby';
end;
$$;

-- ---------------------------------------------------------------------------
-- 关闭房间
-- ---------------------------------------------------------------------------
create or replace function public.close_room(p_room_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED' using errcode = '28000';
  end if;
  if not exists (select 1 from public.rooms r where r.id = p_room_id and r.host_id = auth.uid()) then
    raise exception 'HOST_ONLY' using errcode = '42501';
  end if;
  update public.rooms set status = 'ended', closed_at = now() where id = p_room_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 权限
-- ---------------------------------------------------------------------------
revoke all on function public.create_room(text, text, int, jsonb) from public;
revoke all on function public.join_room(text) from public;
revoke all on function public.leave_room(uuid) from public;
revoke all on function public.set_ready(uuid, boolean) from public;
revoke all on function public.heartbeat(uuid) from public;
revoke all on function public.transfer_host(uuid, uuid) from public;
revoke all on function public.set_room_settings(uuid, text, jsonb) from public;
revoke all on function public.close_room(uuid) from public;

grant execute on function public.create_room(text, text, int, jsonb) to authenticated;
grant execute on function public.join_room(text) to authenticated;
grant execute on function public.leave_room(uuid) to authenticated;
grant execute on function public.set_ready(uuid, boolean) to authenticated;
grant execute on function public.heartbeat(uuid) to authenticated;
grant execute on function public.transfer_host(uuid, uuid) to authenticated;
grant execute on function public.set_room_settings(uuid, text, jsonb) to authenticated;
grant execute on function public.close_room(uuid) to authenticated;

-- =======================================================================
-- 0004_rpc_game.sql
-- =======================================================================
-- 破冰局 · A：局次写入与私有数据读取
-- 规则引擎（C 的纯函数）运行在 uc-command Edge Function 中，SQL 只负责：
--   登录态/成员身份/房主权限、幂等回执、版本号与状态落库、词牌私有读取。

-- ---------------------------------------------------------------------------
-- 开始一局（仅服务端 Edge Function 调用）
-- p_secrets: [{"user_id":"...","word":"...","camp":"civilian"}, ...]
-- ---------------------------------------------------------------------------
create or replace function public.uc_start_game(
  p_actor uuid,
  p_room_id uuid,
  p_variant text,
  p_state jsonb,
  p_view jsonb,
  p_secrets jsonb,
  p_request_id text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room public.rooms%rowtype;
  v_fingerprint text;
  v_existing public.game_starts%rowtype;
  v_game uuid;
  v_number int;
  v_secret jsonb;
begin
  select * into v_room from public.rooms where id = p_room_id for update;
  if not found then
    raise exception 'ROOM_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_room.host_id <> p_actor then
    raise exception 'HOST_ONLY' using errcode = '42501';
  end if;
  if v_room.status = 'playing' then
    raise exception 'GAME_ACTIVE' using errcode = 'P0001';
  end if;
  if p_variant not in ('classic', 'draw') then
    raise exception 'BAD_VARIANT' using errcode = '22023';
  end if;

  v_fingerprint := md5(
    coalesce(p_variant, '') || '|' || coalesce(p_state::text, '') || '|' ||
    coalesce(p_view::text, '') || '|' || coalesce(p_secrets::text, '')
  );

  select * into v_existing
  from public.game_starts
  where room_id = p_room_id and request_id = p_request_id;

  if found then
    if v_existing.fingerprint <> v_fingerprint then
      raise exception 'REQUEST_CONFLICT' using errcode = 'P0001';
    end if;
    return v_existing.game_id;
  end if;

  select coalesce(max(game_number), 0) + 1 into v_number
  from public.games where room_id = p_room_id;

  insert into public.games (room_id, game_number, variant, state, view)
  values (p_room_id, v_number, p_variant, p_state, p_view)
  returning id into v_game;

  for v_secret in select * from jsonb_array_elements(coalesce(p_secrets, '[]'::jsonb)) loop
    insert into public.game_secrets (game_id, user_id, word, camp)
    values (
      v_game,
      (v_secret ->> 'user_id')::uuid,
      v_secret ->> 'word',
      v_secret ->> 'camp'
    );
  end loop;

  insert into public.game_starts (room_id, request_id, fingerprint, game_id)
  values (p_room_id, p_request_id, v_fingerprint, v_game);

  update public.rooms set status = 'playing' where id = p_room_id;

  return v_game;
end;
$$;

-- ---------------------------------------------------------------------------
-- 提交一次指令（幂等：同一 requestId + 同一指纹返回已记录版本）
-- ---------------------------------------------------------------------------
create or replace function public.uc_commit_action(
  p_game_id uuid,
  p_actor uuid,
  p_request_id text,
  p_fingerprint text,
  p_state jsonb,
  p_view jsonb,
  p_version bigint,
  p_status text default 'active',
  p_ended_reason text default null
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing public.game_receipts%rowtype;
  v_room uuid;
begin
  select * into v_existing
  from public.game_receipts
  where game_id = p_game_id and user_id = p_actor and request_id = p_request_id;

  if found then
    if v_existing.fingerprint <> p_fingerprint then
      raise exception 'REQUEST_CONFLICT' using errcode = 'P0001';
    end if;
    return v_existing.result_version;
  end if;

  if p_status not in ('active', 'ended') then
    raise exception 'BAD_STATUS' using errcode = '22023';
  end if;

  insert into public.game_receipts (game_id, user_id, request_id, fingerprint, result_version)
  values (p_game_id, p_actor, p_request_id, p_fingerprint, p_version);

  update public.games
  set state = p_state,
      view = p_view,
      version = p_version,
      status = p_status,
      ended_at = case when p_status = 'ended' then now() else ended_at end,
      ended_reason = coalesce(p_ended_reason, ended_reason)
  where id = p_game_id
  returning room_id into v_room;

  if v_room is null then
    raise exception 'GAME_NOT_FOUND' using errcode = 'P0002';
  end if;

  if p_status = 'ended' then
    update public.rooms set status = 'lobby' where id = v_room;
  end if;

  return p_version;
end;
$$;

-- ---------------------------------------------------------------------------
-- 倒计时结算（无用户指令，无需回执）
-- ---------------------------------------------------------------------------
create or replace function public.uc_tick(
  p_game_id uuid,
  p_state jsonb,
  p_view jsonb,
  p_version bigint
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.games
  set state = p_state, view = p_view, version = p_version
  where id = p_game_id and status = 'active';
  return p_version;
end;
$$;

-- ---------------------------------------------------------------------------
-- 读取自己的词牌（RLS 只是兜底，这里再限定身份）
-- ---------------------------------------------------------------------------
create or replace function public.get_my_word(p_game_id uuid)
returns table (word text, camp text, acknowledged boolean)
language sql
stable
security definer
set search_path = public
as $$
  select s.word, s.camp, (s.acknowledged_at is not null)
  from public.game_secrets s
  where s.game_id = p_game_id and s.user_id = auth.uid();
$$;

create or replace function public.acknowledge_my_word(p_game_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED' using errcode = '28000';
  end if;
  update public.game_secrets
  set acknowledged_at = coalesce(acknowledged_at, now())
  where game_id = p_game_id and user_id = auth.uid();
end;
$$;

-- ---------------------------------------------------------------------------
-- 提交画作（仅房间成员；同一 turn_key 只能一张，重试覆盖自己的那张）
-- ---------------------------------------------------------------------------
create or replace function public.submit_artwork(
  p_game_id uuid,
  p_turn_key text,
  p_storage_path text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_room uuid;
  v_art uuid;
  v_owner uuid;
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED' using errcode = '28000';
  end if;
  if p_turn_key is null or btrim(p_turn_key) = '' then
    raise exception 'BAD_TURN_KEY' using errcode = '22023';
  end if;

  select g.room_id into v_room
  from public.games g
  where g.id = p_game_id and g.status = 'active';

  if v_room is null then
    raise exception 'GAME_NOT_ACTIVE' using errcode = 'P0001';
  end if;
  if not public.is_room_member(v_room) then
    raise exception 'NOT_A_MEMBER' using errcode = '42501';
  end if;

  select a.id, a.user_id into v_art, v_owner
  from public.artworks a
  where a.game_id = p_game_id and a.turn_key = p_turn_key;

  if v_art is not null then
    if v_owner <> v_uid then
      raise exception 'TURN_TAKEN' using errcode = 'P0001';
    end if;
    update public.artworks
    set storage_path = p_storage_path, status = 'pending'
    where id = v_art;
    return v_art;
  end if;

  insert into public.artworks (game_id, turn_key, user_id, storage_path)
  values (p_game_id, p_turn_key, v_uid, p_storage_path)
  returning id into v_art;

  return v_art;
end;
$$;

-- ---------------------------------------------------------------------------
-- 权限：写局次只给 service_role；读词牌/交画给登录用户
-- ---------------------------------------------------------------------------
revoke all on function public.uc_start_game(uuid, uuid, text, jsonb, jsonb, jsonb, text) from public;
revoke all on function public.uc_commit_action(uuid, uuid, text, text, jsonb, jsonb, bigint, text, text) from public;
revoke all on function public.uc_tick(uuid, jsonb, jsonb, bigint) from public;
revoke all on function public.get_my_word(uuid) from public;
revoke all on function public.acknowledge_my_word(uuid) from public;
revoke all on function public.submit_artwork(uuid, text, text) from public;

grant execute on function public.uc_start_game(uuid, uuid, text, jsonb, jsonb, jsonb, text) to service_role;
grant execute on function public.uc_commit_action(uuid, uuid, text, text, jsonb, jsonb, bigint, text, text) to service_role;
grant execute on function public.uc_tick(uuid, jsonb, jsonb, bigint) to service_role;
grant execute on function public.get_my_word(uuid) to authenticated;
grant execute on function public.acknowledge_my_word(uuid) to authenticated;
grant execute on function public.submit_artwork(uuid, text, text) to authenticated;

-- =======================================================================
-- 0005_storage.sql
-- =======================================================================
-- 破冰局 · A：画作存储桶与访问策略
-- 路径约定：{game_id}/{turn_key}/{user_id}.png
-- 只有同房间成员可上传/读取；桶为私有，前端用 storage.createSignedUrl 展示。
--
-- 集成修正：storage.objects 的 owner / bucket_id 在不同 Supabase Storage 版本里
-- 可能是 text 也可能是 uuid，直接和 text 比较会报 42883 operator does not exist: uuid = text。
-- 这里两边都显式转 text，与版本无关。

insert into storage.buckets (id, name, public)
values ('artworks', 'artworks', false)
on conflict (id) do nothing;

drop policy if exists artworks_upload_member on storage.objects;
create policy artworks_upload_member on storage.objects
for insert to authenticated
with check (
  bucket_id::text = 'artworks'
  and public.is_room_member(((storage.foldername(name))[1])::uuid)
);

drop policy if exists artworks_read_member on storage.objects;
create policy artworks_read_member on storage.objects
for select to authenticated
using (
  bucket_id::text = 'artworks'
  and public.is_room_member(((storage.foldername(name))[1])::uuid)
);

drop policy if exists artworks_delete_owner on storage.objects;
create policy artworks_delete_owner on storage.objects
for delete to authenticated
using (
  bucket_id::text = 'artworks'
  and owner::text = auth.uid()::text
);

-- =======================================================================
-- 0006_rpc_lobby_integration.sql
-- =======================================================================
-- 破冰局 · 集成补充（D 模块）：房间开局 / 结束 / 改昵称
--
-- 为什么需要这一支迁移：
--   小程序端 <wx.request> 不支持 PATCH，客户端没法直接 PATCH rooms / profiles。
--   A 的 0003 只提供 lobby 阶段的房间 RPC，没有「房主开局」的入口
--   （uc_start_game 是 service_role 专用，需要 uc-command 才会被调用）。
--   这里补三个客户端可调用的 security definer 函数，权限判断仍以 auth.uid() 为准。
--
-- 只新增文件，不修改 A 的历史迁移。

-- ---------------------------------------------------------------------------
-- 房主开局：大厅 → 进行中
-- ---------------------------------------------------------------------------
create or replace function public.start_room_game(
  p_room_id uuid,
  p_game_type text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED' using errcode = '28000';
  end if;
  if not exists (
    select 1 from public.rooms r where r.id = p_room_id and r.host_id = v_uid
  ) then
    raise exception 'HOST_ONLY' using errcode = '42501';
  end if;
  if p_game_type not in ('draw', 'undercover', 'hybrid', 'truth') then
    raise exception 'BAD_GAME_TYPE' using errcode = '22023';
  end if;
  if exists (
    select 1 from public.rooms r where r.id = p_room_id and r.status <> 'lobby'
  ) then
    raise exception 'ROOM_NOT_JOINABLE' using errcode = 'P0001';
  end if;
  if exists (
    select 1 from public.room_members m
    where m.room_id = p_room_id and m.left_at is null and m.ready = false
  ) then
    raise exception 'NOT_ALL_READY' using errcode = 'P0001';
  end if;
  if exists (
    select 1 from public.games g where g.room_id = p_room_id and g.status = 'active'
  ) then
    raise exception 'GAME_ACTIVE' using errcode = 'P0001';
  end if;

  update public.rooms
  set status = 'playing', game_type = p_game_type
  where id = p_room_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 房主结束本局：进行中 → 大厅，并把准备状态清零（房主保持已准备）
-- ---------------------------------------------------------------------------
create or replace function public.end_room_game(p_room_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_host uuid;
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED' using errcode = '28000';
  end if;
  select host_id into v_host from public.rooms where id = p_room_id;
  if v_host is null then
    raise exception 'ROOM_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_host <> v_uid then
    raise exception 'HOST_ONLY' using errcode = '42501';
  end if;

  update public.rooms
  set status = 'lobby', game_type = 'lobby'
  where id = p_room_id;

  update public.room_members
  set ready = (user_id = v_host)
  where room_id = p_room_id and left_at is null;
end;
$$;

-- ---------------------------------------------------------------------------
-- 改自己的昵称（客户端没有 PATCH 时的安全替代）
-- ---------------------------------------------------------------------------
create or replace function public.set_my_nickname(p_nickname text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_name text := btrim(coalesce(p_nickname, ''));
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED' using errcode = '28000';
  end if;
  if char_length(v_name) = 0 or char_length(v_name) > 20 then
    raise exception 'BAD_NICKNAME' using errcode = '22023';
  end if;
  update public.profiles set nickname = v_name where id = v_uid;
end;
$$;

-- ---------------------------------------------------------------------------
-- 权限
-- ---------------------------------------------------------------------------
revoke all on function public.start_room_game(uuid, text) from public;
revoke all on function public.end_room_game(uuid) from public;
revoke all on function public.set_my_nickname(text) from public;

grant execute on function public.start_room_game(uuid, text) to authenticated;
grant execute on function public.end_room_game(uuid) to authenticated;
grant execute on function public.set_my_nickname(text) to authenticated;

-- =======================================================================
-- 0007_fix_grants_and_join_room.sql
-- =======================================================================
-- 破冰局 · 集成修正 2：表权限 + join_room 列名歧义
--
-- 1) 真实项目上 public 下的表没有给 authenticated 授 SELECT，客户端读 rooms / room_members
--    会得到 42501。这里显式授权；RLS 仍然生效，授权不等于放行数据。
-- 2) A 的 join_room 用 returns table (room_id ...)，输出参数 room_id 与 room_members.room_id
--    同名，函数体里 where room_id = ... 会报 42702 column reference "room_id" is ambiguous。
--    用 #variable_conflict use_column 让同名标识符优先解析成列，保持返回字段名不变。
--
-- 只新增文件，不修改 A 的历史迁移。

-- ---------------------------------------------------------------------------
-- 1. 表权限（RLS 负责真正隔离）
-- ---------------------------------------------------------------------------
grant usage on schema public to authenticated;
grant select on all tables in schema public to authenticated;
grant select on public.game_public to authenticated;

-- 未登录匿名角色不开放任何表读取；RPC 内部用 security definer 自己校验身份。

-- ---------------------------------------------------------------------------
-- 2. join_room：消除 room_id 歧义
-- ---------------------------------------------------------------------------
create or replace function public.join_room(p_code text)
returns table (room_id uuid, seat int, already_member boolean)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_uid uuid := auth.uid();
  v_room public.rooms%rowtype;
  v_existing public.room_members%rowtype;
  v_count int;
  v_seat int;
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED' using errcode = '28000';
  end if;

  select * into v_room from public.rooms where code = upper(btrim(p_code)) for update;
  if not found then
    raise exception 'ROOM_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_room.status <> 'lobby' or v_room.closed_at is not null then
    raise exception 'ROOM_NOT_JOINABLE' using errcode = 'P0001';
  end if;

  select m.* into v_existing
  from public.room_members m
  where m.room_id = v_room.id and m.user_id = v_uid;

  if found then
    update public.room_members m
    set online = true, left_at = null, last_seen_at = now()
    where m.room_id = v_room.id and m.user_id = v_uid;
    return query select v_room.id, v_existing.seat, true;
    return;
  end if;

  select count(*) into v_count
  from public.room_members m
  where m.room_id = v_room.id and m.left_at is null;

  if v_count >= v_room.max_players then
    raise exception 'ROOM_FULL' using errcode = 'P0001';
  end if;

  select coalesce(max(m.seat), 0) + 1 into v_seat
  from public.room_members m where m.room_id = v_room.id;

  insert into public.room_members (room_id, user_id, seat)
  values (v_room.id, v_uid, v_seat);

  return query select v_room.id, v_seat, false;
end;
$$;

revoke all on function public.join_room(text) from public;
grant execute on function public.join_room(text) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. 顺手校验：这些函数体里也有同名风险，重建一次确保用的是列解析
-- ---------------------------------------------------------------------------
create or replace function public.leave_room(p_room_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_uid uuid := auth.uid();
  v_host uuid;
  v_next uuid;
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED' using errcode = '28000';
  end if;
  if not exists (
    select 1 from public.room_members m
    where m.room_id = p_room_id and m.user_id = v_uid and m.left_at is null
  ) then
    raise exception 'NOT_A_MEMBER' using errcode = 'P0001';
  end if;

  update public.room_members m
  set left_at = now(), online = false
  where m.room_id = p_room_id and m.user_id = v_uid;

  select r.host_id into v_host from public.rooms r where r.id = p_room_id;

  if v_host = v_uid then
    select m.user_id into v_next
    from public.room_members m
    where m.room_id = p_room_id and m.left_at is null
    order by m.seat
    limit 1;

    if v_next is not null then
      update public.rooms r set host_id = v_next where r.id = p_room_id;
      update public.room_members m set role = 'host' where m.room_id = p_room_id and m.user_id = v_next;
      update public.room_members m set role = 'player' where m.room_id = p_room_id and m.user_id = v_uid;
    end if;
  end if;
end;
$$;

revoke all on function public.leave_room(uuid) from public;
grant execute on function public.leave_room(uuid) to authenticated;

-- =======================================================================
-- 0008_grant_service_role.sql
-- =======================================================================
-- 破冰局 · 集成修正 3：把 service_role 的表权限补齐
--
-- 现象：uc-command 用 service_role 读 rooms 时报 permission denied for table rooms。
-- 原因：这个项目的默认权限（ALTER DEFAULT PRIVILEGES）没有对这些表生效，
--       0002 只 revoke 了 anon/authenticated 的写权限，0007 只补了 authenticated 的 SELECT，
--       service_role 一直没有拿到表的 GRANT。
--
-- 注意：service_role 本来就会绕过 RLS，这里只是补 Postgres 层的表权限，不改变隔离语义。

grant usage on schema public to service_role;
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;
grant all on all functions in schema public to service_role;

-- 以后新建的表/序列/函数也自动授权，避免再踩一次
alter default privileges in schema public grant all on tables to service_role;
alter default privileges in schema public grant all on sequences to service_role;
alter default privileges in schema public grant all on functions to service_role;

-- authenticated 只需要读；写操作全部走 RPC（security definer）
alter default privileges in schema public grant select on tables to authenticated;

-- =======================================================================
-- 0009_profile_avatar.sql
-- =======================================================================
-- 破冰局 · 集成修正 4：把自定义形象存到 profiles，房间/游戏里才和首页一致
--
-- 现状：profiles 只有 avatar_url（给微信头像用的 URL），我们的小程序形象是分层编号，
--       所以房间列表只能按座位号临时生成一个，和首页选的对不上。
-- 处理：加一个 avatar jsonb 存 { color, body, mouth, eyes, hat }，并提供一个写入 RPC。

alter table public.profiles add column if not exists avatar jsonb;

create or replace function public.set_my_profile(
  p_nickname text default null,
  p_avatar jsonb default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_name text := btrim(coalesce(p_nickname, ''));
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED' using errcode = '28000';
  end if;
  if char_length(v_name) > 20 then
    raise exception 'BAD_NICKNAME' using errcode = '22023';
  end if;

  update public.profiles
  set nickname = coalesce(nullif(v_name, ''), nickname),
      avatar = coalesce(p_avatar, avatar)
  where id = v_uid;
end;
$$;

revoke all on function public.set_my_profile(text, jsonb) from public;
grant execute on function public.set_my_profile(text, jsonb) to authenticated;

-- =======================================================================
-- 0010_room_leaderboard.sql
-- =======================================================================
-- 破冰局 · 集成修正 5：房间积分榜
--
-- uc-command 在每次结算时把引擎给出的建议分值写进 public.scores
-- （唯一约束 (game_id, user_id, reason, ref) 保证重放不重复加分）。
-- 这里提供一个按房间聚合的读取入口给前端排行榜用；只允许本房间成员读。

create or replace function public.room_leaderboard(p_room_id uuid)
returns table (
  user_id uuid,
  nickname text,
  avatar jsonb,
  points bigint,
  games bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select
    s.user_id,
    coalesce(p.nickname, '玩家') as nickname,
    p.avatar,
    sum(s.points)::bigint as points,
    count(distinct s.game_id)::bigint as games
  from public.scores s
  join public.games g on g.id = s.game_id
  join public.profiles p on p.id = s.user_id
  where g.room_id = p_room_id
    and public.is_room_member(p_room_id)
  group by s.user_id, p.nickname, p.avatar
  order by points desc, nickname asc;
$$;

revoke all on function public.room_leaderboard(uuid) from public;
grant execute on function public.room_leaderboard(uuid) to authenticated;
