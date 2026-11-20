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
