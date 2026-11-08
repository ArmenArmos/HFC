# Trello overnight execution

Baseline: main b5d891d. Audience: Noreon members and clinical/operations staff. Targets: app.noreon.health and demo.noreon.health through normal PR checks and deployment; Zoe remains local only.

## Accepted decisions

- Khikar directly authorizes implementation and release of Ready and Blocked work in this chat.
- Enable real integrations only where existing approved configuration is available. Missing Davidyants prices, payment evidence, devices, clinical policy, recipients and specialist authority cannot be fabricated.
- Member booking preference is a start time, without an inferred duration. Actual provider start/end windows remain required; old preferences remain readable.
- Zoe stays a local synthetic prototype, with no hosted flag activation.
- Pilot master is a reference, not another implementation task. Guide & Ideas is outside the execution queue.

## Observable acceptance and backlog

| Work | Acceptance | Current evidence / remaining work |
| --- | --- | --- |
| Optional waist | Blank Continue or Skip saves UNKNOWN; invalid numeric answers and required height/weight remain validated; EN/HY and back/resume work | Actual blank Continue, back/resume and persisted UNKNOWN verified locally; clinical conformance passed; release pending |
| Exclusive test selection | Named confirmation before incompatible switch; Cancel retains; outstanding tests visible; new/reschedule preserve saved requests | EN/HY handlers and actual local browser new/reschedule confirmation, Cancel and persistence passed; shared/real UI already has independent selections; release pending |
| Start-only preference | New/change member requests store start only; no invented end; old saved windows and strict provider proposals remain valid | Clean isolated migration replay, generated types, 62 SQL checks and member contract checks passed; shared browser and release pending |
| Questionnaire recovery | Reproduce genuine stale-revision conflict and transient failure; Retry retains draft; reopening explicitly discards and restores usable latest saved state | Genuine two-session stale-revision conflict, Keep draft and confirmed Discard/reload verified through browser. Missing discard warning added. Original intermittent single-tab trigger was not reproduced; do not claim its cause proven. Release pending |
| Long Home | Exact supplied reference section sequence, existing prescription/BP/report actions, honest unsupported metrics, urgent gates, EN/HY and narrow/desktop rendering | Integrated Home rendered EN/HY mobile/desktop against supplied reference. Actual medicine and BP actions persisted, invalid/stale reports rejected, breathing controls verified. Independent Astra review has no unresolved serious findings. Release pending |
| Zoe | Four synthetic scenarios and evidence/barrier/control/log/metric boundaries, local clickable verification | Local branch local/zoe-comb-prototype commit3d8998e: four scenarios, controls, synchronization and narrow EN/HY rendering verified; build passed and production route404. Independent late-sync finding fixed. No hosted activation |
| Twenty pilot phases | Reuse verified existing foundations; explicit clinical publication gates and unavailable external integrations; do not treat a rehearsal as a real integration | All20 phase cards commented with exact missing inputs, mentioning Yesayi at Khikar’s request, and moved to Blocked (fresh board readback confirms20). Master moved to Guide & Ideas. Disabled synthetic rehearsal is draft PR150; authenticated local entry verified. No partner/clinical activation or completed real-integration claim |

## Findings and verification constraints

- A full TypeScript regression run initially encountered two environment failures: a test had a fixed list of local container names, and one SQL-dependent check raced the isolated database reset. Record and rerun those concrete checks after replay completes; do not hide them.
- Trello returned intermittent 429 responses during attachment/claim operations. Read back list membership and comments before reporting board changes.
- Native worktree creation failed because the chat root is above the repository. Git-created isolated worktrees preserve the original checkout and unrelated changes.
- No live payment/device/DSD API/clinical escalation activation is authorized merely by a synthetic rehearsal.

## Next release gates

Complete focused/self verification, one independent Astra review of concrete diffs and rendered evidence, resolve findings, run required CI, merge using normal rules, verify intended deployment SHA and affected live journeys, then post evidence and move only satisfied cards to Done.

## Latest verification findings

- Final integration CI failed a formatting-sensitive static regex for the existing default-off Zoe gate; gate behavior remained intact. Whitespace/trailing-comma tolerance added; focused gate check passed. Required CI must be rerun.
- Reschedule recommendation heading now distinguishes editable recommendations from saved requests; current requests stay recorded until explicit save. Named group confirmation and cancel verified in actual browser.
- Temporary development fixture/readback routes moved out of the worktree before the final build; they are never deployed.
- Actual reduced-motion emulation was unavailable in the browser API; source motion-reduce behavior reviewed, no claim of emulated coverage.
