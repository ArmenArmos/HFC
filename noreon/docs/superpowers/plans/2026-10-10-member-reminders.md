# Member-controlled reminders Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans or superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship persistent member-owned reminder preferences, a daily routine, and an honest BP-monitor setup path.

**Architecture:** Keep reminder timing separate from prescribed dose timing. A pure schedule module derives reminders and BP occurrences from approved care data, preferences and actual measurements. Store demo preferences in the existing revision-protected case; store real-account preferences in an RLS-protected table.

**Tech Stack:** Next.js 16.3.3, React 19.2.8, TypeScript, Zod, Supabase, existing Noreon tokens.

**Spec:** `docs/superpowers/specs/2026-10-10-member-reminders-design.md` (approved).

## Global Constraints

- Today for daily actions, My care for schedules and preferences, My health for readings and device connection.
- The member owns reminder preferences; the GP does not set notification preferences.
- Turning BP tracking on creates default reminder times of 08:00 and 20:00 in Armenia time.
- Limit the BP schedule to four distinct times per day; validate HH:mm.
- Medicine reminders default to recorded dose times. Offset options: -15, 0, +15 minutes.
- Preferences do not alter medication IDs, dose timestamps, intake events or published instructions.
- Hide routine during unfinished questionnaire; urgent guidance has precedence.
- No simulated reading, device connection or external delivery appears as a real integration.
- Never hand-edit `styles/noreon/`, `docs/clinical/` or generated database types.
- Read relevant guides in `node_modules/next/dist/docs/` before coding.

## Scope and delivery dependencies

This plan implements phase 1: in-app routine, settings, persistence and monitor setup fallback. It does not deliver reminders while the app is closed. Background push requires a separate plan for subscriptions, service worker and idempotent dispatch. Real ingestion requires the exact monitor model and confirmed integration. These remain explicit unavailable capabilities, not simulated production features.

## Review Focus

1. Offset across midnight: preserve the original scheduled-dose identity and never duplicate it.
2. A reading between BP slots: complete at most one slot, never future slots.
3. Concurrent staff publication and member preferences: reject stale writes without losing either change.
4. Medication replacement: retire obsolete reminders but preserve member settings.
5. Empty/duplicate/invalid times: reject invalid settings on the server and keep the saved settings.

## Task 1: Pure preference validation and occurrence scheduling

**Files:** Create `lib/patient-care/reminders.ts`, `scripts/check-reminders.ts`. Consume `dosesForDay` from `lib/patient-care/model.ts` and `Measurement` from `lib/patient/types.ts`.

**Interfaces:**

```ts
export type ReminderPreferences = {
  medicationEnabled: boolean;
  medicationOffsetMinutes: -15 | 0 | 15;
  bpEnabled: boolean;
  bpTimes: string[];
  quietStart: string;
  quietEnd: string;
};
export const DEFAULT_REMINDERS: ReminderPreferences = {
  medicationEnabled: true, medicationOffsetMinutes: 0,
  bpEnabled: false, bpTimes: ['08:00', '20:00'],
  quietStart: '22:00', quietEnd: '07:00',
};
export type ReminderOccurrence = {
  id: string; kind: 'medication' | 'blood-pressure';
  dueAt: string; reminderAt: string;
  status: 'upcoming' | 'due' | 'completed' | 'skipped';
  dose?: DueDose;
};
export function parseReminderPreferences(input: unknown): ReminderPreferences;
export function dailyReminders(care: CareData, measurements: Measurement[],
  preferences: ReminderPreferences, now: Date): ReminderOccurrence[];
```

- [ ] Write failing assertions against the real module. Begin with defaults and invalid times:

```ts
assert.deepEqual(parseReminderPreferences(DEFAULT_REMINDERS).bpTimes, ['08:00','20:00']);
assert.throws(() => parseReminderPreferences({...DEFAULT_REMINDERS,bpTimes:['25:00']}));
assert.throws(() => parseReminderPreferences({...DEFAULT_REMINDERS,bpTimes:['08:00','08:00']}));
assert.throws(() => parseReminderPreferences({...DEFAULT_REMINDERS,bpEnabled:true,bpTimes:[]}));
assert.equal(dailyReminders(EMPTY_CARE,[],DEFAULT_REMINDERS,new Date()).length,0);
```

