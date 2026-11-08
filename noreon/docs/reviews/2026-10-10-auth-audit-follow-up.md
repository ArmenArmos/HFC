# Authentication audit follow-up

Status: deferred at member's request on 10 October 2026. Investigation notes only; no security fixes authorized by this note.

Reviewed another agent's initial report against commit fea9c04c919b031071d40e5ea992e3b401b613cc and the current patient-webapp worktree. Relevant auth/deployment safeguards were already present at the cited revision.

## Verified observations

- App-target configuration requires NEXT_PUBLIC_PATIENT_DEMO=false, rejects a demo secret and requires Supabase configuration. next.config.ts throws for validation errors.
- Host protection rejects demo mode on app.noreon.health. A hosted demo uses a production build intentionally; do not ban demo based solely on NODE_ENV=production.
- Supabase public/anon keys in the user-scoped SSR client are expected, not a secret exposure. Investigate permissions/RLS rather than treating public-key availability as an exploit.
- Missing Supabase configuration passes through the refresh proxy, but patientIdentity returns null and requirePatient redirects. No sensitive bypass was demonstrated in the pasted report.
- Deployment validation allows an absent NOREON_DEPLOYMENT_TARGET for legacy compatibility. Requiring an explicit target for hosted releases is a concrete hardening candidate, not a confirmed data-access vulnerability.
- scripts/check-deployment.ts passed during this review. Hosted runtime settings were not inspected.

## Later investigation priorities

1. Cross-member record/upload/RPC access and storage policies.
2. Cross-clinic doctor authorization.
3. Every service-role operation and its ownership/role checks.
4. Forged/expired sessions and direct server-action calls.
5. OTP abuse/rate limits, signed-file access and deployed configuration.
6. Confirm route-level enforcement wherever proxy configuration is absent; identify a reproducible sensitive endpoint before assigning bypass severity.

Do not interpret this quick review as a full security clearance. Resume when explicitly requested; prioritize the member's more pressing work now.
