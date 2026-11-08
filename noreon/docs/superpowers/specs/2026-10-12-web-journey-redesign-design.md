# Patient web redesign

User priority: implement the reviewed HTML6 redesign in the patient web app first. Native work and remaining roadmap are deferred. Existing reviewed prototype and request authorize this implementation; routine decisions remain delegated. Use inline execution and Claude material review before release.

## Scope and visual direction

Home, Progress, Care team, Care plan and Me form the primary navigation. Profile/questions remain onboarding/detail routes; existing deep links keep working. Progress groups overview, pressure, tests and habits. Desktop uses a persistent navigation rail and readable content width; mobile uses five bottom destinations with a prominent central care-team action. Reuse Noreon navy/teal/surface tokens, existing display/body fonts, soft card hierarchy, generous touch targets and restrained section headings from HTML6. Do not copy prototype inline color values or synthetic clinical logic.

Home foregrounds authoritative next action, daily routine, journey progress and health summary, then reports and team access. Progress exposes existing real charts/results and explicit empty states. Care plan retains actual publication/acknowledgement/medication contracts. Me keeps account, language, consent and settings accessible. Onboarding/forms/reports/service pages get consistent framing and spacing without rewriting their state machines.

## Authority and scope limits

Preserve server guards, published-only evidence, stale-write handling, urgent precedence, real/demo distinctions and all clinical rules. No invented clinician names, operational response promises, live chat, appointment confirmations, provider activation or fake adherence/risk metrics. Care team links to real available contact and service features; synthetic Zoe remains separately gated and labelled. New backend service subsystems are tracked as follow-ups, not simulated in the real UI.

## Acceptance

Every patient route remains reachable; active navigation maps detail routes correctly. Responsive desktop/mobile, EN/HY layout, keyboard focus, headings, no horizontal overflow, bottom safe area and no covered actions. Browser walkthrough of fictional local demo states: incomplete onboarding, active care, empty history, results and report distinction, account/service entry and urgent state. Run types, lint, tokens, clinical checks and existing regression suites; build and inspect rendered screens. Claude reviews material permission/publication/navigation regressions before CI/merge/deploy. Deliver explicit prototype-to-app coverage and residual gaps, not a claim of backend parity with a simulation.
