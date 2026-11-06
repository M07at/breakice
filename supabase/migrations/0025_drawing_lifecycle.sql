-- 结束局次后回大厅并重新准备，保留结果快照。
create or replace function public.finish_draw_session(p_room_id uuid, p_game_key text)
returns void language plpgsql security definer set search_path=public as $$
declare v_host uuid; v_key text;
begin
  select host_id into v_host from public.rooms where id=p_room_id for update;
  if auth.uid() is null or v_host is distinct from auth.uid() then raise exception 'HOST_ONLY' using errcode='42501'; end if;
  select view->>'gameId' into v_key from public.draw_sessions where room_id=p_room_id for update;
  if v_key is distinct from p_game_key then raise sqlstate 'PT409' using message='STALE_GAME'; end if;
  update public.draw_sessions set view=jsonb_set(jsonb_set(view,'{phase}','"ended"'),'{endsAt}','0'),version=version+1,updated_at=now() where room_id=p_room_id;
  update public.rooms set status='lobby',game_type='lobby' where id=p_room_id;
  update public.room_members set ready=false where room_id=p_room_id and left_at is null;
end; $$;
revoke all on function public.finish_draw_session(uuid,text) from public;
grant execute on function public.finish_draw_session(uuid,text) to authenticated;

create or replace function public.end_room_game(p_room_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare v_host uuid;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED' using errcode='28000'; end if;
  select host_id into v_host from public.rooms where id=p_room_id for update;
  if v_host is distinct from auth.uid() then raise exception 'HOST_ONLY' using errcode='42501'; end if;
  if exists(select 1 from public.games where room_id=p_room_id and status='active') then
    raise sqlstate 'PT409' using message='GAME_ACTIVE';
  end if;
  update public.draw_sessions set view=jsonb_set(jsonb_set(view,'{phase}','"ended"'),'{endsAt}','0'),version=version+1,updated_at=now() where room_id=p_room_id;
  update public.rooms set status='lobby',game_type='lobby' where id=p_room_id;
  update public.room_members set ready=false where room_id=p_room_id and left_at is null;
end; $$;

create or replace function public.uc_tick(p_game_id uuid,p_state jsonb,p_view jsonb,p_version bigint)
returns bigint language plpgsql security definer set search_path=public as $$
declare v_room uuid; v_ended boolean := p_state->>'phase'='ended';
begin
  update public.games set state=p_state,view=p_view,version=p_version,
    status=case when v_ended then 'ended' else 'active' end,
    ended_at=case when v_ended then now() else ended_at end,
    ended_reason=case when v_ended then p_state->>'endedReason' else ended_reason end
  where id=p_game_id and status='active' and version<p_version returning room_id into v_room;
  if v_room is not null and v_ended then
    update public.rooms set status='lobby',game_type='lobby' where id=v_room
      and not exists(select 1 from public.games where room_id=v_room and status='active');
    update public.room_members set ready=false where room_id=v_room and left_at is null;
  end if;
  return p_version;
end; $$;
revoke all on function public.uc_tick(uuid,jsonb,jsonb,bigint) from public,anon,authenticated;
grant execute on function public.uc_tick(uuid,jsonb,jsonb,bigint) to service_role;
