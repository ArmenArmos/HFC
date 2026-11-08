// Astra MED-03: Zoe's medicine ask must never delay or roll back the member's tick. Two real sessions: one holds the
// member's ask lock (as the sweep does) or the open ask row; the other ticks under a short statement timeout and must
// commit at once, on both tick paths (the member's own medicine RPC and a care-plan dose row). Fictional data, removed
// afterwards; the settings rows are restored.
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";

const container = process.env.NOREON_TEST_DB_CONTAINER;
const isolatedCi = process.env.GITHUB_ACTIONS === "true" && (process.env.RUNNER_ENVIRONMENT === "github-hosted" || (process.env.RUNNER_ENVIRONMENT === "self-hosted" && process.env.NOREON_ISOLATED_CI_RUNNER === "noreon-ci")) && process.env.GITHUB_REPOSITORY === "noreon-health/noreon-core";
if (!container?.startsWith("supabase_db_") || (container === "supabase_db_noreon-core" && !isolatedCi)) throw Error("Set NOREON_TEST_DB_CONTAINER to an isolated local Supabase container.");
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

const m = randomUUID(), med = randomUUID(), plan = randomUUID(), pmed = randomUUID();
const saved = sql(`select jsonb_build_object('m',(select to_jsonb(s)-'updated_at'-'singleton' from public.member_medicine_settings s),
 'z',(select jsonb_build_object('c',consent_collection_enabled,'v',consent_wording_version) from public.zoe_settings where singleton))::text;`);
