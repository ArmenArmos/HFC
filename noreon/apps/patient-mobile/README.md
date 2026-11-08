# Noreon patient mobile

Native Android/iOS app using Expo SDK 57 and the same Supabase member records as the web app. This first slice has existing-account phone/OTP sign-in with hCaptcha, encrypted session storage and a member overview with BP entry and plan acknowledgement. It is not the completed patient journey or a store release.

## Local development

Use Node 24+ and the pinned pnpm version. This directory is its own workspace/lockfile so mobile dependencies do not change the Next app's runtime. Run from this directory:

```sh
pnpm install --frozen-lockfile
pnpm theme
pnpm test
pnpm typecheck
pnpm lint
pnpm export
pnpm ios
pnpm android
```

The default build is disabled and shows the web-app route. Copy `.env.example` to `.env.local` only when configuring an approved test environment. All `EXPO_PUBLIC_*` values are embedded in the bundle; only the publishable/anon key belongs here, never service-role credentials. The config reader refuses known privileged key formats. Do not enable real sign-in until hosted Auth CAPTCHA, phone/SMS configuration and abuse limits are verified. Native OTP explicitly sets `shouldCreateUser:false`; new account registration stays on the web behind its server switch. Hosted Auth CAPTCHA/rate settings still govern direct sign-in requests and must be verified before enabling a build. No OTP was sent during implementation.

A configured app reads through member RLS, never the service role. The native app does not invent medical interpretations, use synthetic health data by default, or treat missing evidence as normal. Results require review metadata and a plan must be active and published. Readings and reviewed results display 20 records per page, with older/newer navigation. Timestamp-and-ID cursors preserve tied timestamps. Refresh resets history to the newest page; records are read afresh under member RLS and not cached on disk. BP entry uses an authenticated owner-bound RPC with verified membership, existing validation bounds, and atomic submission-ID deduplication. Uncertain retries keep the exact payload/ID in memory and lock editing; successful saves require an explicit new-reading action. Refresh and plan acknowledgement preserve this draft. Closing the app clears it, so check history before re-entering an uncertain save. Profile/questionnaire writes, reports, push, offline sync, biometrics, Zoe and care-team support remain in the roadmap.

Sessions use Expo SecureStore with device-only access while unlocked. Native storage errors block access rather than fall back to plaintext. Keychain payload-size behavior must be tested with actual account claims on target devices. App memory holds health records only for the active member session; requests abort and records unmount on sign-out/account change. A configured backend session is still required by RLS for every data request.

Brand colors, dimensions and typography scale are generated from the vendored CSS using `scripts/theme.mjs`; `pnpm check:theme` detects drift. Fonts are bundled. The current icon is the existing web icon for development; store-grade assets and signing IDs must be finalized before release. `health.noreon.patient` is a provisional bundle/package identifier, not a registered store application.

The existing patient web app remains in the main Next project. Staff remains web-first; shared versus separate staff mobile packaging is an open product decision.

## Dependency audit (2026-10-12)

