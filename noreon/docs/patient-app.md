# Patient web app

Entry: `/patient`. Phone verification creates a Supabase session. Basic profile and consent finish registration; the health questionnaire is an optional next step and its reminder remains on the dashboard until complete. Health-dependent assessments remain incomplete until all applicable answers have been saved and checked on the server.

## Deployment requirements

- `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`: the correct target project.
- `SUPABASE_SERVICE_ROLE_KEY`: server-only credential for that same project. Never expose it through browser configuration or commit it.
- Apply the patient schema through the existing GitHub database deployment workflow. Verify production and staging targets separately.
- Enable hosted phone authentication, configure company-owned Twilio Verify, set sending/resend limits and enable the selected CAPTCHA provider before broad public access. Set `NEXT_PUBLIC_HCAPTCHA_SITE_KEY` for the hCaptcha widget and configure its secret in Supabase Bot and Abuse Protection. The token is passed for initial code requests and resends, then reset. Both settings must be configured together.
- Observe delivery and successful verification on an agreed Armenian phone. Local OTP fixtures do not prove real SMS delivery.
- Founder/clinical team must finalize consent and clinically approve the questionnaire rules before real pilot enrolment. The application describes its present status as a pilot preview and manual measurement capture does not notify clinicians.

## Persistence and security

Browser database roles can read their own records through row-level security. Patient writes are server-only, authenticated with `getUser()` and a confirmed phone, and the writer always derives owner identity from that session. Questionnaire writes use expected revisions to reject stale updates. Measurements use per-owner unique submission IDs to prevent duplicates. No service worker stores health data, and examples use a separate route rather than seeded patient records.

The scoped manifest supports an online-first home-screen entry. Offline editing, push notifications and install prompts are outside this milestone. DSD identity, results, scheduling, clinician SSO, device uploads, WhatsApp and telemedicine are not connected.

## Checks

```sh
pnpm db:reset
pnpm db:types
pnpm supabase status -o json > .superpowers/local-db.json
node scripts/check-patient-db.mjs
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --import ./scripts/register-alias.mjs scripts/check-patient.ts
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --import ./scripts/register-alias.mjs scripts/check-patient-service.ts
pnpm check:clinical
pnpm check:tokens
pnpm lint
pnpm build
```

The database check creates disposable local Auth users and removes them afterward. `.superpowers` and `.env.local` are ignored; database credentials must never be shown in logs or committed. Real-auth test fixtures belong only to a local Supabase instance. When NEXT_PUBLIC_PATIENT_DEMO=true, the hosted demonstration instead uses 99000000 / 123456 and encrypted browser cookies; it never calls Supabase or sends SMS. Demo mode must be disabled before real enrolment.


## Connected fictional care workspace

`/patient/journey` is available only in demo mode after fictional registration. It presents patient, doctor and coordinator views as explicit presentation roles, not staff authentication. Three synthetic cases demonstrate history, registry-derived test proposals, doctor approval, scheduled investigations, fictional laboratory results, interpretation, published plan, simulated monitor readings and reported medication intake. No real device, lab, appointment, prescription or notification service is connected.

Fictional scenario records live in per-session, expiring IndexedDB and remain separate from the member entries in cookie-backed registration/questionnaire/measurement forms. IndexedDB mutations read and update the latest record atomically and signal other tabs. Existing cookie mutations use a browser-wide Web Lock, including sign-out. Browsers without Web Locks cannot perform demo writes; this cooperative browser control is not server-enforced CAS. Real Supabase persistence continues to use its own atomic database checks.

Opening a role view never approves a case. Clinical draft and approved states are explicit; modified evidence invalidates dependent approval. The coordinator handles logistics, and doctor actions publish clinical scenario content. Medication intake is a report; a simulated pack opening is shown separately. Test/result sources, units and Armenia-time labels remain visible.

### Presenter walkthrough

