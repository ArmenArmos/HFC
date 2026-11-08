// BC-04: a retry can overtake a slow first request (the first read as failed after its timeout and the server is still
// working), so both reach the database at once. Two real sessions, a held transaction and no timing guess: the retry
// waits for the first and answers with its row; if the first rolls back, the retry stores it. Fictional data, removed
// afterwards; the settings row is restored.
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";

const container = process.env.NOREON_TEST_DB_CONTAINER;
const isolatedCi = process.env.GITHUB_ACTIONS === "true" && (process.env.RUNNER_ENVIRONMENT === "github-hosted" || (process.env.RUNNER_ENVIRONMENT === "self-hosted" && process.env.NOREON_ISOLATED_CI_RUNNER === "noreon-ci")) && process.env.GITHUB_REPOSITORY === "noreon-health/noreon-core";
if (!container?.startsWith("supabase_db_") || (container === "supabase_db_noreon-core" && !isolatedCi)) throw Error("Set NOREON_TEST_DB_CONTAINER to an isolated local Supabase container; the local primary database is forbidden outside isolated CI.");
const sql = (text: string) => execFileSync("docker", ["exec", "-i", container, "psql", "-U", "postgres", "-X", "-At", "-v", "ON_ERROR_STOP=1"], { input: text, encoding: "utf8" }).trim();

class Session {
  name: string; buffer = ""; error = ""; check: (() => void) | null = null;
  child = spawn("docker", ["exec", "-i", container!, "psql", "-U", "postgres", "-X", "-At", "-v", "ON_ERROR_STOP=1"], { stdio: ["pipe", "pipe", "pipe"] });
  constructor(name: string) {
    this.name = name;
    this.child.stdout.on("data", c => { this.buffer += c; this.check?.(); });
    this.child.stderr.on("data", c => { this.error += c; });
  }
  run(text: string, ms = 10000): Promise<string> {
    const marker = `done_${randomUUID().replaceAll("-", "")}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(Error(`timeout ${this.name}: ${this.error}`)), ms);
      this.check = () => { if (this.buffer.includes(marker)) { clearTimeout(timer); this.check = null; const out = this.buffer.replace(marker, "").trim(); this.buffer = ""; resolve(out); } };
      this.child.stdin.write(`${text}\n\\echo ${marker}\n`);
    });
  }
  close() { this.child.stdin.end("rollback;\n\\q\n"); }
}

const m = randomUUID();
const enabled = sql("select enabled from public.member_medicine_settings where singleton;");
const add = (id: string) => `select public.member_medicine_add('Fictional race add','1 tablet',array['08:00'::time],'${id}'::uuid)`;
const rows = () => sql(`select count(*) from public.member_medicines where user_id='${m}';`);
let a: Session | undefined, b: Session | undefined;
try {
  sql(`set session_replication_role=replica;
insert into auth.users(id,phone,phone_confirmed_at) values('${m}','37499'||floor(random()*9000000+1000000)::text,now());
insert into public.profiles(id,locale,display_name) values('${m}','en','Fictional race member') on conflict(id) do update set display_name=excluded.display_name;
reset session_replication_role;
update public.member_medicine_settings set enabled=true;`);
  a = new Session("first"); b = new Session("retry");
  const asMember = `set statement_timeout='8s';select set_config('request.jwt.claims',jsonb_build_object('sub','${m}','role','authenticated')::text,false);set role authenticated;`;
  await a.run(asMember); await b.run(asMember);

  // The first holds its transaction open with the medicine stored; the retry of the same request arrives meanwhile.
  const committed = randomUUID();
  await a.run("begin;");
  const first = JSON.parse(await a.run(`${add(committed)};`)) as { status: string; id: string };
  assert.equal(first.status, "added", a.error);
  let answered = false;
  const retry = b.run(`${add(committed)};`).then(out => { answered = true; return out; });
  // pg_locks shows the retry waiting on the member's lock: a fact, not a sleep.
  for (let i = 0; i < 200 && sql("select count(*) from pg_locks where locktype='advisory' and not granted;") === "0"; i++) await new Promise(r => setTimeout(r, 25));
  assert.equal(sql("select count(*) from pg_locks where locktype='advisory' and not granted;"), "1", "the retry waits for the first request");
  assert.equal(answered, false);
  await a.run("commit;");
  const second = JSON.parse(await retry) as { status: string; id: string };
  assert.deepEqual(second, first, "the retry answers with the first request's row");
  assert.equal(rows(), "1", "one row, so one set of reminders");

  // A first request that rolled back stored nothing, so the retry is the one that stores it.
  const rolled = randomUUID();
  await a.run("begin;");
  await a.run(`${add(rolled)};`);
  const after = b.run(`${add(rolled)};`);
  for (let i = 0; i < 200 && sql("select count(*) from pg_locks where locktype='advisory' and not granted;") === "0"; i++) await new Promise(r => setTimeout(r, 25));
  await a.run("rollback;");
  assert.equal((JSON.parse(await after) as { status: string }).status, "added");
  assert.equal(rows(), "2");
} finally {
  a?.close(); b?.close();
  sql(`delete from public.member_medicines where user_id='${m}';delete from public.profiles where id='${m}';delete from auth.users where id='${m}';
update public.member_medicine_settings set enabled=${enabled === "t"};`);
}
console.log("Medicine add replay concurrency checks passed.");
