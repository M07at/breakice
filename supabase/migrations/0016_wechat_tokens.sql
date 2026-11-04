-- 破冰局 · 集成修正 11：微信接口的 access_token 缓存
--
-- wxacode.getUnlimited 需要 access_token，而微信对换取频率有限制（每天 2000 次），
-- 所以缓存起来复用。只有 service_role（Edge Function）会读写。

create table if not exists public.wechat_tokens (
  kind       text primary key,
  value      text not null,
  expires_at timestamptz not null,
  updated_at timestamptz not null default now()
);

alter table public.wechat_tokens enable row level security;
-- 不建任何策略：客户端读不到，service_role 绕过 RLS
