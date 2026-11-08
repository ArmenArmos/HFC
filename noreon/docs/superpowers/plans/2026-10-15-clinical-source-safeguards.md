# Clinical source safeguards implementation plan

## Approved scope and observable acceptance

Khikar requested fixes for clear source/code mismatches and AI safeguards, plus a short clinical question list for Armen. The full post-test engine and unresolved clinical policies remain deferred. Audience: members and clinical staff; deliverables: isolated code changes, regression evidence, rendered local flow checks and an English questions document. Baseline: origin/main f97ac95; no deployment authorization inferred.

## Tasks and current backlog

- [x] Source transcription fixes: inclusive 20 pack-year boundary; preserve one-week grade2 BP consultation text without changing red/orange policy; ensure existing HbA1c investigation is requested for diabetes with unknown result; remove unconditional final HIGH classification wording. Tests assert actual action/window/test-list outputs, unknowns and urgent precedence.
- [x] Evidence-only generated output: AI continues transcribing files; generated report explanations and staff review summaries use bounded deterministic wording from checked facts, with no model-authored clinical prose. Current validator counterexamples must fail; allowed factual summaries work in EN/HY. No numerical/clinical comparison from ambiguous ranges or model memory. Historical summaries cannot bypass new display checks. Explicit doctor-authored approved text remains distinct.
- [x] Trust/provenance: staff report explanations load canonical current report by ID/revision; reject member summary requests; reject stale changed evidence; align extraction receipt with actual prompt version; preserve extraction model identity when producing a non-model summary.
- [x] Questions for Armen: resolve source authority/sign-off, external branches, ambiguous disease/organ-damage gates, source-specific follow-up and provider availability. Do not make these clinical decisions in code.
- [x] Verify locally (DB/provider/live limitations below): baseline checks; failing regressions before fixes; relevant suites plus typecheck/build; actual local mobile/member and desktop/staff affected paths with synthetic fixtures; unsafe/stale/error states; independent Astra review of diff and evidence; close concrete findings. Record live/provider/DB checks not performed.

## Implementation boundaries

Worktree: `.worktrees/clinical-source-safeguards`, branch `fix/clinical-source-safeguards`. Native create_worktree could not resolve the non-Git parent directory, so a Git worktree was created from current remote main. Do not modify sibling worktrees, vendored clinical/design files, database schema or deployments. Other active Noreon thread notified.

Clinical task owns lib/clinical and dedicated source-regression checks. Trust task owns staff AI input/route, member proxy, receipt and their tests. Parent owns source-bound outputs, internal bridge/real report server, UI, clinical questions and integration. One independent Astra whole-result review follows verification.

## Decisions and finding dispositions

- Source/output fidelity is enforced by rendering approved factual structures, not by a keyword blacklist or a model judging its own prose. Free model-authored explanation/summary is replaced with source-bound summaries for this delivery; extraction remains model-based and requires source checking. This changes summary richness but avoids falsely promising semantic validation of unrestricted text.
- No plan/medication/diagnosis authority is added. Results still require current source review and existing doctor publication gates. AI extraction factual accuracy remains a human-source-check requirement, not solved by schema validation.
- Clinical questions do not block independently authorized transcription and engineering safeguards.

## Verification ledger

- Final 20 focused TypeScript scripts passed on 2026-10-15, including source boundaries, existing workflow upgrades, hostile/stale summaries, staff route/input, extraction provenance, EN/HY report hierarchy, publication integrity and connected journey. `check-clinical.ts`: 5,249 checks passed. Additional EN/HY SSR historical-summary suppression check passed.
- `pnpm typecheck`, `pnpm build` passed. `pnpm lint`: zero errors, two pre-existing unrelated unused-variable warnings. `git diff --check` passed. Clinical source/design files remain unchanged.
- Earlier broad run: 213/228 scripts initially passed; three changed-contract failures were corrected and rerun successfully. Remaining 12 require local DB/Docker; Docker daemon was unavailable. Full DB runner is blocked, not passing.
- Browser: actual DoctorWorkspace prepared evidence summary and displayed one-week follow-up on desktop. Actual ReportWorkspace loaded sample, selected checked report, prepared and expanded source-only summary at 390×844. These were synthetic component integration fixtures. Authenticated shared staff/database E2E and real provider extraction were not run. Temporary fixture route removed before final build; harness/screenshots retained outside app in output/clinical-source-safeguards-2026-10-15.
- Independent Astra review found and closed the cached workflow requirement upgrade bug, historical narrative display, outdated provider copy and missing current-path regression coverage. Ledger: output/clinical-source-safeguards-2026-10-15/Astra_Review.md.
- No merge, deployment, database migration or clinical policy sign-off. Full post-test classification remains the next phase after Armen answers.