- [ ] Run `node --import ./scripts/register-alias.mjs scripts/check-reminders.ts`; record the expected missing-module failure, then implement the module.
- [ ] Use strict Zod object validation, HH:mm regex `^([01][0-9]|2[0-3]):[0-5][0-9]$`, unique sorted BP times, and at most four slots.
- [ ] BP matching: each slot owns readings from its due time until the next due time, bounded by local midnight. Only measuredAt determines completion. Ignore future timestamps and never pass synthetic chart history into this module.
- [ ] For medication reminder offsets, inspect doses on the local day and neighboring days; preserve dose.dueAt for IDs and check-in calls. Derive reminderAt by adding offset minutes. Group visibility by reminder date, with the recorded dose date/time displayed when it differs.
- [ ] Add fixtures for midnight offsets, one morning reading with two slots, before-first-slot readings, disabled reminders, taken/skipped events, unpublished/inactive/replaced medications. Assert that input care data is unchanged.
- [ ] Run `scripts/check-reminders.ts` and existing `scripts/check-patient-care.ts`; commit the module and tests.

## Task 2: Member-owned persistence with conflict protection

**Files:** Create `lib/patient-care/reminder-repository.ts`, `scripts/check-reminder-db.mjs`, `scripts/check-reminder-storage.ts`. Modify `lib/patient/demo-model.ts`, `app/patient/care/actions.ts`, `lib/patient-care/repository.ts`. Create a CLI-generated migration; regenerate `lib/db/types.ts`.

**Interfaces:**

```ts
export type SavedReminderPreferences = {revision:number; preferences:ReminderPreferences};
export async function getReminderPreferences(): Promise<SavedReminderPreferences>;
export async function saveReminderPreferences(input:unknown, expectedRevision:number):
  Promise<{ok:true;revision:number}|{ok:false;reason:'invalid'|'conflict'|'unavailable'}>;
// DemoState adds reminderPreferences?: SavedReminderPreferences.
// carePageData adds reminders: SavedReminderPreferences.
```

- [ ] Write storage tests for default reads, save/read round trip, stale revision rejection and preference preservation when replacing workflow state. Inject persistence at the repository boundary, not clinical logic.
- [ ] Create migration with `pnpm db:new member_reminder_preferences`. Define `patient_reminder_preferences(user_id uuid primary key references auth.users(id) on delete cascade, revision integer not null default 0, preferences jsonb not null, updated_at timestamptz not null default now())`.
- [ ] Enable RLS in this migration. Grant authenticated select only with `(select auth.uid())=user_id`. Implement member-scoped `save_patient_reminder_preferences(p_preferences jsonb,p_expected_revision integer)` as security definer with fixed search_path, revoked public/anon access, and authenticated execute. Validate allowed keys, types, offset, four-times bound, HH:mm and uniqueness inside the RPC. Insert at expected revision 0 when absent; otherwise update under matching revision, incrementing it atomically. Return -1 on conflict. Never accept caller-supplied user_id.
- [ ] Save demo settings through readDemo/saveDemo. Compare preference revision and retain the workspace revision guard. Map stale state to conflict rather than retrying by overwriting new staff data. Use existing safeRequest lock in the UI.
- [ ] Test real DB owner isolation with two local test accounts: the second sees no row and cannot mutate the first. Test concurrent saves, invalid RPC JSON and missing authentication. Keep test credentials out of output.
- [ ] Run `pnpm db:reset`, `pnpm db:types`, then DB and storage checks. Commit migration, generated types, repository and tests together. Do not apply hosted migrations from the laptop.

## Task 3: Reminder preferences and daily routine UI

