'use client';
import {useEffect,useRef,useSyncExternalStore,type ReactNode} from 'react';
import {createPortal} from 'react-dom';
import {st,type StaffLocale} from '@/lib/staff/staff-locale-copy';
import {ClinicMenu} from '@/components/clinic-portal/menu';

/** The chat shells' Menu floats over the page. A tap or focus outside closes it: left open, it covers the
 * composer once the keyboard lifts it (QA 214). */
export function ChatShellMenu({children}:{children:ReactNode}){
 const menu=useRef<HTMLDetailsElement>(null);
 useEffect(()=>{
  const close=(event:Event)=>{
   if(menu.current?.open&&!menu.current.contains(event.target as Node))menu.current.removeAttribute('open');
  };
  document.addEventListener('pointerdown',close);
  document.addEventListener('focusin',close);
  return ()=>{document.removeEventListener('pointerdown',close);document.removeEventListener('focusin',close);};
 },[]);
 return <details ref={menu} className="relative">{children}</details>;
}
const subscribe=()=>()=>{};
const serverSlot=()=>null;
/** Put contextual actions in the shell's stable Menu slot without moving their state out of the chat. */
export function ChatMenuItems({target,locale,children}:{target:string;locale:StaffLocale;children:ReactNode}){
 const slot=useSyncExternalStore(subscribe,()=>document.getElementById(target),serverSlot);
 const items=<div className="flex flex-col gap-1 border-b pb-2 [&_button]:min-h-11 [&_button]:text-left" onClick={event=>{
  if((event.target as HTMLElement).closest('button,a'))slot?.closest('details')?.removeAttribute('open');
 }}>{children}</div>;
 return slot?createPortal(items,slot):target==='clinic-chat-menu'?<ClinicMenu locale={locale}>{items}</ClinicMenu>:<details className="relative"><summary className="min-h-11 cursor-pointer px-3 py-2">{st(locale,'Menu','Ընտրացանկ','Меню')}</summary>{items}</details>;
}
