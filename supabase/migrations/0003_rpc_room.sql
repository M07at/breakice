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
