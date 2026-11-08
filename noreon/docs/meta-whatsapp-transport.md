# Meta WhatsApp transport contract

`lib/messaging/meta.ts` implements server-only Cloud API transport and webhook verification. Runtime admission, atomic daily spend reservations, auth ownership, delivery persistence and webhook routes must wrap it before enabling real sends. The transport does not independently enforce the combined US$5/day rehearsal budget.

Configuration requires an explicit supported Graph API version, the WABA and sender phone-number IDs, server-only access token, app secret, webhook verify token, and approved English authentication/utility template names and language codes. Armenian templates are optional and fail closed when absent; the helper never substitutes another language. Version syntax validation does not confirm Meta still supports that version.

Authentication templates must be approved as AUTHENTICATION with an OTP copy-code button at index 0. The send contains the same six-digit code as body text and as the URL-button text parameter. The helper accepts only canonical +374 followed by eight digits. It never sends SMS, arbitrary bodies, URLs, clinical variables or names.

Plan templates must be approved with zero variables and this static authenticated care-page button: `https://app.noreon.health/patient/care`. Recommended minimal fixed English body: “Your new care plan is available. Open Noreon to see it.” Keep clinical details out of both approved text and template metadata. The transport sends only the approved name/language; the approved template contains the URL and notice. Inspect the approved template itself before activation, because a name in local configuration cannot prove its remote content or category.

Submissions make one HTTP request to fixed `https://graph.facebook.com`, reject redirects, and have a 10-second maximum timeout including response decoding. Only recognized definitive HTTP rejections return `failed`; timeouts, network failures, unrecognized 4xx, 5xx and invalid success receipts return `unknown`. Accepted requires one bounded `wamid` receipt. Results omit raw errors, recipient, code and credentials; the caller must not log request payloads. An unknown outcome must not trigger an automatic resend.

Webhook callers must enforce a streaming request size limit before buffering. The helper verifies the exact raw bytes using HMAC SHA-256 and timing-safe signature comparison, checks WABA and sender ownership throughout each batch, and returns only reference, recognized status and Unix timestamp in seconds. It discards phone numbers, conversation IDs, costs, error text and inbound-message content. Duplicate statuses are preserved for the persistence layer to deduplicate idempotently. Webhook challenge verification accepts exactly one subscribe mode, matching token and numeric challenge.

Verification command (mocked HTTP, no provider calls):

```sh
node --conditions=noreon-server-test --disable-warning=DEP0205 --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --import ./scripts/register-alias.mjs scripts/check-meta-whatsapp.ts
```

Source evidence inspected 12 October 2026:

- [Meta-owned archived SDK template example](https://github.com/WhatsApp/WhatsApp-Nodejs-SDK/blob/main/website/docs/api-reference/messages/template.md) confirms approved template name, language and body text components. The repository is archived; this is not evidence of current SDK support.
- [Meta-owned Postman authentication copy-code template request](https://www.postman.com/meta/whatsapp-business-platform/request/6vkv46u/create-authentication-template-w-otp-copy-code-button) identifies the authentication template creation endpoint, but its request body was not exposed to the documentation fetch.
- [Current Meta copy-code documentation](https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/authentication-templates/copy-code-button-authentication-templates/) returned HTTP 429 during verification. The copy-code send payload therefore still needs verification against the configured approved template and current Graph version before a real delivery claim.

No real provider request, accepted live receipt or delivered handset message is evidenced by this test. Sender registration, credentials, approved template inspection and a budget-admitted +374 send remain integration acceptance requirements.
