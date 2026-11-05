-- 资料写入 v2：保留旧 RPC，旧客户端仍可继续同步昵称与形象。
create or replace function public.set_my_profile_v2(
  p_nickname text default null,
  p_avatar jsonb default null,
  p_mbti text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_mbti text := nullif(upper(btrim(p_mbti)), '');
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED' using errcode = '28000';
  end if;
  if v_mbti is not null and v_mbti !~ '^[EI][SN][TF][JP]$' then
    raise exception 'BAD_MBTI' using errcode = '22023';
  end if;
  perform public.set_my_profile(p_nickname, p_avatar);
  update public.profiles set mbti = v_mbti where id = auth.uid();
end;
$$;

revoke all on function public.set_my_profile_v2(text, jsonb, text) from public;
grant execute on function public.set_my_profile_v2(text, jsonb, text) to authenticated;

-- 新版积分榜带 MBTI；保留旧函数的返回格式，避免破坏旧客户端。
create or replace function public.room_leaderboard_v2(p_room_id uuid)
returns table (user_id uuid, nickname text, avatar jsonb, mbti text, points bigint, games bigint)
language sql
stable
security definer
set search_path = public
as $$
  select s.user_id, coalesce(p.nickname, '玩家'), p.avatar, p.mbti,
    sum(s.points)::bigint, count(distinct s.game_id)::bigint
  from public.scores s
  join public.games g on g.id = s.game_id
  join public.profiles p on p.id = s.user_id
  where g.room_id = p_room_id and public.is_room_member(p_room_id)
  group by s.user_id, p.nickname, p.avatar, p.mbti
  order by sum(s.points) desc, coalesce(p.nickname, '玩家') asc;
$$;
revoke all on function public.room_leaderboard_v2(uuid) from public;
grant execute on function public.room_leaderboard_v2(uuid) to authenticated;
