import Link from 'next/link';
import type {Route} from 'next';
import {notFound} from 'next/navigation';
import {requireRealStaffForRender} from '@/lib/staff/real-staff-render';
import {staffLocale} from '@/lib/staff/staff-locale';
import {st} from '@/lib/staff/staff-locale-copy';
import {doctorChatHomeEnabled,doctorDecisionsEnabled,doctorWorkspaceEnabled} from '@/lib/staff-zoe/workspace-config';
import {readDoctorWorkspace} from '@/lib/staff-zoe/workspace-read';
import {staffRecordReader} from '@/lib/staff-zoe/server';
import {memberRef} from '@/lib/staff-zoe/contracts';
import {StaffZoeChat} from '@/components/staff/zoe/staff-zoe-pane';
import {WorkspaceMemberList} from '@/components/staff/doctor-workspace/member-list';
import {WorkspaceGlance} from '@/components/staff/doctor-workspace/glance';
import {readWorkspaceDecisions} from '@/lib/doctor-decisions/read';
import {DoctorDecisionCards} from '@/components/staff/doctor-workspace/decisions';
import {careAlertsEnabled} from '@/lib/care-alerts/contracts';
import {DoctorHomeThread} from '@/components/staff/doctor-workspace/home-thread';
import {runDoctorHome} from '@/lib/staff-zoe/home-read';
import {nurseChatEnabled} from '@/lib/nurse-chat/config';
import {readHandoffs} from '@/lib/nurse-chat/handoff-read';
import {NurseHandoffs} from '@/components/staff/nurse-handoffs';
import './workspace.css';

/** The doctor workspace before the rebuilt chat, kept as the fallback while the new chat lacks some actions. */
export async function oldDoctorWorkspace({searchParams}:{searchParams:Promise<{c?:string|string[]}>}){
 if(!doctorWorkspaceEnabled())notFound();
 const {client,identity}=await requireRealStaffForRender();
 if(identity.role!=='doctor')notFound();
 const locale=await staffLocale(identity.role),t=(en:string,hy:string,ru:string)=>st(locale,en,hy,ru);
 const params=await searchParams;
 const c=Array.isArray(params.c)?'invalid':params.c;
 const rpc=client as unknown as Parameters<typeof staffRecordReader>[0];
 if(doctorChatHomeEnabled()){
  const context={client:rpc,role:identity.role,locale};
  const initial=await runDoctorHome(context,{kind:'day'}).catch(()=>({kind:'unavailable' as const}));
  const selected=c?await runDoctorHome(context,{kind:'record',conversationId:c}).catch(()=>({kind:'unavailable' as const})):null;
  return <div className="dw dw-home zk" lang={locale}><DoctorHomeThread key={`${identity.id}:${locale}`} doctorId={identity.id} doctorName={identity.name} renderedAt={new Date().toISOString()} initial={initial} selected={selected} locale={locale} decisionsEnabled={doctorDecisionsEnabled()} alertsEnabled={careAlertsEnabled()}/></div>;
 }
 const data=await readDoctorWorkspace(rpc,identity.role,c,staffRecordReader(rpc,locale,new Date()));
 if(!data)notFound();
 const {conversation,glance}=data;
 const decisions=conversation&&doctorDecisionsEnabled()?await readWorkspaceDecisions(rpc,conversation.member.id):null;
 const handoffs=conversation&&nurseChatEnabled()?await readHandoffs(client,conversation.member.id):undefined;
 return <div className="dw" lang={locale}>
  <header className="dw-heading">
   <div><h1 className="text-h2">{t('Your workspace with Zoe','Ձեր աշխատատարածքը Զոյայի հետ','Ваше рабочее пространство с Zoe')}</h1><p className="text-caption text-muted-foreground">{t('Read the record. Your clinical decisions stay with you.','Կարդացեք գրառումը։ Կլինիկական որոշումները ձերն են։','Читайте запись. Медицинские решения принимаете вы.')}</p></div>
   <nav aria-label={t('Workspace links','Աշխատատարածքի հղումներ','Ссылки рабочего пространства')} className="flex flex-wrap gap-3 text-caption">
    <Link href={'/staff/real/today' as Route} className="underline underline-offset-4">{t('Open Today','Բացել «Այսօր» բաժինը','Открыть «Сегодня»')}</Link>
    <Link href={(conversation?`/staff/real/zoe?c=${conversation.id}`:'/staff/real/zoe') as Route} className="underline underline-offset-4">{t('Original Ask Zoe','«Հարցնել Զոյային» նախորդ էջը','Прежняя страница «Спросить Zoe»')}</Link>
   </nav>
  </header>
  <div className="dw-grid">
   <WorkspaceMemberList key={identity.id} initialPage={data.members} selected={conversation?.member.id} locale={locale}/>
   <section className="dw-chat" aria-label={t('Chat with Zoe','Զրույց Զոյայի հետ','Чат с Zoe')}>
    {data.refused&&<p role="alert" className="p-4 text-body2">{t('This conversation could not be opened. Choose an assigned member again.','Այս զրույցը չհաջողվեց բացել։ Կրկին ընտրեք կցված անդամին։','Не удалось открыть этот разговор. Снова выберите назначенного участника.')}</p>}
    {handoffs!==undefined&&<NurseHandoffs page={handoffs} actor={{id:identity.id,role:'doctor'}} locale={locale}/>}
    {conversation?<StaffZoeChat key={conversation.id} conversation={conversation} locale={locale} role="doctor" workspace decisions={decisions?<DoctorDecisionCards key={JSON.stringify(decisions)} data={decisions} locale={locale}/>:undefined}/>:<div className="dw-welcome">
     <span className="zk-orb" aria-hidden/>
     <h2 className="text-h2">{t('Who would you like to review?','Ում գրառումն եք ցանկանում վերանայել','Чью запись вы хотите посмотреть?')}</h2>
     <p className="text-body2 text-muted-foreground">{t('Choose one of your members. Ask Zoe about the saved record, or open a source to review it yourself.','Ընտրեք ձեր անդամներից մեկին։ Հարցրեք Զոյային պահպանված գրառման մասին կամ բացեք աղբյուրը՝ ինքներդ վերանայելու համար։','Выберите своего участника. Спросите Zoe о сохранённой записи или откройте источник для проверки.')}</p>
    </div>}
   </section>
   {conversation&&<WorkspaceGlance records={glance} locale={locale} reference={memberRef(conversation.member.id)}/>}
  </div>
 </div>;
}
