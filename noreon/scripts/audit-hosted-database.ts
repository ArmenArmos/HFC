/** Catalog metadata only. Never log raw process output or credentials. */
import { spawnSync } from "node:child_process";
import { readdirSync, appendFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
class DatabaseAuditFailure extends Error {
  readonly reason: string;
  constructor(reason: string) {
    super("Hosted database audit unavailable");
    this.reason = reason;
  }
}
type Environment = Record<string, string | undefined>;
export function databaseAuditConfig(env: Environment) {
  if (env.GITHUB_ACTIONS !== "true" || env.GITHUB_REF !== "refs/heads/main")
    throw new DatabaseAuditFailure("execution_context");
  if (
    !/^[a-z0-9]{20}$/.test(env.SUPABASE_PROJECT_ID ?? "") ||
    env.SUPABASE_POOLER_HOST !== "aws-0-eu-central-1.pooler.supabase.com" ||
    !env.SUPABASE_DB_PASSWORD
  )
    throw new DatabaseAuditFailure("invalid_configuration");
  return {
    PATH: env.PATH ?? process.env.PATH ?? "",
    LANG: "C",
    NODE_ENV: "production" as const,
    PGHOST: env.SUPABASE_POOLER_HOST,
    PGPORT: "5432",
    PGDATABASE: "postgres",
    PGUSER: `postgres.${env.SUPABASE_PROJECT_ID}`,
    PGPASSWORD: env.SUPABASE_DB_PASSWORD,
    PGSSLMODE: "require",
    PGCONNECT_TIMEOUT: "10",
    PGOPTIONS:
      "-c default_transaction_read_only=on -c statement_timeout=5000 -c lock_timeout=1000 -c search_path=pg_catalog",
  };
}
const identifier = /^[a-z_][a-z0-9_]{0,62}$/;
const listFields = [
  "tablesWithoutRls",
  "browserUnsafeReadRelations",
  "browserSchemaCreate",
  "browserBypassRls",
  "definersWithoutSearchPath",
  "definersWithNonEmptySearchPath",
  "migrationVersions",
] as const;
const privileges = [
  "INSERT",
  "UPDATE",
  "DELETE",
  "TRUNCATE",
  "TRIGGER",
  "REFERENCES",
  "MAINTAIN",
];
function invalid(): never {
  throw new DatabaseAuditFailure("invalid_payload");
}
function object(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) invalid();
  return raw as Record<string, unknown>;
}
function keys(row: Record<string, unknown>, allowed: string[]) {
  if (
    Object.keys(row).length !== allowed.length ||
    Object.keys(row).some((k) => !allowed.includes(k))
  )
    invalid();
}
export function safeDatabaseReport(raw: unknown, expectedVersions: string[]) {
  const input = object(raw);
  keys(input, [
    ...listFields,
    "serverVersionNum",
    "browserWriteGrants",
    "unsafeDefaultGrants",
    "requiredReads",
    "unbudgetedBeginCallable",
  ]);
  if (
    !Number.isSafeInteger(input.serverVersionNum) ||
    Number(input.serverVersionNum) < 100000
  )
    invalid();
  const lists: Record<(typeof listFields)[number], string[]> =
    Object.fromEntries(
      listFields.map((field) => {
        const value = input[field];
        if (
          !Array.isArray(value) ||
          value.length > 5000 ||
          value.some(
            (item) =>
              typeof item !== "string" ||
              !(field === "migrationVersions" ? /^\d{14}$/ : identifier).test(
                item,
              ),
          )
        )
          invalid();
        if (
          field === "migrationVersions" &&
          new Set(value).size !== value.length
        )
          invalid();
        return [field, value as string[]];
      }),
    ) as Record<(typeof listFields)[number], string[]>;
  const grantList = (name: "browserWriteGrants" | "unsafeDefaultGrants") => {
    const value = input[name];
    if (!Array.isArray(value) || value.length > 5000) invalid();
    return value.map((entry) => {
      const item = object(entry);
      keys(
        item,
        name === "browserWriteGrants"
          ? ["role", "table", "privilege"]
          : ["role", "owner", "schema", "privilege"],
      );
      if (
        !["anon", "authenticated"].includes(String(item.role)) ||
        !privileges.includes(String(item.privilege))
      )
        invalid();
      if (name === "browserWriteGrants") {
        if (typeof item.table !== "string" || !identifier.test(item.table))
          invalid();
      } else if (
        !["all", "public"].includes(String(item.schema)) ||
        typeof item.owner !== "string" ||
        !identifier.test(item.owner)
      )
        invalid();
      return item;
    });
  };
  const browserWriteGrants = grantList("browserWriteGrants"),
    unsafeDefaultGrants = grantList("unsafeDefaultGrants");
  const reads = object(input.requiredReads);
  keys(reads, ["profile", "measurements", "workspace"]);
  if (Object.values(reads).some((v) => typeof v !== "boolean")) invalid();
  if (
    input.unbudgetedBeginCallable !== null &&
    typeof input.unbudgetedBeginCallable !== "boolean"
  )
    invalid();
  if (
    !expectedVersions.length ||
    expectedVersions.some((v) => !/^\d{14}$/.test(v))
  )
    invalid();
  const migrationsMatch =
    JSON.stringify([...lists.migrationVersions].sort()) ===
    JSON.stringify([...expectedVersions].sort());
  const passed =
    !lists.tablesWithoutRls.length &&
    !lists.browserUnsafeReadRelations.length &&
    !lists.browserSchemaCreate.length &&
    !lists.browserBypassRls.length &&
    !lists.definersWithoutSearchPath.length &&
    !browserWriteGrants.length &&
    !unsafeDefaultGrants.length &&
    Object.values(reads).every((v) => v === true) &&
    input.unbudgetedBeginCallable === false &&
    migrationsMatch;
  return {
    passed,
    serverVersionNum: input.serverVersionNum,
    ...lists,
    browserWriteGrants,
    unsafeDefaultGrants,
    requiredReads: reads,
    unbudgetedBeginCallable: input.unbudgetedBeginCallable,
    migrationsMatch,
    scope:
      "Catalog metadata only. RLS enabled does not prove ownership predicates. Non-empty explicit definer search paths require source review. No member records read or settings changed.",
  };
}
type Runner = (
  command: string,
  args: string[],
  options: {
    env: ReturnType<typeof databaseAuditConfig>;
    encoding: "utf8";
    timeout: number;
    maxBuffer: number;
  },
) => {
  status: number | null;
  stdout?: string | null;
  stderr?: string | null;
  error?: unknown;
};
export function runDatabaseAudit(
  env: Environment,
  versions: string[],
  run: Runner = (command, args, options) => spawnSync(command, args, options),
) {
  const config = databaseAuditConfig(env);
  let result;
  try {
    result = run(
      "psql",
      [
        "--no-psqlrc",
        "--no-password",
        "--tuples-only",
        "--no-align",
        "--quiet",
        "--set",
        "ON_ERROR_STOP=1",
        "--file",
        fileURLToPath(new URL("./audit-hosted-database.sql", import.meta.url)),
      ],
      { env: config, encoding: "utf8", timeout: 30000, maxBuffer: 65536 },
    );
  } catch {
    throw new DatabaseAuditFailure("query_failed");
  }
  if (result.error || result.status !== 0)
    throw new DatabaseAuditFailure("query_failed");
  if (
    typeof result.stdout !== "string" ||
    Buffer.byteLength(result.stdout) > 65536
  )
    throw new DatabaseAuditFailure("invalid_payload");
  let raw;
  try {
    raw = JSON.parse(result.stdout);
  } catch {
    throw new DatabaseAuditFailure("invalid_payload");
  }
  return safeDatabaseReport(raw, versions);
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const versions = readdirSync(
      new URL("../supabase/migrations/", import.meta.url),
    )
      .filter((n) => /^\d{14}_.+\.sql$/.test(n))
      .map((n) => n.slice(0, 14));
    const report = runDatabaseAudit(process.env, versions),
      text = JSON.stringify(report, null, 2);
    console.log(text);
    if (process.env.GITHUB_STEP_SUMMARY)
      appendFileSync(
        process.env.GITHUB_STEP_SUMMARY,
        `## Hosted database metadata audit\n\n\`\`\`json\n${text}\n\`\`\`\n`,
      );
    if (!report.passed) process.exitCode = 2;
  } catch (error) {
    console.error(
      `Hosted database audit unavailable: ${error instanceof DatabaseAuditFailure ? error.reason : "execution_failed"}. No raw database output was logged.`,
    );
    process.exitCode = 1;
  }
}
