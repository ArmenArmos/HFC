import {staffLiveAvailable,staffVoiceAvailable} from '@/lib/staff-zoe/voice';
/** WP V: voice for this role, and Gemini Live only when voice itself is on. */
const staffVoiceProps=async(role:'NURSE'|'DOCTOR')=>{const voiceAvailable=await staffVoiceAvailable(role);return voiceAvailable&&await staffLiveAvailable(role)?{voiceAvailable,voiceLive:true}:{voiceAvailable};};
import Link from 'next/link';
import {notFound} from 'next/navigation';
import {z} from 'zod';
import {requireRealStaffForRender} from '@/lib/staff/real-staff-render';
import {staffLocale} from '@/lib/staff/staff-locale';
import {st} from '@/lib/staff/staff-locale-copy';
import {runMemberIdentitySearch} from '@/lib/staff/member-search-command';
import {nurseChatEnabled,nurseChatNewScreen} from '@/lib/nurse-chat/config';
import {readNurseConversation} from '@/lib/nurse-chat/actions';
import {NurseChatVisits,type NurseVisitSelection} from '@/components/staff/nurse-chat-visits';
import './nurse-chat.css';
import {NurseMemberWork} from '@/components/staff/nurse-member-work';
import {readNurseHandoffs} from '@/lib/nurse-chat/handoff-actions';
import {readNurseToday} from '@/lib/nurse-chat/today-actions';
import {NurseMemberChat} from '@/components/staff/nurse-member-chat';
import {NurseToday} from '@/components/staff/nurse-today';
import {NurseUrgentLine,NurseUrgentGuidance} from '@/components/staff/nurse-urgent-guidance';
import {ChatMenuItems} from '@/components/staff/chat-menu-items';
import {NurseChatLanding} from '@/components/staff/nurse-chat-landing';
import {nurseLandingNext} from '@/lib/nurse-chat/landing';
import {WorkspaceMemberList} from '@/components/staff/doctor-workspace/member-list';
import '../doctor-workspace/workspace.css';
import {NurseChatV2} from '@/components/nurse-chat-v2/nurse-chat';
import '@/components/chat-v2/chat.css';
import '@/components/nurse-chat-v2/nurse-chat.css';
import {riskTiersEnabled} from '@/lib/clinical-review/config';

export const dynamic='force-dynamic';
export default async function NurseChatPage({searchParams}:{searchParams:Promise<{member?:string|string[];view?:string|string[];q?:string|string[];card?:string|string[]}&NurseVisitSelection>}){
 if(!nurseChatEnabled())notFound();
 const {client,identity}=await requireRealStaffForRender();
 const locale=await staffLocale(identity.role),t=(en:string,hy:string,ru:string)=>st(locale,en,hy,ru);
 if(identity.role!=='nurse')return <p role="alert">{t('Access denied. This workspace is for assigned nurses.','Հասանելիությունը մերժված է։ Այս աշխատատարածքը կցված բուժքույրերի համար է։','Доступ запрещён. Это рабочее пространство для назначенных медсестёр.')}</p>;
 const params=await searchParams;
 if(nurseChatNewScreen(params))return <NurseChatV2 locale={locale} {...await staffVoiceProps('NURSE')} nurseName={identity.name} nurseId={identity.id} {...(riskTiersEnabled()?{worklist:true}:{})}/>;
 const {member,source,visit,evidence,memberEvidence,view,q,card}=params;
 const query=typeof q==='string'?q.trim().slice(0,100):'';
 const selection={source,visit,evidence,memberEvidence};
 const valid=typeof member==='string'&&z.uuid().safeParse(member).success;
 const [members,initial,today]=await Promise.all([
  view==='members'?runMemberIdentitySearch({query,cursor:null},client):null,
  valid?readNurseConversation(member):null,
  readNurseToday(),
 ]);
 // Conversation authorization locks the member. Read the handoff snapshots after
 // it completes so two reads for the same member cannot conflict with NOWAIT.
 const handoffs=valid&&initial?.ok?await readNurseHandoffs(member):null;
 const workActive=card!=='conversation';
 const visitActive=!['context','notes','samples','week','conversation'].includes(typeof card==='string'?card:'');
 const selectedVisit=source!==undefined||visit!==undefined||memberEvidence!==undefined;
 return <div className="dw nurse-chat-workspace mx-auto max-w-3xl" lang={locale}>
  {valid&&initial?.ok&&<NurseUrgentLine locale={locale}/>}
  {valid&&initial?<>
   <ChatMenuItems target="nurse-chat-menu" locale={locale}><nav className="flex flex-col gap-3" aria-label={t('Member work','Անդամի աշխատանքը','Работа с участником')}>
    <Link href={`/staff/real/nurse-chat?member=${member}&card=visits&view=visits`} className="dw-pill">{t('Your visits','Ձեր այցերը','Ваши визиты')}</Link>
    {initial.ok&&<Link href={`/staff/real/nurse-chat?member=${member}&memberEvidence=true`} className="dw-pill">{t('Member visit evidence','Անդամի այցերի տվյալներ','Данные визитов участника')}</Link>}
   </nav></ChatMenuItems>
   <NurseMemberChat workActive={workActive} visitKey={visitActive?JSON.stringify([source,visit,evidence,memberEvidence,view]):undefined} key={`${identity.id}:${member}`} memberId={member} nurseId={identity.id} nurseName={identity.name} locale={locale} initial={initial} handoffs={handoffs}><NurseMemberWork memberId={member} card={card} selection={selection} locale={locale}/></NurseMemberChat>
  </>:<NurseChatLanding locale={locale} next={nurseLandingNext(today)} unavailable={!today.ok||!today.page||!today.visits}>
   {view==='members'?<WorkspaceMemberList key={query} initialPage={members?.ok?members.page:null} initialQuery={query} locale={locale} nurseChat/>:
    view==='today'?<NurseToday initial={today} actor={{id:identity.id,role:'nurse'}} locale={locale}/>:
    view==='visits'||selectedVisit?<NurseChatVisits selection={selection} locale={locale}/>:
    member!==undefined?<p role="alert" className="text-body2">{t('This conversation could not be opened. Choose an assigned member from Menu.','Այս զրույցը չհաջողվեց բացել։ Ընտրացանկից ընտրեք կցված անդամին։','Не удалось открыть разговор. Выберите назначенного участника в меню.')}</p>:undefined}
  </NurseChatLanding>}
  {valid&&initial?.ok&&<NurseUrgentGuidance locale={locale}/>}

 </div>;
}
