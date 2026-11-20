-- 破冰局 · 集成修正 3：把 service_role 的表权限补齐
--
-- 现象：uc-command 用 service_role 读 rooms 时报 permission denied for table rooms。
-- 原因：这个项目的默认权限（ALTER DEFAULT PRIVILEGES）没有对这些表生效，
--       0002 只 revoke 了 anon/authenticated 的写权限，0007 只补了 authenticated 的 SELECT，
--       service_role 一直没有拿到表的 GRANT。
--
-- 注意：service_role 本来就会绕过 RLS，这里只是补 Postgres 层的表权限，不改变隔离语义。

grant usage on schema public to service_role;
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;
grant all on all functions in schema public to service_role;

-- 以后新建的表/序列/函数也自动授权，避免再踩一次
alter default privileges in schema public grant all on tables to service_role;
alter default privileges in schema public grant all on sequences to service_role;
alter default privileges in schema public grant all on functions to service_role;

-- authenticated 只需要读；写操作全部走 RPC（security definer）
alter default privileges in schema public grant select on tables to authenticated;
