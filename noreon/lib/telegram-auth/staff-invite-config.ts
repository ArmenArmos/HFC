import 'server-only';
import {doctorInvitationOrigin} from '@/lib/messaging/brevo-email';
import {staffInvitationSecret} from '@/lib/staff/real-admin';
import {outboundConfig,telegramBotUsername} from '@/lib/telegram-runtime/config';
import {staffTelegramEnrolmentEnabled} from './staff-signin';

type Env=Record<string,string|undefined>;
/**
 * Staff invitations delivered through Telegram (T-auth B-2a): their own switch
 * (NOREON_STAFF_TELEGRAM_INVITES), the existing invitation switches and signing secret, staff
 * Telegram enrolment, a bot that can send codes and a public origin.
 * Email invitations keep their own configuration and stay off.
 */
export function telegramStaffInvitationReady(env:Env=process.env){
 if(env.NOREON_STAFF_TELEGRAM_INVITES!=='true'||staffInvitationSecret(env)===null||!staffTelegramEnrolmentEnabled(env)||!env.NOREON_TELEGRAM_BOT_TOKEN||outboundConfig(env)===undefined||!telegramBotUsername(env))return false;
 try{doctorInvitationOrigin(env);return true;}catch{return false;}
}
