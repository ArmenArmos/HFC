# Hosted database metadata audit

Run `Inspect hosted database security metadata` manually from `main` after reviewed changes merge. It uses the production environment and existing deployment database credentials. The job cannot run on another ref and does not use the management API credential that was denied Auth configuration access.

The fixed SQL runs in a READ ONLY transaction with catalog-only search path, short connection/query/lock deadlines, bounded capture and no startup file. Credentials are passed through child environment variables, not command arguments. The runner never logs raw database stderr or unvalidated output. It reads security catalogs and migration versions only; it does not read member records, phone numbers, report content, policy expression text or function bodies.

Exit 0 means the selected checks passed. Exit 2 means a validated metadata report contains findings or differs from this checkout's migration history. Exit 1 means the audit could not establish a result; inspect the sanitized reason rather than assuming protection is disabled. A failed query is not proof of an insecure database.

Checks include public table RLS, browser-readable materialized views and ordinary views without security-invoker mode, browser-role write/TRUNCATE/MAINTAIN privileges (MAINTAIN only where supported), schema creation/bypass privileges, future table ACLs with their owning role, explicit security-definer search paths, required reads, obsolete unbudgeted message RPC access and exact migration-version parity. Non-empty explicit search paths are listed for source review even when the automated checks pass. RLS being enabled does not prove every ownership predicate is correct, and this is not a blanket security approval.

Local replay detected residual MAINTAIN grants on five legacy tables and future grants owned by postgres/supabase_admin. These are local catalog findings, not established hosted exposure. PostgreSQL maintenance privileges are not directly exposed as ordinary PostgREST table operations. Confirm the hosted report before deciding a forward hardening migration; do not alter platform-owned roles or defaults speculatively. The audit performs no repair.


## First production inspection (2026-10-12)

Workflow38198190353 completed the read-only inspection and exited2 with validated findings, not a connection failure. All65 migration versions matched. Public-table RLS was enabled, no unsafe readable views or browser schema-create/bypass rights were found, required reads worked and the obsolete unbudgeted RPC was not callable. Two service-only report functions have explicit nonempty paths and remain a source-review item.

Production confirmed MAINTAIN grants on the same five legacy tables and postgres future public-table defaults. A forward migration removes only that unused maintenance access and extends the regression check to PostgreSQL17 privileges. It preserves SELECT/RPC/service access. Supabase-admin-owned future grants remain visible as findings: platform-managed defaults were deliberately excluded from the original application hardening and must be reviewed with the platform owner. The audit will still exit2 until those findings are resolved; do not relabel that as a clean audit. This inspection does not validate policy predicates or hosted Auth settings.
