# Report import implementation plan

> Execute inline with superpowers:executing-plans; obtain one fresh whole-branch review.

Goal: privately import previous reports, review extracted fields, save provenance and explain confirmed results.
Architecture: owner-scoped private Supabase storage and report rows, server-authenticated routes, strict OpenAI Responses extraction, member review, independent imported-result trends.
Spec: ../specs/2026-10-08-report-import-design.md

Global constraints: PDF/JPEG/PNG; 8 MB; ten PDF pages; no clinical rule edits; no real uploads in demo; five member attempts per UTC day per operation; 50 global attempts; store:false; source pages and literal values; no silent unit conversion.

Review focus: comparator values must never plot as exact numbers; missing date must remain missing; stale processing must not overwrite corrections; private originals must not be public; AI confirmation must not publish a clinical review.

## Task 1: domain validation and provider
- [ ] Add scripts/check-reports.ts with real validation cases: missing dates, comparator, qualitative, duplicate keys, source pages, malformed data and incompatible units.
- [ ] Run with node --import ./scripts/register-alias.mjs scripts/check-reports.ts; observe missing module failure.
- [ ] Implement lib/reports/schema.ts: ReportExtraction and ReportRow schema, validateReview, trendPoints, fixed marker/unit catalogue.
- [ ] Implement lib/reports/files.ts: signature check, pdf-lib page/encryption validation, sharp decode and pixel limits, checksum.
- [ ] Implement lib/reports/provider.ts: stateless Responses request, no tools, schema validation, sanitized errors, fixed timeout and output limit; test request and refusal with deterministic HTTP fixtures.
- [ ] Run domain tests, typecheck and lint.

## Task 2: private persistence and concurrency
- [ ] Create migration with pnpm db:new report_import. Create patient_reports with user_id, object_path, checksum, extraction/review JSON, state/revision, consent and model/prompt provenance; enable owner SELECT RLS and service-only writes.
- [ ] Create private bucket with 8 MB/type limits; signed upload only, owner-scoped reads linked to undeleted report.
- [ ] Add service-only claim_report_job RPC: advisory lock quota, five member attempts and 50 global attempts, leases, monotonic revision.
- [ ] Add scripts/check-report-db.mjs testing two-account isolation, denied direct writes, duplicate active claims, quota, stale revision and tombstoned read denial.
- [ ] Replay pnpm db:reset, regenerate pnpm db:types and run database tests.

## Task 3: authenticated transport and review screens
- [ ] Implement lib/reports/server.ts: verified member + registered profile + feature gate; ownership checks around admin storage; origin checks; bounded JSON body.
- [ ] Implement /api/patient/reports actions: create signed upload, list/read, process, confirm, explain, original download and delete; reject demo; sanitized errors; CAS writes; deletion tombstones.
- [ ] Implement /patient/reports with upload, consent, progress/errors/retry and history. Implement review form with original value/page next to corrections, explicit identity confirmation, date validation and preserved original extraction.
- [ ] Link Results to imported reports; graph only confirmed exact numeric values with recognized marker/unit. Keep imported results separate from care order completion.
- [ ] Demo uses a clearly labelled fictional sample, never accepts uploaded files or calls provider.
- [ ] Verify typecheck, targeted lint, build and design tokens.

## Task 4: verification and rollout
- [ ] Test fictional English/Armenian/Russian documents, refusal/injection, corrupt/oversized PDFs, wrong account access, repeat confirmation and correction persistence.
- [ ] Review mobile upload/review/history in browser and capture screenshots.
- [ ] Fresh independent code review; fix actionable findings and rerun affected tests.
- [ ] Commit and open PR. Apply hosted migration through CI only. Keep NOREON_REPORT_IMPORT_ENABLED unset until real provider and signed-in end-to-end checks pass; SMS remains an independent blocker.

Execution ruling: proceed inline under the user's repeated explicit instruction to implement; no extra planning approval loop. Provider-live evaluation may require a deployment using the non-readable production secret. Do not claim it passed based on mocks.
