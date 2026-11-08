# Synthetic Zoe coaching in the member journey

## Authority and scope

Implement the four accepted Yesai/Trello deliverables: behavior records and rules, a structured intervention library, a small contextual member interaction, and outcome logs with scenario/edge-case tests. Reference the consolidated review `output/Noreon_Journey_HTML3_Review_For_Armen_2026-10-11.md`, latest reviewed HTML6 and the product roadmap. The overnight delegation authorizes routine implementation choices. This is synthetic-only; live clinical advice, real recipients/SLAs, outbound messaging, production behavioral profiling/retention and live rollout are not approved by that scope.

The interaction belongs beside an existing daily BP/medicine action. It is not a new general-purpose chatbot or another clinical engine. Use shared event identities and schedule concepts from `lib/patient-care`, but do not copy the HTML's mutable global state. Keep the implementation behind a server-side synthetic-preview flag, off by default. Fixtures and their simulated evidence are explicitly labelled and isolated from real/member records. The preview must not mutate actual care, reminders, readings, doses or delivery queues. A locally exercised preview can be merged disabled; enabling it on a hosted environment is a separate release choice.

## Behavior

Start from **not recorded**, which means unknown. Offer already done, remind later, or something makes this difficult. Requesting help never records a skipped dose. Already done opens evidence reconciliation: choose the intended event and actual time, distinguish a repeated report from a separate observation, and retain reported time separately. Do not claim ingestion from a self-report.

Only a member-confirmed barrier may select a behavioral suggestion. Unknown and multiple barriers are valid; missing data alone proves none. Any COM-B hypothesis stays internal, records its evidence/confidence and is retractable by member correction. Avoid a model dependency: explicit rules are sufficient for the approved synthetic adaptation.

Provide one relevant suggestion, then accept/change/decline. Preserve HTML6's one first suggestion per Armenia day plus one explicitly requested alternative, 14-day declined-intervention cooldown and 21:00–07:00 quiet hours for proactive suggestions. Member-initiated help remains available. Pause/off suppress coaching while leaving independently enabled reminders and human support intact. No silent reminder preference changes or prescription-time changes.

Snooze is a 60-minute simulated request for one event. It expires on plan/day change, evidence completion, coaching/reminder consent changes or a conflicting quiet period. It never delivers a real message. Always display simulated status; never say a nurse was contacted when only a fixture handoff exists.

## Scenarios and library

Cover BP forgetfulness, BP anxiety, medication travel/routine disruption and low perceived importance. The structured library stores stable IDs, topic, explicit eligible barriers, source/version, intervention kind and plain-language copy. Copy is marked synthetic and pending clinical/product approval. Use low-risk routine cues; do not infer dose timing, storage suitability, missed-dose instructions, exercise clearance or measurement prescriptions. Route anxiety, symptoms, medicine concerns, supply/device problems and travel/time-zone clinical questions to a labelled simulated human handoff. Urgent context supplied by the existing safety engine interrupts coaching; do not create another symptom classifier or thresholds.

Travel/routine and importance scenarios cannot be silently omitted because earlier HTML library entries were missing. They may produce a bounded reflection/question or a human placeholder where an actual intervention lacks supplied approval. Silence is valid and must say why a suggestion was withheld without blaming the member.

## Data and outcomes

Use immutable typed records for event identity, plan version, scheduled time, actual occurrence time, report time, submission ID, intervention ID/version, offer/accept/decline/correction and handoff state. Explicit action IDs deduplicate exact retries; a changed payload with the same ID conflicts. All transitions are deterministic against an injected synthetic clock.

An outcome is only eligible for the same event and plan, after intervention acceptance, with actual time no earlier than acceptance. Reporting an older observation later does not establish improvement. Corrections/removal recompute the derived outcome and retain the previous log fact. Show 'recorded after your accepted suggestion', never effectiveness, causal improvement or verified ingestion. A different event, stale plan or expired snooze cannot complete the intended action.

The synthetic session is resettable and must disclose its persistence scope. Do not introduce production schema migrations or use actual patient data to make the demonstration look realistic. A bounded log must reject further simulation with an explicit reset prompt instead of silently deleting history.

## Verification and release gate

Test pure policy and transition behavior for all four scenarios, unknown/multiple/corrected barriers, off/paused/quiet controls, daily and alternative caps, cooldown boundaries, help-versus-skipped separation, before-acceptance late evidence, duplicate versus separate observations, correction/removal, plan/day changes and failed/simulated handoffs. Render the contextual interaction in EN/HY with existing design tokens; exercise browser flows and failure states. Keep clinical guidance authoritative and distinguish placeholder copy.

Claude reviews the important implementation boundaries once the tests and interaction are concrete. Resolve material findings, run relevant root checks/build and CI, then merge with preview disabled. Record any unimplemented accepted scenario or external approval explicitly. This does not complete the broader live Zoe, native journey, staff packaging or WhatsApp/SMS roadmap.
