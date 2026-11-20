-- 普通你画我猜没有 public.games 记录；评分以房间、局次、回合为幂等键。
create table if not exists public.draw_ai_scores (
  room_id uuid not null references public.rooms(id) on delete cascade,
  game_key text not null,
  round_key text not null,
  image_ref text not null,
  status text not null check (status in ('pending', 'success', 'failed', 'timeout', 'unsupported')),
  result jsonb,
  updated_at timestamptz not null default now(),
  primary key (room_id, game_key, round_key)
);
alter table public.draw_ai_scores enable row level security;
revoke all on public.draw_ai_scores from anon, authenticated;
grant all on public.draw_ai_scores to service_role;
