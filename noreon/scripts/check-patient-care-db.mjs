import fs from "node:fs";
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
const env = JSON.parse(fs.readFileSync(process.env.NOREON_TEST_DB_CONFIG ?? ".superpowers/local-db.json", "utf8"));
if (!["127.0.0.1", "localhost", "[::1]"].includes(new URL(env.API_URL).hostname)) throw Error("Use an isolated local Supabase API");
const admin = createClient(env.API_URL, env.SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
const users = [],
  clients = [];
const tables = [
  "patient_care_tests",
  "patient_care_results",
  "patient_care_plans",
  "patient_care_medications",
  "patient_care_appointments",
  "patient_dose_events",
  "patient_dose_event_history",
];
try {
  for (let i = 0; i < 2; i++) {
    const u = await admin.auth.admin.createUser({
      email: `care-${Date.now()}-${i}@example.invalid`,
      email_confirm: true,
    });
    assert.ifError(u.error);
    users.push(u.data.user);
    const link = await admin.auth.admin.generateLink({
      type: "magiclink",
      email: u.data.user.email,
    });
    assert.ifError(link.error);
    const c = createClient(env.API_URL, env.ANON_KEY, {
      auth: { persistSession: false },
    });
    assert.ifError(
      (
        await c.auth.verifyOtp({
          token_hash: link.data.properties.hashed_token,
          type: "magiclink",
        })
      ).error,
    );
    clients.push(c);
  }
  const owner = users[0].id;
  const now = new Date(),
    day = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Yerevan",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(now);
  const due = `${day}T00:00:00+04:00`;
  const plan = await admin
    .from("patient_care_plans")
    .insert({
      user_id: owner,
      clinician: "Test doctor",
      instructions: "Test instructions",
      published_at: new Date(now.getTime() - 86400000).toISOString(),
    })
    .select()
    .single();
  assert.ifError(plan.error);
  const med = await admin
    .from("patient_care_medications")
    .insert({
      user_id: owner,
      plan_id: plan.data.id,
      name: "Test medicine",
      dose: "Test dose",
      instructions: "Test only",
      times: ["00:00"],
      start_date: day,
    })
    .select()
    .single();
  assert.ifError(med.error);
  assert.ifError(
    (
      await admin
        .from("patient_care_plans")
        .update({
          published_at: new Date(now.getTime() + 86400000).toISOString(),
        })
        .eq("id", plan.data.id)
    ).error,
  );
  assert.equal(
    (await clients[0].from("patient_care_plans").select("*")).data.length,
    0,
    "Unpublished plan must not be readable",
  );
  assert.equal(
    (await clients[0].from("patient_care_medications").select("*")).data.length,
    0,
    "Unpublished prescriptions must not be readable",
  );
  assert.ifError(
    (
      await admin
        .from("patient_care_plans")
        .update({
          published_at: new Date(now.getTime() - 86400000).toISOString(),
        })
        .eq("id", plan.data.id)
    ).error,
  );
  const test = await admin
    .from("patient_care_tests")
    .insert({
      user_id: owner,
      title: "Test",
      status: "collected",
      ordered_by: "Test doctor",
      ordered_at: now.toISOString(),
      source: "clinic",
      source_label: "Test clinic",
    })
    .select()
    .single();
  assert.ifError(test.error);
  assert.ifError(
    (
      await admin.from("patient_care_results").insert({
        user_id: owner,
        test_id: test.data.id,
        marker: "LDL",
        value: 3,
        unit: "mmol/L",
        collected_at: now.toISOString(),
        received_at: now.toISOString(),
        source: "laboratory",
        source_label: "Test lab",
      })
    ).error,
  );
  assert.ifError(
    (
      await admin
        .from("patient_care_appointments")
        .insert({ user_id: owner, specialty: "Review", status: "requested" })
    ).error,
  );
  const args = {
    p_medication_id: med.data.id,
    p_due_at: due,
    p_status: "taken",
  };
  assert.ok(
    (await clients[1].rpc("report_patient_dose", args)).error,
    "Other member cannot report own medication",
  );
  assert.ifError((await clients[0].rpc("report_patient_dose", args)).error);
  assert.ifError((await clients[0].rpc("report_patient_dose", args)).error);
  assert.ifError(
    (
      await clients[0].rpc("report_patient_dose_versioned", {
        ...args,
        p_expected_revision: 1,
        p_status: "skipped",
      })
    ).error,
  );
  const events = await clients[0].from("patient_dose_events").select("*");
  assert.equal(events.data.length, 1);
  assert.equal(events.data[0].status, "skipped");
  const history = await clients[0].from("patient_dose_event_history").select("*").order("revision");
  assert.ifError(history.error);
  assert.deepEqual(history.data.map(h=>h.status),["taken","skipped"]);
  assert.ok(history.data.every(h=>h.recorded_by===owner && h.plan_id===plan.data.id));

  for (const table of tables) {
    const other = await clients[1].from(table).select("*");
    assert.ifError(other.error);
    assert.equal(other.data.length, 0, table + " leaks records");
    assert.ok(
      (await clients[0].from(table).insert({ user_id: owner })).error,
      table + " allows clinical writes",
    );
  }
  assert.ok(
    (
      await clients[0].rpc("report_patient_dose", {
        ...args,
        p_due_at: new Date(now.getTime() + 86400000).toISOString(),
      })
    ).error,
    "Future report rejected",
  );
  assert.ok(
    (
      await clients[0].rpc("report_patient_dose", {
        ...args,
        p_status: "approved",
      })
    ).error,
    "Invalid status rejected",
  );
  assert.ok(
    (
      await clients[1].rpc("acknowledge_patient_plan", {
        p_plan_id: plan.data.id,
      })
    ).error,
  );
  assert.ifError(
    (
      await clients[0].rpc("acknowledge_patient_plan", {
        p_plan_id: plan.data.id,
      })
    ).error,
  );
  assert.ifError(
    (
      await admin
        .from("patient_care_plans")
        .update({ active: false })
        .eq("id", plan.data.id)
    ).error,
  );
  assert.ok(
    (await clients[0].rpc("report_patient_dose", args)).error,
    "Stopped plan rejected",
  );
  assert.ok(
    (
      await clients[0].rpc("acknowledge_patient_plan", {
        p_plan_id: plan.data.id,
      })
    ).error,
    "Stopped plan acknowledgement rejected",
  );
  assert.ok(
    (
      await admin.from("patient_care_results").insert({
        user_id: users[1].id,
        test_id: test.data.id,
        marker: "LDL",
        value: 3,
        unit: "mmol/L",
        collected_at: now.toISOString(),
        received_at: now.toISOString(),
        source: "laboratory",
        source_label: "Test lab",
      })
    ).error,
    "Cross-member result parent rejected",
  );
  console.log(
    "Care DB: all seven tables isolated; clinical writes blocked; own reports atomic and correctable; stale, future and cross-account actions rejected.",
  );
} finally {
  for (const u of users) await admin.auth.admin.deleteUser(u.id);
}
