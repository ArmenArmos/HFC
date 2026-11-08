# Native reminder settings

Continue the Android/iOS patient journey under the overnight delegation. This bounded change exposes the existing web reminder preferences in the native dashboard. It does not add notification delivery, alter prescriptions or choose clinical schedules.

## Behavior

Use the same preference schema/defaults and owner-bound `save_patient_reminder_preferences` RPC. Members can enable medicine/BP reminders, choose the existing -15/0/+15 minute offset, one to four distinct HH:mm BP times, and quiet hours. All times are Armenia time. Explain that these are saved organizational settings, phone/SMS/push delivery remains disabled and quiet hours do not hide urgent guidance.

The editor preserves unsaved edits during ordinary dashboard refresh. Save binds an exact payload/revision and freezes editing until the outcome is known. A failed/uncertain save may retry only the same payload/revision; a revision conflict requires explicitly loading current settings before another edit. No automatic conflict overwrite. Reload fetches server settings instead of guessing whether an uncertain save committed. Success updates the editor revision and refreshes the dashboard so dose eligibility uses the new offset.

Read/save calls verify the expected account and capture its token. Unmount/account change prevents stale state application. Bounded waits end even when identity verification stalls. No new grants, migration, providers, local notification permissions, health-data disk storage or synthetic production data.

## Implementation and verification

Extract only preference schema/default helpers into a shared module with no runtime clinical engine dependency; existing web imports remain compatible through re-exports. Native helper validates revisions/preferences and handles save/read results. Add EN/HY editor using existing native tokens and accessible controls. Test shared schema parity, malformed/repeated times, CAS conflict/unknown behavior and no invalid RPC. Run existing web reminder/clinical checks plus native tests/type/lint, both exports, iOS build, and Claude review before merge. Enabled sign-in and real-device acceptance remain external prerequisites.
