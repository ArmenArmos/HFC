import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const url = process.env.NOREON_WORKSPACE_SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.NOREON_WORKSPACE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) throw new Error("Set NOREON_WORKSPACE_SUPABASE_URL and NOREON_WORKSPACE_SERVICE_ROLE_KEY");
const credentialPath = path.resolve(process.env.NOREON_STAFF_CREDENTIALS_FILE ?? path.join(os.homedir(), ".noreon", "staff-test-credentials.json"));
const repoRoot = path.resolve(process.cwd());
if (credentialPath === repoRoot || credentialPath.startsWith(`${repoRoot}${path.sep}`)) {
  throw new Error("Credential file must be outside the repository");
}

const identities = {
  admin: { email: (process.env.NOREON_STAFF_ADMIN_EMAIL ?? "workspace-admin@example.invalid").toLowerCase(), name: "Workspace administrator" },
  doctor: { email: (process.env.NOREON_STAFF_DOCTOR_EMAIL ?? "workspace-doctor@example.invalid").toLowerCase(), name: "Test doctor" },
};
const generatedPassword = () => `${crypto.randomBytes(24).toString("base64url")}aA1!`;
let credentials;
try {
  credentials = JSON.parse(await fs.readFile(credentialPath, "utf8"));
} catch {
  credentials = null;
}
if (!credentials || credentials.admin?.email !== identities.admin.email || credentials.doctor?.email !== identities.doctor.email) {
  credentials = {
    admin: { email: identities.admin.email, password: generatedPassword() },
    doctor: { email: identities.doctor.email, password: generatedPassword() },
  };
}

await fs.mkdir(path.dirname(credentialPath), { recursive: true, mode: 0o700 });
await fs.chmod(path.dirname(credentialPath), 0o700);
await fs.writeFile(credentialPath, `${JSON.stringify(credentials, null, 2)}\n`, { mode: 0o600 });
await fs.chmod(credentialPath, 0o600);

const db = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });

async function findUser(email) {
  for (let page = 1; page <= 100; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error("Could not inspect workspace accounts");
    const found = data.users.find((user) => user.email?.toLowerCase() === email);
    if (found) return found;
    if (data.users.length < 1000) return null;
  }
  throw new Error("Workspace account list exceeded safety limit");
}

async function upsertUser(kind) {
  const { email, password } = credentials[kind];
  const current = await findUser(email);
  if (current) {
    const { data, error } = await db.auth.admin.updateUserById(current.id, { password, email_confirm: true });
    if (error || !data.user) throw new Error(`Could not prepare ${kind} account`);
    return data.user;
  }
  const { data, error } = await db.auth.admin.createUser({ email, password, email_confirm: true });
  if (error || !data.user) throw new Error(`Could not create ${kind} account`);
  return data.user;
}

async function run() {
  const { data: clinics, error: clinicReadError } = await db.from("workspace_clinics").select("id").eq("name", "Noreon Test Clinic").order("created_at").limit(1);
  if (clinicReadError) throw new Error("Could not inspect test clinic");
  let clinicId = clinics[0]?.id;
  if (!clinicId) {
    const { data, error } = await db.from("workspace_clinics").insert({ name: "Noreon Test Clinic", address: "Fictional test location", active: true }).select("id").single();
    if (error || !data) throw new Error("Could not create test clinic");
    clinicId = data.id;
  } else {
    const { error } = await db.from("workspace_clinics").update({ address: "Fictional test location", active: true }).eq("id", clinicId);
    if (error) throw new Error("Could not activate test clinic");
  }

  const adminUser = await upsertUser("admin");
  const doctorUser = await upsertUser("doctor");
  const { error: adminError } = await db.from("workspace_staff").upsert({ user_id: adminUser.id, role: "admin", display_name: identities.admin.name, clinic_id: null, active: true });
  if (adminError) throw new Error("Could not seed administrator membership");
  const { error: doctorError } = await db.from("workspace_staff").upsert({ user_id: doctorUser.id, role: "doctor", display_name: identities.doctor.name, clinic_id: clinicId, active: true });
  if (doctorError) throw new Error("Could not seed doctor membership");
  process.stdout.write(`Seeded staff accounts. Credentials saved to ${credentialPath}\n`);
}

await run();
