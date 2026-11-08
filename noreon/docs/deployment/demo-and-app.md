# App and public site

The informational site is served at noreon.health and www.noreon.health by the `noreon-core` Vercel project. The member app is served at app.noreon.health by the `noreon-app` project from the same repository. The public site's hosts never serve the member app: `/patient` on noreon.health and www.noreon.health redirects to the same path on app.noreon.health, and demo.noreon.health returns 404 (`lib/deployment.ts`, `proxy.ts`). The fictional demonstration (demo.noreon.health, `NEXT_PUBLIC_PATIENT_DEMO`) was retired on 18 October 2026.

## Real app

Set NOREON_DEPLOYMENT_TARGET=app. Configure production-only Supabase URL, anon key, server-only service role key and hCaptcha site key. Do not copy production credentials into preview deployments; use the staging database there.

The real app uses verified Supabase phone identities, profiles, consent, questionnaire drafts/completion and manually entered measurements. Account ownership comes from the verified server session. RLS isolates member reads; server RPCs validate writes and stale revisions. Sign in on a second browser to retrieve the same data. There are no seeded readings, demo role controls, simulated appointments or example dashboards.

## Public site

The `noreon-core` project builds the same repository. `NOREON_DEPLOYMENT_TARGET=marketing` additionally returns 404 for `/patient` on any host. Feature switches for the member app (`NOREON_REAL_MEMBER_REVIEW_ENABLED`, clinic portal, BP devices, pilot catalogue) must stay unset there.

## Release checks

1. Replay migrations locally, run scripts/check-patient-db.mjs and the patient service checks. Apply hosted migrations through the production GitHub workflow, never an untracked manual database push.
2. Use a scoped Supabase CI token with Project Settings, API Keys and API Key Secrets read access, restricted to the production project. Database migrations use the separate database password. Track token expiration and rotate before it expires.
3. Configure Vonage in Supabase Phone Auth; register the sender for Armenia. Disable test OTP mappings in production. Set SMS limits and hCaptcha protection.
4. Point each DNS record to the value shown by its Vercel project. Confirm certificate issuance and the correct root redirect.
5. Test real SMS receipt, wrong/expired codes, resend throttling, registration and saved data after sign-out and a second-browser login. Check another account cannot access those records. Never add fictional fixtures to production.
6. Enable real registration only after these checks succeed. Pending provider setup is not a completed SMS integration.

## Rollout gate

The app starts with registration closed unless NOREON_REGISTRATION_ENABLED=true. Both the entry screen and OTP server actions enforce this. Keep it closed until SMS delivery and CAPTCHA are configured and tested. Production migrations use the verified IPv4 session pooler because GitHub runners cannot reach the direct IPv6 database address.

## Member care records

Real care data is stored in `patient_care_tests`, `patient_care_results`, `patient_care_plans`, `patient_care_medications`, `patient_care_appointments`, and `patient_dose_events`. Members have owner-scoped read access; unpublished plans and their medications are not readable. Clinical writes require a trusted backend service. To replace a plan, deactivate the previous plan and publish a new plan and prescriptions transactionally. Keep prior records for history. Units and reference intervals must come from the reporting source, not inferred thresholds. Store result explanations only with a reviewer and review timestamp.

Dose reports use session-scoped `report_patient_dose` and can be corrected. They accept only today's scheduled, elapsed doses from a currently active published plan in Asia/Yerevan. They are self-reports, not evidence of ingestion. The app refreshes visible care records once per minute and when the tab becomes visible. These are in-app reminders only; push/SMS reminders are not implemented.
