-- 破冰局 · 集成修正 7：人机补位用的机器人账号
--
-- 房间人数不足 4 人时，由 uc-command 用 service_role 创建若干固定机器人账号，
-- 把局补到能开局的人数。机器人是真实的 auth 用户（因为 game_secrets.user_id 外键指向 profiles），
-- 这样引擎不需要任何改动，也天然兼容"机器人也是玩家"的所有逻辑。
--
-- 只有 service_role 需要读这张表；客户端一律不给策略。

create table if not exists public.bots (
  slot       int primary key,
  user_id    uuid not null unique references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.bots enable row level security;
-- 故意不建任何策略：anon / authenticated 都读不到，service_role 绕过 RLS
