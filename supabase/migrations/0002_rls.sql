-- 破冰局 · A：行级安全（RLS）与跨房间隔离
-- 原则：
--   1. 客户端只能看到自己所在房间的数据；
--   2. 词牌（game_secrets）只有本人可读；
--   3. 局次完整状态（games.state）任何客户端都不可读，只走 game_public 视图；
--   4. 所有写操作只允许走 RPC / Edge Function，表上不给 insert/update/delete 策略。

alter table public.profiles        enable row level security;
alter table public.rooms           enable row level security;
alter table public.room_members    enable row level security;
alter table public.games           enable row level security;
alter table public.game_secrets    enable row level security;
alter table public.game_receipts   enable row level security;
alter table public.game_starts     enable row level security;
alter table public.artworks        enable row level security;
alter table public.ai_scores       enable row level security;
alter table public.scores          enable row level security;
alter table public.word_banks      enable row level security;
alter table public.word_bank_items enable row level security;

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------

drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
for select to authenticated
using (id = auth.uid() or public.shares_room_with(id));

drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles
for update to authenticated
using (id = auth.uid())
with check (id = auth.uid());

-- ---------------------------------------------------------------------------
-- rooms / room_members
-- ---------------------------------------------------------------------------

drop policy if exists rooms_select_member on public.rooms;
create policy rooms_select_member on public.rooms
for select to authenticated
using (public.is_room_member(id));

drop policy if exists rooms_update_host on public.rooms;
create policy rooms_update_host on public.rooms
for update to authenticated
using (public.is_room_host(id))
with check (public.is_room_host(id));

drop policy if exists room_members_select on public.room_members;
create policy room_members_select on public.room_members
for select to authenticated
using (public.is_room_member(room_id));

-- ---------------------------------------------------------------------------
-- games：无直接策略，客户端读 game_public 视图
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- game_secrets：只有本人
-- ---------------------------------------------------------------------------

drop policy if exists game_secrets_select_self on public.game_secrets;
create policy game_secrets_select_self on public.game_secrets
for select to authenticated
using (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- receipts：本人可读（用于 replay / 排查）
-- ---------------------------------------------------------------------------

drop policy if exists game_receipts_select_self on public.game_receipts;
create policy game_receipts_select_self on public.game_receipts
for select to authenticated
using (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- 画作 / AI 评分 / 计分：同房可见
-- ---------------------------------------------------------------------------

drop policy if exists artworks_select_room on public.artworks;
create policy artworks_select_room on public.artworks
for select to authenticated
using (
  exists (
    select 1 from public.games g
    where g.id = artworks.game_id and public.is_room_member(g.room_id)
  )
);

drop policy if exists ai_scores_select_room on public.ai_scores;
create policy ai_scores_select_room on public.ai_scores
for select to authenticated
using (
  exists (
    select 1
    from public.artworks a
    join public.games g on g.id = a.game_id
    where a.id = ai_scores.artwork_id and public.is_room_member(g.room_id)
  )
);

drop policy if exists scores_select_room on public.scores;
create policy scores_select_room on public.scores
for select to authenticated
using (
  exists (
    select 1 from public.games g
    where g.id = scores.game_id and public.is_room_member(g.room_id)
  )
);

-- ---------------------------------------------------------------------------
-- 题库：系统题库（owner_id is null）与公开题库所有人可读，自建题库仅本人可写
-- ---------------------------------------------------------------------------

drop policy if exists word_banks_select on public.word_banks;
create policy word_banks_select on public.word_banks
for select to authenticated
using (owner_id is null or is_public or owner_id = auth.uid());

drop policy if exists word_banks_write_own on public.word_banks;
create policy word_banks_write_own on public.word_banks
for insert to authenticated
with check (owner_id = auth.uid());

drop policy if exists word_banks_update_own on public.word_banks;
create policy word_banks_update_own on public.word_banks
for update to authenticated
using (owner_id = auth.uid())
with check (owner_id = auth.uid());

drop policy if exists word_banks_delete_own on public.word_banks;
create policy word_banks_delete_own on public.word_banks
for delete to authenticated
using (owner_id = auth.uid());

drop policy if exists word_bank_items_select on public.word_bank_items;
create policy word_bank_items_select on public.word_bank_items
for select to authenticated
using (
  exists (
    select 1 from public.word_banks b
    where b.id = word_bank_items.bank_id
      and (b.owner_id is null or b.is_public or b.owner_id = auth.uid())
  )
);

drop policy if exists word_bank_items_write on public.word_bank_items;
create policy word_bank_items_write on public.word_bank_items
for all to authenticated
using (
  exists (
    select 1 from public.word_banks b
    where b.id = word_bank_items.bank_id and b.owner_id = auth.uid()
  )
)
with check (
  exists (
    select 1 from public.word_banks b
    where b.id = word_bank_items.bank_id and b.owner_id = auth.uid()
  )
);

-- ---------------------------------------------------------------------------
-- 表权限：写操作只给 service_role（Edge Function）
-- ---------------------------------------------------------------------------

revoke insert, update, delete on public.games          from anon, authenticated;
revoke insert, update, delete on public.game_secrets   from anon, authenticated;
revoke insert, update, delete on public.game_receipts  from anon, authenticated;
revoke insert, update, delete on public.game_starts    from anon, authenticated;
revoke insert, update, delete on public.artworks       from anon, authenticated;
revoke insert, update, delete on public.ai_scores      from anon, authenticated;
revoke insert, update, delete on public.scores         from anon, authenticated;
revoke insert, update, delete on public.room_members   from anon, authenticated;
revoke insert, delete on public.rooms                  from anon, authenticated;
