-- 破冰局 · 集成修正 8：修 wechat-auth 的 USER_NOT_READY（profiles 缺 openid）
--
-- 现象：清缓存后重新登录，wechat-auth 返回 500 USER_NOT_READY，进不了房间。
-- 原因：wechat-auth 先按 profiles.openid 找人，找不到才 createUser；
--       而 profiles.openid 只有在 0001 的触发器（不写 openid）之后、由函数 update 写入。
--       0008 之前 service_role 没有表权限，那次 update 静默失败，于是：
--         · profiles 有行但 openid 为 null
--         · createUser 报 email 已存在
--         · 两条查询都拿不到 userId → USER_NOT_READY
--
-- 修法：① 触发器直接写入 openid；② 回填历史数据（微信账号的 openid = 邮箱前缀）。

-- ① 新建用户时就把 openid 落库，不再依赖函数里的 update
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, openid, nickname, avatar_url)
  values (
    new.id,
    nullif(new.raw_user_meta_data ->> 'openid', ''),
    coalesce(nullif(new.raw_user_meta_data ->> 'nickname', ''), '玩家'),
    new.raw_user_meta_data ->> 'avatar_url'
  )
  on conflict (id) do update
    set openid = coalesce(public.profiles.openid, excluded.openid);
  return new;
end;
$$;

-- ② 补齐缺失的 profiles 行（早期创建失败的情况）
insert into public.profiles (id, openid, nickname)
select u.id,
       nullif(split_part(u.email, '@', 1), ''),
       coalesce(nullif(u.raw_user_meta_data ->> 'nickname', ''), '玩家')
from auth.users u
where u.email like '%@wechat.local'
on conflict (id) do nothing;

-- ③ 回填 openid：微信账号的 openid 就是邮箱前缀（唯一约束，冲突的跳过）
update public.profiles p
set openid = split_part(u.email, '@', 1)
from auth.users u
where u.id = p.id
  and p.openid is null
  and u.email like '%@wechat.local'
  and coalesce(split_part(u.email, '@', 1), '') <> ''
  and not exists (
    select 1 from public.profiles q
    where q.openid = split_part(u.email, '@', 1)
      and q.id <> p.id
  );
