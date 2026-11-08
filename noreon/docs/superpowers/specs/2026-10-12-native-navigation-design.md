# Native member navigation

## Intent and delegated choice

Continue the overnight roadmap from the reviewed HTML6 and implemented native features. The native application currently places every feature in one long dashboard. Introduce a clear member navigation structure without pretending that the incomplete live Zoe/support journey has shipped. Routine scope/architecture choices are delegated by the user; clinical, provider, store and staff-packaging decisions remain separate.

Use Expo Router JavaScript tabs on the installed SDK57. Four implemented areas: Home (today's medicine reports and BP entry), Progress (BP and released-result history), Care plan (published instructions, medicines and acknowledgement), Me (language, reminder settings and sign-out). The prototype's Ask Zoe/Care team destination remains deferred until its real consent/persistence/support implementation exists; do not add a misleading working chat or synthetic clinical content to the real member app.

Alternatives considered: retaining one long page does not advance the requested app structure; implementing a custom in-component tab switch risks losing route/deep-link behavior and violates the repository's Router preference. Native tabs are possible, but JavaScript tabs reuse the existing router and token-based styling with fewer platform-specific changes.

## State and authorization boundaries

- Keep the disabled configuration and existing-member login outside the protected member route group. Use SDK57-compatible protected routes; do not use SDK58-only redirectTo/custom-navigator APIs.
- A valid, phone-verified auth identity is a UI route prerequisite, never a replacement for backend/RLS authorization. Denied/error/loading auth must not mount member records. Reset the member provider and navigation state on account change/sign-out, including already-mounted inactive tabs.
- Extract the existing shared snapshot/read/foreground/day-refresh behavior into a member-scoped provider. One read batch per refresh, using the same fixed-token verification,15-second deadlines and abort handling. No health records in route params or disk storage. Error and freshness state must be visible on each affected screen.
- Keep exact pending BP payload/UUID and dose/reminder pending revisions intact across ordinary tab switching, language changes and data refresh. Do not rely only on incidental tab mounting behavior: place any pending state that would otherwise be lost in the member-scoped model, or explicitly demonstrate the router's retained-screen behavior under every supported navigation action. Account change/sign-out must clear it. Closing/restarting the app retains the existing documented uncertainty boundary; no offline queue is introduced.
- Existing published-plan filters, missing-data semantics, Armenian schedule timezone and server revision checks remain unchanged. No new clinical thresholds, notifications or write endpoints.
- A failed refresh continues to disable new dose reports/history/settings actions as before. BP retries retain exact identity; no timeout is interpreted as proof the write failed.

## Presentation

Use vendored/generated brand tokens, existing typography, EN/HY labels and accessible text labels. Keep platform safe areas, keyboard handling and scrolling intact. Show only implemented destinations. Me owns language/sign-out controls; the public login still offers language switching. Avoid duplicate nested scrolling or headers that consume the small-screen working area.

## Verification and release

Test route-access decisions, member reset and snapshot lifecycle, plus preservation of pending BP/dose/reminder state across navigation/refresh. Exercise cancellation and stale responses. Validate actual tab navigation and form retention in a local synthetic harness without sending OTP or reading/mutating real member data; remove temporary harness code before commit. If signed-in physical-device acceptance cannot be performed, record that limitation explicitly.

Run native tests/typecheck/lint/theme check, both platform exports and iOS Release simulator build; root checks appropriate to shared changes and CI. Review the material auth/state-loss boundaries with Claude once the implementation is concrete. Merge only after checks/review, verify relevant deployments. Keep native Auth, messaging, store distribution and synthetic Zoe production gates unchanged.

## Documentation consulted before implementation

- https://docs.expo.dev/versions/v57.0.0/
- https://docs.expo.dev/router/advanced/tabs/
- https://docs.expo.dev/router/advanced/protected/

Installed Expo57/RN0.86 remains authoritative for supported APIs. Latest documentation contains SDK58-only features; exclude those. Protected routes are client navigation controls and do not replace server access checks.