1. Sign in with 99000000 / 123456, create fictional details, choose Do this later.
2. Open the visual care dashboard from the dashboard and choose Care workflow for approvals. Choose Routine follow-up.
3. Switch to Doctor, review the history and reasons for tests; edit and approve the test list.
4. Switch to Coordinator, schedule the fictional investigation and load sample lab results (or use validated JSON import).
5. Switch to Doctor, edit the scenario interpretation/recommendations and publish the plan.
6. Switch to Patient and inspect the published plan, lab history and BP charts. Add a simulated reading and separate medication/pack events.
7. Switch back to Doctor to review the follow-up. Repeat Review needed and Urgent symptoms scenarios; reset synthetic scenarios to restart.

Check the exact UI labels against the final release before a presentation. No simulated action contacts a real person; the explicit emergency telephone link is the only call handoff and is never activated automatically.

For separate presenter tabs, use `/patient/journey?role=doctor` or `/patient/journey?role=coordinator`. These select fictional presentation roles only and do not grant staff access.

## Visual dashboard

The care workspace opens to twelve source-labelled chart panels; Care workflow keeps approvals and coordination accessible beside it. BP/event filters are anchored to the latest retained event and show the exact date span; lab panels retain their full history on separate units/scales. Historical fixtures now include 28 simulated BP records and fictional labs dated across 2024–2026. Historical medication reports are separate from new check-ins, and event counts do not claim adherence or ingestion. Existing stored scenarios are preserved; use Reset scenarios to restore the richer fictional histories. No clinical targets or health scores are added.

### Role workflow review (7 October 2026)

Switching presentation role now opens role-specific work: member trends, doctor history and approval, coordinator logistics. Case cards show the investigation stage and urgent/unknown gates. History exposes missing applicable answers and uses registry labels. Doctors see dated current and preceding same-unit lab evidence beside interpretation. Member plans precede device entry.

Coordinator schedules and result receipts are bound to history/tests versions; corrections also require the current results version. Evidence changes discard old coordinator drafts. Routine consultations honor the same urgent/unknown gates as approvals. Local datetime inputs validate before UTC conversion, and pending file reads cannot replace a newer draft. Scenario inputs reset when switching cases.

Validated using both Astra review passes, nine domain/service regression scripts, 5,245 clinical conformance checks, token checks, typecheck/build and browser handoff/urgent/case-switch/resume flows. All three role layouts have no document overflow at 390px. Role switching remains a fictional presentation control; real staff authentication and external integrations are outside this demonstration.

### Easier questionnaire entry

Single-choice taps save successfully before advancing through the current conditional branch. Multi-select and numeric questions retain Continue, and Back supports correction. Number fields offer direct typing, large adjustment buttons and an optional bounded slider; the initial slider position does not create an answer. Blood pressure keeps separate exact numeric entry without a slider. Verified single-tap progression, branch changes, multi-select retention, blank validation, keyboard slider adjustments and 390px layout, plus clinical/token checks, typecheck, lint and production build.

### Demo recovery from urgent answers

Both questionnaire urgent views now expose a demo-only restart with confirmation and a link to the fictional care workspace. Restart preserves profile, consent, measurements, expiry and care scenarios; it clears questionnaire answers except profile-derived age/sex, clears urgency/completion and increments the revision. Server-side demo gating and revision validation prevent use on real records or from stale tabs. A full navigation discards unsaved local questionnaire state. The care workspace urgent notice also opens the existing scenario-reset confirmation, which restores and selects the routine case.

Validated the same 190/115 plus symptom path through the browser, reset to the first question, and urgent care scenario reset to routine. Restart, session, clinical-view and journey regression checks pass, along with typecheck, lint and build.

### Questionnaire next steps

After completion, the dashboard renders the clinical engine's current findings and rule-triggered test catalogue as a draft for discussion. Each finding retains its specific next step and source identifier. Test reasons come from fired findings, never the catalogue's fictional patient rationale. Unknown visible fields remain explicit; emergency findings suppress the routine draft. This does not order tests, notify clinicians, import labs, or connect the personal questionnaire to the separate fictional care workspace. The existing catalogue is partial; tests mentioned in finding text may not yet have catalogue cards. No clinical thresholds or source documents changed.

