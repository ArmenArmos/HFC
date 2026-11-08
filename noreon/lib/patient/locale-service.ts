import type { PatientState, SaveResult } from './types';
import { isLocale, type Locale } from '@/lib/locale';
export type LocalePreference = { locale: Locale; expectedLocale: Locale; expectedRevision: number };
function valid(input: unknown): input is LocalePreference {
  if (!input || typeof input !== 'object') return false;
  const value = input as LocalePreference;
  return isLocale(value.locale) && isLocale(value.expectedLocale) &&
    Number.isSafeInteger(value.expectedRevision) && value.expectedRevision >= 0;
}
export function createLocaleService(deps: {
  user: () => Promise<{ userId: string } | null>;
  read: (id: string) => Promise<PatientState>;
  save: (id: string, input: LocalePreference) => Promise<number>;
}) {
  return {
    async saveLocale(input: unknown): Promise<SaveResult> {
      try {
        if (!valid(input)) return { ok: false, reason: 'invalid' };
        const user = await deps.user();
        if (!user) return { ok: false, reason: 'signed_out' };
        const state = await deps.read(user.userId);
        if (!state.profile || !state.consentAccepted || !state.assessment) return { ok: false, reason: 'invalid' };
        if (state.assessment.revision !== input.expectedRevision || state.profile.locale !== input.expectedLocale)
          return { ok: false, reason: 'conflict' };
        const revision = await deps.save(user.userId, input);
        return revision < 0 ? { ok: false, reason: 'conflict' } : { ok: true, revision };
      } catch { return { ok: false, reason: 'unavailable' }; }
    },
  };
}
