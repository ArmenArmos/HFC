'use client';
import {useState,useTransition} from 'react';
import {useRouter} from 'next/navigation';
import type {Route} from 'next';
import {st,type StaffLocale} from '@/lib/staff/staff-locale-copy';
import {nurseLandingDestination} from '@/lib/nurse-chat/landing';
import {EmptyStaffChat} from './empty-chat';

export function NurseChatLanding({locale,children,next,unavailable=false}:{locale:StaffLocale;next:{kind:'visit'|'task';href:string}|null;unavailable?:boolean;children?:React.ReactNode}){
 const t=(en:string,hy:string,ru:string)=>st(locale,en,hy,ru),router=useRouter();
 const [body,setBody]=useState(''),[notice,setNotice]=useState(''),[busy,start]=useTransition();
 return <section className="nurse-landing" aria-label={t('Your workspace','Ձեր աշխատատարածքը','Ваше рабочее пространство')}>
  <div className={`nurse-landing-space${children?' nurse-landing-content':''}`}>{children??(!unavailable&&!next?<EmptyStaffChat locale={locale}/>:null)}</div>
  <form className="nurse-landing-composer" aria-busy={busy} onSubmit={e=>{e.preventDefault();const href=nurseLandingDestination(body);if(!href){setNotice(t('Open today, visits or members from Menu. You can also search by a member’s name. Questions about readings need the member’s clinical context; this box cannot compare members.','Ընտրացանկից բացեք այսօր, այցեր կամ անդամներ։ Կարող եք նաև որոնել անդամի անունով։ Չափումների մասին հարցերի համար բացեք անդամի կլինիկական տվյալները․ այս դաշտը չի համեմատում անդամներին։','Откройте сегодня, визиты или участников через меню. Можно также найти участника по имени. Для вопросов об измерениях откройте его клинические данные; это поле не сравнивает участников.'));return;}setNotice('');setBody('');start(()=>router.push(href as Route));}}>
   <label htmlFor="nurse-workspace-input" className="sr-only">{t('Open work or find a member','Բացել աշխատանքը կամ գտնել անդամին','Открыть работу или найти участника')}</label>
   <input id="nurse-workspace-input" className="dw-input" value={body} maxLength={100} disabled={busy} autoComplete="off" placeholder={t('Today, visits or a name','Այսօր, այցեր կամ անուն','Сегодня, визиты или имя')} onChange={e=>setBody(e.target.value)}/>
   <button className="dw-pill" type="submit" disabled={busy||!body.trim()}>{busy?t('Opening…','Բացվում է…','Открытие…'):t('Open','Բացել','Открыть')}</button>
  </form>
  {notice&&<p role="status" className="text-caption">{notice}</p>}
 </section>;
}
