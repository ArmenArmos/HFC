# Staging AI mode

Real AI for testing on prod-as-staging: Zoe holds real conversations on Telegram (and in the app,
same pipeline), and lab PDFs are read by a real model. Khikar decided this on 17 Oct 2026 22:53:
"we are not live yet, this is testing, we need to have it to test, all the paperwork will be done
later". The DPA per provider, the S1 urgent word list and the legal check are go-live gates
(`output/GO_LIVE_GATES.md`, row "staging AI on"), not blockers for testing.

## Production posture without the staging marker (19 Oct 2026)

Khikar, 19 Oct 2026 01:28: "don't remove AI in non-staging mode. Keep all on." AI no longer depends
on `NOREON_PRELAUNCH_STAGING`. Each gate it used to stand in for is its own setting
(`lib/ai-posture.ts`):

| Gate | Setting | Default | For real members |
| --- | --- | --- | --- |
| App basis for real Gateway calls (Zoe, lab PDF reading, AI care plan): the legal gate the marker stood in for | `NOREON_AI_WITHOUT_DPA_CONFIRMATION` | unset = on | On by Khikar's decision. The DPAs and the Armenian legal check are his call (PENDING_QUESTIONS P14, P16). `false` brings back the old rule: the marker or `NOREON_ZOE_DPA_CONFIRMED=true`. |
| Database basis for the same calls | `zoe_settings.staging_ai_mode` | off | On by the same decision (env seed). Also lets symptom intake run on unsigned symptom sheets, so `symptom_intake_enabled` is the clinical owner's switch. |
| STAGING placeholder urgent list (unsigned, over-matches) instead of the empty S1 list | `NOREON_ZOE_URGENT_PLACEHOLDER` | unset = on only while the marker is set | Set `true` **before** removing the marker, or Zoe goes dark (no S1 list: no drafts, no model). Whether real members may rely on it is Tatevik's S1 sign-off. |

Any value other than `true` or `false` fails the build. Unchanged and still required: the Gateway
provider settings, `NOREON_ZOE_MODEL_CALLS_ENABLED=true`, `zoe_settings.model_calls_allowed` with a
passing 7-day eval per tier, each feature's own switch (`zoe_settings`, `ai_plan_capabilities`, lab
AI), and the US$10 daily caps. The STAGING wording markers (version-100 templates, "STAGING." text)
are a separate go-live gate and must still not reach real members.

## What stays true

- Urgent words stop a message before routing, the spend reservation or any model. On staging the
  list is a STAGING placeholder (`lib/zoe/urgent-staging.ts`, EN, HY and RU, pending Tatevik's S1
  sign-off). The member gets the 103 template on Telegram (or the 103 screen in the app) and the care
  team gets an alert through the existing screening.
- Health questions, general health information and anything unsure become a pending draft that only
  the assigned doctor can approve. Zoe never sends them.
- Zoe answers a member herself only when the fixed rules put the whole window in the low tier
  (logistics, app help) with nothing unsure, the database switch is on, a real model answered, and the
  answer passes the strictest guard (any health wording, dose, threshold, promise, link or wrong
  language blocks it). The doctor sees every answer.
- Spend is capped at US$10 a day in total and per tier, for Zoe and lab reading together.
- Zoe member and staff replies use actual costs when known, full estimates for runs in flight, and `spent + least(estimate, US$0.25) <= cap` for shared tier/total admission; the US$6 high-tier, US$10 total and US$3 member caps stay unchanged, as do lab and care plan reservations.

## Switches (all off by default, except the two marked)

