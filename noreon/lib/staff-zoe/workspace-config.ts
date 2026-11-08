import {nurseChatEnabled} from '@/lib/nurse-chat/config';

/** Screen flag only. Existing staff Zoe's database switch and all per-read permissions still apply. */
export const doctorWorkspaceEnabled=(env:Record<string,string|undefined>=process.env)=>env.NOREON_DOCTOR_WORKSPACE==='true';

/** Decision cards are separate from the read-only shell; default off until pilot sign-off. */
export const doctorDecisionsEnabled=(env:Record<string,string|undefined>=process.env)=>doctorWorkspaceEnabled(env)&&env.NOREON_DOCTOR_DECISIONS==='true';

/** The doctor's day in chat. Both screen flags must be explicitly enabled. */
export const doctorChatHomeEnabled=(env:Record<string,string|undefined>=process.env)=>doctorWorkspaceEnabled(env)&&env.NOREON_DOCTOR_CHAT_HOME==='true';
/** Empty chat rebuild; the existing home and workspace gates stay required. */
export const doctorChatV2Enabled=(env:Record<string,string|undefined>=process.env)=>doctorChatHomeEnabled(env)&&env.NOREON_DOCTOR_CHAT_V2==='true';
/** Where sign-in and the brand link send staff: each role's chat when it is on, otherwise the member list. */
export const doctorHomePath=(role:string,env:Record<string,string|undefined>=process.env)=>role==='doctor'&&doctorChatHomeEnabled(env)?'/staff/real/doctor-workspace':role==='nurse'&&nurseChatEnabled(env)?'/staff/real/nurse-chat':'/staff/real/members';
