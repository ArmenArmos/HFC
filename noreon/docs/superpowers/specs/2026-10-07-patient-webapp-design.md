# Noreon patient web app: October 9 demonstration

Status: product flow agreed through the interactive preview and October 7 conversation, including optional questionnaire completion after registration. Engineering plan review is the next implementation checkpoint.

## Purpose

Build the first patient-facing web app in the existing Noreon repository, rather than another disposable presentation. A person registers using their phone number, verifies it through a real SMS, supplies basic details, completes the existing health questionnaire, and reaches their own dashboard. They can record measurements and return later without losing their work.

The target demonstration date is October 9, 2026. This milestone demonstrates the patient experience and persistence; it does not establish clinical effectiveness or readiness to run the full pilot.

## Sources and decisions

- The user's request defines the deliverable: phone registration, verification, basic details, existing health questionnaire, dashboard, mobile-friendly web app and a path to PWA installation.
- The user confirmed real SMS verification on October 7.
- The user agreed to Supabase authentication and requested review through a clickable visual preview rather than a long specification. The preview now includes all 10 existing questionnaire topics, their conditional fields, and exact date-of-birth entry.
- `Noreon_Davidyants_Pilot_Flow.html` is a reference describing the broader home-first pilot. Its integration and clinical-workflow statements are not instructions to implement every service now.
- The existing clinical questionnaire, branches and rules are reused, without changing their medical content. The repository describes the clinical rules as a demonstration draft requiring clinical approval.
- Proposed defaults: Armenian first with English switching; adult participants; a separately shared app entry link while the public marketing site remains informational.

## Recommended approach and alternatives

Use the existing Next.js/TypeScript application on Vercel with Supabase Auth and PostgreSQL. Reuse brand components and clinical question definitions, but create patient-specific persistence and screens independent of the mock demo state.

Extending the existing browser-only demo would be quicker initially, but would not meet verified-account and cross-device persistence requirements. Building a separate frontend and backend now would duplicate setup and increase the October 9 scope. The existing stack is the recommended foundation.

## Patient journey

### 1. Register or sign in

The proposed entry is `/patient`. The sign-in screen accepts an international phone number, with Armenia (+374) initially selected. It explains that a verification SMS will be sent. Email and passwords are not required.

Supabase issues and verifies the OTP through a configured SMS provider. The app never substitutes a universal demonstration code. The person can correct their number, resend after a visible cooldown, and retry an invalid or expired code. A valid session is required before personal data is read or saved.

Returning members use the same phone flow. After verification they finish basic registration if necessary, or open their dashboard. Health-questionnaire completion is not a registration requirement. The app does not expose whether a number already has an account before verification.

### 2. Basic details and consent

Collect display name, exact date of birth and the biological-sex field already required by the questionnaire, avoiding asking them twice. The user rejected the browser's native calendar: use direct, labelled DD/MM/YYYY entry and a Noreon-styled year → month → day picker. The picker supports typing the year, visible selection, keyboard navigation, Escape/cancel and focus return to its opening control. Start birth date empty for real accounts. Validate a real calendar date including leap years, reject future birth dates and calculate age as of the assessment date, accounting for whether the birthday has occurred that year. Persist birth date as a date-only value, not a timezone-dependent timestamp. Feed the calculated age into the existing `q1.age` clinical field without changing the clinical source. The proposed first version follows the questionnaire's adult range of 18–110. Record an affirmative, versioned consent acknowledgement and timestamp before collecting health answers. No preselected consent checkbox.

The consent screen explains the demonstration/pilot status and intended data use in plain language. Its wording requires founder review before real participants are enrolled. Recording acknowledgement is not treated as proof that all pilot governance is complete.

### 3. Health questionnaire

Reuse the existing question definitions, options, conditional branches and immediate urgent-route behavior. Use a focused mobile layout, visible progress, back navigation and a clear save state. Answers persist to the member's account, including question identifier, answer value, timestamp and questionnaire version.

