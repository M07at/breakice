CREATE OR REPLACE FUNCTION public.end_room_game(p_room_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$

CREATE OR REPLACE FUNCTION public.uc_tick(p_game_id uuid, p_state jsonb, p_view jsonb, p_version bigint)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  update public.games
  set state = p_state, view = p_view, version = p_version
  where id = p_game_id and status = 'active';
  return p_version;
end;
$function$

DROP FUNCTION IF EXISTS public.finish_draw_session(uuid,text);

