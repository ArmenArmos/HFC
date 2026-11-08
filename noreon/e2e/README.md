# End-to-end suite

Real browser journeys against a local, isolated stack. Never against app.noreon.health, backoffice.noreon.health or a hosted database.

## One-time setup

From the Noreon folder, for a lane worktree:

```bash
node output/workflow-tools/lane-ports.mjs <worktree>
output/workflow-tools/vm-start.sh noreon-<worktree-name>
```

Then, in the worktree: `pnpm install`, and `pnpm exec playwright install chromium webkit`.

`NOREON_E2E_COLIMA_PROFILE` overrides the VM name.

## Run

| Command | What | Time |
|---|---|---|
| `pnpm e2e:web` | All web journeys in Chromium | about 2 min |
| `pnpm e2e:web:webkit` | The same in WebKit (not real iOS Safari) | about 2 min |
| `pnpm e2e:telegram` | Telegram into Zoe, back, and the same record in the app | about 5 min |

Each command resets the local database, seeds fictional people, starts its own `next dev` and exits non-zero on failure. To run one file: `node e2e/run.mjs web --project=chromium zoe`. To keep the seeded app up for debugging: `node e2e/run.mjs serve`. Traces and screenshots land in `e2e/.state/results/`.

If the app process exits during a run, the harness reports its exit code and signal, stops Playwright and fails the run. It also checks reachability because Next's CLI can survive a killed server worker; twelve consecutive failed health requests (about two minutes, since a first compile on a small CI server blocks the app for 40 s) stop the run. Check that suite's `app.log` and CI memory artifact before attributing connection errors to product behavior. The harness does not restart the app or retry the suite.

The default web run exercises the existing member screens. The two prototype Home tests require `NOREON_E2E_MEMBER_HOME=true node e2e/run.mjs web --project=chromium member-home`; their skips in the default run are deliberate. The doctor workspace flag stays off and seeded staff sign in to `/staff/real/members`. The urgent-word flow still opens `/patient/zoe/urgent`.

## In CI

`.github/workflows/e2e.yml` runs six legs one after the other, each with its own status and artifact: the Chromium web suite, the new member chat (`NOREON_E2E_CHAT_V2=true`, `member-chat-v2.spec.ts` and `send-before-hydration.spec.ts` only: with the switch on, sign-up lands in it), the rebuilt doctor chat and new nurse chat (`staff-chat`: `NOREON_E2E_DOCTOR_CHAT=true NOREON_E2E_NURSE_CHAT=true`, `doctor-chat-journey.spec.ts` and `nurse-home.spec.ts`, which skip without their switches), the prototype Home (`member-home`, `NOREON_E2E_MEMBER_HOME=true`), the chat kit's look on every Zoe journey (`zoe-kit`, `NOREON_E2E_ZOE_KIT=true`, the `zoe-*` specs) and the Telegram suite. It runs nightly on `main` and by hand on any ref (`gh workflow run e2e.yml --ref <branch> -f suites='["web"]' -f filter=doctor-chat` runs one leg or one file). One run at a time across all refs, so it holds one runner and the other keeps taking Verify. It uses no secrets. Results, app logs and the server's memory are an artifact for 7 days; the peak is in the run summary.

There `run.mjs` uses the runner's Docker and Verify's default project and ports, and only on a Noreon runner (`NOREON_ISOLATED_CI_RUNNER`). Chromium runs in Playwright's own image (`NOREON_E2E_BROWSER_WS`), because the runner has no browser libraries and must not be changed. After a Playwright upgrade, update `PLAYWRIGHT_IMAGE` in the workflow; the job stops with a clear error until then.

## What is real and what is stubbed

- Real: pages, server actions, Auth, RLS and the database.
- Phone codes: fixed `test_otp` numbers added to `supabase/config.toml` by `run.mjs` as a local overlay (skip-worktree, never committed).
- Zoe: `NOREON_ZOE_PROVIDER=fake` in the web suite, a stand-in model in the Telegram suite. Nothing here tests Zoe's answers; evals do that.
- Sending: no provider credentials exist in the app's environment. `net-guard.mjs` refuses server requests to hostnames outside this machine and fails the run. It does not cover literal IP addresses or traffic from the Supabase containers. Browser contexts refuse non-local requests too.

## The Telegram suite

The real webhook route, inbox, sweeps, Zoe pipeline, outbox and app, with signed updates a test writes itself. Everything outside the app is a stand-in on this machine:

- `telegram/fake-api.mjs` plays api.telegram.org: it records every call, answers as Telegram does, and fails on request (`failNext`).
- `telegram/preload.mjs` loads into the app server. It points `api.telegram.org` at the fake and answers every Zoe model call through the AI SDK's own provider hook, so no product code changes and no network is used. The test reads each model call and can script the next answer (`modelSays`).
- The app runs in gateway mode, as on staging, not `NOREON_ZOE_PROVIDER=fake`: Zoe keeps a stand-in provider's text from members, so the fake provider cannot reach the answer paths or the model's 103.
- `telegram/seed.mjs` sets staging's switches. It skips the guards that want a recent model evaluation, because no model is involved.
- Zoe is driven by her real cron route. The webhook's own sweep leaves a run to the cron when it is short of time, and a test must not depend on that timing.

A real press on the real TEST bot is not covered and stays a manual check.

Product regressions remain ordinary failing tests. Do not hide them with `test.fail` or skips. Plain dose logging expects the fixed `logging_request_no_model` reply and then its card, with no model call; a timeout waiting for the run now includes the stored run state, tier and reason, without message text.

## Writing tests

- Assert the stored outcome and reload; a toast proves nothing.
- Pair "absent" with "present", so an empty page cannot pass.
- No conditional skips and no retries. A retry-only pass is a flake to fix.
- Seed prerequisites, never the outcome under test.
- Staff forms carry the case revision they were rendered with. Wait for the stored change, then `caseLoaded()`, before the next command.
