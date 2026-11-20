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
