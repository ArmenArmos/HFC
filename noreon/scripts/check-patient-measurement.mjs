import fs from "node:fs";
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import { persistMeasurement } from "@/lib/patient/measurement-store";
const env = JSON.parse(fs.readFileSync(".superpowers/local-db.json", "utf8"));
const admin = createClient(env.API_URL, env.SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
const { data, error } = await admin.auth.admin.createUser({
  email: `measurement-${Date.now()}@example.invalid`,
  email_confirm: true,
});
assert.ifError(error);
try {
  const input = {
    submissionId: crypto.randomUUID(),
    systolic: 134,
    diastolic: 82,
    pulse: 72,
    measuredAt: new Date().toISOString(),
  };
  await persistMeasurement(admin, data.user.id, input);
  await persistMeasurement(admin, data.user.id, input);
  await assert.rejects(() =>
    persistMeasurement(admin, data.user.id, { ...input, systolic: 140 }),
  );
  const records = await admin
    .from("patient_measurements")
    .select("systolic")
    .eq("user_id", data.user.id);
  assert.deepEqual(records.data, [{ systolic: 134 }]);
  console.log(
    "Measurement persistence: identical replay accepted; changed replay rejected.",
  );
} finally {
  await admin.auth.admin.deleteUser(data.user.id);
}
