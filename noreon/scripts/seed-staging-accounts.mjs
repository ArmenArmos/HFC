// Fictional test accounts for the staging site (staging.noreon.health) only: admin, doctor, nurse and
// clinic admin by email and password, plus the test phone numbers for members (Supabase test one-time
// codes, no SMS). Run with the staging project's URL and service key; refuses any other project.
//   NOREON_WORKSPACE_SUPABASE_URL=https://homqzwzrskgnizbycvhq.supabase.co NOREON_WORKSPACE_SERVICE_ROLE_KEY=... node scripts/seed-staging-accounts.mjs
// Credentials go to ~/.noreon/staging-test-credentials.json (mode 600, outside the repository), never to output.
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const url = process.env.NOREON_WORKSPACE_SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.NOREON_WORKSPACE_SERVICE_ROLE_KEY;
// The one project this may write to, fixed here and not taken from the caller (Astra R1).
const STAGING_ORIGIN = "https://homqzwzrskgnizbycvhq.supabase.co";
if (!url || !serviceKey) throw new Error("Set NOREON_WORKSPACE_SUPABASE_URL and NOREON_WORKSPACE_SERVICE_ROLE_KEY");
if (new URL(url).origin !== STAGING_ORIGIN) throw new Error("Refusing: this script writes only to the noreon-staging project");
const credentialPath = path.resolve(process.env.NOREON_STAGING_CREDENTIALS_FILE ?? path.join(os.homedir(), ".noreon", "staging-test-credentials.json"));
if (credentialPath.startsWith(`${path.resolve(process.cwd())}${path.sep}`)) throw new Error("Credential file must be outside the repository");

const people = {
  admin: { email: "staging-admin@example.invalid", name: "Staging Admin" },
  doctor: { email: "staging-doctor@example.invalid", name: "Staging Doctor" },
  nurse: { email: "staging-nurse@example.invalid", name: "Staging Nurse" },
  clinic: { email: "staging-clinic@example.invalid", name: "Staging Clinic Admin" },
};
const generatedPassword = () => `${crypto.randomBytes(24).toString("base64url")}aA1!`;
let credentials = {};
try { credentials = JSON.parse(await fs.readFile(credentialPath, "utf8")); } catch { /* first run */ }
for (const [kind, p] of Object.entries(people)) {
  if (credentials[kind]?.email !== p.email) credentials[kind] = { email: p.email, password: generatedPassword() };
}
// Member test phones: Supabase test one-time code is set in the project's Auth settings (docs/operations/staging-site.md).
credentials.members = credentials.members ?? [
  { phone: "+37499000101", code: "424242" },
  { phone: "+37499000102", code: "424242" },
  { phone: "+37499000103", code: "424242" },
  { phone: "+37499000104", code: "424242" },
  { phone: "+37499000105", code: "424242" },
  { phone: "+37499000106", code: "424242" },
];
await fs.mkdir(path.dirname(credentialPath), { recursive: true, mode: 0o700 });
await fs.chmod(path.dirname(credentialPath), 0o700);
await fs.writeFile(credentialPath, `${JSON.stringify(credentials, null, 2)}\n`, { mode: 0o600 });
await fs.chmod(credentialPath, 0o600);

const db = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
async function findUser(email) {
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error("Could not list accounts");
    const found = data.users.find((user) => user.email?.toLowerCase() === email);
    if (found) return found;
    if (data.users.length < 1000) return null;
  }
  return null;
}
async function upsertUser(kind) {
  const { email, password } = credentials[kind];
  const current = await findUser(email);
  if (current) {
    const { data, error } = await db.auth.admin.updateUserById(current.id, { password, email_confirm: true });
    if (error || !data.user) throw new Error(`Could not prepare ${kind}`);
    return data.user;
  }
  const { data, error } = await db.auth.admin.createUser({ email, password, email_confirm: true });
  if (error || !data.user) throw new Error(`Could not create ${kind}`);
  return data.user;
}
// Member phone accounts (their one-time codes are Supabase test codes set in the project's Auth settings: 37499000101..106=424242).
for (const { phone } of credentials.members) {
  const { data, error } = await db.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (error) throw new Error("Could not list accounts");
  if (!data.users.some((u) => u.phone === phone.slice(1))) {
    const created = await db.auth.admin.createUser({ phone, phone_confirm: true });
    if (created.error) throw new Error(`Could not create member ${phone}`);
  }
}
const must = (error, what) => { if (error) throw new Error(`${what}: ${error.message}`); };

const { data: clinics, error: ce } = await db.from("workspace_clinics").select("id").eq("name", "Staging Clinic").limit(1);
must(ce, "clinic lookup");
let clinicId = clinics[0]?.id;
if (!clinicId) {
  const { data, error } = await db.from("workspace_clinics").insert({ name: "Staging Clinic", address: "Fictional test location", active: true }).select("id").single();
  must(error, "clinic create");
  clinicId = data.id;
}
const users = Object.fromEntries(await Promise.all(Object.keys(people).map(async (k) => [k, await upsertUser(k)])));
must((await db.from("workspace_staff").upsert({ user_id: users.admin.id, role: "admin", display_name: people.admin.name, clinic_id: null, active: true })).error, "admin");
must((await db.from("workspace_staff").upsert({ user_id: users.doctor.id, role: "doctor", display_name: people.doctor.name, clinic_id: clinicId, active: true })).error, "doctor");
must((await db.from("workspace_staff").upsert({ user_id: users.nurse.id, role: "nurse", display_name: people.nurse.name, clinic_id: clinicId, active: true })).error, "nurse");
// The clinic admin's membership is a table the service role cannot write: scripts/seed-staging-clinic-admin.sql, run with psql afterwards.
process.stdout.write(`Seeded staging accounts. Credentials saved to ${credentialPath}\n`);
