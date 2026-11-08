# Long Home dashboard

Reference: the supplied `noreon-home-dashboard.html`, decoded locally as
`output/app-design-system-2026-10-14/reference-home.html` in the Noreon workspace.
The implementation keeps the existing application shell, clinical/service
next-action priority and guarded medicine controls. It follows the full Home
card's section sequence while retaining the compact check-in list introduced
in the existing application.

## Data boundaries

- Prescription names, doses, instructions and next due times come from the
  currently published plan through `dosesForDay`. Reports remain self-reported.
  Disabling reminders does not hide the prescription or open a check-in early.
- BP times are the member's organizational reminder preferences. They are
  labelled BP reminders, never GP-approved measurement targets.
- BP/pulse tiles and the trend use the same recorded measurement data, excluding
  future timestamps. Pulse is labelled recorded pulse, not resting heart rate.
- Daily medicine/BP counts use actual action evidence. A separate demo chart
  history cannot complete a reminder slot.
- Meals, hydration, steps, activity duration and sleep have no connected logging
  source here. They show untracked states. General curated meal/movement/evening
  ideas do not supply clinical goals, device histories or prescribed quantities.
- Published plan/reviewer, reviewed-result/test counts and confirmed future
  visits use current care data. A new pending review does not erase the previous
  published plan. Nurse assignment details and Zoe chat remain unavailable.
- Breathing is a local, voluntary one-minute timer. It does not start on load,
  play audio, write a clinical observation or notify anyone. Its visual progress
  is static; reduced-motion styling suppresses animated Zoe imagery and
  disclosure transitions.

## Focused checks

Run each with:

```sh
node --conditions=noreon-server-test --import ./scripts/register-alias.mjs scripts/check-home-dashboard.ts
node --conditions=noreon-server-test --import ./scripts/register-alias.mjs scripts/check-home-dashboard-render.ts
node --conditions=noreon-server-test --import ./scripts/register-alias.mjs scripts/check-home-wellbeing-ui.ts
```

The model check covers actual prescription identities, reporting progression,
future readings, disabled reminders and empty/inactive schedules. The render
check renders the production components in EN/HY with action/chart boundaries
mocked. The breathing check exercises actual component handlers with a simulated
timer through completion and unmount cleanup. These are not database or hosted
end-to-end checks.

Also run the existing reminder, patient-presentation, care-progress UX, medicine
schedule, measurement-entry UI and single-point trend checks, token validation,
lint and typecheck.

## Browser acceptance

Use isolated synthetic sessions in the actual local app. Compare the
corresponding screen with the supplied reference. Check 320px Armenian, 375px
empty/reminders-disabled, 390px English and desktop. Capture an ordinary mobile
viewport and full-scroll image after lifestyle imagery has loaded.

1. For an eligible published synthetic prescription, report taken. Verify the
   next prescribed time, daily report count and correction control. Reload and
   confirm the report survives.
2. Open BP entry from Home. Reject inverted systolic/diastolic input. Save a valid
   synthetic reading with pulse. Verify history and Home show the same values
   and date, with the chart including the same observation.
3. Exercise breathing start, pause, resume and reset. Confirm pause freezes the
   timer and completion stops it. Expand and collapse meal/exercise guidance.
4. Verify no-prescription, no readings, reminders-off and pending-review states.
   An urgent assessment must suppress all routine/wellbeing Home blocks.
5. Check keyboard focus, readable wrapping, no horizontal overflow, bottom
   navigation clearance and reduced-motion behavior.

Local fixture cookies must use the application's `/patient` cookie path.
Installing a same-name `/` fixture cookie creates an artificial stale-session
collision after application actions write their `/patient` cookie.

Screenshots and local CUA acceptance evidence from 2026-10-15 are in
`output/home-long-2026-10-15/` in the parent Noreon workspace. Local synthetic
verification does not prove a live deployment or real-member persistence.
