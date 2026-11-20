-- 破冰局 · 集成修正 16：同一轮允许多人各交一幅（接力画）
--
-- 融合玩法改成「接力画」：本轮公共画板上，玩家按顺序依次作画并各自提交一份快照，
-- 最后依次展示每个人提交的内容，再投票。
--
-- 原来的唯一键是 (game_id, turn_key)，注释写着「同一回合只能交一张画」，
-- 于是同轮第二个人提交就会覆盖第一个人——这也是画廊永远只有一幅画的根因。
--
-- 这里把唯一键扩展到玩家维度：同轮多人各留一份，重试仍复用自己那一行。

alter table public.artworks
  drop constraint if exists artworks_game_id_turn_key_key;

drop index if exists public.artworks_game_turn_user_key;
create unique index artworks_game_turn_user_key
  on public.artworks (game_id, turn_key, user_id);

-- submit_artwork 的 on conflict 目标必须跟着改，否则写入会直接报错。
-- 函数体沿用 0001 的语义：非本局成员拒绝、路径必须属于自己的目录、重试复用自己那一行。
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

  select room_id into v_room from public.games where id = p_game_id;
  if v_room is null then
    raise exception 'GAME_NOT_FOUND' using errcode = 'P0002';
  end if;
  if not public.is_room_member(v_room) then
    raise exception 'NOT_A_MEMBER' using errcode = 'P0001';
  end if;

  -- 路径必须是 <room>/<game>/<turn>/<file> 且属于自己，避免覆盖别人的画
  if split_part(p_storage_path, '/', 1) <> v_room::text then
    raise exception 'BAD_PATH' using errcode = '22023';
  end if;

  select user_id into v_owner
  from public.artworks
  where game_id = p_game_id and turn_key = p_turn_key and user_id = v_uid;

  insert into public.artworks (game_id, turn_key, user_id, storage_path, status)
  values (p_game_id, p_turn_key, v_uid, p_storage_path, 'pending')
  on conflict (game_id, turn_key, user_id)
  do update set storage_path = excluded.storage_path, status = 'pending'
  returning id into v_art;

  return v_art;
end;
$$;

revoke all on function public.submit_artwork(uuid, text, text) from public;
grant execute on function public.submit_artwork(uuid, text, text) to authenticated;
