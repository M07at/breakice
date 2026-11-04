-- 破冰局 · 建库前处理：把早期原型留下的同名表改名备份
-- 用法：先单独执行本文件，再按 0001 → 0006 顺序执行 migrations。
-- 只改名，不删数据；确认旧数据没用之后可以自己 drop table public.rooms_legacy_backup;

do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'rooms'
  ) and not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'rooms' and column_name = 'code'
  ) then
    if exists (
      select 1 from information_schema.tables
      where table_schema = 'public' and table_name = 'rooms_legacy_backup'
    ) then
      raise notice 'rooms_legacy_backup 已存在，跳过改名';
    else
      alter table public.rooms rename to rooms_legacy_backup;
      raise notice '旧 rooms 已改名为 rooms_legacy_backup';
    end if;
  else
    raise notice 'public.rooms 不存在或已经是新结构，无需处理';
  end if;
end $$;

-- 顺便看一下还有没有别的同名函数会和 schema 冲突（只读，不改任何东西）
select p.proname as function_name,
       pg_get_function_identity_arguments(p.oid) as arguments
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
order by 1;
