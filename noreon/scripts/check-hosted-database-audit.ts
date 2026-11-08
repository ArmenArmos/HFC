import assert from "node:assert/strict";
import {
  databaseAuditConfig,
  safeDatabaseReport,
  runDatabaseAudit,
} from "./audit-hosted-database";
const env = {
  GITHUB_ACTIONS: "true",
  GITHUB_REF: "refs/heads/main",
  SUPABASE_PROJECT_ID: "abcdefghijklmnopqrst",
  SUPABASE_DB_PASSWORD: "private-password",
  SUPABASE_POOLER_HOST: "aws-0-eu-central-1.pooler.supabase.com",
};
assert.equal(databaseAuditConfig(env).PGSSLMODE, "require");
assert.throws(() =>
  databaseAuditConfig({ ...env, GITHUB_REF: "refs/heads/other" }),
);
assert.throws(() =>
  databaseAuditConfig({ ...env, SUPABASE_POOLER_HOST: "attacker.example" }),
);
const clean = {
  serverVersionNum: 170006,
  tablesWithoutRls: [],
  browserUnsafeReadRelations: [],
  browserWriteGrants: [],
  unsafeDefaultGrants: [],
  browserSchemaCreate: [],
  browserBypassRls: [],
  definersWithoutSearchPath: [],
  definersWithNonEmptySearchPath: [],
  requiredReads: { profile: true, measurements: true, workspace: true },
  unbudgetedBeginCallable: false,
  migrationVersions: ["20261012020621"],
};
assert.equal(safeDatabaseReport(clean, ["20261012020621"]).passed, true);
assert.equal(
  safeDatabaseReport(
    { ...clean, tablesWithoutRls: ["profiles"] },
    clean.migrationVersions,
  ).passed,
  false,
);
assert.equal(
  safeDatabaseReport(
    { ...clean, unbudgetedBeginCallable: true },
    clean.migrationVersions,
  ).passed,
  false,
);
assert.equal(safeDatabaseReport(clean, ["20261012015229"]).passed, false);
assert.throws(() =>
  safeDatabaseReport(
    { ...clean, password: "private" },
    clean.migrationVersions,
  ),
);
assert.throws(() =>
  safeDatabaseReport(
    { ...clean, tablesWithoutRls: ["secret\n::warning::"] },
    clean.migrationVersions,
  ),
);
assert.equal(
  safeDatabaseReport(
    { ...clean, browserUnsafeReadRelations: ["unsafe_view"] },
    clean.migrationVersions,
  ).passed,
  false,
);
let called = false;
const result = runDatabaseAudit(
  env,
  clean.migrationVersions,
  (_command, args, options) => {
    called = true;
    assert.ok(args.includes("--no-psqlrc"));
    assert.ok(!args.join(" ").includes("private-password"));
    assert.equal(options.env.PGPASSWORD, "private-password");
    assert.equal(
      options.env.PGOPTIONS,
      "-c default_transaction_read_only=on -c statement_timeout=5000 -c lock_timeout=1000 -c search_path=pg_catalog",
    );
    return { status: 0, stdout: JSON.stringify(clean) };
  },
);
assert.equal(called, true);
assert.equal(result.passed, true);
assert.throws(
  () =>
    runDatabaseAudit(env, clean.migrationVersions, () => ({
      status: 1,
      stdout: "private-password",
      stderr: "private-password",
    })),
  (error) =>
    error instanceof Error && !error.message.includes("private-password"),
);
console.log(
  "Hosted database audit validates main-only target, selected metadata, migration parity and credential-safe execution.",
);

// Actual catalog query: roll back intentionally unsafe local fixtures.
const container = process.env.NOREON_TEST_DB_CONTAINER;
if (container) {
  if (!container.startsWith("supabase_db_"))
    throw Error("Use an isolated Supabase container");
  const { readFileSync, readdirSync } = await import("node:fs");
  const { execFileSync } = await import("node:child_process");
  const source = readFileSync(
    new URL("./audit-hosted-database.sql", import.meta.url),
    "utf8",
  );
  assert.ok(source.includes("begin read only;"));
  const query = source.replace(
    "begin read only;",
    "begin; grant update on public.profiles to anon; alter table public.profiles disable row level security; create view public.audit_unsafe_view as select 1 as value; create view public.audit_invoker_view with (security_invoker=true) as select 1 as value; create materialized view public.audit_materialized_view as select 1 as value with no data; grant select on public.audit_unsafe_view, public.audit_invoker_view, public.audit_materialized_view to anon;",
  );
  const output = execFileSync(
    "docker",
    [
      "exec",
      "-i",
      container,
      "psql",
      "-U",
      "postgres",
      "-X",
      "-qAt",
      "-v",
      "ON_ERROR_STOP=1",
    ],
    { input: query, encoding: "utf8", timeout: 15000, maxBuffer: 65536 },
  );
  const versions = readdirSync(
    new URL("../supabase/migrations/", import.meta.url),
  )
    .filter((n) => n.endsWith(".sql"))
    .map((n) => n.slice(0, 14));
  const report = safeDatabaseReport(JSON.parse(output), versions);
  assert.equal(report.passed, false);
  assert.ok(report.tablesWithoutRls.includes("profiles"));
  assert.ok(report.browserUnsafeReadRelations.includes("audit_unsafe_view"));
  assert.ok(
    report.browserUnsafeReadRelations.includes("audit_materialized_view"),
  );
  assert.ok(!report.browserUnsafeReadRelations.includes("audit_invoker_view"));
  assert.ok(
    report.browserWriteGrants.some(
      (g) =>
        g.role === "anon" && g.table === "profiles" && g.privilege === "UPDATE",
    ),
  );
  const restored = execFileSync(
    "docker",
    [
      "exec",
      container,
      "psql",
      "-U",
      "postgres",
      "-X",
      "-Atc",
      "select relrowsecurity and not has_table_privilege('anon',oid,'UPDATE') from pg_class where oid='public.profiles'::regclass",
    ],
    { encoding: "utf8" },
  ).trim();
  assert.equal(restored, "t");
  console.log("Local unsafe ACL/RLS fixtures detected and rolled back.");
}
