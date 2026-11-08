-- Supabase compatibility bootstrap for a plain PostgreSQL 16 server.
--
-- Run ONCE on a fresh cluster, connected as the bootstrap superuser `supabase_admin`
-- (start.sh creates the cluster with `initdb -U supabase_admin`), to database `postgres`.
-- Modelled on supabase/postgres init scripts + GoTrue + storage-api schemas: roles,
-- schemas, `auth`/`storage` tables, auth.uid()/role()/jwt()/email(), storage helpers,
-- the empty `supabase_realtime` publication and Supabase's default privileges.
-- Not modelled: GoTrue/storage/PostgREST services, pg_net, pg_cron, vault, pg_graphql,
-- supautils, statement timeouts on login, event triggers.

\set ON_ERROR_STOP 1
set client_min_messages = warning;

-- ---------------------------------------------------------------------------
-- Roles (supabase/postgres migrations/db/init-scripts + later role migrations)
-- ---------------------------------------------------------------------------
-- `postgres` is not a superuser on Supabase; supabase_admin is.
create role postgres with login createrole createdb replication bypassrls;

create role anon nologin noinherit;
create role authenticated nologin noinherit;
create role service_role nologin noinherit bypassrls;
-- 20230529180330_alter_api_roles_for_inherit
alter role anon inherit;
alter role authenticated inherit;
alter role service_role inherit;

create role authenticator with login noinherit;
grant anon, authenticated, service_role to authenticator;

create role supabase_auth_admin with login noinherit createrole noreplication;
create role supabase_storage_admin with login noinherit createrole noreplication;
create role supabase_replication_admin with login replication;
create role supabase_read_only_user with login bypassrls;
grant pg_read_all_data to supabase_read_only_user;
create role supabase_realtime_admin nologin noinherit;
create role dashboard_user with createrole createdb replication;
create role pgbouncer with login;

-- 20230201083204_grant_auth_roles_to_postgres
grant anon, authenticated, service_role to postgres;
-- 20230327032006_grant_auth_roles_to_supabase_storage_admin
grant anon, authenticated, service_role to supabase_storage_admin;
grant authenticator to supabase_storage_admin;
-- 20240606060239_grant_predefined_roles_to_postgres
grant pg_read_all_data, pg_signal_backend, pg_monitor to postgres;

-- supautils `privileged_role_allowed_configs`: superuser-only settings Supabase lets postgres set.
grant set on parameter session_replication_role, log_lock_waits, log_min_duration_statement,
  log_min_messages, log_replication_commands, log_statement, log_temp_files, track_io_timing,
  wal_compression to postgres;

-- Database: owned by postgres (as on Supabase); public schema is owned by pg_database_owner.
alter database postgres owner to postgres;

-- ---------------------------------------------------------------------------
-- Schemas
-- ---------------------------------------------------------------------------
create schema extensions;
alter schema extensions owner to postgres;
create schema auth authorization supabase_admin;
create schema storage authorization supabase_admin;
create schema realtime;
create schema graphql_public;

grant usage on schema public to postgres, anon, authenticated, service_role;
grant all on schema public to postgres;
grant usage on schema extensions to postgres, anon, authenticated, service_role;
grant all on schema extensions to postgres with grant option;
grant usage on schema auth to anon, authenticated, service_role;
grant all on schema auth to supabase_auth_admin, dashboard_user, postgres;
grant usage on schema storage to postgres, anon, authenticated, service_role;
grant all on schema storage to supabase_storage_admin, dashboard_user, postgres with grant option;
grant usage on schema realtime to postgres, anon, authenticated, service_role;
grant usage on schema graphql_public to postgres, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Extensions live in `extensions`
-- ---------------------------------------------------------------------------
create extension if not exists "uuid-ossp" with schema extensions;
create extension if not exists pgcrypto with schema extensions;
-- btree_gist is created by the repo's own migrations (`with schema extensions`).

-- Search paths (supabase post-setup)
alter role postgres set search_path to "$user", public, extensions;
alter role supabase_admin set search_path to "$user", public, auth, extensions;
alter role supabase_auth_admin set search_path to auth;
alter role supabase_storage_admin set search_path to storage;
alter role authenticator set search_path to "$user", public, extensions;

