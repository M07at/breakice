-- 破冰局 · 集成修正 14：开局时必须写 rooms.game_type
--
-- 现象：谁是卧底 / 融合玩法开局后，房主能进游戏，其他人一直停在大厅，
-- 显示「本局进行中」，点「回到游戏」没有任何反应。
--
-- 原因：uc_start_game 只 update 了 status='playing'，没有写 game_type。
-- 客户端靠 rooms.game_type 判断该进哪个游戏，读到 'lobby' 就映射成 null，
-- enterCurrentGame() 直接静默返回，所以按钮毫无反应。
--
-- start_room_game（真心话走这条）本来就是对的：一起写 status 和 game_type。

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
  v_game_type text;
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

  -- classic = 普通谁是卧底；draw = 你画我猜谁是卧底（融合玩法）
  v_game_type := case when p_variant = 'draw' then 'hybrid' else 'undercover' end;

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

  -- 关键：status 和 game_type 一起写，其他人才知道该进哪个游戏
  update public.rooms set status = 'playing', game_type = v_game_type where id = p_room_id;

  return v_game;
end;
$$;
