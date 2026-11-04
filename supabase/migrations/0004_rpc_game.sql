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
