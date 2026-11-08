# Member loading feedback and doctor enrichment

The first navigation fix removed duplicate snapshots. Home, Tests and Reports still performed a staff lookup followed by a clinic lookup, and member navigation gave no visible acknowledgement during dynamic server rendering.

Acceptance: one doctor/clinic enrichment request with the same inactive/missing display semantics; immediate feedback only on the clicked destination; stable navigation dimensions; fresh data and registration/clinical authority unchanged.

The staff query now uses its existing clinic foreign key as a left embed, so missing clinic data retains the doctor name with `active:false`. No persistent record cache or full-page prefetch is introduced. Main navigation shows a spinner in the existing icon slot; Progress labels pulse while pending. EN/HY accessible status and reduced-motion classes accompany the visible feedback. This is pending feedback, not a claim that a page has finished loading. The patient shell remains in its existing location; no loading fallback bypasses page authorization.

## Verification

- Doctor HTTP-boundary regression failed on the old two-query implementation and passed with one query. It covers inactive/missing clinic, missing/wrong-role doctor, no assignment, unavailable query and fresh later calls.
- Existing shell render check covers current-page markers and supplied pending states in both languages. Its mocked hook does not prove browser navigation; actual browser checks below supply that evidence.
- Production-built Next requests against the actual local database show one snapshot plus one staff request on Home/Tests/Reports, zero separate clinic requests. Other checked member routes retain one snapshot.
- Actual browser navigation with a deliberate three-second loopback snapshot delay showed `Opening Home` on the clicked main link at390px, and `Opening Pressure` on the clicked Progress tab at1280px. The indicators clear on completion. Link dimensions were identical before/during pending (Home71.59375×64; Pressure172.5×44); no desktop overflow. Rapid Tests→Care plan navigation removed the superseded status and retained only the latest destination's status. The injected delay was removed.
- Rendered pending screenshots were inspected at both sizes. No health-record mutation was needed for these checks.

Sanitized local evidence: `/tmp/noreon-nav-phase2-counts.log`, `/tmp/noreon-nav-phase2-suite.log`, `/tmp/noreon-nav-phase2-lint.log`; images in parent `output/navigation-latency-review/pending-main-mobile.png` and `pending-progress-desktop.png`. Typecheck, targeted lint and production build passed. Full suite and independent review results are recorded in the parent handoff.

## Findings and remaining acceptance

| Item | Disposition | Evidence |
| --- | --- | --- |
| Serial doctor/clinic enrichment | Locally verified | Actual database request counts and boundary regression |
| Unacknowledged navigation click | Locally verified | Delayed actual browser clicks and stable rendered layout |
| Superseded destination indicator | Closed | Actual rapid navigation check |
| Live release and navigation timing | Pending | Must confirm exact deployment and repeat affected live flow |

This patch does not enable real registration or WhatsApp. It does not claim reduced-motion device testing, production outage UX acceptance, or a new full V6 visual review.

Independent Astra medium and actual Claude Opus5.5 reviews approve the concrete code and rendered evidence with no blocking findings. Full suite109 checks passed; full lint zero errors/two existing warnings. Claude's nonblocking note is retained: Progress pulse is subtle, and a shared live announcement/progress region may be clearer than status text inside a link. Defer that wider feedback design until user experience warrants it; do not represent screen-reader device acceptance as established. Claude's plan suggestions were checked against code and incorporated, with Auth audit preceding public rollout and SMS remaining an explicit alternative rather than an assumed fallback.
