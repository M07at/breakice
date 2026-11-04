-- 破冰局 · 集成修正 12：你画我猜联机的服务端底座
--
-- 为什么不在这轮把 B 的房间状态机搬到服务端：B 的 LocalDrawRoomBackend 是带定时器和回调的
-- 有状态类，抽成纯 reducer 等于重写；先落一套「主持人发布视图 + 其他人投指令」的底座，
-- 既不改 B 的引擎，也能让任意一端成为权威。
--
-- 模型：
--   draw_sessions  一个房间一条，存权威视图（DrawRoomView 的 JSON）和版本号，只有主持人能写
--   draw_inbox     其他人的操作队列（交画 / 发消息 / 送花 / 催 tick），只有主持人能消费
--
-- 权限：两张表都开 RLS 且不给客户端任何策略，全部走下面的 security definer RPC。

create table if not exists public.draw_sessions (
  room_id    uuid primary key references public.rooms (id) on delete cascade,
  host_id    uuid not null references public.profiles (id) on delete cascade,
  view       jsonb not null,
  version    bigint not null default 1,
  updated_at timestamptz not null default now()
);

create table if not exists public.draw_inbox (
  id          bigserial primary key,
  room_id     uuid not null references public.rooms (id) on delete cascade,
  user_id     uuid not null references public.profiles (id) on delete cascade,
  kind        text not null check (kind in ('submitDrawing', 'message', 'reaction', 'tick')),
  payload     jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  consumed_at timestamptz
);

create index if not exists draw_inbox_pending_idx
  on public.draw_inbox (room_id, id)
  where consumed_at is null;

alter table public.draw_sessions enable row level security;
alter table public.draw_inbox enable row level security;

-- ---------------------------------------------------------------------------
-- 主持人发布权威视图（版本号自增，客户端据此判断新旧）
-- ---------------------------------------------------------------------------
create or replace function public.publish_draw_view(p_room_id uuid, p_view jsonb)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_version bigint;
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED' using errcode = '28000';
  end if;
  if not exists (select 1 from public.rooms r where r.id = p_room_id and r.host_id = v_uid) then
    raise exception 'HOST_ONLY' using errcode = '42501';
  end if;

  insert into public.draw_sessions (room_id, host_id, view, version)
  values (p_room_id, v_uid, p_view, 1)
  on conflict (room_id) do update
    set view = excluded.view,
        version = public.draw_sessions.version + 1,
        updated_at = now()
  returning version into v_version;

  return v_version;
end;
$$;

-- ---------------------------------------------------------------------------
-- 任意成员读当前视图
-- ---------------------------------------------------------------------------
create or replace function public.read_draw_view(p_room_id uuid)
returns table (view jsonb, version bigint, updated_at timestamptz)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_room_member(p_room_id) then
    raise exception 'NOT_A_MEMBER' using errcode = '42501';
  end if;

  return query
    select s.view, s.version, s.updated_at
    from public.draw_sessions s
    where s.room_id = p_room_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 成员投一条指令（主持人自己也可以投，消费时按顺序处理）
-- ---------------------------------------------------------------------------
create or replace function public.post_draw_action(p_room_id uuid, p_kind text, p_payload jsonb default '{}'::jsonb)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_id bigint;
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED' using errcode = '28000';
  end if;
  if not public.is_room_member(p_room_id) then
    raise exception 'NOT_A_MEMBER' using errcode = '42501';
  end if;
  if p_kind not in ('submitDrawing', 'message', 'reaction', 'tick') then
    raise exception 'BAD_KIND' using errcode = '22023';
  end if;

  insert into public.draw_inbox (room_id, user_id, kind, payload)
  values (p_room_id, v_uid, p_kind, coalesce(p_payload, '{}'::jsonb))
  returning id into v_id;

  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 主持人取走待处理指令（取走即标记已消费，避免重复处理）
-- ---------------------------------------------------------------------------
create or replace function public.take_draw_actions(p_room_id uuid, p_limit int default 50)
returns table (id bigint, user_id uuid, kind text, payload jsonb, created_at timestamptz)
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
  if not exists (select 1 from public.rooms r where r.id = p_room_id and r.host_id = v_uid) then
    raise exception 'HOST_ONLY' using errcode = '42501';
  end if;

  return query
    with taken as (
      update public.draw_inbox i
      set consumed_at = now()
      where i.id in (
        select i2.id from public.draw_inbox i2
        where i2.room_id = p_room_id and i2.consumed_at is null
        order by i2.id
        limit greatest(1, least(p_limit, 200))
        for update skip locked
      )
      returning i.id, i.user_id, i.kind, i.payload, i.created_at
    )
    select * from taken order by id;
end;
$$;

create or replace function public.clear_draw_session(p_room_id uuid)
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
  if not exists (select 1 from public.rooms r where r.id = p_room_id and r.host_id = v_uid) then
    raise exception 'HOST_ONLY' using errcode = '42501';
  end if;

  delete from public.draw_sessions where room_id = p_room_id;
  delete from public.draw_inbox where room_id = p_room_id and consumed_at is null;
end;
$$;

revoke all on function public.publish_draw_view(uuid, jsonb) from public;
revoke all on function public.read_draw_view(uuid) from public;
revoke all on function public.post_draw_action(uuid, text, jsonb) from public;
revoke all on function public.take_draw_actions(uuid, int) from public;
revoke all on function public.clear_draw_session(uuid) from public;

grant execute on function public.publish_draw_view(uuid, jsonb) to authenticated;
grant execute on function public.read_draw_view(uuid) to authenticated;
grant execute on function public.post_draw_action(uuid, text, jsonb) to authenticated;
grant execute on function public.take_draw_actions(uuid, int) to authenticated;
grant execute on function public.clear_draw_session(uuid) to authenticated;
