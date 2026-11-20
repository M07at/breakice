-- 破冰局 · A：画作存储桶与访问策略
-- 路径约定：{game_id}/{turn_key}/{user_id}.png
-- 只有同房间成员可上传/读取；桶为私有，前端用 storage.createSignedUrl 展示。
--
-- 集成修正：storage.objects 的 owner / bucket_id 在不同 Supabase Storage 版本里
-- 可能是 text 也可能是 uuid，直接和 text 比较会报 42883 operator does not exist: uuid = text。
-- 这里两边都显式转 text，与版本无关。

insert into storage.buckets (id, name, public)
values ('artworks', 'artworks', false)
on conflict (id) do nothing;

drop policy if exists artworks_upload_member on storage.objects;
create policy artworks_upload_member on storage.objects
for insert to authenticated
with check (
  bucket_id::text = 'artworks'
  and public.is_room_member(((storage.foldername(name))[1])::uuid)
);

drop policy if exists artworks_read_member on storage.objects;
create policy artworks_read_member on storage.objects
for select to authenticated
using (
  bucket_id::text = 'artworks'
  and public.is_room_member(((storage.foldername(name))[1])::uuid)
);

drop policy if exists artworks_delete_owner on storage.objects;
create policy artworks_delete_owner on storage.objects
for delete to authenticated
using (
  bucket_id::text = 'artworks'
  and owner::text = auth.uid()::text
);
