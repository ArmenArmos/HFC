# Hosted database metadata audit

Continue the remaining security backlog under overnight delegation. Local replay proves migrations, not hosted configuration. The Auth management audit is denied HTTP403; this separate metadata audit uses the existing production database deployment credential, without broadening access.

## Boundary

A manually dispatched GitHub Actions workflow runs only on main, uses the protected production environment and pinned actions, and opens a PostgreSQL READ ONLY transaction. Read pg_catalog/information_schema and migration version metadata only. Never select member records, phone numbers, reports, provider tokens, policy expression text or function bodies. No repairs, schema changes, role changes, patient mutations or outbound provider calls.

Report tables lacking RLS, current anon/authenticated write/TRUNCATE privileges, unsafe future table ACL grants, required read access, security-definer functions lacking an explicit search_path, service access to the obsolete unbudgeted message RPC, and migration count/latest version. RLS enabled is not proof of correct ownership predicates; do not overstate the audit. Compare observed migration versions against the checked-out migration filenames.

Use the already configured production pooler host and secret project/password. Match existing encrypted connection behavior, pass credentials only via child environment, disable psql startup files, enforce connection/statement/lock and process deadlines, bound captured output and return sanitized errors. Do not log raw connection failures or secrets. Strictly validate output shape before printing the selected metadata report. CI/local fixture tests cover configuration validation, credential non-disclosure, invalid output, migration mismatch and positive/negative metadata results.

## Release

Verify SQL in isolated local replay, review the important credential/read-only boundaries with Claude, merge after CI, then dispatch from main and record the actual hosted outcome. If database access fails, preserve the sanitized reason and continue independent roadmap work. This does not bypass the Auth management permission failure.