Validation: patient-review render checks cover changed answers removing suggestions, actual entered BP replacing seeded values, unknown values, emergency precedence, and bilingual registry findings. The local browser completion flow was exercised with fictional heart-failure history, which displayed cardiology review and investigation guidance.

### Connected questionnaire care flow and result review

A completed questionnaire can now create a separate `questionnaire` care case. It contains no seeded lab history, device readings or medication events. Three presentation cases remain separate. An explicit update to a newer questionnaire revision restarts the connected demonstration cycle, increments evidence versions and clears dependent simulated approvals, results, appointments and monitoring. Resetting the three fictional scenarios preserves the connected case.

Connected mutations verify both the cookie identity and completed assessment revision while holding the same Web Lock used by questionnaire writes. The subsequent IndexedDB mutation remains inside that lock. Unsupported locking fails closed. Roles are still presenter controls, not authenticated clinical staff; no real referrals, SMS or integration is created.

The investigation catalogue now includes document-named NT-proBNP, echocardiography and Holter pathways, plus ECG indications for existing rhythm/urgent-review branches. Procurement availability is not promised. NT-proBNP availability differs between the supplied Word catalogue and its earlier JSON transcription; provider confirmation remains necessary.

The reviewing doctor receives deterministic, traceable draft support from current-cycle results: same-sample non-HDL, source lipid thresholds/FH review, reported ASCVD requiring confirmation, and supported HbA1c review/confirmation branches. A draft can be edited, saved and explicitly published to the same member view. Current lab values feed the existing graphs without fictional historical backfill.

Remaining coverage: eGFR/ACR, ECG findings/HMOD and diabetes target-organ damage are not structured inputs yet; final risk category, validated external SCORE2 input and LDL target assignment remain gated. This is not the complete Phase 2 tree. Glucose/triglycerides are evidence only. EXTERNAL HbA1c confirmation rules retain clinical-validation labels. No medication prescription or AI connection is added.

### Three-story review — 7 October 2026

Walked the routine, further-evaluation and urgent fictional cases at 390 × 844 in a local production build. Routine approval → scheduling → result intake → draft → publication works. Conflicting same-time LDL evidence was correctly identified but did not prevent publication; publication now blocks at both UI and reducer until evidence is corrected. Urgent member views now suppress earlier plans, routine advice and history recommendations; emergency guidance and demonstration recovery controls remain available. Newly generated result summaries no longer call themselves unreviewed drafts after publication; existing saved narrative is preserved. Approval badges explicitly say demo.

Remaining product/clinical-review priorities:
- Member plans need explicit action, due date and responsible person; generated technical findings alone are insufficient.
- Mobile presentation controls push the main action below the first viewport. Separate presenter controls from the member experience.
- Replace coordinator JSON entry with structured result fields before operational use.
- Define clinician-owned alert acknowledgement and resolution. A new non-urgent reading currently replaces the prior urgent reading as the active status; no persistent incident closure workflow exists.
- Complete and clinically validate missing risk/organ-damage inputs and source coverage before any real-patient use. These walkthroughs verify software behavior, not clinical safety or effectiveness.

### Actionable care workflow — 7 October 2026

The next-step card now precedes collapsed presentation controls. Doctor plans require dated actions with an assigned member, doctor or coordinator; each role can explicitly complete its own actions. Technical review notes remain accessible behind a disclosure. Existing published plans without structured actions are preserved and ask the demo doctor to add them.

Coordinators can enter numeric lab results and collection dates through ordinary fields, correct stored results, and start new collections. Empty new values are not inferred. JSON remains an optional technical import. Result changes invalidate plan approval.

Urgent evidence creates a persistent demo incident. Repeated urgent evidence is grouped until an explicit closure; later non-urgent readings never silently close it. Demo doctors acknowledge and record an outcome, with stale-evidence checks and a closure block for current urgent or symptom-incomplete evidence. Closure invalidates earlier plan approval. This workflow does not notify staff or provide medical clearance. Clinical response windows, dispositions and operational ownership remain pending in `clinical-review-decisions.md`.
