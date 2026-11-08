# Member web version 6 acceptance

Reference: `Noreon Health Patient Journey (6) - Reviewed.html`, supplied on 12 October 2026. Scope is the member web app; native apps, provider activation and clinical policy are unchanged.

The member shell, Home, Progress overview, Pressure, Tests, Habits, Zoe, Care plan and Me follow the reviewed design using real available records. Walking, goals, Zoe chat, programme milestones, treatment targets and additional settings remain clearly marked Coming soon with disabled actions. The full walking/goal placeholders are consolidated in Habits; the overview walking summary and important Home next actions remain. This is a deliberate reduction of unavailable-feature duplication, rather than exact duplication of the prototype's simulated working features.

Pressure summaries show exact latest/average values without decorative bars that could imply a shifting scale. Reading counts have a neutral outline without a completion percentage. Medicine calendars distinguish reported taken, skipped and missing reports and retain latest corrections. Lab statuses use only supplied lab bounds, including one-sided bounds; unknown ranges remain unknown. Published-plan and urgent-presentation authority remain in place. Generic Get help reaches the authenticated help page with Call 103 and no automatic-notification promise.

Armenian narrow Progress tabs use two rows, and navigation labels stay readable. Date labels use explicit Armenian names with numeric Gregorian/Latin parts in the caller's requested Yerevan or UTC timezone, avoiding server/browser ICU differences. English formatting keeps its existing options. Shared CareSection retains its original staff fallback; journey styling is scoped to the member shell.

## Verification on the local fictional member

- All eight screens captured at 320, 390 and 1280 pixels in both EN/HY. Actual viewport dimensions were checked; no horizontal overflow or browser error logs in the final matrix.
- Exact reference/app viewport comparisons inspected by Claude Opus 5.5 and an independent GPT-6 Astra medium review. Their substantive findings were corrected and closed. Approval concerns inspected code and rendered screens, not feature availability or release.
- Actual interactions: chart range selection, recorded-value disclosure, 11 October calendar report (one taken, zero skipped), unknown unreported day, Home current-page marker, disabled Zoe textbox/Send, and Help route with `tel:103` without placing a call.
- Temporarily empty local fictional measurements/reports showed unknown summary values and empty chart/calendar messages; original data was restored.
- Local snapshot outage was injected and browser reload recovered after restoration. The captured failure is a Next development overlay; usable production outage/retry behavior is not established by that image. Loading-state coverage is not claimed.
- Staff card scope checked using the actual shared component and generated application CSS: staff block layout, 24px desktop padding/radius and original shadow; member flex layout, 16px padding, token-derived 20px radius and 12px gap. This is an isolated component check, not a staff end-to-end journey.

Fresh checks: 107 TypeScript checks passed; typecheck, build and token checks passed; lint passed with two pre-existing unused-variable warnings. All migrations replayed successfully in the isolated `noreon-integrity-replay` database, preserving the separate member fixture database. New actual-render regressions cover summary/ring semantics, current navigation, one-sided lab status and Armenian fallback formatting, including the original failing cases.

Local review artifacts and logs are recorded in the implementation handoff under the parent workspace's `output/` directory. No provider call, migration edit, credential change, real member test write or live release is represented by these checks. Hosted release verification must be recorded separately after deployment.