After verified phone, basic details and consent, the member sees confirmation that their account is ready. Offer “Start health questions” and “Do this later”. They can access their dashboard, record measurements and view history before completing the questionnaire. Show a persistent, prominent “Complete your health profile” card with completed-topic progress and a resume action until finished. Assessment-dependent content remains unavailable with an explanation of what is missing.

Questionnaire completion is checked on the server against the fields applicable to the saved answers. Hidden, obsolete branch answers are excluded from the current assessment. Missing answers are not interpreted as normal findings. Registration state, questionnaire progress and clinical review state are separate concepts.

Refresh, closing the browser and signing in on another device resume the saved questionnaire. Failed saves remain visibly unsaved and offer retry; the interface does not silently claim completion.

Urgent findings preserve the existing interrupt and clinically authored wording. The screen must not claim that a doctor or emergency service has been notified. An urgent response is not overridden simply to finish the demo.

### 4. Dashboard

The dashboard becomes available after basic registration and consent, regardless of questionnaire completion. An urgent questionnaire finding still immediately presents the existing safety route; “Do this later” must not suppress that guidance. The dashboard presents:

- A greeting and practical next action.
- Questionnaire completion and a factual summary of recorded information.
- Latest blood pressure and pulse, with measurement time and source.
- Measurement history and a simple trend when enough actual entries exist.
- A truthful care-plan status. Show a pending clinical review only when a real owned task has been created; otherwise show no published care plan.
- A link to a separate example dashboard for illustrative results, appointments and care planning, useful for stakeholder review and distinct from the member's record.

A new account begins with empty measurement history. No synthetic reading, clinician approval, prescription or booking is inserted into that account as if it were real. Sample content lives on a separate example screen, is labelled and is excluded from health calculations. No invented health score or AI-generated treatment recommendation. Topic progress does not display 100% until all applicable questions are completed. Production has explicit saving, saved and retry states, and preserves keyboard focus when selecting options or advancing.

### 5. Record measurements

First version supports manual blood pressure (systolic/diastolic), pulse and measurement date/time. Weight can be recorded separately. Display units next to inputs, reject malformed entries and distinguish implausible entry errors from clinically concerning readings. Clinical thresholds and wording come from the existing clinical source, not newly invented UI logic.

Every entry records owner, source (`manual`), units, measured time and created time. Duplicate submissions use an idempotency identifier. Successful saves update history and the dashboard; failures retain entered values. Device pairing is future functionality, not a simulated successful connection.

For October 9, manual measurement entry is capture-only: it does not run medical interpretation, send alerts or promise clinical monitoring. The existing questionnaire engine reads `q5.last_reading` and questionnaire symptom context; a new measurement cannot safely be assessed by replaying old symptom answers. A later clinical monitoring implementation requires an explicit measurement-to-rule adapter and contemporary symptom context, approved separately by the clinical team.

### 6. Account and mobile experience

Provide profile, language selection and sign-out. Use large touch targets, readable type, keyboard-friendly forms and a layout that works from 360px phone widths upward. No desktop-only dependency for completing onboarding or recording a measurement.

Build on the existing manifest and icons for home-screen installation, with app-specific start URL and scope. Authenticated responses and personal health data are not stored in a service-worker cache. Offline use shows a clear connection-required state; offline health editing and push notifications are outside this milestone.

## Architecture and storage

- Next.js supplies the mobile UI and authenticated server operations on Vercel.
- Supabase Auth supplies phone OTP, sessions and member identity. The SMS provider is configured within Supabase; provider credentials never enter browser code or Git.
- Supabase PostgreSQL stores profiles, consent acknowledgements, questionnaire progress/answers and measurements. Each table uses row-level security scoped to the authenticated owner from its first migration.
- Patient code lives separately from `lib/demo`; shared questionnaire and rules stay in `lib/clinical`.
- Proposed protected routes: `/patient/profile`, `/patient/questions`, `/patient/urgent`, `/patient/dashboard`, `/patient/measurements` and `/patient/account`. Sign-in and verification are public entry screens. Server checks enforce session, profile and consent state. Questionnaire completion gates assessment-dependent content only, not the dashboard or measurement capture. Redirects are not the only access control.
- Data access uses the authenticated Supabase client. Identity is taken from the session, never a member ID submitted by the browser.
- Questionnaire saves are revision-aware so a stale device cannot silently overwrite newer answers. Completion uses the saved revision.
- No health data in URLs, analytics events or routine application logs. Errors report operation/failure category without phone numbers or questionnaire contents.

