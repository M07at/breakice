-- 破冰局 · 集成修正 10：数据备份与回退
--
-- 哪些数据丢了会真出事：
--   1. profiles 的昵称/形象 —— 用户自己捏的，丢了得重捏
--   2. word_banks / word_bank_items —— 用户自建题库，丢了没法恢复
-- 房间、局次、积分是过程数据，丢了可以重开一局，不进快照。
-- Storage 里的画作属于对象存储，用 Supabase Dashboard 的存储备份，不在这里处理。
--
-- 用法（在 SQL Editor 里执行）：
--   select public.create_backup('上线前');       -- 打一个快照，返回 id
--   select * from public.list_backups();         -- 看有哪些快照
--   select public.export_backup('<id>');         -- 取出 JSON，自己另存一份
--   select * from public.restore_backup('<id>'); -- 合并回灌（只插缺失的，不删现有数据）
--   select public.prune_backups(30);             -- 删掉 30 天前的快照

create table if not exists public.backups (
  id         uuid primary key default gen_random_uuid(),
  label      text not null,
  payload    jsonb not null,
  created_by uuid,
  created_at timestamptz not null default now()
);

comment on table public.backups is '手动快照：profiles + 自建题库。只由管理员/SQL Editor 操作。';

-- 只有管理员会用到，不开放给客户端
alter table public.backups enable row level security;

create or replace function public.create_backup(p_label text default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_label text := coalesce(nullif(btrim(coalesce(p_label, '')), ''), 'manual-' || to_char(now(), 'YYYYMMDD-HH24MI'));
begin
  insert into public.backups (label, payload, created_by)
  values (
    v_label,
    jsonb_build_object(
      'version', 1,
      'profiles', coalesce((select jsonb_agg(to_jsonb(p)) from public.profiles p), '[]'::jsonb),
      'word_banks', coalesce((select jsonb_agg(to_jsonb(b)) from public.word_banks b), '[]'::jsonb),
      'word_bank_items', coalesce((select jsonb_agg(to_jsonb(i)) from public.word_bank_items i), '[]'::jsonb)
    ),
    auth.uid()
  )
  returning id into v_id;

  return v_id;
end;
$$;

create or replace function public.list_backups()
returns table (id uuid, label text, created_at timestamptz, bytes bigint, banks int, items int)
language sql
stable
security definer
set search_path = public
as $$
  select
    b.id,
    b.label,
    b.created_at,
    length(b.payload::text)::bigint,
    jsonb_array_length(coalesce(b.payload -> 'word_banks', '[]'::jsonb)),
    jsonb_array_length(coalesce(b.payload -> 'word_bank_items', '[]'::jsonb))
  from public.backups b
  order by b.created_at desc;
$$;

create or replace function public.export_backup(p_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select payload from public.backups where id = p_id;
$$;

/**
 * 合并回灌：只补齐缺失的行，不删除现有数据。
 * 误删恢复、换环境迁移都用它；真要清空重来请手工执行。
 */
create or replace function public.restore_backup(p_id uuid)
returns table (banks_restored int, items_restored int, profiles_touched int)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payload jsonb;
  v_banks int := 0;
  v_items int := 0;
  v_profiles int := 0;
begin
  select payload into v_payload from public.backups where id = p_id;
  if v_payload is null then
    raise exception 'BACKUP_NOT_FOUND' using errcode = 'P0002';
  end if;

  -- 题库：owner 已被删除的跳过，否则外键会整条语句失败
  with inserted as (
    insert into public.word_banks
    select r.* from jsonb_populate_recordset(null::public.word_banks, coalesce(v_payload -> 'word_banks', '[]'::jsonb)) r
    where r.owner_id is null
       or exists (select 1 from public.profiles p where p.id = r.owner_id)
    on conflict (id) do nothing
    returning 1
  )
  select count(*) into v_banks from inserted;

  -- 题库条目（外键要求题库先在）
  with inserted as (
    insert into public.word_bank_items
    select r.* from jsonb_populate_recordset(null::public.word_bank_items, coalesce(v_payload -> 'word_bank_items', '[]'::jsonb)) r
    where exists (select 1 from public.word_banks b where b.id = r.bank_id)
    on conflict (id) do nothing
    returning 1
  )
  select count(*) into v_items from inserted;

  -- 昵称/形象：只补空的，不覆盖用户现在的设置
  with restored as (
    update public.profiles p
    set nickname = coalesce(nullif(p.nickname, '玩家'), s.nickname, p.nickname),
        avatar_url = coalesce(p.avatar_url, s.avatar_url)
    from jsonb_populate_recordset(null::public.profiles, coalesce(v_payload -> 'profiles', '[]'::jsonb)) s
    where p.id = s.id
      and (p.avatar_url is null or p.nickname = '玩家')
    returning 1
  )
  select count(*) into v_profiles from restored;

  return query select v_banks, v_items, v_profiles;
end;
$$;

create or replace function public.prune_backups(p_keep_days int default 30)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted int;
begin
  delete from public.backups where created_at < now() - make_interval(days => greatest(p_keep_days, 1));
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

-- 备份里含全量题库，只允许管理员（SQL Editor / service_role）调用
revoke all on function public.create_backup(text) from public;
revoke all on function public.list_backups() from public;
revoke all on function public.export_backup(uuid) from public;
revoke all on function public.restore_backup(uuid) from public;
revoke all on function public.prune_backups(int) from public;
