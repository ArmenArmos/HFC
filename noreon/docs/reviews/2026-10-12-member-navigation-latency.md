# Member navigation latency acceptance

The live fictional member journey took about 1.3–1.9 seconds per section switch, measured through browser automation (including its overhead). The V6 acceptance did not measure navigation latency. This change addresses repeated database reads during server rendering; no visual, clinical-policy or provider changes are included.

Acceptance: each normalized shared-demo page render reads one workspace snapshot; new requests, session cookies, saves, urgent state and authorization remain fresh. The deployed member journey must be timed again before claiming live performance acceptance.

React request-scoped memoization is confined to explicit server-render readers. Each consumer receives a clone. Actions and API authorization retain fresh readers. Route authorization now uses the case returned by its single fresh snapshot, keeping consent and returned state coherent.

## Evidence and findings

Production-built local Next HTTP requests reduced snapshot RPCs from Home 11, Progress 10, Pressure 10, Tests 11, Plan 10, Team 10 and Me 3 to one each; Reports also uses one. Legacy fixture normalization can legitimately require additional reads. Separate staff/clinic enrichment remains.

Actual local database/HTTP probes verified subsequent-request freshness, independent cookies, urgent-state precedence, expiry denial, and fresh reports/inbox authorization. A browser profile save appeared immediately after navigating Plan → Me; the fictional fixture was restored. All eight rendered desktop pages were inspected. The modeled React-cache regression is explicitly a mock; actual production-mode HTTP probes establish request scope.

108 TypeScript checks passed, including cloning/projection/fresh-reader regressions. Lint has zero errors and two existing unrelated warnings. Production build passed. Independent GPT-6 Astra medium and actual Claude Opus 5.5 reviews approved the concrete diff and rendered evidence with no actionable findings. Both require post-release live timing. No new mobile visual acceptance is claimed because the change does not alter UI.

| Finding | Severity | Disposition | Evidence |
| --- | --- | --- | --- |
| Repeated render snapshots | User-visible performance | Implemented; local verification passed | Actual RPC counts before/after |
| Freshness / isolation / authorization risk | Correctness | Closed | Actual HTTP requests and save journey; independent review |
| Live navigation latency | Acceptance | Pending deployment and comparable live measurement | Baseline browser timings retained |
| Missing navigation loading feedback | Follow-up if needed | Deferred until live result establishes need | No patient loading boundary; no UX change in this patch |

Local probe scripts/credentials remain ignored. Sanitized evidence and review reports are in the parent workspace output directory. No hosted record writes were performed.