-- ---------------------------------------------------------------------------
-- Default privileges (supabase init: anything created in public is API-visible)
-- ---------------------------------------------------------------------------
alter default privileges in schema public grant all on tables to postgres, anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to postgres, anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to postgres, anon, authenticated, service_role;
alter default privileges for role postgres in schema public grant all on tables to postgres, anon, authenticated, service_role;
alter default privileges for role postgres in schema public grant all on functions to postgres, anon, authenticated, service_role;
alter default privileges for role postgres in schema public grant all on sequences to postgres, anon, authenticated, service_role;
alter default privileges for role supabase_admin in schema public grant all on tables to postgres, anon, authenticated, service_role;
alter default privileges for role supabase_admin in schema public grant all on functions to postgres, anon, authenticated, service_role;
alter default privileges for role supabase_admin in schema public grant all on sequences to postgres, anon, authenticated, service_role;

alter default privileges in schema extensions grant all on tables to postgres, anon, authenticated, service_role;
alter default privileges in schema extensions grant all on functions to postgres, anon, authenticated, service_role;
alter default privileges in schema extensions grant all on sequences to postgres, anon, authenticated, service_role;
grant all on all functions in schema extensions to postgres with grant option;

alter default privileges in schema storage grant all on tables to postgres, anon, authenticated, service_role;
alter default privileges in schema storage grant all on functions to postgres, anon, authenticated, service_role;
alter default privileges in schema storage grant all on sequences to postgres, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- auth schema (GoTrue, current migrations)
-- ---------------------------------------------------------------------------
create type auth.aal_level as enum ('aal1', 'aal2', 'aal3');
create type auth.factor_type as enum ('totp', 'webauthn', 'phone');
create type auth.factor_status as enum ('unverified', 'verified');
create type auth.code_challenge_method as enum ('s256', 'plain');
create type auth.one_time_token_type as enum (
  'confirmation_token', 'reauthentication_token', 'recovery_token',
  'email_change_token_new', 'email_change_token_current', 'phone_change_token');

create table auth.instances (
  id uuid not null primary key,
  uuid uuid,
  raw_base_config text,
  created_at timestamptz,
  updated_at timestamptz
);

create table auth.schema_migrations (
  version varchar(255) not null primary key
);

create table auth.users (
  instance_id uuid,
  id uuid not null primary key,
  aud varchar(255),
  role varchar(255),
  email varchar(255),
  encrypted_password varchar(255),
  email_confirmed_at timestamptz,
  invited_at timestamptz,
  confirmation_token varchar(255),
  confirmation_sent_at timestamptz,
  recovery_token varchar(255),
  recovery_sent_at timestamptz,
  email_change_token_new varchar(255),
  email_change varchar(255),
  email_change_sent_at timestamptz,
  last_sign_in_at timestamptz,
  raw_app_meta_data jsonb,
  raw_user_meta_data jsonb,
  is_super_admin boolean,
  created_at timestamptz,
  updated_at timestamptz,
  phone text default null unique,
  phone_confirmed_at timestamptz,
  phone_change text default '',
  phone_change_token varchar(255) default '',
  phone_change_sent_at timestamptz,
  confirmed_at timestamptz generated always as (least(email_confirmed_at, phone_confirmed_at)) stored,
  email_change_token_current varchar(255) default '',
  email_change_confirm_status smallint default 0
    check (email_change_confirm_status >= 0 and email_change_confirm_status <= 2),
  banned_until timestamptz,
  reauthentication_token varchar(255) default '',
  reauthentication_sent_at timestamptz,
  is_sso_user boolean not null default false,
  deleted_at timestamptz,
  is_anonymous boolean not null default false
);
comment on table auth.users is 'Auth: Stores user login data within a secure schema.';
comment on column auth.users.is_sso_user is 'Auth: Set this column to true when the account comes from SSO. These accounts can have duplicate emails.';
create unique index confirmation_token_idx on auth.users (confirmation_token) where confirmation_token::text !~ '^[0-9 ]*$';
create unique index recovery_token_idx on auth.users (recovery_token) where recovery_token::text !~ '^[0-9 ]*$';
create unique index email_change_token_current_idx on auth.users (email_change_token_current) where email_change_token_current::text !~ '^[0-9 ]*$';
create unique index email_change_token_new_idx on auth.users (email_change_token_new) where email_change_token_new::text !~ '^[0-9 ]*$';
create unique index reauthentication_token_idx on auth.users (reauthentication_token) where reauthentication_token::text !~ '^[0-9 ]*$';
create unique index users_email_partial_key on auth.users (email) where is_sso_user = false;
create index users_instance_id_email_idx on auth.users (instance_id, lower(email::text));
create index users_instance_id_idx on auth.users (instance_id);
create index users_is_anonymous_idx on auth.users (is_anonymous);

