# Zoe practice corrections

All five practice records are fictional. The engine runs the existing Zoe pipeline with in-memory ports. It never accepts caller-supplied storage ports. A session snapshot includes the exact jobs, results, earlier replies, urgency state and a bounded allowlist of nonsecret Zoe flags. Record edits affect the next job; they do not change saved runs.

Export an offline JSON copy of practice marks. This command reads only that file. It does not query Supabase, read credentials or discover sessions.

```sh
node --no-warnings --import ./scripts/register-alias.mjs scripts/zoe-practice-export.ts /tmp/practice-marks.json docs/reference/zoe-eval/practice-corrections.json
```

Input is `{ "marks": [...] }`. Each mark contains `id`, `rating` (`good` or `wrong`), `reason`, `correction`, and its persisted `snapshot`. The snapshot has the session state plus `markedTurn` and `configVersion`. Exports omit author and session database identifiers. The job's internal identity is a fixed fictional practice identity, used only by the in-memory harness.

Replay through the real configured Gateway models saved with each marked turn:

```sh
node --no-warnings --conditions=noreon-server-test --import ./scripts/register-alias.mjs scripts/zoe-practice-replay.ts docs/reference/zoe-eval/practice-corrections.json docs/reference/zoe-eval/practice-replay.json
```

The default uses the saved routing configuration, requires enabled real Gateway calls, and uses the configured medium model to judge the baseline and candidate against the correction. It fails explicitly if configuration or judging is unavailable. No database lookup is performed. For a controlled test or alternate transport, add `--factory /tmp/practice-provider.ts`. That module exports `createPracticeDependencies(example)`, returning the explicit `provider`, `judge` and optionally `routing`, `env`, `urgencyCheck` and `topicCheck`. Use the existing configured provider factory for actual models. Model calls remain subject to that factory's configuration and gates. A fake factory verifies plumbing only. The export preserves the exact saved jobs. Replay runs every chronological turn through the marked reply, restoring each turn’s saved record and nonsecret pipeline flags. Each next candidate job receives the newly generated earlier replies and reconstructed urgent state. The injected factory selects candidate models.

An optional `comparePracticeCorrection({correction,candidate,candidateWhy})` export returns `{assessment:'better'|'same'|'worse',reason}`. It must compare the candidate with the saved baseline and requested correction. Identical reply, outcome, route reason and urgency count as `same`. Changed outputs remain `unjudged` without this explicit comparison. These are reply feedback labels, never a clinical verdict or clinical acceptance.

Both commands create a new file under `docs/reference/zoe-eval/` and refuse to overwrite existing output. Session history stops at 40 turns, 100 record edits or the 2 MB snapshot budget. Starting a new session resets only the fictional conversation.