Proposed records:

| Record | Main contents |
| --- | --- |
| Profile | Auth user ID, display name, date-only birth date, biological sex, language |
| Consent | Owner, text version, acknowledged timestamp |
| Questionnaire session | Owner, questionnaire version, revision, progress, completion timestamp |
| Questionnaire answers | Session, field IDs, values and answered timestamps |
| Measurement | Owner, type, values/units, source, measured time, created time, idempotency ID |

All schema changes follow the existing migration and generated-type workflow. Hosted changes deploy through the repository's database Actions, not an undocumented manual schema edit.

Consent acceptance and questionnaire completion are controlled server transitions, not member-editable profile flags. Answer access checks must follow the parent session's ownership, and relational constraints must prevent an answer carrying one owner from referencing another owner's session. Verify both direct reads and writes across two accounts.

## Independent Astra review, October 7

The user requested an Astra agent to review the concept, design and implementation readiness. Its verdict supports the existing stack and narrowed deadline scope, with the changes above: custom accessible birth-date entry, capture-only manual measurements, explicit ownership and server completion enforcement, separate sample screens, truthful care-plan status and honest questionnaire progress. Real Armenian SMS delivery remains an unverified setup dependency. The review did not certify the future authenticated app or clinical readiness.

## Davidyants/DSD boundaries

This milestone does not create a clinic integration. Noreon account identity and self-reported data must not be represented as an official DSD clinical record.

Future work includes DSD patient matching, finalized results, authoritative scheduling, clinician SSO, approved care-plan publication and clinical write-back. Provider-specific payloads should sit behind an integration boundary so the patient interface can keep its own vocabulary.

Also deferred: document scanning, live Zoe medical advice, WhatsApp workflows, medication-device adherence, connected BP uploads and telemedicine. Sample cards can illustrate future steps, but do not impersonate operational services or clinician decisions.

## Real SMS dependency

The checked-in local Supabase configuration currently disables phone signup, confirmation and the Twilio provider. Available environment files contain Supabase connection variables but no SMS-provider variable names. This does not establish the hosted project's settings; they still need inspection.

Required before end-to-end acceptance: company access to the correct Supabase project, an approved SMS provider account, phone authentication configured, sending limits, and successful delivery/verification on an Armenian +374 number. Provider setup and any spending require the user's concrete account/budget decisions. The app cannot be described as working with real SMS until delivery is observed.

Official reference: https://supabase.com/docs/guides/auth/phone-login

## Acceptance checks

1. A real SMS reaches an agreed Armenian test phone; its OTP creates an authenticated session. Wrong/expired codes do not authenticate and resend limits are enforced.
2. A new member completes details, consent and the existing branching questionnaire on a phone-size viewport.
3. Progress survives refresh and a subsequent sign-in. Choosing “Do this later” opens the dashboard and clearly shows the unfinished questionnaire. Navigating to assessment-dependent content cannot bypass its completion check.
4. Two separately authenticated accounts cannot read or modify each other's answers or measurements, including direct database/API attempts.
5. A manual measurement survives a later sign-in and appears in the correct history/chart. Repeated submissions do not create duplicates.
6. Existing clinical conformance checks pass; urgent-route behavior is exercised without inventing new medical guidance.
7. Sample results/plans remain explicitly marked and never become actual account observations, orders or approvals.
8. Sign-out removes access to protected screens; authenticated data is not available from an offline cache.
9. Existing build, lint and relevant brand-token checks pass; public contact and informational pages continue working.

## Decisions for review

The patient journey and separate registration/questionnaire state are agreed. Confirm the SMS provider/account setup path and founder-reviewed consent wording before enrolling real participants. DSD integration remains a later decision requiring its actual interface and clinic agreement.
