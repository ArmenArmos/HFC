# Native onboarding implementation plan

> Use superpowers:executing-plans inline under the user's overnight delegation. Claude is the independent final material-risk reviewer.

**Goal:** Native profile/consent/questionnaire flow with shared clinical rules and safe server reconciliation.
**Architecture:** Verified bearer transport -> single-flight journey controller -> member provider/focused forms -> existing tabs.
**Tech stack:** Expo57, RN0.86, React19.2.3, existing Supabase/clinical modules.
**Spec:** docs/superpowers/specs/2026-10-12-native-onboarding-design.md

## Global constraints

- Native sign-in/server API remain disabled. No real member/provider calls.
- Existing tokens/copy/clinical rules; no dependency/schema change.
-15s transport deadline, memory-only drafts, verified owner, mandatory GET after every save.

## Review focus

- A saved write followed by failed GET retries only GET and cannot advance past urgent state.
- A late response after logout/account switch cannot restore data or submit as the replacement user.
- Blank/partial numeric values cannot become normal zeros; hidden branch drafts cannot apply elsewhere.
- A new urgent answer displays guidance even if offline and cannot be bypassed by tabs.
- Concurrent server revision changes never silently overwrite an edit.

### Task 1: Protocol and journey controller

Files: journey-protocol.ts, journey-api.ts, journey-controller.ts; tests/journey.test.ts.
Interfaces: JourneySnapshot={state:PatientState,consentVersion:string}; JourneyCommand profile/answers/complete matching PR100. JourneyTransport.read(signal),write(command,signal). createJourneyController(transport) exposes snapshot/subscribe/start/stop/load/save; state tracks phase idle/loading/saving/blocked/invalid, snapshot, reset sequence and expected revision.
- [ ] Test save success does POST then GET; failed GET holds writes and load retries GET only;409 locks; duplicate save sends once; old read/saved reply ignored after stop.
- [ ] Test malformed/wrong-owner snapshots, response JSON stalls, caller abort and token lease replacement reject. Run missing-module failures.
- [ ] Implement immutable observable controller and fixed-origin transport using existing verifiedActionClient and abortableRequest; guards before each request and after every awaited result.
- [ ] Run Node tests/types; commit.

### Task 2: Focused profile and questionnaire UI

Files: journey-provider.tsx, journey-screen.tsx, journey-profile.tsx, journey-questions.tsx, journey-field.tsx, journey-copy.ts; member/_layout.tsx, account-page.tsx; tests/journey-ui.test.tsx and navigation-ui.test.tsx fixtures.
- [ ] Add rendered tests for required consent/profile validation, number/single/multi/BP/unknown controls, invalid numeric, immediate urgent rendering offline, no progression on failed post-save GET and disabled duplicate presses.
- [ ] Wire provider lifecycle above tabs under existing MemberDraftProvider; expose edit actions and show focused screen for missing/incomplete/urgent state. Key ownership remains authenticated member.
- [ ] Use shared fields/validation/rules; raw numeric strings; per-field keyed drafts; explicit reload discards to saved state; required post-save read before advance. Pilot consent copy mirrors web EN/HY.
- [ ] Keep emergency guidance visible during saving/blocked states, allow correction but no tab exit until nonurgent saved state. Reconcile foreground refresh without silently replacing active edits.
- [ ] Run full native model/rendered/types/lint/theme and clinical checks; commit.

### Task 3: Verify, review and release

- [ ] Clean mobile-only install, both platform exports and iOS Release build. Fictional simulator profile/questionnaire/urgent/EN-HY walkthrough; restore all overrides and rebuild default-off source.
- [ ] Claude reviews contract reconciliation, urgent route, drafts/ownership and navigation; fix material findings with regression evidence.
- [ ] Create/attach PR, await final CI, merge exact reviewed head, verify app/core deployments. Update roadmap/handoff with remaining activation/device/store scope.