**Files:** Create `components/patient-care/reminder-settings.tsx`, `components/patient-care/daily-routine.tsx`, `scripts/check-reminder-ui.ts`. Modify `app/patient/dashboard/page.tsx`, `app/patient/care/page.tsx`, `lib/patient-care/model.ts` where duplicate reminders need suppression.

**Interfaces:**

```tsx
<ReminderSettings saved={reminders} locale={profile.locale} />
<DailyRoutine occurrences={dailyReminders(care, measurements,
  reminders.preferences, now)} locale={profile.locale} preferences={reminders.preferences} />
```

- [ ] Write failing rendered-UI assertions for actual medicine name/dose, reported skipped state, monitoring times, settings link, unavailable external delivery and absence of editable prescription fields.
- [ ] My care form: medication enable toggle, offset select, BP enable toggle, editable time list with add/remove up to four, quiet-hour fields and Save reminder settings. Use the existing Button, Input and copy conventions. Preserve local edits on save failure and display conflict recovery text. Separate scheduled dose time from reminder time.
- [ ] Today: leave urgent/onboarding next action first. Below it, render time-ordered routine only after questionnaire completion. Use DoseButtons for eligible medication check-ins; BP actions open `/patient/measurements/new`. Show completed states without converting skipped into taken. Deduplicate the old generic measurement prompt when a scheduled BP task is shown.
- [ ] Refresh routine using existing CareRefresh and refresh after mutations. Derive in-app due reminders from current time; no browser alert is presented as background push.
- [ ] Verify member settings persist after GP publication, reminders-off preserves clinical tasks, and the daily routine never uses chartMeasurements.
- [ ] Run `pnpm typecheck` and targeted ESLint on all changed TS/TSX files. Commit UI and tests.

## Task 4: Monitor setup and honest manual fallback

**Files:** Create `app/patient/health/monitor/page.tsx`. Modify `app/patient/health/page.tsx`, `components/patient-care/daily-routine.tsx`. Add rendered assertions to `scripts/check-reminder-ui.ts`.

- [ ] Assert that setup cannot display Connected or last-sync timestamps without an actual adapter and received measurement.
- [ ] Add Connect my monitor links beside BP actions and in My health. Setup explains automatic syncing is not yet available for this release, offers Record blood pressure and links back to the member schedule. It does not request Bluetooth permissions or manufacture compatibility.
- [ ] Provide no model picker until supported models exist. Preserve the future first-reading confirmation requirement in the device integration design.
- [ ] Run typecheck and targeted lint, then commit.

## Task 5: End-to-end verification and handoff

- [ ] Run pure scheduling/storage/UI tests plus existing service workflow, publication, work queue, clinical and token checks. Report every failure by name; do not broaden successful checks without a new reason.
- [ ] Start a local dev server and use the native browser tools to test a fictional account: publish a medicine-containing plan, enable BP tracking, edit defaults, refresh, record one morning measurement, verify evening remains pending, record medicine skipped and confirm the status.
- [ ] In a second tab, simulate a concurrent update and verify conflict recovery preserves both settings and GP content. Verify replaced plan retires the old medicine reminder.
- [ ] Check English/Armenian and 360px width; settings labels, times, save/error feedback and buttons must not clip. Capture screenshots of saved preferences and Today routine.
- [ ] Verify real-account persistence with local Supabase and RLS tests, without modifying production data. If Docker/local database is unavailable, report that limitation and do not claim migration replay or real-account verification passed.
- [ ] Update the workflow/testing guide's source with member-owned preferences, default times, in-app-only delivery and unavailable real monitor syncing; render and visually verify its PDF if the source is available.
- [ ] Review the whole diff and report precisely what works locally, what is deployed, and which external integrations remain unavailable. Deployment is a separate action; no hosted schema push is included here.

## Subsequent plans

Background notification delivery consumes the validated preference and occurrence model above and requires an idempotent dispatcher, push subscription storage and explicit permission. A real monitor adapter requires the exact hardware model, documented integration, access credentials and a physical reading test. These plans are written once phase 1 is validated and hardware/provider choices are resolved.
