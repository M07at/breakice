-- 破冰局 · 集成修正 5：房间积分榜
--
-- uc-command 在每次结算时把引擎给出的建议分值写进 public.scores
-- （唯一约束 (game_id, user_id, reason, ref) 保证重放不重复加分）。
-- 这里提供一个按房间聚合的读取入口给前端排行榜用；只允许本房间成员读。

create or replace function public.room_leaderboard(p_room_id uuid)
returns table (
  user_id uuid,
  nickname text,
  avatar jsonb,
  points bigint,
  games bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select
    s.user_id,
    coalesce(p.nickname, '玩家') as nickname,
    p.avatar,
    sum(s.points)::bigint as points,
    count(distinct s.game_id)::bigint as games
  from public.scores s
  join public.games g on g.id = s.game_id
  join public.profiles p on p.id = s.user_id
  where g.room_id = p_room_id
    and public.is_room_member(p_room_id)
  group by s.user_id, p.nickname, p.avatar
  order by points desc, nickname asc;
$$;

revoke all on function public.room_leaderboard(uuid) from public;
grant execute on function public.room_leaderboard(uuid) to authenticated;
