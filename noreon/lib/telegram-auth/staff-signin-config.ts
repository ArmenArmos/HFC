import 'server-only';
import {outboundConfig,telegramEnabled} from '@/lib/telegram-runtime/config';

type Env=Record<string,string|undefined>;
/** Admins may issue staff Telegram links (and revoke) only when this is on; separate from sign-in. */
export const staffTelegramEnrolmentEnabled=(env:Env=process.env)=>telegramEnabled(env)&&env.NOREON_STAFF_TELEGRAM_ENROLMENT==='true';
/** The second-step screen is offered only when the flag is on and the bot can actually send. */
export const staffTelegramSigninEnabled=(env:Env=process.env)=>telegramEnabled(env)&&env.NOREON_STAFF_TELEGRAM_SIGNIN==='true'
 &&Boolean(env.NOREON_TELEGRAM_BOT_TOKEN)&&outboundConfig(env)!==undefined;

/** The raw `staff_signin_state` answer; the portal fields fall back to B-1's shared `eligible`. */
export type StaffSigninState={required:boolean;admitted:boolean;enrolled:boolean;eligible:boolean;staffEligible:boolean;clinicEligible:boolean};
export function parseStaffSigninState(data:unknown):StaffSigninState|null{
 if(!data||typeof data!=='object')return null;
 const d=data as Record<string,unknown>,b=(k:string)=>typeof d[k]==='boolean'?d[k] as boolean:undefined;
 const required=b('required'),admitted=b('admitted'),enrolled=b('enrolled'),eligible=b('eligible');
 if(d.ok!==true||required===undefined||admitted===undefined||enrolled===undefined||eligible===undefined)return null;
 return {required,admitted,enrolled,eligible,staffEligible:b('staffEligible')??eligible,clinicEligible:b('clinicEligible')??eligible};
}
/** True when this portal's session should go to the code screen rather than be refused. */
export const telegramStepDue=(s:StaffSigninState|null,portal:'staff'|'clinic')=>
 !!s&&s.required&&!s.admitted&&s.enrolled&&(portal==='clinic'?s.clinicEligible:s.staffEligible);
