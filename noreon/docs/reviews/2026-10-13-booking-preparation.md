# Booking preparation review, 13 October 2026

Scope: the reported shared fictional case showed missing operational address/preparation detail and requested provider confirmation after all three booked laboratory results had arrived. Product source reviewed at `5d6c5cf`, based on `a4486d0`.

## Acceptance criteria

- Authenticated shared operations can record the named provider's supplied instructions for the applicable booking before any result receipt. Members and doctors cannot record them. Stale revisions and storage conflicts reject the change.
- Operations and the member can read the booking address, provider, recording time and full instructions. Member preparation states work in English and Armenian at 390 and 1280 widths.
- Recording preparation preserves the requested reservation status. Replacement or changed recommendations invalidate preparation for the new booking.
- Completed bookings have zero active bookings and no pending preparation prompt. Partial receipts without recorded preparation describe receipt progress; home recording tasks show task guidance.
- Clinical evidence, review drafts, publication, assignments and result receipt remain unchanged by the preparation action. No provider contact, external message or inferred medical instruction is introduced.

## One finding list

Independent GPT-6 Astra review identified three P2 findings. All three were closed by the final source and rendered-image review at `5d6c5cf`; no serious unresolved finding remained.

| Finding | Evidence | Disposition | Fix verification |
| --- | --- | --- | --- |
| P2: preparation falsely confirmed a reservation | Care projection treated supplied preparation as booking confirmation | Keep the booking requested | Model check asserts requested status before and after recording and replacement |
| P2: home recording tasks requested impossible provider confirmation | Home logs share the booking preparation renderer | Render home recording guidance | Actual EN/HY component checks assert home instructions and absence of provider confirmation |
| P2: partial receipt left an impossible pending preparation prompt | First receipt disables the preparation action while outstanding results remain | Describe partial receipt progress; retain previously recorded text | Component/model checks assert receipt progress, one active booking, blocked late recording and preservation of existing instructions |
| TS1: stale next-action copy assertion | First full PR CI ran 132 TypeScript checks; `check-work-queue.ts:39` alone expected `/arranged/` after the intentional request wording change | Closed: assert the exact approved English and Armenian saved-request titles | Fresh focused work-queue check and file ESLint passed; fresh full CI remains the release gate |

## Verification and reality boundary

- Fresh full typecheck passed. Full ESLint passed with zero errors and two existing unused-variable warnings in `app/demo/welcome/page.tsx` and `scripts/check-report-content-parity.ts`.
- Fresh booking model, actual component EN/HY rendering and server-action checks passed. The action check explicitly mocks authentication/storage; it covers member, missing staff, doctor, stale revision, storage conflict, successful admin save and disabled shared mode.
- Reconciliation (10 tests), service workflow, service publication and member service guards passed. No database schema or migration changes are required.
- The root coordinator exercised the real member booking action, standard staff sign-in, operations Save provider instructions action and member reload against local SQL and compare-and-swap persistence. An ignored local hosting fixture supplies shared demo routing; this is a local end-to-end action check, not a hosted production action check or an authentication bypass. Fixture identities and instructions are fictional; no OTP/provider/external messaging was sent.
- Read-back of local before/after audit snapshots confirms case revision 2 to 3 and a staff-attributed `booking.changed` event. Assessment, care, review tasks, measurements, monitoring revisions, clinical draft, publication, assignment, consultation, requirements, receipts and evidence revision metadata are identical.
- The root coordinator exercised actual rescheduling (new booking has no preparation) and all three receipts (zero active bookings and no pending preparation). A completed three-laboratory booking with other unbooked home tasks is also covered.
- Operations 390×844 form capture `booking-provider-form-ops-390.jpg` was also visually inspected: address, provider/time, full text, disclosure, labeled fields and Save button were readable without clipping. Operations 1280 rendered capture `booking-preparation-ops-en-1280.jpg` was visually inspected by the coordinator: address, provider/time, full text and recording action were readable. Final rendered English and Armenian provider blocks at 390×844 were visually inspected without overflow (`booking-provider-block-en-390.jpg`, `booking-provider-block-hy-390.jpg`); 1280×900 screens also passed. The actual three-laboratory/one-receipt fixture shows receipt progress without a pending prompt (`booking-partial-receipt-en-390.jpg`). The coordinator accepted the final browser journey at `5d6c5cf`. The independent Astra reviewer also inspected desktop operations, the affected EN/HY 390 renders and partial receipt evidence and accepted all three fixes without serious unresolved findings.
- Fresh default `pnpm build` passed: compiled production routes and generated 82 static pages. The initial worktree dependency symlink caused a Turbopack filesystem-root error; a frozen install of unchanged dependencies inside this worktree resolved the environment issue. Exact-head CI/preview deployment status is recorded in the PR. Hosted read-only acceptance of the originally reported case remains a post-release check.

After the independent Twilio change landed, this branch was rebased without conflicts onto `64b9417`. A byte comparison confirmed the booking product and regression diff is identical to the accepted `a4486d0..5d6c5cf` diff. Full typecheck, lint, production build and the same seven relevant check scripts passed again on the rebased source. No booking migration was added or renumbered; the isolated CI job replays the complete migration sequence.

## React checklist

The changed TSX components use typed props, stable booking/task IDs, escaped text with preserved whitespace and wrapping, native disclosure/form controls, labeled inputs, a disabled pending fieldset and the existing alert/error command transport. The preparation renderer has no hooks or extra fetches; the action authenticates on the server. No component-library change, request waterfall or speculative performance refactor is needed.

## Release boundary

Final browser and Astra acceptance passed on product source `5d6c5cf`; subsequent commits only record this evidence. Use normal protected PR checks and squash merge. App and core previews must be ready at the exact PR head. After merge, verify main CI and production deployment metadata before the coordinator checks the original hosted case. No administrative merge bypass or hosted database push is part of this release. The unrelated Telegram root-folder preview failure is outside this change.
