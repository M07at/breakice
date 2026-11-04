-- 破冰局 · 集成修正 6：修复「同房可见」策略里的 RLS 自噬
--
-- 问题：0002 里 scores / artworks / ai_scores 的 select 策略写成了
--   exists (select 1 from public.games g where g.id = xxx.game_id and is_room_member(g.room_id))
-- 但 public.games 是「开启 RLS 且不给 authenticated 任何 select 策略」的（为了不暴露 games.state）。
-- 策略里的子查询同样受 RLS 约束，于是这个 exists 永远为空 → 同房成员一条也读不到。
-- （room_leaderboard 是 security definer，绕过 RLS，所以积分榜看起来是好的。）
--
-- 修法：用一个 security definer 的小函数拿 room_id，策略里不再直接 join games。

create or replace function public.game_room_id(p_game uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select room_id from public.games where id = p_game;
$$;

revoke all on function public.game_room_id(uuid) from public;
grant execute on function public.game_room_id(uuid) to authenticated;

-- scores：同房成员可读
drop policy if exists scores_select_room on public.scores;
create policy scores_select_room on public.scores
for select to authenticated
using (public.is_room_member(public.game_room_id(game_id)));

-- artworks：同房成员可读
drop policy if exists artworks_select_room on public.artworks;
create policy artworks_select_room on public.artworks
for select to authenticated
using (public.is_room_member(public.game_room_id(game_id)));

-- ai_scores：经由 artworks 反查局次
drop policy if exists ai_scores_select_room on public.ai_scores;
create policy ai_scores_select_room on public.ai_scores
for select to authenticated
using (
  exists (
    select 1 from public.artworks a
    where a.id = ai_scores.artwork_id
      and public.is_room_member(public.game_room_id(a.game_id))
  )
);
