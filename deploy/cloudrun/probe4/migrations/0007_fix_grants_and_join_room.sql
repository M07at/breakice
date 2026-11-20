-- 破冰局 · 集成修正 2：表权限 + join_room 列名歧义
--
-- 1) 真实项目上 public 下的表没有给 authenticated 授 SELECT，客户端读 rooms / room_members
--    会得到 42501。这里显式授权；RLS 仍然生效，授权不等于放行数据。
-- 2) A 的 join_room 用 returns table (room_id ...)，输出参数 room_id 与 room_members.room_id
--    同名，函数体里 where room_id = ... 会报 42702 column reference "room_id" is ambiguous。
--    用 #variable_conflict use_column 让同名标识符优先解析成列，保持返回字段名不变。
--
-- 只新增文件，不修改 A 的历史迁移。

-- ---------------------------------------------------------------------------
-- 1. 表权限（RLS 负责真正隔离）
-- ---------------------------------------------------------------------------
grant usage on schema public to authenticated;
grant select on all tables in schema public to authenticated;
grant select on public.game_public to authenticated;

-- 未登录匿名角色不开放任何表读取；RPC 内部用 security definer 自己校验身份。

-- ---------------------------------------------------------------------------
-- 2. join_room：消除 room_id 歧义
-- ---------------------------------------------------------------------------
create or replace function public.join_room(p_code text)
returns table (room_id uuid, seat int, already_member boolean)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
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

  select m.* into v_existing
  from public.room_members m
  where m.room_id = v_room.id and m.user_id = v_uid;

  if found then
    update public.room_members m
    set online = true, left_at = null, last_seen_at = now()
    where m.room_id = v_room.id and m.user_id = v_uid;
    return query select v_room.id, v_existing.seat, true;
    return;
  end if;

  select count(*) into v_count
  from public.room_members m
  where m.room_id = v_room.id and m.left_at is null;

  if v_count >= v_room.max_players then
    raise exception 'ROOM_FULL' using errcode = 'P0001';
  end if;

  select coalesce(max(m.seat), 0) + 1 into v_seat
  from public.room_members m where m.room_id = v_room.id;

  insert into public.room_members (room_id, user_id, seat)
  values (v_room.id, v_uid, v_seat);

  return query select v_room.id, v_seat, false;
end;
$$;

revoke all on function public.join_room(text) from public;
grant execute on function public.join_room(text) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. 顺手校验：这些函数体里也有同名风险，重建一次确保用的是列解析
-- ---------------------------------------------------------------------------
create or replace function public.leave_room(p_room_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_uid uuid := auth.uid();
  v_host uuid;
  v_next uuid;
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED' using errcode = '28000';
  end if;
  if not exists (
    select 1 from public.room_members m
    where m.room_id = p_room_id and m.user_id = v_uid and m.left_at is null
  ) then
    raise exception 'NOT_A_MEMBER' using errcode = 'P0001';
  end if;

  update public.room_members m
  set left_at = now(), online = false
  where m.room_id = p_room_id and m.user_id = v_uid;

  select r.host_id into v_host from public.rooms r where r.id = p_room_id;

  if v_host = v_uid then
    select m.user_id into v_next
    from public.room_members m
    where m.room_id = p_room_id and m.left_at is null
    order by m.seat
    limit 1;

    if v_next is not null then
      update public.rooms r set host_id = v_next where r.id = p_room_id;
      update public.room_members m set role = 'host' where m.room_id = p_room_id and m.user_id = v_next;
      update public.room_members m set role = 'player' where m.room_id = p_room_id and m.user_id = v_uid;
    end if;
  end if;
end;
$$;

revoke all on function public.leave_room(uuid) from public;
grant execute on function public.leave_room(uuid) to authenticated;