The router's transitive URL decoder is overridden to `decode-uri-component@0.5.0` for [GHSA-vcc3-ghjq-m6fr](https://github.com/advisories/GHSA-vcc3-ghjq-m6fr). The committed pnpm patch preserves query-string's CommonJS call contract with the decoder's ESM default export. A malformed-input regression runs in a subprocess with a deadline. Xcode's UUID dependency is overridden to 11.1.1 for [GHSA-w5hq-g745-h8pq](https://github.com/advisories/GHSA-w5hq-g745-h8pq); parsing the generated Xcode project and UUID generation were checked.

`pnpm audit --prod` still reports two unpatched high advisories: [node-forge signature verification](https://github.com/advisories/GHSA-86w9-cpqp-85rv) through Expo CLI/code-signing tooling, and [braces stack exhaustion](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) through Metro's file globbing. They are in the build dependency graph; neither appears in either platform's exported production source map. Do not treat this as a clean audit or proof that build tooling is safe for untrusted certificates/patterns. Recheck upstream fixes before enabling distribution; build only trusted source/configuration. The patched decoder is present in both production maps.

### Daily medicine reports

The native dashboard reads the published plan, all active plan medicines and paged dose reports for today and the preceding Armenia day. It reuses the web schedule/eligibility functions, labels Armenia time explicitly, and includes the existing +15-minute cross-midnight allowance. Taken/skipped reports and corrections call the owner-bound, revision-checked RPC shipped in PR87. An uncertain request retains the exact status and revision for retry; a newer fetched revision replaces the local pending state. Corrections remain in the server history. Closing the app discards in-memory pending requests: check the latest status before another report.

Dashboard reads use a fixed verified token, refresh on foreground and Armenia day change, and update the displayed clock locally each minute, and preserve the BP draft. Failed refresh or a snapshot from another Armenia day disables new dose reports; the server always rechecks ownership, current plan, schedule and revision. This is not an offline submission queue. Enabled sign-in and real-device acceptance are still required before distribution.

### Reminder preferences

Native settings reuse the web schema/defaults and existing revision-checked RPC. They preserve edits across refresh, retain exact pending payloads after uncertain saves, and require explicitly loading the latest settings after conflicts. All reminder times are Armenia time, and they do not alter prescriptions. Saving settings does not enable phone, SMS, WhatsApp or push delivery. Shared validation imports resolve to the native pinned Zod dependency in Metro, TypeScript and the Node test runner; other packages keep their own resolution. Root web dependencies are not required for a mobile-only install.

### Request deadlines

Dashboard/history/settings reads and BP, dose and acknowledgement requests bound authentication as well as data transfer. Saves have a single 15-second deadline. An authentication response arriving after cancellation cannot start the later data operation. Timeouts remain uncertain outcomes when a write may already have reached the server; existing exact-payload/revision retries remain necessary. This does not add an offline queue or change sign-in/OTP configuration.


### Member navigation

The signed-in native app separates Home, Progress, Care plan and Me. Home contains dose reports and BP entry; Progress contains paged readings/released results; Care plan contains published instructions and acknowledgement; Me contains language, reminder settings and sign-out. Live Zoe/support is still outside this native release.

Records are fetched once in a member-scoped provider. Edits and exact uncertain retry payloads are held in a separate in-memory store above the screens, survive tab switches and screen remounts, and reset on account changes/sign-out. No health drafts are written to disk. A failed refresh is shown on every tab; Me retains sign-out access even if records cannot load.

`pnpm test:ui` runs rendered router/form checks under Jest Expo with fictional data and mocked transport/auth boundaries. It checks direct-route guards, account changes, late response rejection, failed-refresh behavior and BP/dose/reminder retry retention through forced remounts. These do not replace physical-device or hosted-auth acceptance. The testing-only renderer is pinned to 1.2.0 because 1.3.0 pulls a reconciler requiring React 19.3, while this app uses 19.2.3. The Jest resolver maps only shared-source Zod and generated Babel helpers to the native dependency tree, preserving other packages' resolution.

The rendered-test dependency graph also reports the unpatched moderate [sprintf-js precision advisory](https://github.com/advisories/GHSA-hp3w-g68c-fv3c), through Jest/Istanbul command-line parsing. Expo Router lists the testing library as a peer, so audit includes that path despite its test-only use. Recheck upstream before accepting untrusted test/build inputs; this is not a clean dependency audit.


### Authentication lifecycle

Each native Auth SDK instance has a revocable credential and network boundary. Retiring it prevents late reads/writes/removals from touching the active session. The SDK-facing adapter returns empty storage and discards mutations for retired instances, while the provider rejects their late operation results. This avoids the installed SDK's uncaught background initial-session read errors. Disposal runs immediately and after pending initialization settles so retired clients cannot restart refresh timers.

Initialization, OTP operations and local cleanup have 15-second visible deadlines. A hung or failed SecureStore deletion leaves access closed; a replacement client cannot start until deletion actually succeeds. Retrying does not skip a stuck native operation, and the app must not claim device logout completed after a deletion error. A process restart can reload an old credential if native deletion never completed; real-device failure acceptance remains necessary.

Local deletion is independent of best-effort server revocation. Revocation uses a copy of the old session only, refreshes an expired/near-expiry token in memory if needed, and calls local-scope logout within one 15-second deadline. It never persists rotated credentials or touches the replacement login. Offline/failed remote revocation remains unconfirmed; already-issued access tokens retain existing expiry behavior. CAPTCHA success/verification phase guards prevent duplicate requests and do not automatically resend codes. Native sign-in stays disabled pending hosted Auth/provider verification and physical-device acceptance.

Regression tests include the installed Supabase SDK with fictional, intercepted transport and in-memory storage: a delayed old verification response cannot overwrite a new session, old sign-out cannot remove it, and late SDK initialization leaves no refresh timers. No hosted OTP or member mutations are part of these tests.

## Native profile and questionnaire

The member area now checks the authoritative journey before showing the four tabs. Missing profile/consent, incomplete answers and urgent answers open the focused native journey. Me offers profile and answer review. Field definitions, bounds, branching, progress and emergency guidance come from the existing shared clinical modules; local urgent answers show guidance before any network operation.

The fixed-origin bearer transport uses `/api/native/journey` on `app.noreon.health`. The server endpoint and native sign-in remain disabled until their documented activation gates are met. No service credential enters the native package. The pilot information-use disclosure mirrors the web flow; this is not new clinical/legal approval.

Every save uses the loaded revision and must be followed by an authoritative read before progression. A failed/uncertain write or stale/concurrent read locks further writes. Explicit “Reload saved values and replace this edit” performs GET only and replaces the edit after success. Foreground checks preserve active drafts when the server revision changes and surface newly observed urgent guidance. Back validates and saves before moving; Clear explicitly removes the saved answer. Completion requires confirmation and a fresh nonurgent complete state. Drafts remain memory-only and are removed on logout/account switch.

Native journey now has distributed per-member request admission (120/fixed UTC minute and 5,000/UTC day); 429 preserves drafts and requires explicit recovery.

Remaining: hosted Auth abuse controls and consent/clinical acceptance before activation; real-device accessibility/lifecycle acceptance; report upload, support/service/continuity views, push/deep links and store delivery. Android/iOS exports and iOS simulator builds do not establish Android APK or physical-device acceptance.

Completed member tabs remain mounted during a foreground questionnaire refresh; a failed check displays a retry notice. Confirmed newer incomplete/urgent state closes access. Required profile/consent correction never hides already saved urgent guidance. These paths have rendered regressions; physical-device and activation acceptance remain pending.
