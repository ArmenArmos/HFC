# Clinical questions for Armen

We are fixing clear software transcription errors now. Before implementing the decisions after test results, we need your answers to the questions below. A short answer beside each item is enough; please identify a replacement source/version where needed.

1. **Which clinical document is authoritative and approved for use?** We have decision tree NRN-CLIN-ALG-001 v1.1, questionnaire Word/JSON and an older simulator. Some disagree. Should v1.1 Word govern, and who signs off the reconciled version?

2. **Which externally sourced branches may we enable?** STOP-BANG/sleep-apnoea criteria and the ADA diabetes-confirmation branch are marked EXTERNAL and require separate validation. Which are approved, and which must stay pending?

3. **What happens when a new report has HbA1c at least 9% but there is no known diabetes diagnosis?** The red-flag register says doctor review within seven days; the diabetes branch also requires confirmation before diagnosis. Should the seven-day review apply regardless of known diagnosis, while confirmation remains required?

4. **What counts as confirmed disease and confirmed BP?** Which evidence may establish ASCVD, CKD, diabetes, familial hypercholesterolaemia or persistent high BP: a member's history, a checked report, an existing diagnosis or explicit clinician confirmation? Who records confirmation?

5. **When may we record organ damage as absent?** Which ECG/echo, urine ACR and eGFR evidence is sufficient? We will keep hypertension-mediated organ damage separate from diabetes target-organ damage; how should missing or conflicting evidence block classification?

6. **For younger people with short-duration diabetes, what exactly means “no other risk factors”?** Please confirm the required factors and evidence for the moderate-risk branch. The simulator adds assumptions that the Word document does not fully define.

7. **How should we ask about breathlessness without known heart failure?** The tree suggests considering NT-proBNP and echocardiography. Please confirm the question, qualifying circumstances and required review timing. We will retain the existing urgent symptom route.

8. **Which missing results block a risk category, and which block publication of any care plan?** For example, should a doctor be able to publish an interim plan while ACR, echo or an applicable SCORE2 percentage is pending? Please name any mandatory gates and permitted exceptions.

9. **How should the validated SCORE2 result enter Noreon?** Please confirm the approved calculator/model, Armenia's regional calibration, required inputs and who verifies the supplied percentage. The Word tree says the score is an external input; the JSON describes a calculation.

10. **What source-specific follow-up must be operationally enforced?** Please confirm who owns each urgent/nonurgent review, how completion is recorded, and what happens when a clinician or test provider is unavailable. A displayed deadline alone is not a completed care pathway.

## Questions from your screening cards 43–53

11. **Which answers should the full diabetes sub-flow collect?** The Word tree names type, duration, treatment, last glucose and HbA1c; the machine source defines only duration and HbA1c. Please confirm type/treatment choices, glucose units and fasting/random context. The unknown-duration button and missing-HbA1c ordering are software fixes already covered locally; they do not need a new clinical decision. (Cards 48–49.)

12. **When should the additional diabetes checks be offered or ordered?** For glucose, creatinine/eGFR, ACR, eye and foot checks, confirm due/overdue criteria, intervals, acceptable existing results and the route when a service is unavailable. HbA1c alone must not silently become fasting glucose or a blanket package. (Card 49.)

13. **What should “above target” mean for someone taking BP medication?** We can show medication history and the raised reading now. Please confirm whether the label uses a generic screening threshold or an individualized clinician-approved target, including exceptions. We have not changed medicines or assigned a personal target. (Card 45.)

14. **What review priority should isolated family sudden death receive?** The Word tree calls for priority ECG when a first-degree relative died suddenly before 50, but gives no deadline or urgency colour. The existing symptom-associated RF-12 already has a review route and its ECG mapping is fixed locally. Please confirm the separate asymptomatic route and how the age criterion is recorded. (Card 47.)

15. **What are the exact response choices for stress and chest-pain follow-ups?** For ESC Box 2, the Word tree includes work, finances, family, loneliness and a recent serious event after “often” or “always”; confirm checklist versus separate questions and who acts on answers. For chest-pain relief, confirm wording, answer choices and whether/how they affect triage. These fields are missing from the machine source; we will not invent a score or alter urgency from guessed options. (Cards 50 and 53.)

16. **Should stable chest-pain review request haemoglobin alone or a complete blood count?** The decision tree says Hb, while the available lab catalogue lists CBC. ECG, lipids and TSH are mapped locally; we need confirmation before substituting CBC or defining a separate Hb service. (CP-002.)

The CKD summary now states reported history without inferring stage. Potassium-enriched salt advice is not generated anywhere in the current implementation, including for CKD. Before any such advice is enabled, its medication/CKD exclusions need explicit implementation and review. (Card 46.)

The post-test output will initially be a source-linked review for the clinician, with missing evidence explicit. Medication selection, dosing, exceptions to targets and final publication will retain clinician authority. We will not copy contradictory simulator behavior or fill clinical gaps from model memory.

Engineering evidence: `/Users/khikardanielyan/Code/Noreon/output/Noreon_Clinical_Decision_Tree_Audit_2026-10-15.md` and its detailed Phase 2/source matrices. Original clinical files remain unchanged.
