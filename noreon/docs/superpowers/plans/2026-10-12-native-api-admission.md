# Native API admission implementation plan

> Use superpowers:executing-plans inline under Khikar's overnight delegation. Claude independently reviews material risks before merge/deploy.

**Goal:** Distributed per-member admission for native journey, reusable by reports, without changing existing budgets or activation.
**Architecture:** Remote bearer identity → service-only atomic SQL admission → existing bounded journey service.
**Tech stack:** Supabase PostgreSQL, Next16.3.8 route handlers, TypeScript; no new package.
**Spec:** docs/superpowers/specs/2026-10-12-native-api-admission-design.md

## Global constraints

-120 requests/UTC fixed minute and5000/UTC day; provisional activation defaults.
- No change to AI/upload/demo/staff quotas, clinical rules or disabled gates.
- CLI-only new forward migration; isolated database only for local resets; hosted migration via main workflow.
- Admission after verified phone/bearer, before body/state/write; preserve deadline/abort behavior.

## Review focus

- Simultaneous last-slot requests permit exactly the quota; denied requests do not extend windows.
- Retry-After reflects both windows and never returns zero/negative on denial.
- Wrong/unsigned/ineligible identity cannot create another member's quota row.
- Late admission response after cancellation cannot start patient reads or writes.
-429/unavailable keeps native drafts and cannot trigger automated resend.

### Task 1: Atomic database admission

- [ ] Read current applicable SQL grants/defaults and limiter conventions. Create forward migration with `pnpm db:new native_member_request_admission`.
- [ ] Write failing SQL tests for table/function permissions, eligibility, exact120/5000 boundaries, independent owners, reset/denial stability and Retry-After.
- [ ] Implement private row and service-only atomic claim. Replay only isolated database; add concurrent last-slot regression using existing concurrency-test patterns.
- [ ] Regenerate database types and verify full isolated SQL regressions; commit.

### Task 2: Integrate bounded native journey admission

- [ ] Read installed Next route docs and existing journey dependency/test contract.
- [ ] Add failing tests: admission after verified identity, before body/read/write;429 no-store/Retry-After; malformed/error results fail closed; caller abort and late admission cannot continue; disabled/invalid token never claim.
- [ ] Wire shared admission adapter into verified native context/handler while preserving current auth and service contracts. Add native429 no-resend/draft retention assertion where existing tests do not prove it.
- [ ] Run existing route/native/clinical/type/lint tests and targeted concurrency checks; commit.

### Task 3: Review and release

- [ ] Claude focused material review; reproduce/fix significant findings and record minor deferrals.
- [ ] Clean migration replay/generated types, full tests/builds and PR CI. Create/attach PR.
- [ ] Merge exact reviewed head, verify main migration job, deployed app/core SHA and disabled endpoint. Update roadmap/handoff; keep activation gates and full goal active.
