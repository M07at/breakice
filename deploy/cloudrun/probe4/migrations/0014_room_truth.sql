-- 破冰局 · 集成修正 9：真心话大冒险的共享回合
--
-- 之前每台设备各自"转盘"，你转到 A、别人转到 B，四个人看到的人不一样。
-- 把「轮到谁 + 什么题」写进 rooms.settings.truth，所有客户端读同一份，
-- 现有 2 秒轮询就能同步，不需要额外的实时通道。

create or replace function public.set_room_truth(p_room_id uuid, p_truth jsonb)
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
  if not public.is_room_member(p_room_id) then
    raise exception 'NOT_A_MEMBER' using errcode = '42501';
  end if;

  update public.rooms
  set settings = jsonb_set(coalesce(settings, '{}'::jsonb), '{truth}', coalesce(p_truth, 'null'::jsonb), true)
  where id = p_room_id and closed_at is null;

  if not found then
    raise exception 'ROOM_NOT_FOUND' using errcode = 'P0002';
  end if;
end;
$$;

revoke all on function public.set_room_truth(uuid, jsonb) from public;
grant execute on function public.set_room_truth(uuid, jsonb) to authenticated;
