# Patient Android and iOS application

Khikar explicitly requires actual Android/iOS apps alongside patient web. Provisional engineering decision: use Expo/React Native with a shared native codebase, and keep staff web-first until the shared/separate staff-app decision is reviewed. This does not decide against a future dedicated clinician mobile app.

## First executable slice

Create an independently buildable `apps/patient-mobile` project, isolated from the Next app's TypeScript/lint/deployment graph. Use the official current Expo TypeScript template and compatible native dependencies. Generate native theme values from the existing vendored Noreon tokens; do not fork brand values or edit vendored files.

Implement real phone/OTP authentication with hCaptcha, encrypted device session storage, foreground-aware refresh and complete session/data clearing on sign-out or identity change. No service credentials may appear in mobile code or public config. Keep real sign-in behind explicit mobile configuration and launch gates until the existing hosted Auth CAPTCHA/rate settings and SMS account are verified. Default unconfigured builds show setup-unavailable, not fictional medical data or fake success.

Authenticated native screens read the member's existing profile, active released plan, medication instructions, reviewed results and measurements through the same Supabase RLS boundary. Do not copy clinical thresholds or authorize by hiding screens. Missing records stay missing. Support Armenian and English, large text, accessible controls, loading/error/retry and stale-request cancellation. No health data is persisted offline in this first slice.

This slice is not the full mobile journey: native profile/questionnaire edits, measurement/dose writes, report upload, notifications, offline sync, biometrics, care-team support and Zoe will follow using shared server contracts. Avoid implementing a second clinical engine or direct privileged database mutations. Store release needs real accounts/signing and device acceptance; no store submission or live OTP is authorized overnight.

## Verification

Test secure storage failure/concurrency, configuration boundaries, auth/data isolation and RLS reads. Typecheck/lint native source, export both Android and iOS bundles, run available native simulator/build checks, and obtain focused Claude review before merge. Keep actual runtime/build evidence distinct from bundle compilation and store release.

Official references: https://docs.expo.dev/more/create-expo/, https://supabase.com/docs/guides/auth/quickstarts/react-native, https://supabase.com/docs/guides/auth/phone-login, https://github.com/hCaptcha/react-native-hcaptcha. Registry inspected 12 October 2026: Expo 57.0.27, TypeScript template 57.0.29, hCaptcha native 4.1.0. Confirm installed dependency compatibility rather than assuming web React versions apply to native.
