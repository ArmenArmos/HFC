# Patient Web App Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. The proposed execution is implementation in this chat, with an independent Astra review of the branch before integration.

**Goal:** Deliver a mobile-friendly patient app with real phone authentication, saved profile/questionnaire/measurements and a dashboard available before questionnaire completion.

**Architecture:** Extend the existing Next.js app under `/patient`, sharing clinical definitions but not browser-only demo state. Supabase provides phone Auth and owner-isolated persistence; server operations validate inputs and control consent/completion. Twilio Verify is the proposed SMS provider; actual Armenian delivery is an external acceptance dependency.

**Tech Stack:** Existing Next.js 16.3.3, React 19.2.8, TypeScript, Supabase Auth/PostgreSQL, existing brand tokens and components. No separate application server or new UI framework.

**Spec:** `docs/superpowers/specs/2026-10-07-patient-webapp-design.md`, amended with the user-approved optional questionnaire flow.

## Global Constraints

- Public marketing remains informational, with a separately shared patient app entry.
- Real SMS verification; no universal demonstration passcode in the authenticated app.
- Registration, questionnaire completion and clinical review are separate states.
- Armenian first and English switching; copy follows repository voice rules.
- Existing clinical questions, branches, thresholds and vendored source documents remain unchanged.
- DOB is date-only; branded year/month/day picker plus numeric DD/MM/YYYY entry, no native calendar.
- Adult questionnaire age range is 18–110; age is derived at the assessment date.
- Manual measurements are capture-only for this milestone.
- Examples are separate from member records; no invented approvals, prescriptions, bookings or clinical tasks.
- Authenticated personal data is not service-worker cached or placed in URLs/analytics/logs.
- Migrations are created with the Supabase CLI, replayed locally, types regenerated and deployed through existing GitHub Actions.

## Review Focus

1. A partial or changed questionnaire must remain unfinished and resume correctly; hidden stale follow-ups must not affect completion.
2. Two authenticated accounts must not access one another's data, including writes bypassing the UI.
3. Phone retries, expiry and delivery failures must not leave a false verified state or cause uncontrolled SMS requests.
4. Invalid dates, leap days and exact birthdays must produce the correct age on mobile numeric keyboards.
5. A failed/duplicated/stale save must not erase input, overwrite a newer revision or report success incorrectly.

## Task 1: Patient domain validation and storage contract

**Files:** create `lib/patient/validation.ts`, `lib/patient/questionnaire.ts`, `lib/patient/types.ts`, `scripts/check-patient.ts`; CLI-create a migration under `supabase/migrations/`; regenerate `lib/db/types.ts`.

**Interfaces:**

```ts
type PatientProfile = {
  userId: string; name: string; birthDate: string;
  biologicalSex: "male" | "female"; locale: "hy" | "en";
};
type AssessmentDraft = {
  id: string; revision: number; assessmentDate: string;
  answers: Answers; completedAt: string | null;
};
type SaveResult =
  | { ok: true; revision: number }
  | { ok: false; reason: "invalid" | "conflict" | "unavailable" };
parseBirthDate(input: string): string | null;
ageOn(birthDate: string, assessmentDate: string): number;
assessmentProgress(answers: Answers): {
  completedTopics: number; totalTopics: 10; complete: boolean;
};
```

- [ ] Add meaningful domain tests before implementation:

```ts
assert.equal(parseBirthDate("18051974"), "1974-05-18");
assert.equal(parseBirthDate("31/02/1974"), null);
assert.equal(parseBirthDate("29/02/1900"), null);
assert.equal(parseBirthDate("29/02/2000"), "2000-02-29");
assert.equal(ageOn("2008-10-08", "2026-10-07"), 17);
assert.equal(ageOn("2008-10-07", "2026-10-07"), 18);
assert.equal(assessmentProgress({}).complete, false);
```

- [ ] Run `node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --import ./scripts/register-alias.mjs scripts/check-patient.ts`; verify the missing-module failure, then implement pure parsing, date validation, phone normalization, measurement validation and progress calculations.
- [ ] Create the migration using `pnpm db:new patient_foundation`. Extend profile fields without weakening existing RLS. Create consent records, owned assessment sessions and owned measurements. Store draft answers in their owned assessment row as JSONB to avoid cross-owner child references. Assessments carry an integer revision and source questionnaire version; measurements carry an owner-scoped unique submission ID.
- [ ] Make clinically sensitive state transitions server-only. Browser roles have select access to their own records but cannot directly set consent, completion or write arbitrary clinical fields. Authenticated server actions validate the member through the session, then use a server-only database writer. Set `SUPABASE_SERVICE_ROLE_KEY` only in server environment, never a `NEXT_PUBLIC_` variable. Every writer derives the owner from the verified session and explicitly scopes operations to that owner; retain RLS read policies.
- [ ] Implement atomic assessment writes using a server-only RPC comparing owner and expected revision. Grant execution to the backend service role only; stale writes return conflict. Consent acceptance and completion writes use the same trusted backend boundary.
- [ ] Add integration checks with two actual local Auth users: owner reads succeed; other-user reads return no data; direct member writes to completion/consent fail; stale expected revision fails; duplicate measurement ID does not create a second entry.
- [ ] Run `pnpm db:reset`, regenerate types with `pnpm db:types`, and run domain/integration checks before committing.

