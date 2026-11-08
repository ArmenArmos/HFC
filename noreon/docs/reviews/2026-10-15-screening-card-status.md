# Armen's screening cards: implementation reconciliation

Checked 2026-10-15 for Khikar. Cards43–53 are attributed to Armen Martirosyan in the saved Trello activity export. Their descriptions are empty; acceptance below uses the card titles plus unchanged clinical sources. No Trello status was changed.

## Reference and release boundary

Refreshed main: a239acb64fe336344e39c4b3a78792c04fc7314a. Prior local clinical-source safeguards:287548a. Main was merged into the isolated fix/clinical-source-safeguards branch as063966f before these fixes. Main contains generic screening, test suggestions, clinical review and urgent handling, plus recent UX fixes. It does not contain287548a or this follow-up patch. No deployment or live-release claim applies to these local changes.

The audit searched fetched local/remote history, relevant unique file versions and active worktree changes. No separate complete implementation of these card gaps was found. Examples: fix/trello-overnight has unrelated booking/Home/unsaved-answer changes; open PR150 is pilot rehearsal; neither closes screening cards. Do not cherry-pick another active worktree or infer completion from a branch name.

## One current finding list

| Card | Already present on main | Local correction now | Remaining / disposition |
| --- | --- | --- | --- |
| 43 Lipid referral visible after questionnaire | Missing-lipid rule, lipid catalogue and service-page recommendation existed. Summary hid suggestions in a closed disclosure or suppressed them when current workflow existed. | Existing summary suggestions open on entry; when a workflow exists, an explicit link opens current tests/next steps. Browser followed it to a service page listing lipid profile. | Suggested tests remain distinct from accepted provider bookings. Do not claim every recommendation is already an ordered referral. Locally corrected visibility; not released. |
| 44 STOP-BANG object text | Scoring/finding existed; localized unit object was interpolated as text. | Render numeric score/unit per language, including partial marker. | Clear bug fixed locally. EXTERNAL clinical-validation question remains independently open. |
| 45 Treated hypertension above target | Numeric raised-BP rule, history and urgent precedence existed, but finding omitted reported medication. | Raised-BP detail now explicitly says medication was reported. Classification and review deadlines stay unchanged. | Partial. Individualized “above target” semantics/exceptions need Armen; no dose/target changes. |
| 46 CKD card and potassium-salt exclusion | Reported kidney history excluded generic SCORE2, but no dedicated summary. No potassium-enriched salt advice was generated anywhere. | Visible factual “You reported kidney disease” summary; no stage or new risk category inferred. | Partial. Existing absence of potassium advice is not a tested conditional advice engine. CKD and potassium-sparing-medication exclusions must precede any future enablement. |
| 47 Sudden death before50 → ECG | RF-12 symptom-associated escalation existed. Its ECG could appear only incidentally through another rule. No independent asymptomatic history referral existed. | RF-12 now directly maps to ECG. | Partial. Isolated family-history branch, precise age capture and review priority remain pending source/clinical clarification. No new deadline/urgency invented. |
| 48 Five diabetes questions / unknown duration | Only duration and HbA1c fields; unknown duration existed in rules but numeric input/save rejected it. | Unknown duration selectable and persisted through actual member save; retained as unknown, not0. Prior287548a makes classification wording conditional. | Partial. Type/treatment/glucose answer options/context need source reconciliation. |
| 49 Diabetes follow-up tests | Combined HbA1c/glucose only when separately indicated; kidney test linked to BP. | Prior287548a adds standalone nonfasting unknown-HbA1c ordering and cached-workflow upgrades, retained here. | Partial. Full diabetes package, intervals, due eligibility, accepted existing evidence and unavailable-service route need decision. No blanket orders added. |
| 50 ESC Box2 stress follow-up | Often/always activates a finding; follow-up fields absent. | No invented questions/scoring added. | Pending exact answer format and ownership. Word includes often AND always, beyond title wording. |
| 51 SCORE2/SCORE2-OP and lifetime risk | Model-applicability helper exists in presenter monitor; final post-test categories/pipeline absent. | Source safeguards retain explicit pending classification. | Pending approved score input, calibration, evidence gates and review. No recreated calculator or fabricated category. |
| 52 Emergency emphasis/instructions | Registry red detection and103 action existed. Ordinary chrome/Home links distracted; Word safety instruction incomplete. | Full-viewport critical-token background, prominent103, source sit/do-not-stay-alone/do-not-drive; no routine header/Home/help; only red rules accepted. Compact demo-reset disclosure remains only in demo. | Local member route/render verified EN/HY mobile/desktop. Emergency service is not automatically notified. Legacy presenter demo is not this authenticated member flow. |
| 53 QA paths | Palpitations-only route, exercise eligibility helper and age bounds existed. Relief field absent. | New targeted QA confirms palpitations-only fields/rule, RF08/09 helper and age110 acceptance/111 rejection. | Partial. Exercise scheduler has no current consumer; do not claim operational reminder interlock. Relief wording/options/data mapping require reconciliation; browser date-entry upper boundary not independently exercised. |

## Related clear mapping gap

CP-002 says cardiology within2weeks plus ECG/lipids/Hb/TSH, but its isolated planned-test output was empty. Local correction maps ECG and lipids and adds catalogue-backed TSH. Hb remains explicitly unresolved because the catalogue offers CBC, not a standalone Hb entry; CBC substitution would expand scope. This is a partial branch implementation, not full completion.

## Source anchors and safeguards

Decision tree v1.1 Word (zero-based XML paragraph indices):P116–118 and207–209 potassium/CKD exclusions; P175–179 BP timing; P205 five diabetes fields; P231–233 missingHbA1c; P250–252 isolated familySCD priorityECG; P301–304 stress follow-ups; P325 urgent instructions; P328 relief clarifier; P339 CP002 investigations; P370–371 exercise reminder interlock; P441/P444 external SCORE2 input. Questionnaire Word P247–250 confirms urgent instructions and relief. Lab JSON contains TSH and CBC. Original clinical sources are unchanged.

Clinical questions: docs/reviews/2026-10-15-questions-for-armen.md. Previously fixed engineering gaps are labelled locally fixed, not presented as unanswered clinical choices.

## Verification boundary

Browser screenshots/logs: output/screening-cards-2026-10-15. Actual member pages/server actions exercised with synthetic local encrypted demo state; no provider calls or hosted patient records. Hosted authentication, database-backed concurrency/persistence and deployed behavior remain outside this verification. Exact final script/build/review evidence is recorded in the accompanying handoff when the run finishes.

Final verification:224 runnable TypeScript scripts passed,12 explicitly DB-blocked; clinical5,250checks passed. Typecheck/build/tokens passed; lint0errors and2pre-existingwarnings. Independent Astra reviewed code and all8screenshots with no unresolved substantive findings. The broader run discovered a language-only profile edit reopening clinical review; a regression-backed stable requirement comparison fixed it while preserving new-test upgrades.
