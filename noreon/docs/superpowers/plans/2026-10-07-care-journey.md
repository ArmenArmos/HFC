# Connected Care Journey Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Demonstrate a coherent, resettable fictional care workflow across patient, doctor and coordinator roles.
**Architecture:** Keep the authenticated patient foundation. Build a clearly separated scenario workspace with a pure transition model, atomic IndexedDB persistence and small role components. Reuse the approved clinical engine and brand tokens, not old demo side-effect approvals.
**Tech Stack:** Existing Next.js, React, TypeScript, Recharts, browser IndexedDB/Web Locks; no new dependencies.
**Spec:** docs/superpowers/specs/2026-10-07-care-journey-design.md

## Global constraints
- Fictional scenarios only; no real device/lab/SMS/appointment integration.
- Do not edit vendored styles/noreon or docs/clinical, nor recreate medical thresholds.
- Patient/doctor/coordinator share case state; role selection is a demo control, not authorization.
- Existing public marketing remains informational; no new marketing registration CTA.
- Date/units/source visible; doctor decisions versioned and never happen just by opening views.

## Review focus
- Approval invalidation when history or results change; urgent-case prevention.
- Concurrent tabs and sign-out cannot undo acknowledged mutation or logout.
- Missing/unknown clinical inputs cannot become reassuring facts.
- Invalid/duplicate result imports preserve existing state and cannot inject content.
- Mobile operability, language ancestry, timezone and fictional provenance.

## Task 1 — Domain and storage
- [ ] Define typed case/test/result/plan/reading/event contracts and pure reducer under lib/journey.
- [ ] Write failing tests for gates, invalidate-on-change, imports, reset, idempotency, and source distinctions.
- [ ] Implement three seeded fictional cases, clinical-engine test proposal adapters, and validated JSON fixtures.
- [ ] Implement atomic IndexedDB updates, BroadcastChannel notifications and expiry keyed by demo identity.
- [ ] Run tests; review and commit.

## Task 2 — Connected role views
- [ ] Build workspace provider and role/scenario navigation, persistent demo banner, timeline and reset controls.
- [ ] Patient: history, test progress, approved plan, results charts/data, BP trends, medication reports.
- [ ] Doctor: case queue, findings, edit/approve test proposal, results interpretation, versioned publication, follow-up alerts.
- [ ] Coordinator: ownership, appointment/test logistics and pending queue without clinical approve buttons.
- [ ] Add JSON import/example download or paste affordance with validation and actionable errors.
- [ ] Review each role with fixtures and test no-view-side-effect/approval gate behavior.

## Task 3 — Astra fixes and integration
- [ ] Regression-test demo Web Lock serialization including sign-out and unsupported-browser behavior.
- [ ] Add registry non-emergency summary guidance, language attributes, timezone labels and emergency-call controls.
- [ ] Add protected demo-only journey route and dashboard entry; reuse profile/answers context.
- [ ] Check clinical conformance, tokens, typecheck, lint, tests and build.

## Task 4 — Review and release
- [ ] Fresh Astra code/product review; resolve concrete findings and rerun affected checks.
- [ ] Browser walk three roles and scenarios, import, reload/reset, mobile and multi-tab behavior.
- [ ] Push PR, attach artifact, merge and verify Vercel checks/deployment and public link.
- [ ] Report working link, fictional scope, known infrastructure prerequisites and screenshots.
