import 'server-only';
import type { SpeechProvider } from '../voice';
/** Synthetic fixture only. Does not interpret, store or forward audio. Never loaded in production. */
export const fakeSpeechProvider: SpeechProvider = {
  async transcribe() { return {primary:'145/92',urgent:null}; },
};
