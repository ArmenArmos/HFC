# Noreon: previous report import and AI explanation

Status: ready for scope review, 8 October 2026. No AI service connected yet. This is a new backend subsystem (architectural work).

## Member experience

Results offers Add a previous report. Accept one PDF, JPEG or PNG at a time, initially up to 8 MB and 10 pages. Explain the selected processor and ask for consent before sending a report to AI. Allow cancellation without losing existing records. Start with fictional reports for end-to-end validation.

The first pass extracts report date, test name, literal result text, numeric value where present, comparator (such as < or >), units, the laboratory reference interval, laboratory identity and source page/snippet. Missing information remains missing. Patient identity from a report is not silently attached to the signed-in member; ask the member to confirm that it is their report and flag any possible mismatch without revealing another account.

Show the source alongside editable extracted fields. Highlight uncertain, missing and contradictory fields. Preserve original extraction and the member's corrections. A member confirmation is not clinician review. Never convert qualitative results such as negative, positive or trace into invented numbers.

After confirmation, add the document to report history and eligible numeric observations to graphs. Group only the same marker and compatible units; do not infer unit conversions or clinical targets. Use collection dates, not upload dates. Preserve historical values as historical; an old abnormal report does not assert a current emergency. Missing dates or units must be resolved before graphing.

A separate AI explanation describes the report in plain language, references the source values/pages, and proposes questions to discuss with a clinician. It must not diagnose, prescribe, change medication, declare an all-clear, or create a clinician-approved plan. Recommendations based on Noreon's medical documents remain produced by the versioned clinical rules engine. AI never edits the questionnaire silently. Any suggested profile update must be shown as a separate member-confirmed change.

Initial coverage: laboratory tables, including numeric and qualitative results. Other written test reports can be stored and summarized as report text. Raw ECG traces, imaging interpretation, radiology diagnosis and scans without a written report are not supported in the first release.

## Backend and separation

Keep originals in a private Supabase Storage bucket with owner-scoped policies. Persist an owner-scoped report record, extraction job state, source checksum, extracted fields, corrections, consent timestamp, provider/model and prompt version. Store AI explanation separately from clinician explanation. Add provenance links to member-imported observations; never populate reviewed_by/reviewed_at from AI or member confirmation.

A verified server session determines the owner, never a client-supplied user ID. Signed upload URLs must be tied to a server-created report and fixed owner path. Validate MIME signatures, size, page count and decode failures before processing. Reject encrypted or malformed files with an actionable message. Serve originals only to the owner through short-lived links.

Use an atomic per-account quota and one active processing job per report. Workers claim jobs with a lease, bounded retry and idempotent confirmation. Cap files, output tokens and daily usage. A timeout leaves the document retryable without duplicating saved observations. Do not log documents, extracted health data, signed URLs or provider responses.

Treat document text as untrusted content: no tools, links to fetch, code execution or instructions taken from the document. Require a strict response schema and deterministic validation. Model uncertainty is advisory, not a calibrated accuracy probability.

Provider selection and credentials remain pending. OpenAI direct is the simplest proposed first connection. Use stateless requests and store:false where supported. This does not by itself mean zero retention: verify the account's actual data controls before real report processing. Vercel Gateway is an alternative, with explicit model/provider routing and no unapproved cross-provider fallback for health documents.

Do not put real uploads or production API credentials in the fictional demo. The demo uses static sample reports and labels every simulated extraction. Real upload capability remains feature-gated until authentication, consent, isolation and end-to-end provider checks pass.

## Acceptance tests

- Photograph and PDF of the same fictional report produce matching dates, values and units.
- Armenian, English and Russian examples; blurry decimal, comma decimal, < value, qualitative result, missing unit/date, duplicate upload and wrong-person report.
- A fabricated instruction inside a report does not change extraction instructions or cause external calls.
- Two accounts cannot list, view, download, modify or confirm each other's documents or results.
- Invalid type, oversized file, timeout, provider refusal and interrupted upload recover honestly.
- A correction is saved with provenance; retries do not create duplicate graph points.
- Historic abnormal results do not trigger current symptom guidance; no AI output becomes a prescription or clinician review.
- Mobile file selection, extraction review, correction, confirmation and reload persistence work end to end.

