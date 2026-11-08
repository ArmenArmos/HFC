# Clinician workspace correction

Audience: assigned doctors and nurses; administrators managing their clinic access. Target: shared demo and native review in the existing Next app. Reference: reviewed patient journey HTML v6 provides visual density and care-team responsibilities; it does not contain a corresponding doctor portal screen to copy.

Accepted user scope: doctors can do nurse duties and clinical treatment; nurses collect assigned members' measurements/evidence and record follow-up, but cannot create/change treatment. Use explicit assignment in the doctor's active clinic, not clinic-wide or administrator access. Clinical source approval and publication remain doctor-only. This supersedes the earlier follow-up spec's exclusion of implementing nurse roles. Existing clinical rules and publication guards remain intact.

Navigation: Overview (compact status + next action), Evidence (questionnaire, readings, tests and historical report review together), Treatment plan (consultation, draft, publication), Follow-up (care-team tasks and doctor-set monitoring), History. Nurse navigation omits Treatment plan entirely. Native review uses the same grouping and server role boundary.

Acceptance checks:
- Existing reported confusion is resolved: historical reports appear in Evidence, matching links and headings.
- Long evidence-change history is disclosed while stale-evidence warning remains visible. Publication requirements are disclosed, not duplicated as a second expanded checklist.
- Active save/review alone shows busy identity; conflicting mutations remain guarded. Success/failure release busy state and preserve uncertainty/conflict refresh behavior.
- Nurse standard sign-in opens nurse queue. Only explicitly assigned active-clinic members are accessible; unrelated, inactive, cross-clinic and clinical-mutation access is denied in server/SQL checks.
- Doctors can record the same care-team measurements/notes, plus existing treatment workflow.
- Care notes are append-only and attributed; they neither send messages nor approve source results. Measured values use existing validation and do not invent clinical thresholds.
- Desktop and phone rendered flows inspected, with empty/error/loading paths and actual fictional measurement/note/save entry-point exercise. Mocked React boundary regression is separately labelled.
- No existing clinical case data is changed in hosted databases by QA; SQL replay and fictional role accounts use isolated local instance.

Finding list and evidence:
- UX1/UX2 closed: reports grouped under Evidence; compact Overview and disclosed supporting detail inspected at 1280×900 and 390×844 in actual local browser. The supplied patient prototype has no doctor portal screen; no literal doctor-screen match is claimed.
- BUG1 closed: actual shared draft save showed one busy action, released after success. Actual React regression covers synchronous overlap rejection, error release and refresh failure.
- ROLE1 closed: standard nurse login, assigned queue, unrelated case denial, measurement and attributed note saves exercised on isolated fictional cases. Doctor care-team note save exercised too. Native nurses see approved care and readonly evidence, without treatment controls. Five forward migrations replayed from empty isolated DB; 43 SQL checks and three-session concurrency pass; generated types match. No hosted QA clinical writes or actual nurse account grants.
- DATA1 closed: live provider revisions refreshed after shared care tasks; tests reject stale-prop reuse and block further writes after uncertain refresh.
- DRAFT1 closed: native browser two-tab saved-draft conflict and injected same-revision source change preserve local text and block save until explicit resolution. Actual React tests cover stale responses, pending field lock, unchanged draft renewal and medicine-time comparison. Mocked boundaries are not handset or browser end-to-end evidence.
- INBOX1 closed: nurse inbox metadata additionally checks current assignment and active care access, fails closed on denied/error/ambiguous results, deduplicates bounded checks. Actual module regression exercises authorization boundaries.

Independent review: GPT-6 Astra inspected the concrete result, rendered desktop/phone evidence and role/concurrency/editor boundaries. Concrete findings above were resolved and reviewed; final narrow inbox and rebased service authorization review has no remaining findings.

Release evidence is recorded separately in the review report and current rehearsal handoff. Provider messaging remains disabled pending external approval; clinical rules are unchanged.
