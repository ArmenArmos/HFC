# Clinical source documents

The screening algorithm is specified here, not in the code. `NRN-CLIN-ALG-001`
is the document code, and `ALGORITHM_VERSION` in `lib/demo/rules/rules.ts`
carries it into every decision the demo records.

| File | What it fixes |
| --- | --- |
| `NRN-CLIN-ALG-001-questionnaire.json` | **The machine-readable specification.** Every question, option, bound and branch condition, plus the twelve red flags and the derived-value thresholds. This is what `pnpm check:clinical` reads |
| `NRN-CLIN-ALG-001-questionnaire.fhir.json` | The same questionnaire as a FHIR `Questionnaire`, for the CQL and FHIR surfaces |
| `NRN-CLIN-ALG-001-questionnaire.docx` | The ten questions in plain language: what is asked, which answers exist, and where each one leads |
| `NRN-CLIN-ALG-001-decision-tree-v1.1.docx` | The full decision tree in two phases, screening and post-diagnostic, with a guideline citation on every branch |
| `NRN-CLIN-ALG-001-triage-simulator.html` | The executable specification: the branching graph, the twelve red flags, the derived metrics, the four triage levels and the threshold registry with its sources |
| `NRN-LAB-CAT-001-lab-catalogue.json` | What the algorithm orders, which packages carry it, and which investigations no package currently delivers |
| `NRN-LAB-CAT-001-lab-catalogue.docx` | The same, as the clinical team circulates it |

There is also a CQL/FHIR knowledge package, `noreon-cds`, which compiles the
same logic for a certified engine. It is not vendored here: it is a JVM service
with its own repository and its own build, and this app does not call it. When
the two disagree, that package and this one are both transcriptions of the
documents above, and the documents settle it.

## Never edit these here

They are copies of what the clinical team maintains. Taking an update is a file
replacement, which only works while the copies are still identical to their
source. A wrong value is wrong upstream: raise it there rather than patching the
copy, the same rule the vendored design tokens follow.

Open the simulator in a browser to read it. Its three tabs are the branching
walkthrough, the red flag registry and the threshold table, and the walkthrough
is the fastest way to see what a given set of answers produces.

### The v1.1 machine-readable files were transcribed here, not supplied

The clinical team sent the v1.1 update as Word documents only. The JSON files
are what `pnpm check:clinical` reads, so the alcohol question could not reach
the app until they moved too, and three of them were transcribed in this
repository rather than received:

| File | Transcribed from |
| --- | --- |
| `NRN-CLIN-ALG-001-questionnaire.json` | `NRN-CLIN-ALG-001-questionnaire.docx` v1.1 and §2.4 of the decision tree |
| `NRN-CLIN-ALG-001-questionnaire.fhir.json` | The questionnaire JSON above, generated from it so the two cannot disagree |
| `NRN-LAB-CAT-001-lab-catalogue.json` | The three entries the v1.1 `.docx` added: antithrombin activity, the PCR viral panel (CMV DNA, HCV RNA, HSV-1/2 DNA, EBV DNA) and copper |

Those three are the only files here that are not copies of something the
clinical team holds. They need replacing with the team's own regenerated
copies, and until that happens a disagreement between them and the Word
documents is this repository's mistake rather than an upstream one.

The three catalogue entries are all what the catalogue calls a
`Ծրագրի լրացում`, an addition to what the packages carry rather than a new
investigation the algorithm orders. Nothing in `lib/demo/seed/tests.ts` refers
to them and the reconciliation the check prints is unchanged.

`NRN-CLIN-ALG-001-triage-simulator.html` was left at v1.0, because it is a
rendered document rather than data: it still walks the nine-question graph and
has no alcohol branch. Nothing reads it, but it is the fastest way to read the
algorithm and it is now the wrong version to read.

## What the code takes from them

