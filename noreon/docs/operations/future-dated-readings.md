# Future-dated blood pressure readings

Live finding, 18 Oct 2026 15:47 (prod-as-staging). A test member's reading was stored with
`measured_at` four days ahead. The Zoe symptom intake treated it as the latest reading, and as it
was 160/120 (diastolic at or above 110) every symptom message met RF-03 and went to the urgent path.

Fixed in migration `20261018115307_bp_future_dated_readings.sql` and the app:

- **Entry.** No path stores a reading more than 5 minutes ahead of the server clock: trigger
  `patient_measurements_not_future` on every insert and every change of `measured_at`, plus the
  same check in the member, BP week, staff care command and nurse visit evidence server code
  (`lib/patient/measured-at.ts`). The member and nurse time pickers stop at the current time.
  The nurse visit evidence path was the one without a check.
- **Readers.** The Zoe claim's `latestReading` uses only readings measured at or before now, and
  RF-03 counts a stored reading only when measured between now minus 24 h and now. The care plan
  draft, GP report, Home and reminders ignore future rows too.
- **Existing rows are kept.** They are not deleted or edited; the rules above simply ignore them
  until their time passes. Thresholds are unchanged (clinical owner: Armen).

## Report: list future-dated rows (read only)

Run in the Supabase SQL editor. It changes nothing.

```sql
select m.id,
       m.user_id,
       m.submission_id,
       m.systolic,
       m.diastolic,
       m.measured_at,
       m.created_at,
       m.measured_at - now() as ahead_by,
       exists (select 1 from public.patient_care_visit_entries e where e.measurement_id = m.id) as from_nurse_visit
from public.patient_measurements m
where m.measured_at > now() + interval '5 minutes'
order by m.measured_at desc;
```

On 18 Oct 2026 this listed one row: member `0ce2559d-61a5-4f5a-b51c-bf16ed58626b`, 160/120,
measured_at 2026-10-22 09:28 UTC, created 2026-10-18 09:30 UTC.

Before the pre-launch database reset this list should be empty or explained.
