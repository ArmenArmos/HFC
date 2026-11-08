# Read-only hosted Auth inspection

The local Supabase CLI has no management token. The production deployment workflow already has a configured token and project reference. Add a main-only, manually dispatched production-environment workflow that uses those existing secrets for one GET to the official Auth config endpoint. No account/login/OTP request, configuration change, new credentials or hosted data mutation.

The response can contain provider secrets. Keep it in bounded memory, reject redirects, use a 15-second timeout and never log raw responses/errors. Return only a fixed allowlist of typed booleans, nonnegative integer limits and known CAPTCHA provider names. Missing/unexpected values remain null. Publish the sanitized report to the existing workflow log/step summary; do not upload raw artifacts. No installs occur in the credential-bearing step. Pin actions and use read-only repository permissions, production environment, main-ref job guard and an independent script guard.

Tests cover omitted/malformed fields, secret redaction, fixed GET destination, redirect refusal setting, invalid project refs, error sanitization and no provider calls. Claude reviews the credential/output boundary before merge. After main CI, dispatch the audit on main, inspect sanitized observations, then decide any actual fix separately with current authentication-flow compatibility evidence. A green inspection run means the read succeeded, not that every control is adequate.

References: https://supabase.com/docs/reference/api/v1-get-auth-service-config and https://supabase.com/docs/guides/auth/rate-limits (read 12 October 2026). The token-endpoint rate limit covers password and refresh grants; application-only throttles do not prove hosted endpoint protection.

Review follow-up: include only a configured/not-configured indicator for test OTP entries, a validated canonical expiry date, numeric SMS resend interval and an allowlisted provider. Never include test phone/code pairs. Correct the documented token reuse key to `security_refresh_token_reuse_interval`; explicitly list all absent/unrecognized fields as unverified.

The repository was verified private. Its production environment initially had no deployment-branch policy; it is now restricted to the single `main` branch under the approved hardening scope. The Supabase credential remains repository-scoped, so environment restrictions do not prevent other workflows from using it. Moving credentials to environment-only storage remains unresolved and is not implied by this audit's successful execution.
