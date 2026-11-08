# Member-controlled daily care and reminders

## Intent and approved direction

Make medicine check-ins, BP tracking and monitor setup easy to find in Noreon. Use the existing navigation: Today for daily actions, My care for schedules and preferences, My health for readings and device connection. The member owns reminder preferences; the GP does not set notification preferences. Preserve the GP's published medicine instructions and the existing urgent route.

This is the written design for review before implementation. No product code has changed yet.

## Member experience

### Today

Show the next outstanding action first, then a compact daily routine in time order. Use the actual medicine name and dose from the published plan. Show due, upcoming, reported taken, reported skipped and recorded BP states in words. Completed tasks remain available without crowding out the next action. Hide the routine during an unfinished questionnaire and give urgent guidance precedence.

A medication check-in keeps its original medication ID and scheduled dose timestamp. A reminder preference never creates a medication, changes a dose or marks a dose as taken.

BP tracking is enabled by the member from My health, or offered during care-plan onboarding. Turning it on creates default reminder times of 08:00 and 20:00 in Armenia time. These are organizational defaults, not a prescribed measurement frequency. The member can edit, add, remove or disable times. Any recorded monitoring instructions remain visible separately.

### My care: Reminder preferences

Medicine reminders are enabled by default when active published medicines exist, at each recorded dose time. The member can disable them and choose a reminder offset relative to the recorded dose time: at the scheduled time, 15 minutes before or 15 minutes after. Display the dose time separately from the reminder time. The prescribed schedule is not editable here.

BP preferences default to morning/evening times when the member enables tracking. No reminders fire before BP tracking is enabled. Limit the schedule to four distinct times per day, validate HH:mm and show a timezone label.

In-app reminders are available by default. External delivery is opt-in. Quiet hours suppress external delivery, not the visibility of due tasks or urgent guidance. Provide a clear save state, useful validation errors, and settings that survive refresh and sign-in on another device for a real account.

### My health: BP monitor

Offer Connect my monitor beside BP recording and in My health. The connected state requires a first successfully received reading, not merely permission or account authorization. Show model, source and last received timestamp. Preserve manual entry whenever setup or sync is unavailable.

Until an exact brand/model and its supported integration are identified, the production setup displays that automatic syncing is not yet available and offers manual entry. Demo simulation must be explicitly labelled and must not set a real connected status.

## Persistence and boundaries

Use the existing shared demo-case state for demonstration preferences, with revision-conflict protection and the existing expiry. Store real-account preferences in a dedicated member-owned table with RLS in its creating migration. Do not put preference changes into GP draft/publication commands. Regenerate database types after the migration and replay local migrations before delivery.

Keep scheduling in a framework-independent module under lib/patient-care. Generate daily tasks from the approved care data, member preferences and actual measurements. Default preferences apply to existing accounts without rewriting their clinical plans. A later GP publication must preserve the member's preferences and retire reminders for inactive medications.

Use stable occurrence identities for scheduled tasks. Editing reminders must not alter dose-event identities. Map BP readings into the appropriate due slot; one reading must not complete both morning and evening tasks. Never use optional synthetic demo history to complete real daily tasks.

## External reminders: separate delivery phase

The current application has an event inbox, but no push subscription store, service worker or scheduled delivery service. External reminders therefore require a separate implementation plan after the routine and preference model. Use explicit notification permission, member-owned subscriptions, idempotent delivery, expired-subscription handling and neutral lock-screen text. Report unsupported or denied permission without disabling in-app reminders. Do not claim that keeping the page open delivers reminders while the application is closed.

The first implementation can ship the routine, persisted preferences and in-app due reminders independently. Phone notification delivery and real monitor ingestion remain visibly unavailable until implemented and verified. This separation is a delivery dependency, not a change to the intended final scope.

## Acceptance criteria

- Default medication reminders appear only for active, published medications.
- Members change notification settings without GP intervention or a new publication.
- Preferences survive refresh; another member cannot read or modify them.
- Reminder offsets never modify dose times, doses or intake history.
- BP reminders can be enabled, edited and disabled by the member.
- A morning reading does not complete an evening task; missing readings remain pending.
- Turning reminders off preserves the approved care plan and measurement history.
- Urgent guidance remains the first action and is never deferred by quiet hours.
- A replaced plan cancels obsolete medication reminders without resetting preferences.
- No simulated reading, device connection or external delivery appears as a real integration.
- Denied notification permission and failed device sync retain useful in-app/manual paths.
- Verify English and Armenian, a 360px viewport, timezone midnight, due-time boundaries, refresh and concurrent preference edits.

## Delivery order

1. Daily routine, member-owned settings, persistence and in-app scheduling.
2. Opt-in external notifications with background delivery.
3. Real monitor adapter once hardware and supported integration are confirmed.

The design does not choose a monitor brand or invent provider compatibility. The hardware question is pending with the member.
