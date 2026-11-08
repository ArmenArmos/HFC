import 'server-only';
import {readZoeThread} from '@/lib/zoe/app-chat';
import {readTelegramLink} from '@/lib/telegram-runtime/member';
import {telegramBotUsername} from '@/lib/telegram-runtime/config';
import {doctorChannel} from '@/lib/zoe/member-screen';

/** How a signed-in member can write to the care team right now (QA N-09, review F3): the app chat
 * when it is on, else Telegram (linked, or a link to connect it), else nothing. No email route. */
export type MemberContact={mode:'chat';href:'/patient/zoe'}|{mode:'telegram';href:string}|{mode:'connect';href:'/patient/account/telegram'}|{mode:'none'};
export async function memberContact():Promise<MemberContact>{
 if(await readZoeThread().catch(()=>null))return {mode:'chat',href:'/patient/zoe'};
 const channel=doctorChannel(await readTelegramLink().catch(()=>null),telegramBotUsername());
 return channel.mode==='unavailable'?{mode:'none'}:channel;
}
