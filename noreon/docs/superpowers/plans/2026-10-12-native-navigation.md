# Native member navigation implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Execution is inline under the user's overnight delegation, with Claude reviewing material boundaries before release.

**Goal:** Deliver protected Home, Progress, Care plan and Me screens while preserving uncertain submissions across navigation.

**Architecture:** A member-scoped provider owns the shared records/refresh clock and an in-memory draft store. Expo Router tabs consume that provider. Existing forms retain their validation/transport, with durable edit/pending fields stored above the screens and busy/request handles remaining local.

**Tech Stack:** Expo57, React19.2.3, React Native0.86, Expo Router, Supabase member RLS.

**Spec:** `docs/superpowers/specs/2026-10-12-native-navigation-design.md`

## Global constraints

- No new clinical thresholds, notifications or write endpoints.
- No health records in route params or disk storage.
- Preserve exact BP payload/UUID and dose/reminder pending revisions across navigation, language and snapshot refresh.
- Auth changes reset the member provider and navigation. Keep provider activation/store gates unchanged.
- Use existing generated tokens, EN/HY copy, Router and SDK57-compatible APIs.

## Review focus

1. Navigating away during an uncertain write and returning must retain its exact retry payload, not create a second event.
2. Account A late callbacks must never populate B's provider or screen.
3. A failed refresh must remain visible on every tab and preserve disabled action semantics.
4. Direct member route access while disabled/loading/unauthenticated/unverified must not mount records.
5. A new dose revision must supersede old revision state rather than reuse a stale pending correction.

### Task 1: Member draft state and access model

Files: `src/lib/member-drafts.ts`, `member-drafts.tsx`, `navigation-access.ts`, `tests/navigation.test.ts` under `apps/patient-mobile`.

- [ ] Write failing tests for separate stores, stable payload identity across subscribers/remount, updater functions, and revision-separated dose keys; table-test access guards for loading/error/disabled/unverified states.
- [ ] Implement `createDraftStore()` with stable `get<T>(key, initialize)`, `set<T>(key, valueOrUpdater)` and `subscribe(listener)`; hook `useMemberDraft<T>(key, initial)` uses `useSyncExternalStore` with this member-scoped store. Store lives only above member routes, with no persistence.
- [ ] Add `memberRouteAllowed(enabled, loading, error, session)` returning a strict boolean for a verified phone session. Backend authorization remains unchanged.
- [ ] Test red/green, then wire BP editable fields/id/pending/status, reminder preferences/revision/pending/status and dose pending/result to the store. Keep busy flags/controllers local so a remount cannot restore a permanent busy state. Dose keys include event identity and current revision.

### Task 2: Shared member snapshot and screens

Files: `src/lib/member-session.tsx`, `member-screen.tsx`, `dashboard.tsx`, `member-pages.tsx`, `src/app/index.tsx`, `src/app/_layout.tsx`, `src/app/member/{_layout,index,progress,plan,me}.tsx`, `copy.ts`.

- [ ] Extract the current dashboard read/foreground/day-refresh effects into `MemberProvider({userId, children})`; preserve15s abortable identity/read flow, active request guard and stale response cancellation. `useMember()` returns userId,data,error,now,reload.
- [ ] Put draft provider and member data provider above Tabs, keyed by auth userId. Keep language state in the root provider so login and tabs share it without resetting drafts.
- [ ] Guard the member route using Stack.Protected and an internal layout check. Avoid SDK58-only redirectTo. Route index shows existing disabled/login/error/missing-phone behavior and redirects a valid member to `/member`.
- [ ] Home renders dose schedule and BP form; Progress renders paged BP/released results; Care plan renders published instructions/medications/acknowledgement; Me renders preferences/language/sign-out. Common screen wraps safe area, keyboard/scroll, loading/errors/unregistered fallback and refresh. Me must keep sign-out reachable even if records fail.
- [ ] Preserve existing filter/revision behavior and show last successful load time with a visible stale error. Avoid nested ScrollViews and unsupported live Zoe/support destinations.

### Task 3: Navigation verification and release

- [ ] Run native tests/typecheck/lint/theme check; inspect installed Router option types and use generated tokens for tab styles.
- [ ] Exercise real route switching and BP/reminder drafts in a local synthetic fixture harness, with no hosted credentials or OTP calls. Verify member-to-public guard transition and account reset; remove harness code before commit. Record any unavailable platform acceptance explicitly.
- [ ] Run Android/iOS exports and iOS Release simulator build. Inspect EN/HY layouts and safe area/keyboard behavior as available.
- [ ] Request one material review from Claude focusing on auth, stale state and retry loss. Address material findings and verify affected cases.
- [ ] Commit, push, create/attach PR, wait for CI, exact-head merge, verify app/core deployments and update roadmap/handoff. Native sign-in/store delivery stays disabled.
