-- 本地验证用的 Supabase 兼容层（**不要**在生产库执行）
--
-- 目的：在没有 Supabase 平台的情况下，用一台普通 PostgreSQL 跑通 26 支迁移，
-- 提前发现"迁移脚本只在 Supabase 上能过"的问题。
--
-- 复刻的对象：
--   · 角色 anon / authenticated / service_role
--   · schema auth + auth.users + auth.uid()
--   · schema storage + buckets/objects + storage.foldername()
--
-- 云托管上的真实 Supabase 由官方镜像提供这些对象，因此本文件只在本地验证时使用。

-- ---------- 角色 ----------
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
end $$;

-- ---------- auth schema ----------
create schema if not exists auth;

create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text,
  raw_user_meta_data jsonb default '{}'::jsonb,
  created_at timestamptz default now()
);

-- Supabase 的 auth.uid() 从 JWT 里取 sub；本地用会话变量模拟
create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

create or replace function auth.role()
returns text
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claim.role', true), '')::text
$$;

-- ---------- storage schema ----------
create schema if not exists storage;

create table if not exists storage.buckets (
  id text primary key,
  name text not null,
  public boolean default false,
  created_at timestamptz default now()
);

create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets (id),
  name text not null,
  owner uuid,
  created_at timestamptz default now()
);

alter table storage.objects enable row level security;

-- 路径按 / 切成数组，Supabase Storage 同名函数
create or replace function storage.foldername(name text)
returns text[]
language sql
immutable
as $$
  select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1]
$$;
