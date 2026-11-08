// Fictional people and settings for the suite. Seeds prerequisites only, never the outcome a test asserts.
import { readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { dirname, join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { fixtureId as id, sql } from "./db.mjs";
import { telegramPeople } from "./telegram/config.mjs";

const envPath = process.env.NOREON_E2E_ENV;
const env = JSON.parse(readFileSync(envPath, "utf8"));
const admin = createClient(env.api, env.service, { auth: { persistSession: false, autoRefreshToken: false } });
const answers = readFileSync(new URL("../scripts/fixtures/patient-answers.json", import.meta.url), "utf8").replaceAll("'", "''");

const people = {
  doctor: [1], otherDoctor: [2], nurse: [3], admin: [4],
  ldlMember: [11, "37499000211", "hy"], otherMember: [12, "37499000212", "en"],
  zoeHy: [13, "37499000213", "hy"], zoeEn: [14, "37499000214", "en"],
  previewHy: [15, "37499000202", "hy"], previewEn: [16, "37499000203", "en"],
  regimenMember: [17, "37499000217", "en"],
  ...(process.env.NOREON_E2E_SUITE === "telegram" ? telegramPeople : {}),
  evidenceIphone: [18, "37499000218", "en"], evidenceGalaxy: [19, "37499000219", "en"],
  zoeLdl: [22, "37499000222", "en"],
  doctorPhoneEn: [23, "37499000223", "en"], doctorPhoneHy: [24, "37499000224", "hy"],
  doctorDesktopEn: [25, "37499000225", "en"], doctorDesktopHy: [26, "37499000226", "hy"],
  doctorUnassigned: [27, "37499000227", "en"],
  chatMember: [28, "37499000228", "en"],
};
const accounts = {};
for (const [name, [n, phone]] of Object.entries(people)) {
  const account = { id: id(n), email: `e2e-${name.toLowerCase()}@example.invalid`, password: `${randomBytes(18).toString("base64url")}aA1!`, phone };
  const made = await admin.auth.admin.createUser({ id: account.id, email: account.email, email_confirm: true, password: account.password, ...(phone ? { phone, phone_confirm: true } : {}), user_metadata: { full_name: `Fictional ${name}` } });
  if (made.error) throw new Error(`${name}: ${made.error.message}`);
  accounts[name] = account;
}
const member = (name, n, locale) => `
update public.profiles set display_name='Fictional ${name}',birth_date=(current_date-interval '52 years 1 month')::date,biological_sex='male',locale='${locale}' where id='${id(n)}';
insert into public.patient_consents(user_id,version) values('${id(n)}','patient-pilot-v1');
insert into public.patient_assessments(user_id,answers,completed_at,assessment_date) values('${id(n)}','${answers}'::jsonb,clock_timestamp(),current_date);
insert into public.patient_clinical_cases(user_id,assigned_doctor_id) values('${id(n)}','${id(1)}');`;
sql(`begin;
insert into public.workspace_clinics(id,name,address) values('${id(20)}','Fictional Clinic North','12 Fictional Avenue, Yerevan');
insert into public.workspace_staff(user_id,role,display_name,clinic_id) values
 ('${id(1)}','doctor','Dr Fictional Hayk','${id(20)}'),('${id(2)}','doctor','Dr Fictional Other','${id(20)}'),('${id(3)}','nurse','Nurse Fictional Ani','${id(20)}');
insert into public.workspace_staff(user_id,role,display_name) values('${id(4)}','admin','Fictional admin');
update public.ldl_goal_settings set ldl_goal_enabled=true where singleton;
insert into public.conversation_policy(singleton,version,grant_seconds,intent_seconds,intake_window_seconds,intake_max_messages) values(true,'e2e-local',600,600,600,10) on conflict(singleton) do nothing;
update public.conversation_policy set app_chat_enabled=true,zoe_chat_actions_enabled=true where singleton;
${process.env.NOREON_E2E_DOCTOR_CHAT === "true" ? "update public.staff_zoe_settings set staff_zoe_enabled=true where singleton;" : ""}
insert into public.member_medicine_settings(singleton,enabled) values(true,true) on conflict(singleton) do update set enabled=true;
${Object.entries(people).filter(([, p]) => p[2]).map(([name, p]) => member(name, p[0], p[2])).join("\n")}
insert into public.patient_measurements(user_id,submission_id,measured_at,systolic,diastolic) values('${id(12)}',gen_random_uuid(),now()-interval '1 hour',131,84);
update public.patient_clinical_cases set assigned_nurse_id='${id(3)}' where user_id='${id(12)}';
update public.patient_clinical_cases set assigned_doctor_id='${id(2)}' where user_id='${id(27)}';
commit;`);
writeFileSync(join(dirname(envPath), "accounts.json"), JSON.stringify(accounts), { mode: 0o600 });
console.log(`Seeded ${Object.keys(accounts).length} fictional accounts`);
