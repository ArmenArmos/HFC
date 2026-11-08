# Distributed native API request admission

## Authority and intent

Khikar delegated routine overnight roadmap decisions and asked to keep implementing while external provider/account gates remain unavailable. This is an architectural prerequisite for native journey and report APIs. Preserve current disabled activation gates and all existing AI/upload quotas. No live member calls or hosted Auth mutation are authorized by this batch.

## Chosen approach

A shared service-only PostgreSQL claim function bounds authenticated native API traffic by remotely verified member ID. This covers journey now and offers the same contract for report routes next. Reusing demo/staff admission buckets would change approved unrelated limits; per-process counters would not work across deployments. A PostgreSQL row per member supplies atomic distributed counters with bounded storage and account-deletion cleanup.

Provisional engineering defaults:120 requests per UTC fixed minute and5000 per UTC day across native APIs. Each questionnaire write and mandatory GET count separately. These limits should support a complete questionnaire and normal foreground refreshes; validate with pilot usage before activation. Fixed-window boundary bursts may reach twice the minute count across adjacent windows; this is accepted for the initial request limiter, not a provider-spend guarantee. Denied requests do not extend windows or change quota counts. Existing report reservation/AI and demo/staff quotas stay unchanged.

## Database contract

CLI-generated immutable forward migration creates a private RLS table with one row per auth user, fixed minute/day anchors and nonnegative bounded counters. Cascade on user deletion. No PUBLIC/anon/authenticated read/write/TRUNCATE/MAINTAIN grants. Claim function is SECURITY DEFINER with fixed search_path and service_role EXECUTE only; validate owner and confirmed phone server-side. It atomically initializes/locks the owner's row, resets expired counters, denies exhausted minute/day quotas with accurate positive Retry-After (the longer remaining wait when both exhausted), otherwise increments both counters and returns allowed. No token, phone, medical content, IP or user-agent is stored.

Function result: `{allowed:boolean,retry_after:number}`. Failure to obtain a valid result is unavailable, never silently allowed. SQL tests cover exact boundaries, window expiry, daily/minute interaction, denial stability, roles, user isolation, malformed/ineligible owner and concurrency.

## Server integration

Native journey already verifies bearer token and confirmed phone through Supabase remote getUser. Keep that sequence; apply admission after verified identity and before reading request body or patient state, inside the existing cancellation/deadline budget. Neither caller-supplied user IDs nor cookies determine the limiter owner. Disabled routes and invalid bearer tokens do not create quota rows. The privileged claim client is constructed only after verified identity.

Return429 with no-store, `Retry-After` and a minimal `rate_limited` body. Database/admission response failure returns unavailable, with no patient write/read continuation. An aborted operation cannot continue into service work after a late successful admission. Existing uncertain write semantics and clinical rules do not change.

Native client already treats non-success as blocked/failed reads and offers explicit recovery. Verify429 cannot cause auto retry or lose drafts. Do not add timers that repeatedly resubmit. Report APIs will consume the same server contract in their later batch.

## Limits and acceptance

This limits already-authenticated member requests; remote Auth verification and signed-out source abuse still require hosted Auth/firewall controls. Do not claim those gates solved. Direct owner-bound native database actions have their own existing RPC controls; this contract initially covers API journey and later report routes, not all network traffic.

Tests must prove SQL atomic boundaries and route ordering, cancellation and denial, preserve all existing web/native behavior, clean replay and generated types. Claude reviews important security/concurrency findings before merge. Production migration runs only from main workflow, then verify exact deployments and disabled live route. Activation remains off.
