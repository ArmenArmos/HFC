# Native authentication lifecycle design

## Intent and scope

Continue the delegated overnight hardening roadmap. Native sign-in stays disabled, and no real OTP/session/provider calls are used for validation. Fix the observed unbounded initialization/OTP/logout waits without permitting a late old SDK operation to restore credentials after logout or affect a new login. This is an architectural change to client lifetime, not new authentication policy.

The current SDK waits for initialization, process locks and remote sign-out before local removal. Its own dispose documentation warns that in-flight requests can still persist a session. A simple Promise.race plus direct deletion is insufficient.

## Alternatives and choice

1. UI-only deadlines: smallest, but stale verification/refresh can still persist and emit a session. Reject.
2. Await all SDK work before logout: preserves ordering but can leave credentials and UI indefinitely stuck. Reject.
3. Revocable per-client storage and transport leases, with serialized mandatory local deletion before replacement: chosen. More lifecycle code, but testable boundaries isolate old operations without relying on SDK internals.

## Storage and client lifetime

Keep one serialized SecureStore queue. Each SDK instance receives a lease whose get/set/remove operations check liveness when queued work actually begins; reads also check after the native await. Retirement is synchronous. Operations already inside a native write may finish, but mandatory deletion is queued behind them. The strict vault rejects subsequent old-lease operations. The SDK-facing adapter translates retirement into empty reads and discarded mutations: installed SDK background INITIAL_SESSION reads otherwise produce unhandled rejections. AuthProvider separately rejects stale operation results, so a completed old SDK call cannot restore application access. A replacement client is created only after deletion succeeds. If native storage never returns, the UI deadline ends in a closed error state; no new login is enabled, and the queued deletion remains pending. No plaintext fallback.

The vault clears the fixed native OTP session keys (session, user, legacy verifier and verifier index) plus keys touched by the lease. This application does not enable OAuth/PKCE flows. Preserve secure-storage device-only accessibility. Retired clients cannot delete a newer client's credentials.

Each client also receives a fetch wrapper that combines its retirement signal, caller cancellation and a 15-second transport deadline. It rejects even if a mocked/nonconforming fetch ignores cancellation and rejects late results. Retirement prevents new fetches and aborts in-flight requests. The normal application data clients remain fixed-token and retain their existing per-operation deadlines; they capture the current auth client before verification.

## Auth provider and recovery

AuthProvider owns the active client lifetime. Initialization has a single 15-second visible deadline. An initial auth event or successful getSession settles loading; generation checks discard late initial replies and events. A timeout/storage failure retires that client, removes access and displays the existing generic retry state. Explicit retry performs local cleanup before creating a new instance. A token refresh for the current instance preserves the member identity/drafts.

Logout immediately hides member data and retires the client. Local credential deletion is independent of remote SDK initialization/locks. Copy the already-known old access/refresh token and expiry. For expired/near-expiry tokens (or one unexpected401), refresh through the isolated transport in memory, never storing the result. Use the resulting old-session access token to make a bounded best-effort POST to the existing Auth logout endpoint with scope=local; this request never uses new-session credentials and cannot gate device cleanup. This preserves best-effort server refresh-token revocation while allowing offline local logout. Already-issued access tokens remain subject to the existing expiry/server behavior.

Concurrent cleanup requests share one promise. After confirmed deletion, start a fresh client/initialization; after failure/timeout stay closed. Old callbacks cannot flip loading/error/session in the new generation. SDK initialization can start refresh in its finally block after disposal; retire immediately and dispose again when initialization settles, and stop any foreground refresh start that finishes after retirement. On provider unmount retire resources; StrictMode re-entry may acquire a fresh lease to existing credentials without clearing them, because unmount is not user logout.

## OTP operations

Login calls provider-owned runAuthOperation, which binds one current client and imposes a 15-second deadline across SDK work. Timeout retires that instance, so a late verify cannot persist credentials or reopen access. Provider error recovery creates a new client only after cleanup. Ordinary invalid-code/provider rejection shows the generic login error without replacing a healthy client.

Deduplicate CAPTCHA success and verify presses with a local phase ref. Ignore cancellation messages caused by hiding a successfully completed CAPTCHA. Invalidate component callbacks on unmount. Human CAPTCHA interaction itself is not limited to 15 seconds. Never auto-resend OTP. Keep shouldCreateUser=false, normalized phone validation and CAPTCHA requirements unchanged.

## Verification and release

Prove queued and in-flight storage races, old cleanup versus new credentials, ignored fetch cancellation, startup timeout/late events, timeout during verify, single-flight logout, stalled remote revocation, deletion failure and unmount. Test exact legacy operation behavior without live providers. Preserve navigation suite and account guards. Run native tests/types/lint/theme, both platform exports and iOS Release simulator build. Claude reviews material lifetime/recovery risks before merge. CI and exact merge/deployment verification remain required; no activation/store release.

Routine architecture/implementation choices are covered by the user's explicit overnight delegation. Preserve outstanding hosted Auth permissions and device/store acceptance gates.
