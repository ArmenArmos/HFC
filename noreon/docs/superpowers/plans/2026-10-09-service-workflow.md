# Approved Noreon service workflow

Implement the agreed client booking, separate doctor review, and operations demo. Existing emergency guidance stays; live urgent alert operations remain unresolved. Staff portals simulate one browser's fictional case and must be inaccessible in real-app mode. No live booking, lab contact, prescribing or staff provisioning claims.

## Architecture

Operational state uses the existing encrypted seven-day demo cookie and a typed reducer. Server actions validate all transitions. Test suggestions come from the existing clinical engine. Client care data contains published snapshots only. Three milestones: tests needed, tests scheduled, treatment published. Separate routes live under /patient/doctor and /patient/backoffice to keep session isolation. The production care read path also filters unpublished results.

Real report files/extractions remain memory-only in a layout provider: navigation within the app retains them, reload/sign-out clears them. Client sees receipt; doctor simulation can check extraction, request AI explanation, edit it and publish. No medical contents enter the operational cookie. Historical reports never fulfill a new test order. Uploaded report AI text remains clinician-review content until explicit publication.

## Tasks

1. Build pure workflow state/transitions, Armenian calendar scheduling, working-day review window, publication snapshots, server actions and model tests. Own lib/service-workflow and app/patient/service/actions.ts, demo model extension.
2. Build booking, progress, GP appointment, doctor and backoffice workspace components and routes. Own components/service-workflow and staff/service route pages. Consume locked ServiceWorkflow/ServiceCommand contracts.
3. Integrate client dashboard/results/care, server care projection, lift report memory state and gate extraction/explanation behind doctor simulation. Retain clear upload consent and delete behavior.
4. Verify typecheck, lint, clinical and token checks, scheduling/publication tests and complete browser stories. Independent whole-change review; fix important findings before PR/deploy. Verify deployed flow.

## Review focus

Unpublished values leaking via charts or React props; publishing before all results/required consultation; stale draft or report revision approval; date arithmetic around Armenia midnight/weekends; appointment invalidation after test rescheduling/cancel; session separation and real-app staff access; cookie size and concurrency; temporary report clearing and misleading live-service claims.

## Decisions

User approval of the seven answers supersedes older repository copy that said individual doctor review was not promised. Demo staff portals are workflow simulation, not real role authentication. Production staff onboarding, live integrations, clinical protocol intervals and urgent alert operations remain outside this release.

## Verification and review record

- Pure workflow tests passed: grouped bookings, reschedule/cancel, Armenia calendar boundaries, delayed results, working-day review target, consultation/publication gates, zero-test flow and immutable plan snapshots.
- Database reset replay, generated types and SQL publication-isolation checks passed locally. Existing care database tests also passed.
- Typecheck, production build, clinical conformance (5,248 checks), token checks, existing care/report/provider/bridge regressions and lint passed (one pre-existing unused import warning in the retired demo welcome page).
- Browser walkthrough passed: grouped home laboratory booking, separate clinic examination, receipt, temporary historical import, checked report review, doctor explanation, package publication, client-visible released reports, GP registration and reassignment. Mobile layout checked at 390px.
- Independent Astra review identified report publication snapshot replacement/clock coupling and a late-AI-response deletion race. Fixed with explicit publication revision snapshots and functional revision-checked updates; regression tests passed. Erroneous doctor-side real upload branch also removed.
- Routine booking/publication cannot override the existing urgent questionnaire route. No live urgent alert dispatch added.

## Release limits

One fictional case per browser session; doctor roster/booking/lab receipt are simulations, not real staff accounts or provider connections. Uploaded documents and AI drafts remain memory-only and clear on reload/sign-out. Production staff routes are unavailable. Real clinical result publication requires an explicit linked published plan. Staff interfaces are English; member basics retain the existing locale support. Native health integrations remain future work.