| Source | Code |
| --- | --- |
| The spec-to-app translation table | `lib/demo/seed/spec-map.ts` |
| The branching graph, question by question | `lib/demo/seed/questions.ts` |
| BMI, waist, pack-years, blood pressure category, activity adequacy, diet score, AUDIT-C, weekly alcohol in grams, STOP-BANG, OSA risk, SCORE2 applicability | `lib/demo/rules/derived.ts` |
| The twelve red flags, `RF-01` to `RF-12` | `lib/demo/rules/rules.ts` |
| `session.triage_level = MAX(all_triggered_flags)` | `highestUrgency` in `lib/demo/rules/engine.ts` |

The flag ids are the ones in the registry. A finding shown on screen carries the
same id a clinician would look up, which is the point of keeping them.

## Where the algorithm stops

It screens. It does not diagnose, it does not prescribe, and it does not replace
a consultation. Three lines in the source govern everything downstream:

- Red always wins. One red answer among eight green ones is a red result. Not an
  average, not a sum, not last-write-wins.
- "Right now" is asked first. Before frequency, before history, before
  medication.
- A missing answer is not a zero. Someone who does not know their blood pressure
  does not have a normal blood pressure; it is recorded as unknown and they are
  sent to measure it.

STOP-BANG, the Epworth sleepiness scale, the AHI classification and the ADA
diagnostic criteria are not in the five ESC guidelines the rest of the algorithm
rests on. They are marked `EXTERNAL` in the threshold registry and need separate
validation before any production use.

## Two documents, two models of alcohol

Version 1.1 asks about alcohol in both source documents, and they do not ask the
same thing:

| Source | What it specifies |
| --- | --- |
| `NRN-CLIN-ALG-001-questionnaire.docx`, question 4 | AUDIT-C. Three items, a total of 0 to 12, and cut-offs that differ by sex: 4 for men, 3 for women |
| `NRN-CLIN-ALG-001-decision-tree-v1.1.docx`, §2.4 | Grams of ethanol a week, with a 100 g ceiling that is explicitly the same for women and men |

Neither replaces the other. AUDIT-C screens for harmful use and dependence; the
gram figure is a cardiovascular exposure, and the two answer different
questions about the same three answers. The app computes both, from the AUDIT-C
items plus the drink type and volume that §2.4 asks for, and the questionnaire
itself sanctions those two extra fields where it says the standard-drink figures
are approximate and the app asks for the drink and the volume as well.

The documents also place the question differently: the questionnaire makes it
question 4 of ten, the decision tree makes it a fourth subsection of question 2.
This app follows the questionnaire, because the questionnaire is what fixes the
question order and the app renders that order.

## A conflict between two sources, unresolved

`NRN-LAB-CAT-001` exists as a Word document and as JSON, and they disagree about
**NT-proBNP**:

| Source | What it says |
| --- | --- |
| `.docx`, section Ա.1 | Available in **Essential and Metabolic**, ordered as needed, ESC HF 2023 |
| `.json`, section Բ.2 | **In no package at all**, severity `high`, needed for the breathlessness branch when heart failure is not already diagnosed |

Both cannot be true, and it matters: `NRN-RULE-CMB-001` asks for NT-proBNP when
heart failure is on the conditions list. This app follows the JSON, because the
JSON is what the check reads and the more cautious of the two readings is the
one that does not promise an investigation nobody can perform. That choice is
recorded here rather than made silently, and the clinical team should settle it.

## What this app does not implement

The decision tree is at version 1.1 and has two phases. This app implements
**Phase 1, the screening**, which is what the questionnaire and the triage
result are. Phase 2 is the post-diagnostic tree: what happens once laboratory
values come back, including the SCORE2 category lookup, the LDL-C target ladder
and the HMOD determination. The demo shows a report and a plan, but it does not
run that tree, and no screen should imply it does.

`pnpm check:clinical` also reconciles the ordered tests against the laboratory
catalogue and prints anything the current packages cannot deliver. That list is
not a failure; closing it is a procurement decision, and the catalogue carries it
as an open question. Printing it stops the demo implying an order that nobody
can fulfil.