| Where | Switch | Meaning |
| --- | --- | --- |
| Vercel (Production) | `NOREON_PRELAUNCH_STAGING=true` | Prod-as-staging marker. While `NOREON_ZOE_URGENT_PLACEHOLDER` is unset it turns on the placeholder urgent list. No longer needed for real calls or CAPTCHA. |
| Vercel | `NOREON_AI_WITHOUT_DPA_CONFIRMATION` | On unless `false`: the app has a basis for real calls without `NOREON_ZOE_DPA_CONFIRMED`. |
| Vercel | `NOREON_ZOE_URGENT_PLACEHOLDER=true` | The placeholder urgent list, with or without the marker. |
| Vercel | `NOREON_ZOE_MODEL_CALLS_ENABLED=true` | The app may call the Gateway. |
| Vercel | `NOREON_ZOE_PROVIDER=gateway` | Zoe uses the AI Gateway (instead of the stand-in). |
| Vercel | `NOREON_LAB_AI_PROVIDER=gateway` | Lab PDFs are read by the lab reading tier's model (medium, Sonnet 5.5, by default). |
| Vercel (optional) | `NOREON_AI_TIER_LAB_READING`, `NOREON_AI_TIER_PLAN_SUMMARY` = `low`, `medium` or `high` | Moves lab reading or the care plan summary to another AI settings tier (`lib/zoe/purpose-route.ts`; default `medium` for both). The spend counts against that tier's cap. Zoe intake stays on high. |
| Vercel | `NOREON_ZOE_SCAFFOLD_ENABLED=true`, `NOREON_ZOE_PIPELINE_ENABLED=true` | Zoe consent card and pipeline (check they are already on). |
| Vercel | `NOREON_ZOE_TEST_LEXICON` | Must be absent or not `true`: the fictional test list would replace the placeholder list. |
| Vercel | `NOREON_ZOE_RUN_KEY` (optional) | 32-byte base64 key so admins can open a run's redacted input and output on the Trace page. |
| Database | `zoe_settings.staging_ai_mode` | Real calls without a signed data agreement (on by owner decision, 19 Oct). |
| Database | `zoe_settings.model_calls_allowed` | Real calls on. Refused unless staging mode (or every configured provider's DPA is signed) and a passing model-mode eval per tier from the last 7 days. |
| Database | `zoe_settings.direct_answers_enabled` | Zoe's own logistics answers. |
| Database | templates `zoe.answer`, `zoe.urgent` approved | Telegram delivery of those two message kinds. |
| Database | `zoe_settings.conversational_replies_enabled` + templates `zoe.chat`, `zoe.receipt` approved | Zoe's own warm replies to greetings, thanks and feelings, and one warm line instead of the fixed acknowledgement for messages that wait for the doctor (SQL section 8). Needs a passing Low-tier eval with the chat rows. |

**Direct answers and Zoe consent.** While `direct_answers_enabled` is on, the Zoe consent statement
and the settings line say that Zoe answers simple visit and app questions herself
(`lib/zoe/consent-copy.ts`), and each consent trace event records
`noreon.zoe.consent.direct_answers`. For real members, switching direct answers on is a change to
what members agreed to: ship it as a new Zoe consent wording version (`ZOE_CONSENT_VERSION` and
`zoe_settings.consent_wording_version` together). A new version re-asks every member and Zoe stops
for each member until they agree again (GO_LIVE_GATES, Zoe consent).

The AI Gateway authenticates with Vercel OIDC on Vercel, so no key is needed there. Locally, the
`AI_GATEWAY_API_KEY` from the Development environment is used; never print it.

## Steps for the lead

1. Merge the PR through `scripts/merge-pr.mjs` (applies the migration).
2. Vercel, project noreon-app, Production: set the env rows above, then redeploy.
3. Run `docs/operations/staging-ai-mode.sql` sections 0 to 1 in the Supabase SQL editor.
4. Backoffice, Operations, AI settings: "Model eval with real calls" for Low, Medium and High. All
   three must pass (no MUST failure). SQL section 2 shows the results.
5. SQL sections 3 to 5.
6. On the test member: grant "Zoe may read my messages" in the app (consent card), then write to the
   TEST bot. "Where can I see my visit times?" should get Zoe's answer within seconds; a health
   question gets the acknowledgement and, for the doctor, a pending draft. SQL section 7 verifies.

Rollback: SQL section R (switches off, a new unapproved version of the two Zoe templates so new messages are held, and anything already queued held; approval cannot be withdrawn in place because template versions are immutable), and/or set `NOREON_ZOE_MODEL_CALLS_ENABLED=false` and redeploy.

## Running the eval locally

```bash
NOREON_ZOE_MODEL_CALLS_ENABLED=true node --conditions=noreon-server-test --import ./scripts/register-alias.mjs scripts/zoe-model-eval.ts --out output/zoe-model-eval
```

with `AI_GATEWAY_API_KEY` from `vercel env pull --environment=development` loaded into the shell
(not printed). It writes a report with every answer and draft the models wrote.

## Known limits (testing)

- Without warm replies (section 8) the member gets the fixed acknowledgement for every Telegram message and then Zoe's answer. With them, the acknowledgement is held for Zoe and goes only when she sends nothing of her own (or only the urgent text), or after 3 minutes as a backstop.
- Armenian "կարող եմ" ("can I") routes to the high tier, so "Where can I see..." in Armenian becomes a
  doctor draft rather than a direct answer. Safe, not helpful; tune with the clinical owner.
- Zoe cannot see bookings, times or results; she points to the right place in the app.
- The model-mode eval calls are not counted against the daily cap (bounded: about 40 short calls per
  tier and five lab sheets; one run per tier every 10 minutes).
- The eval checks each tier's primary model; the fallback is called only when the primary fails and is
  not evaluated separately.
- Symptom words outside the routing word lists (for example "my ankles are puffy" inside a booking
  question) can still get a logistics answer; the doctor still sees the message as unanswered.
- The placeholder urgent list ignores negation on purpose: "no chest pain today" also takes the 103
  route. A false alarm is the intended failure until the signed S1 list.
- Zoe answers directly only on Telegram for now; in-app messages keep the doctor flow until the in-app
  chat shows her answers.
