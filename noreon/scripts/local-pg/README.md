# Local PostgreSQL stand-in for the Supabase database

For machines without Docker, where `supabase start` / `pnpm db:reset` cannot run. A plain
PostgreSQL 16 server is bootstrapped with a Supabase-compatibility shim, every migration in
`supabase/migrations/` is replayed in filename order, and the SQL checks run against it.

```bash
scripts/local-pg/start.sh                # create + replay on first run; otherwise just start
scripts/local-pg/start.sh --reset        # wipe and replay from zero (about 10 s)
scripts/local-pg/start.sh --stop
scripts/local-pg/run-sql-checks.sh       # every scripts/check-*.sql, in filename order
scripts/local-pg/run-sql-checks.sh zoe   # names containing "zoe" (or a glob: 'check-zoe-v3-*')
psql -h /tmp/noreon-pg/run -p 54329 -U postgres -d postgres
```

Settings: `NOREON_PG_DIR` (default `/tmp/noreon-pg`), `NOREON_PG_PORT` (default `54329`),
`PG_BIN` (default `/usr/lib/postgresql/16/bin`), `NOREON_CHECK_TIMEOUT` (seconds per check),
`VERBOSE=1` to stream check output. Per-check logs land in `$NOREON_PG_DIR/check-logs/`.
When run as root, the server runs as OS user `postgres` (or `pgrunner`, created if needed).

Each migration runs in one transaction as role `postgres`, and stops at the first failure,
naming the file. Each check runs as `psql -U postgres -X -v ON_ERROR_STOP=1`, as
`node scripts/run-checks.mjs --sql` does through `docker exec`.

## What `shim.sql` provides

- Roles: `supabase_admin` (the only superuser), `postgres` (non-superuser with `createrole`,
  `createdb`, `replication`, `bypassrls`, member of `anon`/`authenticated`/`service_role`),
  `anon`, `authenticated`, `service_role` (`bypassrls`), `authenticator`, `supabase_auth_admin`,
  `supabase_storage_admin`, `dashboard_user` and the other platform roles.
- Schemas `auth`, `storage`, `extensions` (`pgcrypto`, `uuid-ossp`; migrations add `btree_gist`),
  empty `realtime` and `graphql_public`; `postgres` search path `"$user", public, extensions`.
- GoTrue tables (`users`, `identities`, `sessions`, `refresh_tokens`, `audit_log_entries`,
  `one_time_tokens`, `mfa_*`, `flow_state`, ...) and `auth.uid()`, `auth.role()`, `auth.email()`,
  `auth.jwt()` defined exactly as GoTrue does (reading `request.jwt.claim.*` / `request.jwt.claims`).
- storage-api tables `storage.buckets` / `storage.objects` (RLS on), `foldername()`,
  `filename()`, `extension()`, the `updated_at` trigger and the `protect_delete` triggers
  (direct deletes need `set storage.allow_delete_query = 'true'`).
- The empty `supabase_realtime` publication (`wal_level = logical`) and Supabase's default
  privileges on `public` (everything granted to the API roles unless a migration revokes it).

## Known differences from real Supabase

- PostgreSQL 16, not 17 (`config.toml` says 17). PG17-only syntax fails, e.g. the `MAINTAIN`
  privilege, so `check-native-api-admission.sql` fails here. Migrations guard their own PG17
  statements with `server_version_num`.
- No GoTrue, Storage, PostgREST, Realtime services: only their database objects. Nothing
  issues JWTs, uploads files or broadcasts changes; tests set `request.jwt.claims` themselves.
- No supautils: what it allows `postgres` to do is emulated with plain grants
  (`SET` on `session_replication_role` and a few log settings; membership in
  `supabase_storage_admin` so migrations can create policies on `storage.objects`).
- No pg_net, pg_cron, vault/pgsodium, pg_graphql, pg_stat_statements, event triggers,
  login statement timeouts for `anon`/`authenticated`, or `supabase_migrations` history table.
- Durability is off (`fsync = off`): this is a disposable test database.
