# Native authentication lifecycle implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans inline under the user's overnight delegation. Claude reviews the material batch before release.

**Goal:** Bound native authentication waits while preventing old clients from restoring or deleting credentials after logout.

**Architecture:** A serialized credential vault hands each SDK client a revocable storage lease. Client-bound transport cancels and rejects late results. AuthProvider manages initialization, retirement, cleanup and replacement; Login binds all OTP operations through that provider.

**Tech Stack:** Expo57, React19.2.3, React Native0.86.3, installed Supabase JS/Auth SDK, SecureStore.

**Spec:** docs/superpowers/specs/2026-10-12-native-auth-lifecycle-design.md

## Global constraints

- Native sign-in and outbound providers stay disabled; fictional local mocks only.
- Keep shouldCreateUser=false, CAPTCHA and existing backend/RLS/clinical rules unchanged.
- No plaintext credential fallback or health data in storage/routes.
- One 15-second visible authentication deadline; cleanup failures remain closed.
- A new client must not start before required deletion completes after logout/retry.
- Keep EN/HY UI generic; never expose provider error details or tokens.

## Review focus

1. A storage write already in flight at logout completes before deletion; queued old writes are rejected.
2. An old client's late remove/session event cannot affect the replacement instance.
3. Cancellation-ignoring network mocks cannot deliver accepted late results.
4. A native storage hang can leave cleanup pending, but must never enable another login or claim logout completed.
5. Duplicate CAPTCHA success and verification presses must not create duplicate OTP calls; verification timeouts cannot persist a late session.

### Task 1: Revocable storage and network boundaries

Files: create apps/patient-mobile/src/lib/auth-boundary.ts and tests/auth-boundary.test.ts; retain existing session-storage.ts compatibility.

Interfaces:
```ts
createCredentialVault(driver: SecureDriver, sessionKey: string): {
  lease(onFailure?: () => void): { storage: SecureDriver; retire(): void };
  clear(): Promise<void>;
}
createAuthTransport(fetcher: typeof fetch, timeoutMs?: number): {
  fetch: typeof fetch; retire(): void;
}
```

- [ ] Add deferred fixtures that pause a native write, enqueue another, retire, clear, finish the first and assert storage is empty; rejected stale remove must preserve a later new lease's value. Add deletion failure and stale read cases.
- [ ] Add a fetcher that ignores signals; retire or advance deadline, assert prompt rejection and no late value; already-retired fetch must never call the fetcher. Test caller cancellation and active success.
- [ ] Observe missing-export failures, implement serialized guarded operations and combined fetch signals using existing abortableRequest, then run Node suite.
- [ ] Commit the independently tested boundary primitives.

### Task 2: Client lifetime and provider/login integration

Files: supabase.ts, auth.tsx, login.tsx, actions.ts, new auth-lifetime.ts, tests/auth-lifecycle-ui.test.tsx; remove obsolete logout.ts and its superseded test after replacements cover rejection and hang cases.

Interfaces:
```ts
type AuthLease<T> = { client: T; retire(): void; active(): boolean };
createAuthLifetime<T>(create: () => AuthLease<T>, clear: () => Promise<void>): {
  current(): AuthLease<T> | null;
  start(): AuthLease<T>;
  retire(lease?: AuthLease<T>): void;
  clear(): Promise<void>;
}
```

- [ ] Test lifetime single-flight clear; start rejects during cleanup; old retirement cannot retire new lease; deletion failure does not automatically start any client.
- [ ] Build configured clients lazily with vault lease + transport and keep the exported current-client getter for fixed-token action auth. On retire disable storage/transport synchronously and catch SDK dispose errors. Expose bounded revokeOldSession(token) on the existing local-scope endpoint independent of the retired client.
- [ ] Render real AuthProvider against fake SDK leases. A stalled getSession must transition loading -> error at deadline, ignore late session/events, and recover only after confirmed deletion. Signout must hide member data immediately and finish local cleanup despite a stalled remote revoke. Failed/hung deletion keeps error and no active client; single-flight repeated signout shares cleanup.
- [ ] Implement provider generation/alive checks, 15s initialization/operation/cleanup deadlines, and provider-owned generic runAuthOperation(callback). Retire on timeout or storage fault. Keep successful auth events authoritative over stale initial getSession replies. Catch foreground/background refresh promises.
- [ ] Wire Login to runAuthOperation, phase refs and unmount invalidation. Fake CAPTCHA/test transport proves duplicate success and verify presses make one request; invalid code remains retryable; no automatic resend.
- [ ] Update actions.ts to capture current auth instance without creating one. Run all Node/rendered tests/types/lint and commit.

### Task 3: Review and release

- [ ] Run native tests/typecheck/lint/theme and clean mobile-only install as dependency topology requires; no dependency upgrades intended.
- [ ] Export Android/iOS and build iOS Release simulator. Verify normal disabled gate remains. Record lack of enabled-auth physical-device acceptance.
- [ ] Have Claude inspect storage/transport retirement, late callbacks, remote-vs-local logout, and cleanup recovery; address material findings with regression tests.
- [ ] Update README/roadmap/handoff with exact verification and remaining limits. Create/attach PR, await CI, merge exact reviewed head, verify app/core production deployments. Keep full roadmap active.
