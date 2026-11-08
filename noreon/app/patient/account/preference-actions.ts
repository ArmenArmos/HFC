'use server';
import {loggedAction} from '@/lib/observability/with-logging';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import {
  callbackFrom, contactPreferenceInput, textSize,
  type CallbackResult, type PreferenceResult,
} from '@/lib/patient/member-preferences-contract';

function failure(message: string | undefined): 'unauthorized' | 'invalid' | 'unavailable' {
  return message === 'Sign in required' || message === 'Complete your profile first' || message === 'Member account required' ? 'unauthorized'
    : message === 'Choose a text size' || message === 'Choose how to contact you' || message === 'Choose times of day' || message === 'Choose who should contact you' ? 'invalid'
    : 'unavailable';
}

export const saveTextSize=loggedAction("saveTextSize",async function saveTextSize(input: unknown): Promise<PreferenceResult> {
  const parsed = textSize.safeParse(input);
  if (!parsed.success) return { ok: false, reason: 'invalid' };
  try {
    const { error } = await (await createClient()).rpc('save_member_preferences', { p_text_size: parsed.data });
    if (error) return { ok: false, reason: failure(error.message) };
  } catch { return { ok: false, reason: 'unavailable' }; }
  revalidatePath('/patient', 'layout');
  return { ok: true };
});

export const saveContactPreference=loggedAction("saveContactPreference",async function saveContactPreference(input: unknown): Promise<PreferenceResult> {
  const parsed = contactPreferenceInput.safeParse(input);
  if (!parsed.success) return { ok: false, reason: 'invalid' };
  try {
    const { error } = await (await createClient()).rpc('save_member_preferences', { p_contact_channel: parsed.data.channel, p_contact_times: parsed.data.times });
    if (error) return { ok: false, reason: failure(error.message) };
  } catch { return { ok: false, reason: 'unavailable' }; }
  revalidatePath('/patient/account/contact');
  return { ok: true };
});

export const requestCallback=loggedAction("requestCallback",async function requestCallback(input: unknown): Promise<CallbackResult> {
  const parsed = callbackFrom.safeParse(input);
  if (!parsed.success) return { ok: false, reason: 'invalid' };
  try {
    const { data, error } = await (await createClient()).rpc('member_request_callback', { p_from: parsed.data });
    if (error) return { ok: false, reason: failure(error.message) };
    const result = data as { ok?: boolean; result?: string; code?: string } | null;
    if (result?.ok && (result.result === 'created' || result.result === 'already_open')) {
      revalidatePath('/patient/account/contact');
      return { ok: true, result: result.result };
    }
    return { ok: false, reason: result?.code === 'rate_limited' ? 'rate_limited' : 'unavailable' };
  } catch { return { ok: false, reason: 'unavailable' }; }
});

export const cancelCallback=loggedAction("cancelCallback",async function cancelCallback(input: unknown): Promise<CallbackResult> {
  if (typeof input !== 'string' || !/^[0-9a-f-]{36}$/i.test(input)) return { ok: false, reason: 'invalid' };
  try {
    const { data, error } = await (await createClient()).rpc('member_cancel_callback', { p_request: input });
    if (error) return { ok: false, reason: failure(error.message) };
    const result = data as { ok?: boolean } | null;
    revalidatePath('/patient/account/contact');
    return result?.ok ? { ok: true, result: 'cancelled' } : { ok: false, reason: 'not_open' };
  } catch { return { ok: false, reason: 'unavailable' }; }
});
