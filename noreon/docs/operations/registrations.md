# Registrations (admin)

Asked by Khikar, 18 Oct 2026: "shouldn't anyone registered be seen? and which step the patient is on?"
Before this page, the backoffice listed only enrolled members (a `patient_clinical_cases` row), so a
person who signed up but had not enrolled was invisible to staff.

Page: `/staff/real/registrations` (admin host only, "Registrations" in the admin sidebar).
Data: `public.admin_member_registrations(p_step, p_stuck_days, p_limit)`, migration
`20261018120400_staff_registrations.sql`. Check: `scripts/check-registrations.sql` and `.ts`.

## Who is listed

Every `auth.users` row except:

- staff: any `workspace_staff` row, including removed or inactive staff;
- clinic users: any `clinic_portal_memberships` row;
- clinic invitees: any `clinic_portal_invitations` row with an auth user (set at verification, before
  or without a membership);
- blocked or retired accounts: `banned_until` in the future, `deleted_at` set, or anonymous.

## Access and audit

- `security definer`, `search_path=''`, execute granted to `authenticated` only (not anon, not
  service_role). The body starts with `_real_staff_require_admin()`: an active, not removed
  `workspace_staff` admin with an allowed managed session. Doctors, nurses, clinic users, members,
  anon and service role are refused with `insufficient_privilege`.
- Every successful call inserts one `access_audit` row: actor, role `admin`, surface
  `registrations.list`, no member id (it is a list), filters in `object_id`, session id. It shows in
  the Activity log as "Opened the registrations list". Refused calls record nothing.
- Clinics never see this list. Clinic visibility stays booking-based (P21); nothing here changes
  any clinic function or policy.
- Returned fields: id, name, masked phone (`+374 ••• 123`), sign-up date, channel, step, when the
  step was reached, questionnaire started/completed, urgent yes/no, enrolled, doctor assigned yes/no,
  last activity. No answers, readings, results, plan text or urgent rule id.

## Steps

The step is the furthest one reached, checked from 10 down. All sources are read-only.

| Step | Reached when | Source | "Reached at" |
| --- | --- | --- | --- |
| 1 Signed up | an account exists | `auth.users` | `created_at` |
| 2 Profile complete | name, birth date and sex set (same test as enrolment) | `profiles` | `updated_at` |
| 3 Consent given | any consent row | `patient_consents` | earliest `accepted_at` |
| 4 Questionnaire | started: an answer beyond `q1.age`/`q1.sex` (the profile step writes those two), or completed | `patient_assessments` | `completed_at`, else `updated_at` |
| 5 Enrolled | a case exists; detail says doctor assigned or not | `patient_clinical_cases` | `created_at` |
| 6 Visit or tests booked | a test or home-visit request not cancelled, or a booking appointment confirmed or pending notice | `patient_test_requests`, `booking_appointments` | earliest `created_at` |
| 7 Visit done | a nurse visit recorded, or the clinic checked the member in as arrived | `patient_care_visits`, `clinic_booking_checkins` | earliest |
| 8 Results in | lab stage `results-received` not later retracted, a clinic result file attached, or a clinic or laboratory result row | `patient_care_lab_stages`, `clinic_result_attachments`, `patient_care_results` (source clinic/laboratory) | earliest |
| 9 Plan published | a doctor publication exists | `patient_clinical_publications` | earliest `published_at` |
| 10 In programme | after a published plan the member acted on it: acknowledged a published plan, sent a home reading after the first plan, or sent a programme check-in | `patient_care_plans.acknowledged_at`, `patient_measurements`, `programme_checkins` | earliest of those |

Notes:

- Masked phone: `+374 ••• 123` for numbers of 10 digits or more, only the prefix (`+123 •••`) for shorter ones.
- Indexes added for the per-member lookups (`clinic_booking_checkins(appointment_id)`,
  `programme_checkins(member_id)`, `patient_care_plans(user_id)`) and the facts CTE is materialized:
  Fable measured 2.4-2.6 s at 10k accounts before, 0.16-0.18 s after.
- Profile and consent are saved in one call today (`save_patient_profile`), so step 2 alone is rare.
- An urgent answer leaves `completed_at` empty by design, so an urgent person shows "Questionnaire
  started" with the urgent flag. The urgent flag (`urgent_rule` set) is shown at every step.
- Channel is how the person signs in today, not a recorded sign-up source (none is stored): Telegram
  when an active member Telegram sign-in binding exists, else phone (SMS), else email.
- Last activity is the latest of: last sign-in, any step time above, profile or questionnaire edits,
  case or booking changes, the latest plan and the latest home reading.
- "Stuck more than N days" means the current step was reached more than N days ago. People at step
  10 are never stuck.
- The funnel shows, per step, how many reached it or went further, and how many are at it now. Counts
  always cover everyone; the step and stuck filters apply to the list only (500 rows at most).
