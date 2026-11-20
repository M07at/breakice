-- 破冰局 · 集成修正 15：一局结束后回到「未准备」，房主退出即关房
--
-- 需求：
--   1. 每局结束后所有人回到大厅，并把准备状态清成「未准备」，
--      必须重新准备齐，主持人才能再开下一局；
--   2. 主持人退出后房间关闭，其他人都回到主界面。

-- ---------------------------------------------------------------------------
-- 一局结束：清除全场准备状态
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

  -- 回到大厅后所有人都要重新准备
  update public.room_members
  set ready = false
  where room_id = p_room_id and left_at is null;
end;
$$;

-- ---------------------------------------------------------------------------
-- 谁是卧底的结算走 uc_commit_action：置 ended 时同样清准备状态
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
    update public.rooms set status = 'lobby', game_type = 'lobby' where id = v_room;
    update public.room_members set ready = false
    where room_id = v_room and left_at is null;
  end if;

  return p_version;
end;
$$;

-- ---------------------------------------------------------------------------
-- 房主退出 = 房间关闭（不再转移房主）
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

  select host_id into v_host from public.rooms where id = p_room_id;

  update public.room_members
  set left_at = now(), online = false
  where room_id = p_room_id and user_id = v_uid;

  if v_host = v_uid then
    -- 房主走了就没有主持人，直接关房；其他人下一次轮询会看到房间已关闭
    update public.rooms set status = 'ended', closed_at = now() where id = p_room_id;
    update public.room_members
    set left_at = coalesce(left_at, now()), online = false
    where room_id = p_room_id and left_at is null;
  end if;
end;
$$;
