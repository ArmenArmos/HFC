# Supply chain: dependencies, SBOM and code scanning

Updated 18 October 2026. Standards backlog item 6 (OWASP ASVS L2 V14, NIST SSDF PW.4/RV.1).

## What runs

| Piece | File | When | Cost |
| --- | --- | --- | --- |
| Dependabot version updates | `.github/dependabot.yml` | Mondays 06:00 Yerevan | One grouped minor/patch PR per ecosystem per week (web npm, mobile npm, GitHub Actions); majors come as separate PRs. Each PR runs Verify. |
| SBOM (CycloneDX 1.7, JSON) | `.github/workflows/supply-chain.yml` | Pushes to main and ready PRs that change a lockfile, Mondays, by hand | About 2 minutes, on the runner `VERIFY_RUNS_ON` names. Artifact `sbom-<sha>` kept 90 days: `sbom-web.cdx.json`, `sbom-mobile.cdx.json`. Generated from the lockfiles with `@cyclonedx/cdxgen` (pinned); nothing is installed and no package script runs. |
| Production dependency audit | same workflow | same | `pnpm audit --prod --json` piped to `scripts/audit-gate.mjs`, once for the root lockfile and once for `apps/patient-mobile` (its own lockfile), fails on high or critical advisories in runtime dependencies. Advisories with no published fix that only reach build tooling can be accepted in `scripts/audit-accepted.json`, each with a reason and an `until` date after which the audit fails again. A failed scheduled run emails the repository admins. |
| CodeQL (javascript-typescript, security-extended) | `.github/workflows/codeql.yml` | Pushes to main and Mondays, GitHub-hosted runner | **Off** until the repository variable `CODEQL_ENABLED` is `true`. See below. |

## Integrator steps (free, settings only)

In GitHub, `noreon-health/noreon-core` → Settings → Code security:

1. Turn on **Dependency graph** and **Dependabot alerts** (free for private repositories).
2. Turn on **Dependabot security updates** (opens fix PRs for alerts, outside the weekly schedule).
3. Leave **Grouped security updates** on, so a burst of advisories is one PR.

Dependabot PRs open ready, so CI runs on each. If Actions minutes get tight, lower
`open-pull-requests-limit` rather than turning updates off. Merge them through `scripts/merge-pr.mjs`
like any PR; the Next.js major is pinned on purpose (AGENTS.md), so review major PRs by hand.

## CodeQL needs a decision (Khikar)

The repository is private on GitHub Free. Code scanning results for private repositories need
**GitHub Code Security** (paid, per active committer per month), and the CodeQL licence covers
private code only with that licence. So the workflow ships switched off. Options:

1. Buy Code Security for this repository, then set the repository variable `CODEQL_ENABLED=true`.
   Results appear under Security → Code scanning. Runs on GitHub-hosted runners weekly and on main
   (about 6 to 10 minutes a run).
2. Use a free scanner instead (for example Semgrep Community Edition with its open rules, run in the
   supply-chain workflow and kept as an artifact). A follow-up PR can add it.

The pen test before real members (backlog item 6) is a separate purchase.

## Reading an SBOM

Download the `sbom-<sha>` artifact from the workflow run. Each component carries its package URL
(`purl`), version, licence when declared and scope (`required` for runtime, `optional` for dev
tooling). To check one advisory against a release: find the deployed commit, open that commit's
supply-chain run, and search the SBOM for the package name.
