import 'server-only';
import { createClient } from '@/lib/supabase/server';
import type { LocalePreference } from './locale-service';
export async function persistLocale(_id: string, input: LocalePreference): Promise<number> {
  void _id;
  const client = await createClient();
  const {data,error} = await client.rpc('save_patient_locale', {p_locale:input.locale,p_expected_locale:input.expectedLocale,p_expected_revision:input.expectedRevision});
  if (error || typeof data !== 'number') throw new Error('Locale storage unavailable');
  return data;
}
