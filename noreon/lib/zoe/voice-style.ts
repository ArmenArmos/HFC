import {BRAND_NAMES_PROMPT_RULE} from '@/lib/brand';

/**
 * Voice-mode reply style (WP V): the "HOW YOU SOUND" and conversation-flow guidance of the Gemini Live demo
 * (docs/source/zoe-voice/zoe-voice-gemini-live.txt), ported as an addendum to Zoe's guarded text prompts, applied only
 * when the member's newest message came from voice (a recorded turn with a server receipt, or a Live turn). Only how Zoe
 * sounds is ported: not the demo's fictional patient, not its tools, and none of its medical rules. Every existing rule
 * of the prompt it is added to wins where they differ (for example, a prompt that forbids numbers still forbids them),
 * and the reply still passes the output guard, the reply check and plan quoting before anything is spoken.
 * Fixed text, versioned with VOICE_STYLE_VERSION, which is joined to the prompt version of every call that uses it.
 */
export const VOICE_STYLE_VERSION='zoe-voice-style-1';

export const VOICE_STYLE_ADDENDUM=[
 'Voice mode: the member is talking to you by voice and your reply will be read aloud. These lines change only how you sound; every rule above still applies and wins where they differ.',
 'Keep the turn short, usually one to three sentences. Ask at most one question, then stop and let them speak.',
 'Write for the ear: no lists, headings, symbols, abbreviations, links or parentheses. Write numbers so they read naturally aloud.',
 'When a rule above allows you to mention a number the member gave, repeat it back exactly as they said it so they can correct you; say blood pressure as the upper and the lower number. Never guess or round a number; if a number was unclear, say so and ask again.',
 'Use plain everyday words, warm and calm, never rushed. In Armenian use the polite Դուք form. Stay in the language the member speaks.',
 'If the member interrupts or changes the subject, follow them. No filler and no long summaries unless they ask.',
 BRAND_NAMES_PROMPT_RULE,
].join('\n');

/** The prompt with the voice addendum when the turn came from voice; unchanged otherwise. */
export const withVoiceStyle=(system:string,voice:boolean)=>voice?`${system}\n${VOICE_STYLE_ADDENDUM}`:system;
/** The prompt version stamped on the call. */
export const voicePromptVersion=(version:string,voice:boolean)=>voice?`${version}+${VOICE_STYLE_VERSION}`:version;
/** The member's newest message in the job came from voice. */
export const voiceTurn=(job:{messageSeq:number;messages:readonly {seq:number;voice?:true}[]})=>job.messages.some(m=>m.seq===job.messageSeq&&m.voice===true);
