-- 破冰局 · 集成修正 13：你画我猜的私有题面
--
-- B 的引擎只把 word 下发给「本机就是作画者」的那一端，联机时只有主持人设备能看到题面，
-- 远程作画者永远拿不到自己要画什么。
--
-- 这里给题面单开一张表：主持人写入，只有本人能读自己那一行（RLS 限定 user_id = auth.uid()），
-- 视图里不会出现别人的答案。

create table if not exists public.draw_words (
  room_id    uuid not null references public.rooms (id) on delete cascade,
  round_key  text not null,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  word       text not null,
  created_at timestamptz not null default now(),
  primary key (room_id, round_key, user_id)
);

alter table public.draw_words enable row level security;

drop policy if exists draw_words_own on public.draw_words;
create policy draw_words_own on public.draw_words
for select to authenticated
using (user_id = auth.uid());

-- 主持人写入某一轮的题面（重复写同一轮就覆盖）
create or replace function public.publish_draw_word(
  p_room_id uuid,
  p_round_key text,
  p_user_id uuid,
  p_word text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED' using errcode = '28000';
  end if;
  if not exists (select 1 from public.rooms r where r.id = p_room_id and r.host_id = auth.uid()) then
    raise exception 'HOST_ONLY' using errcode = '42501';
  end if;
  if p_word is null or btrim(p_word) = '' then
    raise exception 'BAD_WORD' using errcode = '22023';
  end if;

  insert into public.draw_words (room_id, round_key, user_id, word)
  values (p_room_id, p_round_key, p_user_id, p_word)
  on conflict (room_id, round_key, user_id) do update set word = excluded.word;
end;
$$;

-- 读自己这一轮的题面
create or replace function public.read_my_draw_word(p_room_id uuid, p_round_key text)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select w.word
  from public.draw_words w
  where w.room_id = p_room_id
    and w.round_key = p_round_key
    and w.user_id = auth.uid()
  limit 1;
$$;

revoke all on function public.publish_draw_word(uuid, text, uuid, text) from public;
revoke all on function public.read_my_draw_word(uuid, text) from public;
grant execute on function public.publish_draw_word(uuid, text, uuid, text) to authenticated;
grant execute on function public.read_my_draw_word(uuid, text) to authenticated;
