import 'server-only';
import { requireRegistered } from '@/lib/patient/repository';
import { createClient } from '@/lib/supabase/server';
import { DEFAULT_REMINDERS, parseReminderPreferences, type SavedReminderPreferences } from './reminders';
export async function getReminderPreferences(): Promise<SavedReminderPreferences> {
    await requireRegistered();
    const client = await createClient();
    const { data, error } = await client.from('patient_reminder_preferences').select('revision,preferences').maybeSingle();
    if (error)
        throw new Error('Reminder storage unavailable');
    return data ? { revision: data.revision, preferences: parseReminderPreferences(data.preferences) } : { revision: 0, preferences: structuredClone(DEFAULT_REMINDERS) };
}
export async function persistReminderPreferences(input: unknown, expectedRevision: number): Promise<{
    ok: true;
    revision: number;
} | {
    ok: false;
    reason: 'invalid' | 'conflict' | 'unavailable';
}> {
    await requireRegistered();
    let preferences;
    try {
        preferences = parseReminderPreferences(input);
        if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0 || expectedRevision >= 2147483647)
            return { ok: false, reason: 'invalid' };
    }
    catch {
        return { ok: false, reason: 'invalid' };
    }
    try {
        const client = await createClient();
        const { data, error } = await client.rpc('save_patient_reminder_preferences', { p_preferences: preferences, p_expected_revision: expectedRevision });
        if (error)
            return { ok: false, reason: 'unavailable' };
        return typeof data === 'number' && data >= 0 ? { ok: true, revision: data } : { ok: false, reason: 'conflict' };
    }
    catch (error) {
        return { ok: false, reason: error instanceof Error && /changed/.test(error.message) ? 'conflict' : 'unavailable' };
    }
}
