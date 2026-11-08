'use client';
import type {ReactNode} from 'react';
import type {Locale} from '@/lib/locale';
import {useChatViewport} from '@/components/patient/use-chat-viewport';

/** Keep the whole clinic chat, including its composer, inside the keyboard's visual viewport. */
export function ClinicChatViewport({locale,children}:{locale:Locale;children?:ReactNode}){
 useChatViewport(true);
 return <div lang={locale} className="fixed inset-x-0 flex min-h-0 flex-col overflow-hidden bg-background" style={{top:'var(--chat-view-top, 0px)',height:'var(--chat-view-height, 100dvh)'}}>{children}</div>;
}
