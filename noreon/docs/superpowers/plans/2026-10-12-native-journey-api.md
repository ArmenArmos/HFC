# Native journey API implementation plan

> Use superpowers:executing-plans inline under explicit overnight delegation. Claude reviews the material batch before merge/deploy.

**Goal:** Provide the authenticated server contract needed by native profile/consent/questionnaire screens.
**Architecture:** Bounded bearer-only HTTP boundary, existing patient service, reusable RLS-read/server-write repository.
**Tech stack:** Installed Next16.3.8, Supabase JS, TypeScript.
**Spec:** docs/superpowers/specs/2026-10-12-native-journey-api-design.md

## Global constraints

- Default off; app-only, demo=false. No hosted enabling or real member writes.
- Existing clinical rules, service-role RPC permissions and web behavior preserved.
-16KiB streamed JSON;20s server deadline; no secret/health logging.

## Review focus

- Cookie/demo credentials must not become a native bearer identity.
- Profile saves from an old device revision must not overwrite new answers.
- Request abort during auth/body/read must prevent a later privileged write.
- Unknown fields must not inject owner, completion or clinical flags.
- HTTP timeout cannot be presented as a confirmed failed database write.

### Task 1: Shared persistence and revision contract

Files: lib/patient/database-store.ts (extracted store), repository.ts (web wrapper), service.ts (optional saveProfile revision), scripts/check-patient-service.ts.
- [ ] Add failing assertion saveProfile(profile,true,99) => conflict and zero writer calls; invalid revision => invalid; initial -1 allowed only without assessment.
- [ ] Extract createDatabasePatientStore(readClient,writeClient):PatientStore from current repository. Web calls () => createClient() and writer; native can inject token-scoped clients. Keep mapping and write RPC contract unchanged.
- [ ] Add optional expectedRevision?:number to service.saveProfile and compare against state.assessment?.revision ?? -1 before seed/write. DB still receives that observed revision for atomic race protection.
- [ ] Run service tests, typecheck, commit.

### Task 2: Bounded HTTP boundary and real adapter

Files: lib/patient/native-journey.ts (pure handler), native-journey-server.ts (server-only installed SDK adapter), app/api/native/journey/route.ts; scripts/check-native-journey.ts, check-native-journey-server.ts.
Interfaces: createNativeJourneyHandler({enabled,context,timeoutMs?}): (Request)=>Promise<Response>; context(token,signal)=>Promise<{user:{userId,phone},store:PatientStore}|null>. createNativeJourneyContext(token,signal, env, fetcher?) verifies actual SDK getUser and creates fixed-token reader/server writer.
- [ ] Write request fixtures for GET and all three POST commands against real createPatientService, verified-owner fake store. Assert generic status401/400/409/503, no-store, exact shape guards, consent version, max body and stalled stream.
- [ ] Run missing-module failure; implement parser, bounded request lifecycle, abort checks before/after awaits and before each store mutation.
- [ ] Test installed SDK adapter with intercepted HTTP responses, ensuring public apikey plus member bearer Authorization for auth validation, bearer Authorization for RLS reads, service role only for RPC writer; unconfirmed identity denies context. Implement adapter and default-off route.
- [ ] Document API and uncertain-write/client recovery + activation gates. Run full TS/SQL/clinical/types/lint/build. Commit.

### Task 3: Review and release

- [ ] Claude reviews authentication, owner binding, deadlines, stale profile and sensitive responses; fix material findings with regression evidence.
- [ ] Create and attach PR; wait CI, exact-head merge, verify production app/core deployments with endpoint disabled. Record evidence and remaining native UI/activation work in roadmap/handoff.