## Task 2: Phone registration, session guards and profile

**Files:** create `app/patient/page.tsx`, `app/patient/verify/page.tsx`, `app/patient/profile/page.tsx`, `app/patient/ready/page.tsx`, `app/patient/layout.tsx`, `lib/patient/auth.ts`, `lib/patient/repository.ts`, `app/patient/actions.ts`, `components/patient/phone-entry.tsx`, `components/patient/profile-form.tsx`; modify `proxy.ts` and `lib/supabase/session.ts`.

**Interfaces:**

```ts
requirePatient(): Promise<{ userId: string; phone: string }>;
getPatientState(): Promise<{
  profile: PatientProfile | null; consentAccepted: boolean;
  assessment: AssessmentDraft | null;
}>;
requestPhoneCode(phone: string): Promise<{ ok: boolean; retryAfter?: number }>;
verifyPhoneCode(phone: string, code: string): Promise<{ ok: boolean }>;
saveProfile(input: Omit<PatientProfile, "userId">, consent: true): Promise<SaveResult>;
```

- [ ] Add tests for malformed phone/code, SMS failure, unauthenticated profile save and a spoofed browser owner ID. Assert no database write occurs without a verified session.
- [ ] Read the installed Next server-action, cookies and proxy guides before coding. Use Supabase `signInWithOtp` and `verifyOtp` with `type: "sms"`; retain the phone only for the verification screen, outside URL parameters. Signed-in guards verify identity using Supabase server Auth, not trusted cookie contents.
- [ ] Keep retired `/demo` routes redirected. Add targeted `/patient` session refresh and protected-route guards without affecting static marketing pages. A member with incomplete basic profile/consent goes to profile. A member with incomplete questionnaire may use the dashboard and measurements.
- [ ] Implement the profile and company-reviewed consent acknowledgement. After successful save, show “Your account is ready” with “Start health questions” and “Do this later”. Both paths are real authenticated routes.
- [ ] Configure real phone Auth and Twilio Verify under company accounts once access is available. Inspect hosted Supabase configuration separately from local defaults. Apply resend/send limits and provider protections; any provider billing is a separate user decision.
- [ ] Verify actual delivery and correct-code authentication on the agreed Armenian test number; wrong/expired codes do not establish a session. Record the result without storing the phone or code in logs.

## Task 3: Accessible birth-date control and patient shell

**Files:** create `components/patient/birth-date-picker.tsx`, `components/patient/patient-shell.tsx`, `lib/patient/copy.ts`; reuse brand typography/colors/components.

**Interfaces:**

```ts
BirthDatePicker(props: {
  value: string; onChange: (isoDate: string) => void;
  assessmentDate: string; locale: "hy" | "en";
}): ReactNode;
```

- [ ] Exercise the input cases from Task 1 against the actual control; numeric eight-digit entry formats as DD/MM/YYYY. Typing a year goes directly to month selection. Choosing year/month/day returns one date-only value.
- [ ] Use the approved preview as the interaction reference. Start empty. Use the existing accessible Dialog component for focus trapping, Escape and focus return; keep state stable between views. Make the picker fit and scroll at 320×360, and test with the keyboard-visible layout.
- [ ] Add readable patient navigation for Today, Measurements, Health profile and Account, with active state and large touch targets. Preserve public marketing chrome separately.
- [ ] Use existing brand tokens instead of copying the prototype's literal CSS values. Run `pnpm check:tokens` after styling.

## Task 4: Saved, optional questionnaire

**Files:** create `app/patient/questions/page.tsx`, `app/patient/urgent/page.tsx`, `components/patient/questionnaire.tsx`, `components/patient/question-field.tsx`; extend `lib/patient/questionnaire.ts` and server actions.

**Interfaces:**

```ts
saveAnswers(input: {
  expectedRevision: number; entries: Array<{ fieldId: string; value: FieldValue }>;
}): Promise<SaveResult>;
completeAssessment(expectedRevision: number): Promise<SaveResult>;
```

