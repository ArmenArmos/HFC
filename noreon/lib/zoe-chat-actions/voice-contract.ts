/** Shared recording limits. Audio and the unconfirmed transcript are never stored. */
export const VOICE_MAX_BYTES = 2 * 1024 * 1024;
export const VOICE_MAX_MS = 60_000;
export type VoiceTranscripts = {primary:string|null;urgent:string|null};
export type VoiceResult = {status:'ok';text:string;urgent:boolean;receipt?:string}|{status:'unavailable'|'invalid'|'rate_limited'};
export type VoiceAudio = {bytes:Uint8Array;mimeType:string;durationMs:number};
