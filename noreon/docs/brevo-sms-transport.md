# Brevo OTP SMS transport contract

`lib/messaging/brevo.ts` is a server-only transport for a Supabase-generated OTP. It accepts only canonical Armenian numbers (`+374` and eight digits) and six-digit codes, with fixed content: `Noreon code: XXXXXX. Do not share this code.` The 44-character ASCII message uses one GSM-7 segment. Callers cannot supply alternative bodies, URLs, country overrides, clinical details or message types.

Configuration requires a server-only API key and the approved sender ID (1–11 ASCII letters/digits). Syntax validation does not confirm account approval or sender registration. The request uses the fixed Brevo HTTPS endpoint, an `api-key` header and `transactional` type. Redirects are rejected; the helper makes one request with a maximum 10-second timeout including response decoding. Responses are size bounded.

Only HTTP 201 with a positive safe-integer `messageId` returns `accepted` and its decimal string reference. Recognized request rejections return `failed`; timeouts, network errors, unrecognized 4xx, 5xx, unexpected successful status codes and malformed receipts return `unknown`. Unknown outcomes must not trigger an automatic resend. Results contain no raw provider response, code, key or phone number. Callers must not log request payloads.

The root integration must provide the signed Supabase send hook, rate limits and atomic reservations against the combined US$5/day rehearsal cap. This transport does not enforce those controls, configure Supabase or enable sending. Persist the provider reference for later delivery verification; accepted means provider admission, not handset delivery.

[Brevo's API guide](https://developers.brevo.com/docs/transactional-sms-endpoints) documents the endpoint, authentication header, transactional content request and numeric receipt. [The reference](https://developers.brevo.com/reference/send-async-transactional-sms) specifies alphanumeric sender syntax. [Transactional SMS help](https://help.brevo.com/hc/en-us/articles/4424272648850-Send-transactional-SMS) includes OTP use and requires country-specific sender registration for accounts created after March 13, 2026. [Supported countries](https://help.brevo.com/hc/en-us/articles/208717449-Supported-countries-and-pricing-for-SMS-messages) lists Armenia. [Sender registration guidance](https://help.brevo.com/hc/en-us/articles/28255350696466-Register-a-Sender-ID-to-send-SMS-messages) requires registration for destination countries. These pages were inspected on October 12, 2026.

Verification command, with injected HTTP and no real SMS:

```sh
node --conditions=noreon-server-test --disable-warning=DEP0205 --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --import ./scripts/register-alias.mjs scripts/check-brevo-sms.ts
```

Mocked checks cover fixed content, recipient/code validation, endpoint and headers, single submission, receipt validation, sanitized failures, response bounds and timeouts. Credentials, account activation, Armenian sender approval, budget-admitted hook operation and handset delivery remain unverified. No API token was read and no live provider request was made.