- [ ] Add domain cases for selecting “none” in a multi-select, changing a parent so stale follow-ups disappear, unanswered applicable fields, completed profile-derived age/sex and conditional BP parts. Changing an answer invalidates a completed assessment when necessary.
- [ ] Reuse `CORE_QUESTIONS`, `visibleFields`, existing branch conditions and clinical rules; never alter their clinical wording/options/thresholds. Profile-derived `q1.age` and `q1.sex` are populated server-side at the assessment date.
- [ ] Render focused mobile questions with topic progress, Back, saving/saved/retry states, a clear “Finish later” action and resume position. Do not show 100% before completion. Preserve focus for option changes and put focus on the next question when advancing.
- [ ] Save answers with expected revision, prune obsolete branches and show an explicit reload/reconcile action after a conflicting device save. Failed saves retain unsaved input; do not advance as if the answer were persisted.
- [ ] Run `firesEmergency` against current answers at the existing interruption points. The urgent screen uses source clinical wording, does not claim clinician notification and is not silently bypassed by “Finish later”.
- [ ] Complete only after a server check of all applicable saved answers. The dashboard stays accessible for ordinary partial questionnaires; assessment-dependent output remains incomplete.
- [ ] Run `pnpm check:clinical` and test at least a nonurgent completed route, an interrupted chest-pain route and a changed branch resumed after sign-out/sign-in.

## Task 5: Dashboard, measurements and truthful examples

**Files:** create `app/patient/dashboard/page.tsx`, `app/patient/measurements/page.tsx`, `app/patient/measurements/new/page.tsx`, `app/patient/account/page.tsx`, `app/patient/example/page.tsx`, `components/patient/measurement-form.tsx`, `components/patient/measurement-history.tsx`; extend repository/actions.

**Interfaces:**

```ts
recordMeasurement(input: {
  submissionId: string; systolic: number; diastolic: number;
  pulse?: number; measuredAt: string;
}): Promise<{ ok: boolean }>;
getMeasurements(): Promise<Array<{
  id: string; systolic: number; diastolic: number;
  pulse: number | null; measuredAt: string; source: "manual";
}>>;
```

- [ ] Test invalid/partial numbers, malformed dates, duplicate submission IDs and failed writes. Verify entries survive a later session and cannot be accessed from a second account.
- [ ] Show “Complete your health profile” prominently while unfinished, with completed topics and a resume action. Show registration as complete. Use truthful empty measurement and care-plan states.
- [ ] Save manual BP/pulse with units, timestamps and provenance. Disable duplicate requests while saving, retain fields on failure and update history only after confirmed persistence. Capture-only means no automatic medical assessment or clinical notification.
- [ ] Separate sample trends/results/appointments onto `/patient/example`, clearly marked and excluded from patient observations. Do not create queued reviews or approved plans for demonstration purposes.
- [ ] Add account language/profile/sign-out. On sign-out clear any transient health UI state and deny protected content on back navigation/refetch.

## Task 6: Verification, preview deployment and independent review

**Files:** update `app/manifest.ts` only as needed for the patient app entry; add `docs/patient-app.md`; update test scripts/package commands for the actual checks.

- [ ] Keep the app online-first, with no service-worker storage of personal data. Document PWA installation as a follow-up unless the existing manifest behavior can be verified without expanding deadline scope.
- [ ] Run build, lint, token, clinical and patient checks. Verify clean database replay and generated-type consistency. Fix all change-related failures; record unrelated existing warnings accurately.
- [ ] Test mobile registration, skipping/resuming the questionnaire, urgent guidance, two-account isolation, measurement retries and SMS expiry/resend against the actual app. Use only agreed test data.
- [ ] Open a draft PR, attach it to this chat, and verify its Vercel preview. Database staging deploy uses the existing Actions workflow and correct staging secrets; never point a preview at production by accident.
- [ ] Ask the user-authorized Astra reviewer to independently review the full branch, focusing on security, partial completion, clinical boundaries and mobile design. Resolve concrete findings and rerun affected checks.
- [ ] Report the working preview and any remaining external dependency accurately. Production integration follows the repository workflow; no claim that real SMS or hosted persistence works until observed end to end.

## Execution dependencies and decisions

- User-approved product scope: registration now, questionnaire can be finished later, unfinished dashboard reminder, measurements accessible.
- Proposed execution: this agent implements in this chat, Astra independently reviews before integration.
- External setup: company Twilio account/provider funding, hosted Supabase administrative access and server-only writer credential, database deployment secrets and finalized consent wording.
- These dependencies do not block local implementation or the reviewable preview, but they do block an honest claim that the live authenticated app is complete.