create table auth.identities (
  provider_id text not null,
  user_id uuid not null references auth.users (id) on delete cascade,
  identity_data jsonb not null,
  provider text not null,
  last_sign_in_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz,
  email text generated always as (lower(identity_data ->> 'email')) stored,
  id uuid not null default gen_random_uuid() primary key,
  constraint identities_provider_id_provider_unique unique (provider_id, provider)
);
create index identities_email_idx on auth.identities (email text_pattern_ops);
create index identities_user_id_idx on auth.identities (user_id);

create table auth.sessions (
  id uuid not null primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz,
  updated_at timestamptz,
  factor_id uuid,
  aal auth.aal_level,
  not_after timestamptz,
  refreshed_at timestamp,
  user_agent text,
  ip inet,
  tag text
);
comment on column auth.sessions.not_after is 'Auth: Not after is a nullable column that contains a timestamp after which the session should be regarded as expired.';
create index sessions_user_id_idx on auth.sessions (user_id);
create index user_id_created_at_idx on auth.sessions (user_id, created_at);
create index sessions_not_after_idx on auth.sessions (not_after desc);

create table auth.refresh_tokens (
  instance_id uuid,
  id bigserial primary key,
  token varchar(255),
  user_id varchar(255),
  revoked boolean,
  created_at timestamptz,
  updated_at timestamptz,
  parent varchar(255),
  session_id uuid references auth.sessions (id) on delete cascade,
  constraint refresh_tokens_token_unique unique (token)
);
create index refresh_tokens_instance_id_idx on auth.refresh_tokens (instance_id);
create index refresh_tokens_instance_id_user_id_idx on auth.refresh_tokens (instance_id, user_id);
create index refresh_tokens_parent_idx on auth.refresh_tokens (parent);
create index refresh_tokens_session_id_revoked_idx on auth.refresh_tokens (session_id, revoked);
create index refresh_tokens_updated_at_idx on auth.refresh_tokens (updated_at desc);

create table auth.audit_log_entries (
  instance_id uuid,
  id uuid not null primary key,
  payload json,
  created_at timestamptz,
  ip_address varchar(64) not null default ''
);
create index audit_logs_instance_id_idx on auth.audit_log_entries (instance_id);

create table auth.one_time_tokens (
  id uuid not null primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  token_type auth.one_time_token_type not null,
  token_hash text not null check (char_length(token_hash) > 0),
  relates_to text not null,
  created_at timestamp not null default now(),
  updated_at timestamp not null default now()
);
create unique index one_time_tokens_user_id_token_type_key on auth.one_time_tokens (user_id, token_type);
create index one_time_tokens_token_hash_hash_idx on auth.one_time_tokens using hash (token_hash);
create index one_time_tokens_relates_to_hash_idx on auth.one_time_tokens using hash (relates_to);

create table auth.mfa_factors (
  id uuid not null primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  friendly_name text,
  factor_type auth.factor_type not null,
  status auth.factor_status not null,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  secret text,
  phone text,
  last_challenged_at timestamptz unique,
  web_authn_credential jsonb,
  web_authn_aaguid uuid
);
create index factor_id_created_at_idx on auth.mfa_factors (user_id, created_at);
create unique index mfa_factors_user_friendly_name_unique on auth.mfa_factors (friendly_name, user_id) where trim(friendly_name) <> '';

create table auth.mfa_challenges (
  id uuid not null primary key,
  factor_id uuid not null references auth.mfa_factors (id) on delete cascade,
  created_at timestamptz not null,
  verified_at timestamptz,
  ip_address inet not null,
  otp_code text,
  web_authn_session_data jsonb
);

