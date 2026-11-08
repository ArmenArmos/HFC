/**
 * What crosses HTTP for a Gemini Live session (WP V), shared by the token routes and the browser. The browser gets a
 * single-use ephemeral token, the model id and the time by which the session must start; never the API key, the
 * instruction or the configuration (they are locked inside the token on the server).
 */
export const LIVE_PCM_RATE=16_000;
export const LIVE_PCM_MIME=`audio/pcm;rate=${LIVE_PCM_RATE}`;
/** A Live session is closed after this long even while in use; a new token opens the next one. */
export const LIVE_SESSION_MAX_MS=10*60_000;
export type LiveToken={token:string;model:string;expiresAt:string};
export type LiveTokenResult=LiveToken|{status:'unavailable'|'invalid'|'rate_limited'};
/** Where each audience asks for a token. */
export const LIVE_TOKEN_ENDPOINT={member:'/api/patient/zoe/live-token',staff:'/api/staff/zoe/live-token'}as const;
export const SPEECH_STREAM_ENDPOINT={member:'/api/patient/zoe/speech-stream',staff:'/api/staff/zoe/speech-stream'}as const;
