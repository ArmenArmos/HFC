# Native profile and questionnaire design

The user delegated overnight implementation/design decisions. This architectural batch connects the PR100 server contract to patient iOS/Android, preserving the reviewed web/prototype journey and existing tabs. Use existing Noreon tokens, fonts and sentence-case EN/HY copy; a focused one-field questionnaire with topic progress, no invented clinical thresholds or consent promises. Native sign-in and server API remain disabled in hosted configuration.

## Architecture and alternatives

Use a member-owned journey controller/provider above the existing tabs. A focused profile/questionnaire view replaces the tabs while onboarding, editing or urgent; once the saved assessment is complete and nonurgent, tabs return. MemberDraftProvider remains above both so other drafts survive this transition. Me exposes Edit profile and Review answers. This avoids separate duplicated forms per tab and prevents navigation around a pending urgent draft. A WebView fallback would not implement the requested native journey; a copied rules engine would drift.

The HTTP transport targets only https://app.noreon.health/api/native/journey, freezes a verified current member token, supports caller cancellation and a15s per-request deadline including JSON parsing. Validate response ownership/shape. Never store tokens/health drafts in plaintext, URLs or logs. No dependency/schema/provider change.

The pure controller owns authoritative snapshot, request phase, min expected revision, generation and single-flight writes. Every successful POST must finish a GET with revision >= the saved revision before returning success. Failed POST/409 or uncertain response locks writes; only an explicit reload of the saved version unlocks. Failed post-save GET retries GET only, never POST. On successful recovery discard obsolete local edit only with explicit reload action, whose label states that saved values replace the edit. Background/resume checks revalidate server state without overwriting active drafts; changed revision while editing blocks save and asks for reload. Account change/logout disposes the controller and member drafts; late replies cannot update another member.

## Screens

Profile: name, birth date (YYYY-MM-DD with shared parser/validation), biological sex and current app language. Show the existing pilot information-use copy and require consent for initial registration or missing/version-mismatched acceptance; never preselect new consent. Use GET consentVersion and existing version semantics. Existing consent can carry through profile edits.

Questionnaire: render activeFields excluding q1, single/multi choices, numeric/scale text, paired BP and explicit unknown where allowed. Store raw numeric text to avoid converting blank/partial input to zero. Validate with mergeAnswers/fieldComplete; prune hidden branches via shared rules. Show field bounds/units and topic progress. Back and Continue both validate and save the current answer before moving, so edits are retained in the saved version; an invalid answer stays on its field and explicit Clear is available; review index and completion derive from authoritative read. No auto-save or automatic retransmission.

Emergency: immediately derive shared firesEmergency from valid local pending answers, even offline; show rule reason/nextStep before network completion. Saved urgentRule also blocks ordinary progression. Retain ability to correct the triggering answer and save it. Do not promise clinical monitoring or call emergency services automatically.

Failed initial load shows retry-read, web fallback and sign-out. A successfully completed journey requires explicit completion/read confirmation before returning to tabs. Profile/questionnaire drafts remain memory-only; confirmed re-read replaces the edited field with authoritative values. Do not allow an old field draft to be applied to a different field after branching.

## Verification and release

Pure tests: transport ownership/cancellation/deadline; controller duplicate save, mandatory GET, failed GET recovery, stale revision, late/unmounted replies. Rendered tests: initial profile/consent, all field kinds, invalid numeric, branch changes, urgent offline/correction, completion, conflicts/uncertain state, EN/HY and logout isolation. Existing navigation tests continue using a completed journey fixture. Both exports, iOS Release build and fictional simulator walkthrough; restore fixtures before final build. Claude important-only review before merge/deploy. Physical devices, stores, hosted Auth, distributed API throttling and clinical/consent approval remain activation gates.


## Implementation clarifications

Foreground revision changes retain the original edited snapshot and put newly fetched state in a separate latest snapshot. Newly observed urgent guidance is shown immediately, while all writes/progression stay blocked until explicit reload replaces the edit. A GET revision newer than the just-saved revision is also a concurrent-change review, not permission to advance. Accepted revisions never regress. Provider ownership is keyed internally as well as at the member layout. Local emergency/completeness rules double-check saved completion metadata before tabs can appear. These decisions preserve the original safety invariants without new clinical policy.

## Review corrections

A completed member keeps the existing tab subtree mounted while a read-only foreground journey refresh is loading or fails. A notice distinguishes unconfirmed questionnaire freshness and offers an explicit retry. A newly fetched incomplete or urgent journey closes the gate immediately, even while the old editor snapshot is retained for conflict recovery. This preserves in-flight BP/dose/reminder operations without letting stale completion override newer safety evidence. Profile/consent correction also displays already saved emergency guidance.
