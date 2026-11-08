# Telegram channel boundary

Base: frozen conversation core `1ff9fa8f` (CC1–CC11). Governing documents: the root brief, `SECURITY_BOUNDARY_ADVICE.md` and the source-backed persistence integration plan. Scope is three server-only modules, one focused check and this plan. No product route, environment credentials, core/SQL/types/Auth edits, provider activation or network.

Primary docs, checked 16 October 2026: [setWebhook](https://core.telegram.org/bots/api#setwebhook), [Update](https://core.telegram.org/bots/api#update), [Message](https://core.telegram.org/bots/api#message), [CallbackQuery](https://core.telegram.org/bots/api#callbackquery), [answerCallbackQuery](https://core.telegram.org/bots/api#answercallbackquery), [InlineKeyboardButton](https://core.telegram.org/bots/api#inlinekeyboardbutton), [sendMessage](https://core.telegram.org/bots/api#sendmessage), [Making requests](https://core.telegram.org/bots/api#making-requests), [ResponseParameters](https://core.telegram.org/bots/api#responseparameters).

## Responsibilities

Telegram transports verified private events and exact outward payloads. Noreon owns identity linking, roles, intake and clinical logic, drafts, exact doctor approval, intents, durable inbox/outbox and audit.

| Module | Does | Never does |
| --- | --- | --- |
| `protocol.ts` | Strict update shapes; canonical `(adapter, account, botId)` namespace in principal, event and request keys; receipt fingerprint; opaque `ni1:` buttons; bounded strict UTF-8 reading | Infer a member, role, command or approval; follow URLs; parse `/start` tokens |
| `ingress.ts` | Request → Response handler: secret before body, request bounds, one awaited inbox call, 200 only for the exact committed tuple | Read env, mount a route, cache receipts, call the core |
| `outbound.ts` | `ChannelAdapter` over an injected HTTP port: exact rendered envelope, one call, strict echo verification; empty callback acknowledgement | Retry, reroute, edit, truncate, parse HTML/Markdown, claim delivery or read |

## Decisions

- **Authentication.** SHA-256 digests compared with `timingSafeEqual`; the handler keeps only the digest. Configured secret 32–256 of `[A-Za-z0-9_-]`, unique per bot. A missing, malformed or combined header fails before any body pull. Fetch strips surrounding whitespace from header values before the handler runs.
- **Bounds.** Byte caps are 256 KiB to 1 MiB: the floor guarantees a worst-case escaped 4096-unit echo or update always fits, so a valid message is never refused forever or recorded as unknown. Timers are 1–60 000 ms, below Node's `setTimeout` clamp.
- **Admitted shapes.** Private text from a non-bot sender in their own chat, with inert `entities`, `link_preview_options`, `quote` and a same-chat `reply_to_message` (only its ID is kept, as untrusted context). A button press by a non-bot user in their own private chat, on a text message authored by the configured bot. Everything else is 422: forwarded, automatic-forward, `sender_chat`, `via_bot`, edited, topic, business, external reply, media, group/channel, inline-mode, game and inaccessible-message shapes, and any unknown key.
- **Callbacks.** Data is `ni1:` plus a 16–60 character opaque reference, at most 64 UTF-8 bytes. The envelope action is `{ intentRef }`, which the core's strict command schema rejects. A trusted Noreon resolver must look up a purpose-bound intent, check the current actor and link generation and construct the command. Edits need a separately validated workflow.
- **Receipts.** The inbox port receives a frozen event and an abort signal and must answer only after commit. 200 requires `{ status: committed | committed-duplicate, eventId, fingerprint }` matching this event exactly. Void, truthy, malformed, mismatched, failed, unknown, conflict, thrown or timed-out answers are 503. A 200 carries no body, because Telegram treats a JSON body with `method` as an API call.
- **Outbound.** Address is a canonical positive decimal chat ID. The full `renderOutboundText` envelope must be well-formed Unicode, at most 4096 UTF-16 units, and have no surrounding whitespace. The whitespace restriction is conservative pending live echo verification (TG-06), not an established Telegram behavior; it remains a product gap for approved text containing edge whitespace. Any normalization must precede doctor review and approval, never change an approved envelope. Otherwise the result is `unsupported` before any call. `accepted` requires HTTP 200, no redirect, matching URL, `ok: true`, and a result with a positive message ID, the same private chat, this bot and identical text. Anything else after invocation is `unknown`, with a constant reason. No definite-failure table is assumed.

## Checklist

- [x] RED through the actual Request/Response and HTTP contracts (`RESUME_red.log`).
- [x] Protocol, no-authority ingress, commit-before-ACK and exact pinned outbound.
- [x] GREEN: 24 scenarios, including zero-pull spies, receipts, duplicates, lost commit, namespaces, callbacks, UTF-16 and escaped-echo bounds, ambiguous outcomes, disabled zero calls, a synthetic core trace with an explicit resolver, and server-only negative import.
- [x] Mutation probes: six source regressions each turn the check red.
- [x] Lint, typecheck, unchanged core check; findings, evidence and manifest under the root output directory.

## Integration gates (not done here)

1. Durable inbox (D3): unique canonical event ID, fingerprint conflict, atomic receipt-to-processing status that survives worker failure.
2. Member-text link-generation fencing at durable dispatch: a relink between receipt and processing must not redirect queued text.
3. Trusted intent resolver with durable, purpose-bound references.
4. Callback acknowledgement lifecycle: the dispatcher calls `acknowledgeCallback` after commit.
5. Live setup: route, `setWebhook` with `secret_token` and `allowed_updates: ["message", "callback_query"]`, credential custody and a fetch-backed HTTP port that never logs URLs. Already-queued updates of other types still arrive, so a poison/dead-letter policy for 422s is needed.
6. Namespace immutability: renaming the account or replacing the bot orphans links and receipts and needs a migration.
7. Unknown-delivery reconciliation (core), and live confirmation of Telegram's length counting and trimming.

Voice, files and other media remain unsupported.
