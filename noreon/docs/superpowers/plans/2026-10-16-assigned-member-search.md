# Assigned-member search implementation plan

**Goal:** Real staff can find assigned members by name or verified phone, including beyond the old first 200 requests.
**Reference:** Main accepted design handoff, 16 October 2026; agreed MVP flow §6. Base ad976a7. Local first; no push/release until coordinated.
**Architecture:** New guarded RPC filters current staff scope before keyset pagination. POST action validates inputs/results. Client owns ephemeral query and ignores obsolete responses. Existing assignments remain authoritative.
**Constraints:** Preserve admin/doctor/nurse/session boundaries. No phone in DTO, URL, logs, persistence or analytics. No providers, clinical changes or production writes. Settings worktree/review DB frozen. D3 alone owns SQL/generated types.

## Acceptance and review focus

- Literal case-insensitive name matching and formatted verified-phone search; reject short numeric/control/oversized inputs. Empty means scoped queue.
- Scope before filtering and limit; late member >200 discoverable. Stable created_at/id ties; 50+1 keyset, no duplicates; both cursor fields required.
- Pending, empty, no match, unavailable, clear and paging are distinct. Draft retained on error. Changing query clears prior results/cursor and ignores late responses.
- Current assignment/revision commands survive extraction. No new roles/privileges. Recheck access on every call, including later pages.
- Actual EN/HY375/1280 keyboard and rendered checks through local entry point. Real isolated SQL role/session/paging tests, not substituted by mocks.

## Tasks

- [x] Write schema/command tests and observe RED, implement pure validation/DTO/command; guard-before-call action test.
  Files: lib/staff/member-search-{schema,command}.ts, real-member-search-actions.ts; scripts/check-member-search.ts.
- [x] Write SQL regressions; implement CLI-created forward migration with current scope, phone verification and keyset50+1. Replay only after settings reviewer releases DB. CLI-generate types; never hand-edit.
  Files: supabase/migrations/*_assigned_member_search.sql; scripts/check-member-search.sql; lib/db/types.ts.
- [x] Write UI behavior tests; extract current cards unchanged and add named search/clear/more controls, race handling, errors; wire members page.
  Files: components/real-review/member-{queue-list,search}.tsx, app/staff/real/(review)/members/page.tsx; scripts/check-member-search-ui.ts.
- [x] Selfcheck focused tests, SQL replay/legacy scope, lint/typecheck/build; actual UI matrix and screenshots. One finding list and frozen packet to Main for fresh Opus review. No uncoordinated CI.

Local result: dependency settings treeb14beec (cherry-picks4722720+185889d); actual source wired, SQL+types+local browser tests complete. Fresh Opus review and authorized release remain PENDING; no push/CI.
Finding closures: deterministic numeric-part date formatting avoids server/browser hy-AM hydration mismatch; regression+actual native Armenian typing verified. Existing message-channel test exact allowlist gained only owned QA container after Main approval; arbitrary names still rejected. Full runner disposition retained in external packet, no failures silently skipped.
