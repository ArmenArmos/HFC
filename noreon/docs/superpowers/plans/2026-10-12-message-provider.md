# Provider transport and callback boundary

Use the official Twilio Node SDK as a replaceable adapter for SMS and approved WhatsApp templates. The provider choice is provisional; no account, sender, billing agreement or live messaging is activated. Build and test locally with synthetic credentials and injected network transport. No outbound endpoint or cron is wired until the complete dispatch/delivery integration is ready.

## Contract

Server configuration owns the account, token, senders, per-language WhatsApp content IDs, authenticated app URL and exact HTTPS callback URL. A job supplies only the database-issued attempt UUID, verified E.164 destination, channel and locale. Never accept arbitrary text, URL or recipient from a public request. SMS uses a fixed minimal plan notice; WhatsApp uses approved content IDs. Automatic SDK retries are off; timeout ten seconds. Any ambiguous provider error is unknown. A provider-created message SID means accepted submission, even if its initial delivery status is failed. Recognized HTTP request rejections (400/401/403/404/405/422/429) without a message reference are failed; other errors, including 408/409/499, remain unknown.

Callback parsing is bounded, form-only, validates the exact configured URL including the opaque attempt UUID and all incoming form fields using the official SDK. Reject duplicate fields, forged signatures, wrong account, bad message IDs and unknown statuses. Do not trust Host/forwarded headers. Return only normalized attempt/reference/status/error-code facts, no phone or body. Signed duplicate callbacks remain idempotent at the subsequent database boundary.

## Work

- [x] Failing tests for fixed payloads, configuration validation, transport acceptance/rejection/ambiguity, no retry, callback tampering/account/URL/body bounds.
- [x] Official SDK adapter and validated configuration, no live wiring.
- [ ] Append-only delivery events and callback route, producer and worker to follow in the same integration effort; no claim that helper code alone completes messaging.
- [ ] Test/audit/build and focused Claude review before release.

WhatsApp content templates must embed the fixed authenticated app link in the approved language-specific template; no runtime free-text/URL template variables are supplied. Delivery callbacks use an append-only fact table. Projection never regresses on late callbacks and flags contradictory terminal evidence. Callback endpoint uses a dedicated real-project service credential and is explicitly disabled on demo deployments.

Validation:52 migration byte parity/clean replay;generated types;27SQL/77TS checks,typecheck/build pass;production dependency audit0;lint only2existingwarnings. Claude focused review requested. Producer/worker/operator reconciliation remain next stage, so this is not end-to-end outbound integration.

Claude batch9 ready verdict. D1 and D2 recorded in parent spec as activation gates: visible/recoverable definitive rejection, configuration circuit breaker, known-SID reconciliation and unknown-without-SID operator queue. Its broad 4xx description predates final conservative allowlist:408/409/499/5xx unknown. Final route test additionally exercises enabled real-project RPC with mocked transport and demo rejection;no livecalls.
