import fs from "node:fs";
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
const env = JSON.parse(fs.readFileSync(".superpowers/local-db.json", "utf8"));
const admin = createClient(env.API_URL, env.SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
const users = [];
try {
  for (let i = 0; i < 2; i++) {
    const { data, error } = await admin.auth.admin.createUser({
      email: `patient-test-${Date.now()}-${i}@example.invalid`,
      email_confirm: true,
    });
    assert.ifError(error);
    users.push(data.user);
  }
  const profile = {
    p_user_id: users[0].id,
    p_name: "Test member",
    p_birth_date: "1974-05-18",
    p_sex: "male",
    p_locale: "en",
    p_consent_version: "patient-pilot-v1",
    p_answers: {},
    p_expected_revision: -1,
    p_urgent_rule: null,
  };
  const { error: saveError } = await admin.rpc("save_patient_profile", profile);
  assert.ifError(saveError);
  const clients = [];
  for (const u of users) {
    const { data, error } = await admin.auth.admin.generateLink({
      type: "magiclink",
      email: u.email,
    });
    assert.ifError(error);
    const client = createClient(env.API_URL, env.ANON_KEY, {
      auth: { persistSession: false },
    });
    const result = await client.auth.verifyOtp({
      token_hash: data.properties.hashed_token,
      type: "magiclink",
    });
    assert.ifError(result.error);
    clients.push(client);
  }
  const own = await clients[0].from("patient_assessments").select("*");
  assert.ifError(own.error);
  assert.equal(own.data.length, 1);
  const other = await clients[1]
    .from("patient_assessments")
    .select("*")
    .eq("user_id", users[0].id);
  assert.ifError(other.error);
  assert.equal(other.data.length, 0);
  const forged = await clients[0].rpc("save_patient_assessment", {
    p_user_id: users[1].id,
    p_expected_revision: 0,
    p_answers: {},
    p_complete: true,
    p_urgent_rule: null,
  });
  assert.ok(forged.error);
  const direct = await clients[0]
    .from("patient_assessments")
    .update({ completed_at: new Date().toISOString() })
    .eq("user_id", users[0].id);
  assert.ok(direct.error);
  const first = await admin.rpc("save_patient_assessment", {
    p_user_id: users[0].id,
    p_expected_revision: 0,
    p_answers: {},
    p_complete: false,
    p_urgent_rule: null,
  });
  assert.ifError(first.error);
  assert.equal(first.data, 1);
  const stale = await admin.rpc("save_patient_assessment", {
    p_user_id: users[0].id,
    p_expected_revision: 0,
    p_answers: {},
    p_complete: true,
    p_urgent_rule: null,
  });
  assert.ifError(stale.error);
  assert.equal(stale.data, -1);
  const completed = await admin.rpc("save_patient_assessment", {
    p_user_id: users[0].id,
    p_expected_revision: 1,
    p_answers: {},
    p_complete: true,
    p_urgent_rule: null,
  });
  assert.ifError(completed.error);
  assert.ifError(
    (
      await admin.rpc("save_patient_profile", {
        ...profile,
        p_name: "Renamed member",
        p_expected_revision: 2,
      })
    ).error,
  );
  const renamed = await admin
    .from("patient_assessments")
    .select("completed_at")
    .eq("user_id", users[0].id)
    .single();
  assert.ok(
    renamed.data.completed_at,
    "A name-only change must preserve completed questionnaire",
  );
  const staleProfile = await admin.rpc("save_patient_profile", {
    ...profile,
    p_name: "Stale name",
    p_expected_revision: 2,
  });
  assert.ifError(staleProfile.error);
  assert.equal(staleProfile.data, -1);
  const unchanged = await admin
    .from("profiles")
    .select("display_name")
    .eq("id", users[0].id)
    .single();
  assert.equal(unchanged.data.display_name, "Renamed member");
  assert.ifError(
    (
      await admin.rpc("save_patient_profile", {
        ...profile,
        p_birth_date: "1975-05-18",
        p_expected_revision: 3,
      })
    ).error,
  );
  const changedClinical = await admin
    .from("patient_assessments")
    .select("completed_at")
    .eq("user_id", users[0].id)
    .single();
  assert.equal(changedClinical.data.completed_at, null);
  const reading = {
    user_id: users[0].id,
    submission_id: crypto.randomUUID(),
    systolic: 134,
    diastolic: 82,
    pulse: 72,
    measured_at: new Date().toISOString(),
  };
  assert.ifError(
    (await admin.from("patient_measurements").insert(reading)).error,
  );
  assert.ok((await admin.from("patient_measurements").insert(reading)).error);
  const measurements = await clients[1]
    .from("patient_measurements")
    .select("*")
    .eq("user_id", users[0].id);
  assert.ifError(measurements.error);
  assert.equal(measurements.data.length, 0);
  console.log(
    "Patient database: owner isolation, server-only writes, revision conflicts and duplicate protection pass.",
  );
} finally {
  for (const u of users) await admin.auth.admin.deleteUser(u.id);
}
