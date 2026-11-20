-- 破冰局 · 集成修正 4：把自定义形象存到 profiles，房间/游戏里才和首页一致
--
-- 现状：profiles 只有 avatar_url（给微信头像用的 URL），我们的小程序形象是分层编号，
--       所以房间列表只能按座位号临时生成一个，和首页选的对不上。
-- 处理：加一个 avatar jsonb 存 { color, body, mouth, eyes, hat }，并提供一个写入 RPC。

alter table public.profiles add column if not exists avatar jsonb;

create or replace function public.set_my_profile(
  p_nickname text default null,
  p_avatar jsonb default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_name text := btrim(coalesce(p_nickname, ''));
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED' using errcode = '28000';
  end if;
  if char_length(v_name) > 20 then
    raise exception 'BAD_NICKNAME' using errcode = '22023';
  end if;

  update public.profiles
  set nickname = coalesce(nullif(v_name, ''), nickname),
      avatar = coalesce(p_avatar, avatar)
  where id = v_uid;
end;
$$;

revoke all on function public.set_my_profile(text, jsonb) from public;
grant execute on function public.set_my_profile(text, jsonb) to authenticated;
