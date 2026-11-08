# Self-hosted CI runners

The Verify workflow can run on self-hosted runners instead of GitHub-hosted
machines, so CI does not spend Actions minutes. Two repo variables choose the
runner labels, as a JSON array:

| Variable | Job | Unset |
| --- | --- | --- |
| `VERIFY_RUNS_ON` | `verify` | GitHub-hosted `ubuntu-latest` |
| `MOBILE_RUNS_ON` | `mobile` (Expo checks) | falls back to `VERIFY_RUNS_ON`, then `ubuntu-latest` |

| Value | Runs on |
| --- | --- |
| `["self-hosted","noreon-ci"]` | any Noreon runner (Hetzner x86 servers and the ARM Mac runner) |
| `["self-hosted","noreon-ci","X64"]` | the x86 runners only |

Normal setting: `VERIFY_RUNS_ON=["self-hosted","noreon-ci"]` and
`MOBILE_RUNS_ON=["self-hosted","noreon-ci","X64"]`. The mobile job's Expo export
runs the Hermes compiler, which crashes (SIGSEGV) on the ARM Mac runner, so it
stays on x86; verify can use every runner.

```bash
gh variable set MOBILE_RUNS_ON --repo noreon-health/noreon-core --body '["self-hosted","noreon-ci","X64"]'
gh variable set VERIFY_RUNS_ON --repo noreon-health/noreon-core --body '["self-hosted","noreon-ci"]'
```

Switch back to GitHub-hosted at once, without a PR, if the self-hosted runners are down or the
runner is broken:

```bash
gh variable delete VERIFY_RUNS_ON --repo noreon-health/noreon-core
gh variable delete MOBILE_RUNS_ON --repo noreon-health/noreon-core
```

The temporary burst server (`output/workflow-tools/ci-burst/`) is removed from
Khikar's Mac. `ci-burst-watchdog.yml` runs on GitHub every 3 hours and deletes any
server labelled `purpose=noreon-ci-burst` older than 24.5 hours, for when the Mac
is off. Its token is an environment secret limited to `main`.

Deploy and audit workflows stay on GitHub-hosted runners: they hold production
secrets, and the runner never sees them.

## What it is

Three runners, all with the label `noreon-ci`. GitHub hands each queued job to
whichever is free, one job per runner at a time.

| Runner | Where | Labels GitHub adds | Role |
| --- | --- | --- | --- |
| `noreon-ci-hz1` | Hetzner server `noreon-ci-1` (Falkenstein) | `Linux`, `X64` | main runner; also runs the uptime monitor (`output/workflow-tools/uptime/`) |
| `noreon-ci-hz2` | Hetzner server `noreon-ci-2` (Falkenstein) | `Linux`, `X64` | main runner |
| `noreon-ci-mac` | Colima VM `noreon-ci` on Khikar's Mac | `Linux`, `ARM64` | extra runner, only while the Mac has memory to spare |

The mobile job's Expo export runs the Hermes compiler, which crashes on ARM64,
hence `MOBILE_RUNS_ON` with the `X64` label (above).

Each runner is a container `noreon-ci-runner`, built from GitHub's
`ghcr.io/actions/actions-runner` image plus git, python3 and build tools, with
`NOREON_ISOLATED_CI_RUNNER=noreon-ci` in its `.env`. It uses its host's Docker for
the CI Supabase stack (fixed name `supabase_db_noreon-core`, ports 54321-54329
inside that host only), so two jobs never share a database. A Verify job takes
about 15 minutes; its limit is 40.

- **Hetzner servers:** Ubuntu, key-only SSH, automatic security updates (reboot
  at 04:00 UTC if needed), 4 GB swap, weekly image and cache clean-up. Set up
  with `output/workflow-tools/ci-runner/server-setup.sh`, registered with
  `register-runner.sh` (Noreon folder). Never stop, change or reboot them from a
  lane.
- **Mac runner:** a LaunchAgent (`com.noreon.ci-memory-guard`) runs
  `output/workflow-tools/ci-runner/swap-guard.sh` every minute. Below 25% free
  memory (or critical pressure) for 3 minutes it drains the Mac runner by
  removing its `noreon-ci` label, so GitHub sends it no new jobs while a running
  job finishes; at 35% free for 3 minutes it restores the label, starting the VM
  first if needed. It never stops the runner (that once lost a job just being
  assigned). It also kills orphaned `vercel` CLI processes. Log:
  `swap-guard.log` next to it. Never stop the `noreon-ci` VM by hand. The VM
  mounts no part of the home folder and has port forwarding off, so PR code that
  reaches its Docker cannot reach the Mac's files or a lane's database.
- The second Mac VM, `noreon-ci-2`, is retired (18 Oct).

## Operate

```bash
gh api repos/noreon-health/noreon-core/actions/runners --jq '.runners[]|.name+" "+.status+" "+([.labels[].name]|join(","))'
ssh root@<server-ip> docker logs --tail 20 noreon-ci-runner      # a Hetzner runner
docker -H unix://$HOME/.colima/noreon-ci/docker.sock logs --tail 20 noreon-ci-runner   # the Mac runner
```

If a runner shows offline while its host is up, restart its container
(`docker restart noreon-ci-runner` on that host). Starting any Colima profile
switches the global Docker context, so lanes address their own VM with
`--context` or `DOCKER_HOST`.

## Database guards

The concurrency checks refuse to run outside an isolated CI database, so they
can never wipe a developer's local stack. They accept GitHub-hosted runners, and
a self-hosted runner only when `NOREON_ISOLATED_CI_RUNNER=noreon-ci` is set. That
variable lives only in the runner container's `.env`; never set it on a
developer machine.

## Adding a runner

Prefer another Hetzner server: run `server-setup.sh` on it as root, then
`register-runner.sh <server-ip> <runner-name>` from the Mac (needs repo admin for
the registration token). The runner registers with the label `noreon-ci`; GitHub
adds `Linux` and `X64`.
