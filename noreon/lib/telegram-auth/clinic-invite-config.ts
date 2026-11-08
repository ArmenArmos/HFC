import 'server-only';
import {outboundConfig,telegramBotUsername,telegramEnabled} from '@/lib/telegram-runtime/config';

type Env=Record<string,string|undefined>;
/** Clinic invitations by Telegram (T-auth B-2b-2) have their own switch and need a bot that can send. */
export const clinicTelegramInvitesReady=(env:Env=process.env)=>telegramEnabled(env)&&env.NOREON_CLINIC_TELEGRAM_INVITES==='true'
 &&Boolean(env.NOREON_TELEGRAM_BOT_TOKEN)&&outboundConfig(env)!==undefined&&telegramBotUsername(env)!==null;
/** Invitation links open on the clinic host; outside production a local host may stand in. */
export function clinicInviteOrigin(requestHost:string|null,env:Env=process.env):string|null{
 const host=env.NOREON_CLINIC_PORTAL_HOST?.toLowerCase();
 if(host&&/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(host))return `https://${host}`;
 if(env.NODE_ENV!=='production'&&requestHost&&/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(requestHost))return `http://${requestHost}`;
 return null;
}