## Connection recommendation

Use OpenAI directly for the first integration. This keeps one named processor and one account to configure. A Vercel AI Gateway integration remains an alternative if central billing and routing become useful, but adds another service to review and configure. Dedicated OCR plus a separate language model can be evaluated later if the representative report set shows that direct extraction is insufficient. It would add a second extraction pipeline now.

Use the Responses API with strict structured output and store:false. Pass a bounded file in the request, without a public URL or a persistent provider file/vector store. No model tools, external browsing, or cross-provider fallback. Select and pin an available document-capable model only after evaluating fictional Armenian, Russian and English reports in the company account. Do not equate valid JSON with accurate transcription.

References checked 8 October 2026:
- https://developers.openai.com/api/docs/guides/file-inputs
- https://developers.openai.com/api/docs/guides/your-data

## Fit with the current app

The current CareResult type represents exact numeric observations. Keep imported report rows as their own records so qualitative, comparator and undated entries remain readable without entering numeric graphs. Only member-confirmed, exact numeric results with a resolved collection date, a recognized marker and matching units may enter an explicitly labelled imported-results trend. Unknown markers remain visible in the report. Never map a marker solely by a model-generated name.

Add a report card and Add a previous report action to Results, followed by a report review page and a saved report detail page. Use Direction A styling and the existing English/Armenian UI conventions. Keep each original result string beside its editable normalized fields and keep the document preview available. A failed extraction keeps the original and explains retry or replacement. An unreadable report produces no invented results.

The existing clinician result list and care-plan workflow remain independent. Importing a file does not complete an ordered test, resolve an incident, book an appointment or publish a treatment plan. AI-generated explanations are labelled as such. Member confirmation is labelled Imported by you, not Review published or Review pending, which could imply a clinical service that has not been arranged.

## Initial operating limits and lifecycle

Allow at most five extraction attempts and five explanation attempts per member per UTC day, one leased job per report, and a configurable global daily attempt ceiling initially set to 50. Enforce quotas atomically before provider calls; an API timeout counts as an attempt because it may have incurred cost. Set separate bounded output limits for extraction and explanation. A model refusing, returning invalid data or exceeding limits leaves a clear retryable/error state without saving observations.

Upload originals directly to the private bucket using a short-lived, fixed-path, create-only signed upload. Server processing validates the uploaded file before any AI transmission and claims the stored report/job. Do not send 8 MB files through a server-action request body. Cap images by decoded dimensions as well as byte size. Enforce the ten-page PDF limit before processing. Reject active HTML/SVG and attachments inside documents. Preview PDFs through a constrained viewer, never arbitrary uploaded HTML.

The state sequence is uploaded → processing → needs_review → confirmed, with explicit failed/retryable states. A version check prevents stale review forms overwriting later corrections. Confirmation is transactional and idempotent. An expired job lease may be retried on member request; it must not write over a later attempt. Store only sanitized error codes, not model responses, in operational logs.

Allow members to remove their imported report, extracted rows, explanation and associated graph entries, without removing independent clinician records. Clear ownership-scoped cached previews as part of removal. If storage cleanup fails, keep a deletion tombstone for retry and hide access immediately; never claim permanent deletion until cleanup succeeds. Do not promise removal from provider abuse-monitoring retention; disclose the actual configured retention before accepting real documents.

## Rollout and outstanding setup

Company AI account selection and billing are needed to run provider tests. No AI credential exists in the noreon-app production configuration at the time of this review. Secrets belong in server-only configuration. No real report has been sent to an AI provider by this work.

Build and validate against fictional reports first. Keep real uploads disabled until private storage/RLS, file validation, owner isolation, correction persistence and actual provider extraction pass the acceptance tests. SMS authentication remains a separate release dependency for real members. hCaptcha is now saved in production; SMS delivery remains unresolved under Vonage support ticket 3149119.
