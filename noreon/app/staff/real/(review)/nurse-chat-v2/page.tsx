import {notFound,redirect} from 'next/navigation';
import {nurseChatEnabled} from '@/lib/nurse-chat/config';

export const dynamic='force-dynamic';
/** The new chat lives at the original address. This path only keeps old links working. */
export default async function NurseChatV2Page(){
 if(process.env.NOREON_NURSE_CHAT_V2!=='true'||!nurseChatEnabled())notFound();
 redirect('/staff/real/nurse-chat');
}
