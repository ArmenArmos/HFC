# Web journey redesign implementation plan

Spec: docs/superpowers/specs/2026-10-12-web-journey-redesign-design.md. Execute inline, based on reviewed HTML6 and explicit web-first request.

1. Map routes/screens and implement responsive shell/navigation. Add meaningful route selection tests; preserve detail links and accessibility.
2. Reorganize Home/Progress/Care team/Care plan/Me, reusing server projections and actual actions. Add Progress sections without duplicating authority; retain direct legacy URLs. Refresh card/heading/action hierarchy.
3. Apply consistent framing to onboarding, measurements, reports, service and account details. Verify real/demo and urgent/empty states remain truthful.
4. Run regression/type/lint/token/clinical/build checks; browser compare mobile/desktop and both languages. Fix material issues. Ask Claude for focused security/correctness and coverage review.
5. PR/CI/exact-head release after review, then report web redesign coverage with screenshots and outstanding backend capabilities. Do not resume unrelated roadmap work.
