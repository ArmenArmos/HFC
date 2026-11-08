import type {Metadata} from 'next';
import {notFound} from 'next/navigation';
import {signinLinkOrigin} from '@/lib/telegram-auth/signin-link-config';
import {captchaSiteKey} from '@/lib/captcha';
import {TelegramLinkContinue} from '@/components/patient/telegram-link-continue';
export const metadata:Metadata={referrer:'no-referrer',robots:{index:false,follow:false}};
/** The link from the "Open Noreon" button: signs in at once (token only in the #fragment, never sent to a server by a preview). */
export default function TelegramLinkPage(){
 if(!signinLinkOrigin())notFound();
 return <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 px-5 py-8"><p className="text-h2 font-semibold">Noreon</p><TelegramLinkContinue siteKey={captchaSiteKey()}/></main>;
}