const prior = JSON.parse(saved) as { m: { enabled: boolean; reminders: boolean; asks: boolean }; z: { c: boolean; v: string | null } | null };
const due = (days: number) => `((now() at time zone 'Asia/Yerevan')::date-${days}+time '08:00') at time zone 'Asia/Yerevan'`;
let a: Session | undefined, b: Session | undefined;
try {
  sql(`set session_replication_role=replica;
insert into auth.users(id,phone,phone_confirmed_at) values('${m}','37499'||floor(random()*9000000+1000000)::text,now());
insert into public.profiles(id,locale,display_name) values('${m}','en','Fictional race member') on conflict(id) do update set display_name=excluded.display_name;
insert into public.member_medicines(id,user_id,name,times,started_on) values('${med}','${m}','Fictional race medicine',array['08:00'::time],(now() at time zone 'Asia/Yerevan')::date-3);
insert into public.patient_care_plans(id,user_id,clinician,instructions,active,published_at) values('${plan}','${m}','Fictional','Fictional',true,now()-interval '5 days');
insert into public.patient_care_medications(id,user_id,plan_id,name,dose,instructions,times,start_date) values('${pmed}','${m}','${plan}','Fictional plan race medicine','1','Fictional',array['08:00'::time],(now() at time zone 'Asia/Yerevan')::date-5);
insert into public.zoe_settings(singleton,consent_collection_enabled,consent_wording_version) values(true,true,'zoe-consent-race-1')
 on conflict(singleton) do update set consent_collection_enabled=true,consent_wording_version='zoe-consent-race-1';
insert into public.zoe_consents(member_id,kind,granted,wording_version,source) values('${m}','zoe_reads_messages',true,'zoe-consent-race-1','settings');
reset session_replication_role;
update public.member_medicine_settings set enabled=true,asks=true;`);
  a = new Session("holder"); b = new Session("member");
  const asMember = `set statement_timeout='3s';select set_config('request.jwt.claims',jsonb_build_object('sub','${m}','role','authenticated')::text,false);set role authenticated;`;
  await b.run(asMember);

  // 1. The sweep (or another tick) holds the member's ask lock: a skip still saves at once; no ask opens now.
  await a.run(`begin;select pg_advisory_xact_lock(hashtextextended('medicine-ask:${m}',0));`);
  const t1 = Date.now();
  const r1 = await b.run(`select public.member_medicine_dose_report('${med}',${due(1)},'skipped',0)->>'status';`, 5000);
  assert.equal(r1, "saved", `skip under a held ask lock: ${r1} ${b.error}`);
  assert.ok(Date.now() - t1 < 2500, "the skip did not wait for the ask lock");
  assert.equal(sql(`select count(*) from public.member_medicine_asks where user_id='${m}';`), "0", "lock busy: no ask opened now");
  await a.run("rollback;");

  // 2. Lock free: the next skip opens the ask.
  const r2 = await b.run(`select public.member_medicine_dose_report('${med}',${due(2)},'skipped',0)->>'status';`, 5000);
  assert.equal(r2, "saved");
  const ask = sql(`select id from public.member_medicine_asks where user_id='${m}' and state='open';`);
  assert.match(ask, /^[0-9a-f-]{36}$/, "an ask opened");

  // 3. Another transaction holds the open ask row: correcting the dose to taken still saves at once.
  await a.run(`begin;select 1 from public.member_medicine_asks where id='${ask}' for update;`);
  const t3 = Date.now();
  const r3 = await b.run(`select public.member_medicine_dose_report('${med}',${due(2)},'taken',1)->>'status';`, 5000);
  assert.equal(r3, "saved", `taken under a held ask row: ${r3} ${b.error}`);
  assert.ok(Date.now() - t3 < 2500, "the correction did not wait for the ask row");
  await a.run("rollback;");

  // 4. The care-plan tick path (patient_dose_events) under a held ask lock: the row commits at once.
  await b.run("reset role;");
  await a.run(`begin;select pg_advisory_xact_lock(hashtextextended('medicine-ask:${m}',0));`);
  const t4 = Date.now();
  await b.run(`insert into public.patient_dose_events(user_id,medication_id,due_at,status) values('${m}','${pmed}',${due(1)},'skipped');`, 5000);
  assert.ok(Date.now() - t4 < 2500, "the plan tick did not wait for the ask lock");
  assert.equal(sql(`select count(*) from public.patient_dose_events where user_id='${m}';`), "1", "the plan tick committed");
  await a.run("rollback;");

  // 5. The care-plan path with the open ask row held: correcting the plan dose to taken commits at once.
  await b.run(`insert into public.patient_dose_events(user_id,medication_id,due_at,status) values('${m}','${pmed}',${due(2)},'skipped');`, 5000);
  const planAsk = sql(`select id from public.member_medicine_asks where user_id='${m}' and source='plan' and state='open';`);
  assert.match(planAsk, /^[0-9a-f-]{36}$/, "a plan ask opened");
  await a.run(`begin;select 1 from public.member_medicine_asks where id='${planAsk}' for update;`);
  const t5 = Date.now();
  await b.run(`update public.patient_dose_events set status='taken' where user_id='${m}' and medication_id='${pmed}' and due_at=${due(2)};`, 5000);
  assert.ok(Date.now() - t5 < 2500, "the plan correction did not wait for the ask row");
  assert.equal(sql(`select status from public.patient_dose_events where user_id='${m}' and medication_id='${pmed}' and due_at=${due(2)};`), "taken");
  await a.run("rollback;");
  console.log("Medicine asks never delay a tick: held ask lock and held ask row, on both own and care-plan medicines.");
} finally {
  a?.close(); b?.close();
  sql(`delete from public.member_medicine_asks where user_id='${m}';delete from public.patient_dose_events where user_id='${m}';
delete from public.member_medicine_doses where user_id='${m}';delete from public.member_medicines where user_id='${m}';
delete from public.patient_care_medications where user_id='${m}';delete from public.patient_care_plans where user_id='${m}';
set session_replication_role=replica;delete from public.zoe_consents where member_id='${m}';delete from public.profiles where id='${m}';delete from auth.users where id='${m}';reset session_replication_role;
update public.member_medicine_settings set enabled=${prior.m.enabled},reminders=${prior.m.reminders},asks=${prior.m.asks};
${prior.z ? `set session_replication_role=replica;update public.zoe_settings set consent_collection_enabled=${prior.z.c},consent_wording_version=${prior.z.v === null ? "null" : `'${prior.z.v}'`};reset session_replication_role;` : "set session_replication_role=replica;delete from public.zoe_settings;reset session_replication_role;"}`);
}
