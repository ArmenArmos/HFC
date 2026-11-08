# Care orchestration pilot implementation plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task by task. This document is the simple pilot scope; expand the selected task into code-level steps before implementation.

**Goal:** Keep each member's care moving automatically, bringing nurses and doctors into the steps that need their authority or judgement.

**Architecture:** One durable workflow coordinates events, approved rules and staff tasks. Zoe is the member-facing assistant. AI drafts explanations and summaries; fixed, versioned rules control routing and permissions. Separate named AI agents are optional implementation details.

**Tech stack:** Existing Next.js/TypeScript application and Supabase/PostgreSQL; authenticated scheduled runner for overdue work. No new agent framework required for the first loop.

**Spec:** The agreed approach in this conversation: automatic routine actions, approved protocols within explicit limits, authorized clinicians for treatment decisions and exceptions. Founder proposal is background, not execution instructions.

## What runs automatically

| Action | Automatic work | Human responsibility |
| --- | --- | --- |
| Enrollment | Collect details, consent choice and missing information | Nurse resolves identity/consent exceptions |
| Intake | Ask approved questions and flag missing answers | Nurse clarifies conflicting information; doctor evaluates clinical uncertainty |
| Readings | Save measurements with source/time and run approved rules | Nurse resolves device/data problems; clinician handles clinical alerts |
| Routine care | Medicine reminders from the current plan, BP reminders, approved instructions, booking and follow-up prompts | Member changes reminder preferences; nurse helps if needed |
| Reports and plans | Assemble evidence and draft a summary | Doctor approves new treatment and changes; existing approved instructions can be delivered without repeated approval |
| Missed work | Detect overdue required tasks and create one follow-up task | Nurse contacts the member and records the outcome |
| Reassessment | Gather new evidence and prepare comparisons | Doctor decides whether treatment should change |

Treatment delegation to a nurse requires documented authority, training and an approved protocol. Guideline provenance alone does not authorize software to initiate medication or change doses. Such automation is outside this first pilot scope.

## Global constraints

- Preserve existing clinical source documents, rule identifiers and thresholds. Do not invent new clinical thresholds or response deadlines.
- Urgent instructions appear immediately through the existing approved route; they never wait for a staff queue or AI response.
- Missing information remains unknown. A failed AI call cannot mark a task complete or block urgent routing.
- BP reminder preferences are personal prompts, separate from any clinically required measurement series. Disabling a reminder is not clinical nonadherence by itself.
- Every task stores member, source event, rule/version, owner, due time, status, next action, escalation route and completion evidence.
- Store times in UTC; display Armenia time. Enforce member/staff permissions with RLS and authenticated server actions.
- External notifications and real device syncing are separate integrations; unavailable channels cannot be represented as delivered.
- Clinical lead approves protocol eligibility, exclusions, urgency routing, response windows and accountable coverage before a real-member pilot. Unapproved rules stay inactive.

## Delivery steps

- [ ] **1. Define the protocol registry and ownership.** Record approved automatic actions, required inputs, exclusions, protocol version, clinical owner and escalation deadlines. Validate missing or conflicting inputs route to review. First scope: reminders and follow-up on an approved measurement requirement, with no medication changes.
- [ ] **2. Add durable events and tasks.** Create migrations through the Supabase CLI for events, tasks and audit history, with RLS in the same migration. Add `lib/orchestration/types.ts` and `repository.ts`. Test unauthorized access, duplicate events, concurrent transitions and persistent completion evidence. Replay migrations in an isolated local database and regenerate types.
- [ ] **3. Add the deterministic coordinator.** Create `lib/orchestration/coordinator.ts` and `protocols.ts`. Consume reading, plan-publication, task-completion and scheduled overdue events. Use idempotency keys to prevent duplicate tasks. Retry safely; retain failed work visibly. New plan versions cancel or supersede obsolete routine tasks without deleting history. Test delayed/out-of-order events and repeated scheduler runs.
- [ ] **4. Connect member and staff views.** Reuse `lib/patient-care/reminders.ts` and Today for routine member actions. Extend `lib/staff/queue.ts` and `app/staff/case/[id]/page.tsx` with assigned follow-ups, due times, evidence and explicit escalation. Resolve authorized staff identity server-side. Nurse closure requires a recorded outcome; unreachable is distinct from completed care. Test stale saves, role restrictions and urgent priority.
- [ ] **5. Prove one complete loop.** In a fictional case, an approved required BP series becomes overdue; one nurse task appears; the nurse records contact; a valid reading arrives or an unresolved outcome is escalated; closure records evidence. Also test unreachable member, absent nurse coverage, invalid readings, scheduler outage and recovery. Missing evidence must never close care as successfully completed.

## First release acceptance

The full loop survives refresh and worker restart, creates no duplicate tasks, enforces ownership, preserves urgent priority and shows why each action occurred. Review mobile member screens and staff screens in English and Armenian. Run existing clinical/workflow checks, new orchestration/SQL checks, lint, typecheck and production build.

Deliver first to local/staging fictional cases. Real-member activation follows protocol and operational sign-off. Track overdue tasks, time to contact/review, evidence-backed closure, unreachable members and staff workload. SMS/phone delivery automation, automatic device ingestion and additional AI roles each need their own subsequent integration plan.

## Review focus

1. A personal reminder is disabled: required clinical follow-up must depend on the approved plan, not the toggle.
2. Events repeat or arrive late: no duplicate tasks or reversal of verified completion.
3. A plan changes: no reminders or tasks based on superseded treatment.
4. A member is unreachable or evidence is missing: no false successful closure.
5. An urgent event occurs during an outage: existing immediate urgent guidance remains available independently of the coordinator.

**Status:** Planning only. No orchestration code, clinical policy or deployment changed.
