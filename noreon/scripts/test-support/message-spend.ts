import assert from "node:assert/strict";
/** Isolated, serial local regression fixture. Never used by application code. */
export async function messageSpendFixture(
  sql: (query: string) => Promise<string>,
  dailyLimit = 9_000_000_000,
) {
  assert.ok(
    process.env.NOREON_TEST_DB_CONTAINER?.startsWith("supabase_db_"),
    "Explicit local test container required",
  );
  assert.equal(
    await sql(
      "select count(*) from public.patient_message_spend_reservations;",
    ),
    "0",
    "Refuse to modify a database with spending history",
  );
  assert.equal(
    await sql("select count(*) from public.patient_message_spend_totals;"),
    "0",
    "Refuse to replace existing budget totals",
  );
  const original = JSON.parse(
    await sql(
      "select row_to_json(p) from public.patient_message_spend_policy p where id=1;",
    ),
  );
  assert.equal(original.enabled, false, "Test policy must begin disabled");
  assert.ok(Number.isSafeInteger(dailyLimit) && dailyLimit > 0);
  await sql(
    `select public.configure_patient_message_spend(${original.revision},'{"enabled":true,"currency":"USD","daily_limit_micros":${dailyLimit},"sms_segment_ceiling_micros":1000,"whatsapp_message_ceiling_micros":2000,"max_sms_segments":3,"allowed_prefixes":["+374"]}'::jsonb || jsonb_build_object('valid_until',clock_timestamp()+interval '1 day'),'test-spend-fixture');`,
  );
  const revision = original.revision + 1;
  return {
    revision,
    async cleanup() {
      await sql(`delete from public.patient_message_spend_reservations where policy_revision=${revision};
   delete from public.patient_message_spend_totals t where not exists(select 1 from public.patient_message_spend_reservations r where r.budget_day=t.budget_day and r.currency=t.currency);
   delete from public.patient_message_outbox where cancellation_policy_revision=${revision};
   delete from public.patient_message_spend_policy_events where revision=${revision};
   update public.patient_message_spend_policy p set revision=o.revision,enabled=o.enabled,currency=o.currency,daily_limit_micros=o.daily_limit_micros,sms_segment_ceiling_micros=o.sms_segment_ceiling_micros,whatsapp_message_ceiling_micros=o.whatsapp_message_ceiling_micros,max_sms_segments=o.max_sms_segments,allowed_prefixes=o.allowed_prefixes,valid_until=o.valid_until,updated_at=o.updated_at from json_populate_record(null::public.patient_message_spend_policy,'${JSON.stringify(original).replaceAll("'", "''")}') o where p.id=1;`);
    },
  };
}