create table auth.mfa_amr_claims (
  session_id uuid not null references auth.sessions (id) on delete cascade,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  authentication_method text not null,
  id uuid not null constraint amr_id_pk primary key,
  constraint mfa_amr_claims_session_id_authentication_method_pkey unique (session_id, authentication_method)
);

create table auth.flow_state (
  id uuid not null primary key,
  user_id uuid,
  auth_code text not null,
  code_challenge_method auth.code_challenge_method not null,
  code_challenge text not null,
  provider_type text not null,
  provider_access_token text,
  provider_refresh_token text,
  created_at timestamptz,
  updated_at timestamptz,
  authentication_method text not null,
  auth_code_issued_at timestamptz
);

-- Request helpers, exactly as GoTrue defines them.
create or replace function auth.uid() returns uuid language sql stable as $$
  select
  coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;
comment on function auth.uid() is 'Deprecated. Use auth.jwt() -> ''sub'' instead.';

create or replace function auth.role() returns text language sql stable as $$
  select
  coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')
  )::text
$$;
comment on function auth.role() is 'Deprecated. Use auth.jwt() -> ''role'' instead.';

create or replace function auth.email() returns text language sql stable as $$
  select
  coalesce(
    nullif(current_setting('request.jwt.claim.email', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email')
  )::text
$$;
comment on function auth.email() is 'Deprecated. Use auth.jwt() -> ''email'' instead.';

create or replace function auth.jwt() returns jsonb language sql stable as $$
  select
    coalesce(
        nullif(current_setting('request.jwt.claim', true), ''),
        nullif(current_setting('request.jwt.claims', true), '')
    )::jsonb
$$;

-- Ownership and grants (auth objects belong to supabase_auth_admin; postgres and
-- dashboard_user have full table access, API roles only use the helper functions).
do $$
declare r record;
begin
  for r in select c.relname, c.relkind from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'auth' and c.relkind = 'r' loop
    execute format('alter table auth.%I owner to supabase_auth_admin', r.relname);
  end loop;
  for r in select p.oid::regprocedure as f from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'auth' loop
    execute format('alter function %s owner to supabase_auth_admin', r.f);
  end loop;
  for r in select t.typname from pg_type t join pg_namespace n on n.oid = t.typnamespace
           where n.nspname = 'auth' and t.typtype = 'e' loop
    execute format('alter type auth.%I owner to supabase_auth_admin', r.typname);
  end loop;
end $$;
alter schema auth owner to supabase_admin;
grant all on all tables in schema auth to supabase_auth_admin, dashboard_user, postgres;
grant all on all sequences in schema auth to supabase_auth_admin, dashboard_user, postgres;
grant all on all routines in schema auth to supabase_auth_admin, dashboard_user, postgres;
grant execute on function auth.uid(), auth.role(), auth.email(), auth.jwt() to public, anon, authenticated, service_role;
alter default privileges for role supabase_auth_admin in schema auth grant all on tables to postgres, dashboard_user;
alter default privileges for role supabase_auth_admin in schema auth grant all on sequences to postgres, dashboard_user;
alter default privileges for role supabase_auth_admin in schema auth grant all on routines to postgres, dashboard_user;

-- ---------------------------------------------------------------------------
-- storage schema (storage-api migrations, without the service itself)
-- ---------------------------------------------------------------------------
create type storage.buckettype as enum ('STANDARD', 'ANALYTICS');

create table storage.migrations (
  id integer not null primary key,
  name varchar(100) not null unique,
  hash varchar(40) not null,
  executed_at timestamp default current_timestamp
);

create table storage.buckets (
  id text not null primary key,
  name text not null,
  owner uuid,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  public boolean default false,
  avif_autodetection boolean default false,
  file_size_limit bigint,
  allowed_mime_types text[],
  owner_id text,
  type storage.buckettype not null default 'STANDARD'
);
comment on column storage.buckets.owner is 'Field is deprecated, use owner_id instead';
create unique index bname on storage.buckets using btree (name);

create table storage.objects (
  id uuid not null default gen_random_uuid() primary key,
  bucket_id text references storage.buckets (id),
  name text,
  owner uuid,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  last_accessed_at timestamptz default now(),
  metadata jsonb,
  path_tokens text[] generated always as (string_to_array(name, '/')) stored,
  version text,
  owner_id text,
  user_metadata jsonb,
  level integer
);
comment on column storage.objects.owner is 'Field is deprecated, use owner_id instead';
create unique index bucketid_objname on storage.objects using btree (bucket_id, name);
create index name_prefix_search on storage.objects using btree (name text_pattern_ops);
create index idx_objects_bucket_id_name on storage.objects (bucket_id, name collate "C");

alter table storage.migrations enable row level security;
alter table storage.buckets enable row level security;
alter table storage.objects enable row level security;

create or replace function storage.foldername(name text) returns text[] language plpgsql as $$
declare
_parts text[];
begin
	select string_to_array(name, '/') into _parts;
	return _parts[1:array_length(_parts,1)-1];
end
$$;

create or replace function storage.filename(name text) returns text language plpgsql as $$
declare
_parts text[];
begin
	select string_to_array(name, '/') into _parts;
	return _parts[array_length(_parts,1)];
end
$$;

create or replace function storage.extension(name text) returns text language plpgsql as $$
declare
_parts text[];
_filename text;
begin
	select string_to_array(name, '/') into _parts;
	select _parts[array_length(_parts,1)] into _filename;
	return reverse(split_part(reverse(_filename), '.', 1));
end
$$;

create or replace function storage.update_updated_at_column() returns trigger language plpgsql as $$
begin
    new.updated_at = now();
    return new;
end;
$$;

-- storage-api "protect_delete": direct DELETEs need `set storage.allow_delete_query = 'true'`.
create or replace function storage.protect_delete() returns trigger language plpgsql as $$
begin
    if coalesce(current_setting('storage.allow_delete_query', true), 'false') != 'true' then
        raise exception 'Direct deletion from storage tables is not allowed. Use the Storage API instead.'
            using hint = 'This prevents accidental data loss from orphaned objects.',
                  errcode = '42501';
    end if;
    return null;
end;
$$;

create trigger update_objects_updated_at before update on storage.objects
  for each row execute function storage.update_updated_at_column();
create trigger protect_objects_delete before delete on storage.objects
  for each statement execute function storage.protect_delete();
create trigger protect_buckets_delete before delete on storage.buckets
  for each statement execute function storage.protect_delete();

create or replace function storage.search(prefix text, bucketname text, limits int default 100,
  levels int default 1, offsets int default 0, search text default '', sortcolumn text default 'name',
  sortorder text default 'asc')
returns table (name text, id uuid, updated_at timestamptz, created_at timestamptz,
  last_accessed_at timestamptz, metadata jsonb)
language plpgsql stable as $$
begin
  return query
    select o.name, o.id, o.updated_at, o.created_at, o.last_accessed_at, o.metadata
    from storage.objects o
    where o.bucket_id = bucketname and o.name ilike prefix || '%' and o.name ilike '%' || search || '%'
    order by o.name
    limit limits offset offsets;
end
$$;

do $$
declare r record;
begin
  for r in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'storage' and c.relkind = 'r' loop
    execute format('alter table storage.%I owner to supabase_storage_admin', r.relname);
  end loop;
  for r in select p.oid::regprocedure as f from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'storage' loop
    execute format('alter function %s owner to supabase_storage_admin', r.f);
  end loop;
end $$;
alter type storage.buckettype owner to supabase_storage_admin;
grant all on storage.buckets, storage.objects to anon, authenticated, service_role;
grant all on storage.buckets, storage.objects to postgres with grant option;
grant all on storage.migrations to anon, authenticated, service_role, postgres;
grant all on all tables in schema storage to dashboard_user;
grant all on all routines in schema storage to dashboard_user, postgres;
-- Supabase lets `postgres` manage policies on storage.objects (create policy needs ownership in
-- plain PostgreSQL), which the repo's migrations rely on.
grant supabase_storage_admin to postgres;

-- ---------------------------------------------------------------------------
-- Realtime: empty publication, as created by the Supabase image.
-- ---------------------------------------------------------------------------
create publication supabase_realtime;
alter publication supabase_realtime owner to postgres;

-- start.sh treats the existence of role postgres as "shim applied".
select 'shim applied' as status;
