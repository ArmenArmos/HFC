# Member reminder testing

Implemented locally on 10 October 2026. These changes are not yet deployed to the hosted app.

## Where to use it

- **Today:** the next outstanding reminder and a daily routine with due, upcoming, recorded, taken and skipped states. Urgent guidance and unfinished registration keep priority.
- **My care > Your reminder settings:** the member changes preferences directly, without GP review or republication.
- **My health > Connect my BP monitor:** explains current availability and always offers manual recording.

## Defaults

Medicine reminders are enabled at each published dose time. Members can disable them or choose 15 minutes before, at the dose time, or 15 minutes after. Reminder changes never alter the medication, dose or recorded schedule.

Blood-pressure tracking is enabled by the member. Its starting reminder times are 08:00 and 20:00, in Armenia time (UTC+4). Members can edit, add or remove times, up to four distinct times daily. These times organize reminders; they are not a prescribed measurement frequency.

## Basic acceptance test

1. Use a fictional case with a published example medicine. Open My care and enable BP reminders.
2. Move a medicine reminder 15 minutes earlier and change the first BP time. Save and refresh.
3. Confirm both preferences persist and the recorded medicine dose time has not changed.
4. Record a BP reading after the morning slot. Today should show that slot as Recorded; the evening slot stays Upcoming or Due until its own reading exists.
5. Record a medicine as Skipped. It must remain distinct from Taken.
6. Disable medicine reminders. Today hides its reminder, but My care retains the published medicine and check-in history.
7. Edit in two tabs. Save in one, then try the stale tab. The stale save must be rejected with reload instructions.
8. Test a 23:50 medicine with a +15-minute reminder. The reminder appears at 00:05 on the next day; a check-in uses the original 23:50 dose identity.
9. Open monitor setup. It must not claim a real connection and must offer manual entry.

## Delivery limits

Reminders are currently in-app tasks visible while using Noreon. No background push, SMS or WhatsApp delivery is enabled. Quiet-hour preferences are stored for future phone delivery and do not hide in-app tasks or urgent guidance.

Automatic monitor syncing requires an exact supported brand/model, its integration and a real first-reading test. No simulated pairing is exposed as a real connection.

## Verification completed

Local fictional browser checks: settings save and refresh, reminder/clinical-time separation, skipped medicine, one reading completing one BP slot, conflicting tabs, 360px layout and monitor fallback. Automated checks cover defaults, validation, midnight boundaries, stale revisions, SQL ownership/RLS, invalid RPC values and concurrent saves. Every migration was replayed in an isolated local database and database types were generated from it.
