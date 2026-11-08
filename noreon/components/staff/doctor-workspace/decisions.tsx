'use client';
import {useRef,useState,useTransition} from 'react';
import {useRouter} from 'next/navigation';
import Link from 'next/link';
import type {Route} from 'next';
import type {Locale} from '@/lib/locale';
import {st} from '@/lib/staff/staff-locale-copy';
import {stamp} from '@/components/patient-care/common';
import {AlertCardLines} from '@/components/staff/alert-card';
import {pressDoctorItem} from '@/lib/doctor-decisions/actions';
import type {ItemCard,ItemResult} from '@/lib/doctor-decisions/items';
import type {ReplyCard,ReplyPreparation} from '@/lib/doctor-decisions/replies';
import type {WorkspaceDecisions} from '@/lib/doctor-decisions/read';
import {commandConversation} from '@/app/staff/real/conversation/actions';
import {formatMmol,formatPercent} from '@/lib/ldl/status';
import {ZoeTurn} from '@/components/patient/zoe-kit/thread';
import {DoctorApprovalCards} from './approval-cards';

const button='min-h-12 rounded-md bg-primary px-4 py-2 text-body2 font-medium text-primary-foreground focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50';
const box='sz-record space-y-3 rounded-xl border bg-background p-4';
type Status=ItemResult['status']|'queued';
function Outcome({status,locale}:{status:Status|null;locale:Locale}){
 const t=(en:string,hy:string,ru:string)=>st(locale,en,hy,ru);
 if(!status)return null;
 const text=status==='saved'?t('Saved.','Պահպանված է։','Сохранено.'):status==='queued'?t('Reply approved and queued. Delivery is not yet confirmed.','Պատասխանը հաստատված է և հերթում է։ Հանձնումը դեռ հաստատված չէ։','Ответ утверждён и поставлен в очередь. Доставка ещё не подтверждена.'):
  status==='stale'?t('This card has changed. Nothing was applied. Reload and review the current record.','Այս քարտը փոխվել է։ Ոչինչ չի կիրառվել։ Թարմացրեք և վերանայեք ընթացիկ գրառումը։','Карточка изменилась. Ничего не применено. Обновите и проверьте текущую запись.'):
  status==='access'?t('You no longer have permission to act on this member.','Այս անդամի համար գործելու թույլտվություն այլևս չունեք։','У вас больше нет разрешения на действия для этого участника.'):
  status==='disabled'?t('This action is switched off.','Այս գործողությունն անջատված է։','Это действие отключено.'):
  status==='outcome-unknown'?t('The outcome is not known. Reload and check the record before trying again.','Արդյունքը հայտնի չէ։ Թարմացրեք և ստուգեք գրառումը՝ կրկին փորձելուց առաջ։','Результат неизвестен. Обновите и проверьте запись перед повтором.'):
  t('That did not go through. Reload and try again.','Չստացվեց։ Թարմացրեք և փորձեք նորից։','Не получилось. Обновите страницу и попробуйте ещё раз.');
 return <p role={status==='saved'||status==='queued'?'status':'alert'} className="text-body2">{text}</p>;
}
function ItemDecision({card,locale}:{card:ItemCard;locale:Locale}){
 const t=(en:string,hy:string,ru:string)=>st(locale,en,hy,ru);
 const [status,setStatus]=useState<Status|null>(null),[pending,go]=useTransition();const pressed=useRef(false);
 const title=card.kind==='alert'?t('Acknowledge this alert','Հաստատել այս ահազանգի ստացումը','Подтвердить это оповещение'):card.kind==='medicine'?t('Mark this medicine concern handled','Նշել դեղի այս հարցը որպես լուծված','Отметить этот вопрос о лекарстве как решённый'):t('Mark this LDL result reviewed','Նշել ՑԽԼ այս արդյունքը որպես վերանայված','Отметить этот результат ЛПНП как рассмотренный');
 function press(){if(pressed.current)return;pressed.current=true;go(async()=>{try{setStatus((await pressDoctorItem({kind:card.kind,id:card.id,memberId:card.memberId,revision:card.revision})).status);}catch{setStatus('outcome-unknown');}});}
 return <section className={box} data-decision={card.kind}>
  <h3 className="text-h3">{card.kind==='alert'?t('Urgent alert','Շտապ ահազանգ','Срочное оповещение'):title}</h3>
  {card.kind==='alert'&&<AlertCardLines alert={card.data} locale={locale}/>}
  <p className="text-caption text-muted-foreground"><time dateTime={card.at}>{stamp(card.at,locale)}</time></p>
  {card.kind==='alert'&&<p className="text-body2">{t('This records that you have seen this alert. It stays open for follow-up. No message is sent.','Գրանցվում է, որ տեսել եք այս ահազանգը։ Այն մնում է բաց՝ հետագա ընթացքի համար։ Հաղորդագրություն չի ուղարկվում։','Будет записано, что вы видели оповещение. Оно останется для дальнейшей работы. Сообщение не отправляется.')}</p>}
  {card.kind==='medicine'&&<><p className="text-body2 font-medium">{card.data.ask.medicine.name} {card.data.ask.medicine.dose}</p><p className="text-body2">{card.data.kind==='side_effect'?t('Side effect reported','Հաղորդվել է կողմնակի ազդեցություն','Сообщён побочный эффект'):card.data.kind==='refill'?t('Refill requested','Դեղի պաշարի լրացման խնդրանք','Запрос на пополнение лекарства'):t('Member decided to stop','Անդամը որոշել է դադարեցնել','Участник решил прекратить приём')}</p><p className="text-body2">{t('After you have answered the member, close this concern. No medicine or dose changes. No message is sent.','Անդամին պատասխանելուց հետո փակեք այս հարցը։ Դեղը կամ դեղաչափը չի փոխվում։ Հաղորդագրություն չի ուղարկվում։','После ответа участнику закройте этот вопрос. Лекарство и доза не меняются. Сообщение не отправляется.')}</p></>}
  {card.kind==='ldl'&&<>
   <dl className="space-y-1 text-body2">
    <div><dt className="inline">{t('LDL','ՑԽԼ','ЛПНП')}: </dt><dd className="inline font-medium">{formatMmol(card.data.facts.value.mmol)} {t('mmol/L','մմոլ/լ','ммоль/л')} · {stamp(`${card.data.facts.value.on}T12:00:00+04:00`,locale,false)}</dd></div>
    <div><dt className="inline">{t('Goal','Նպատակ','Цель')}: </dt><dd className="inline">{card.data.facts.goal?<>&lt; {formatMmol(card.data.facts.goal.thresholdMmol)} {t('mmol/L','մմոլ/լ','ммоль/л')}{card.data.facts.goal.reductionPct!==null?` · ≥ ${card.data.facts.goal.reductionPct}%`:''}</>:t('Not set','Սահմանված չէ','Не установлена')}</dd></div>
    <div><dt className="inline">{t('From baseline','Ելակետից','От исходного')}: </dt><dd className="inline">{card.data.facts.reduction.percent===null?t('Not known','Հայտնի չէ','Неизвестно'):`${formatPercent(card.data.facts.reduction.percent)}%`}</dd></div>
   </dl>
   <p className="text-body2">{t('After you have decided the next step and told the member, close this review item. This does not approve treatment or send a message.','Հաջորդ քայլը որոշելուց և անդամին տեղեկացնելուց հետո փակեք այս վերանայման հարցը։ Սա չի հաստատում բուժում և չի ուղարկում հաղորդագրություն։','Определив следующий шаг и сообщив участнику, закройте этот пункт проверки. Лечение не утверждается, сообщение не отправляется.')}</p>
  </>}
  <div className="flex flex-wrap items-center gap-3"><button type="button" onClick={press} disabled={pending||status!==null} className={button}>{pending&&status===null?t('Saving…','Պահպանվում է…','Сохранение…'):title}</button><Link href={(card.kind==='alert'?'/staff/real/alerts':`/staff/real/members/${card.memberId}`) as Route} className="text-body2 underline">{t('Open source','Բացել աղբյուրը','Открыть источник')}</Link></div>
  <Outcome status={status} locale={locale}/>
 </section>;
}
function ReplyDecision({card,locale,onReply}:{card:ReplyCard;locale:Locale;onReply?:()=>void}){
 const t=(en:string,hy:string,ru:string)=>st(locale,en,hy,ru);
 const [status,setStatus]=useState<Status|null>(null),[pending,go]=useTransition();const pressed=useRef(false);
 function press(){if(pressed.current)return;pressed.current=true;go(async()=>{try{
  const r=await commandConversation({schema:1,purpose:'reply.approve',intentId:card.intentId,requestId:card.requestId},{memberId:card.memberId,modeRevision:card.modeRevision});
  setStatus(r.ok?'queued':r.code==='disabled'?'disabled':r.code.includes('stale')||r.code.includes('intent')||r.code.includes('hash')?'stale':'unavailable');
 }catch{setStatus('outcome-unknown');}});}
 return <section className={box} data-decision={card.takeover?'takeover':'reply'}>
  <h3 className="text-h3">{card.takeover?t('Reply and take over from Zoe','Պատասխանել և շարունակել Զոյայի փոխարեն','Ответить и продолжить вместо Зои'):t('Reply to the member','Պատասխանել անդամին','Ответить участнику')}</h3>
  <p className="text-caption text-muted-foreground">{t('Reply revision','Պատասխանի տարբերակ','Версия ответа')} {card.revision}</p>
  <p className="text-caption text-muted-foreground">{card.author==='staff'?t('Your draft','Ձեր նախագիծը','Ваш черновик'):t('Draft prepared by AI. Review before sending.','AI-ի պատրաստած նախագիծ։ Վերանայեք ուղարկելուց առաջ։','Черновик подготовлен ИИ. Проверьте перед отправкой.')}</p>
  <blockquote className="whitespace-pre-wrap break-words rounded-md border p-3 text-body2">{card.body}</blockquote>
  <p className="text-body2">{t('Your press approves and queues this exact text for the member.','Սեղմելով՝ հաստատում եք և հերթագրում այս ճշգրիտ տեքստը՝ անդամին ուղարկելու համար։','Нажатие утверждает и ставит в очередь именно этот текст для участника.')}</p>
  {card.takeover&&<p className="text-body2">{t('Your reply also takes over the conversation. The existing topic setting applies. Urgent safety replies continue. You can hand back to Zoe on the conversation page.','Ձեր պատասխանը նաև ձեզ է փոխանցում զրույցը։ Գործում է թեմայի առկա կարգավորումը։ Շտապ անվտանգության պատասխանները շարունակվում են։ Զրույցի էջում կարող եք այն վերադարձնել Զոյային։','Ваш ответ также передаёт разговор вам. Действует текущая настройка темы. Срочные ответы безопасности сохраняются. Вернуть разговор Зое можно на странице разговора.')}</p>}
  <div className="flex flex-wrap items-center gap-3"><button type="button" onClick={press} disabled={pending||status!==null} className={button}>{card.takeover?t('Send this reply and take over','Ուղարկել այս պատասխանը և շարունակել','Отправить этот ответ и продолжить'):t('Send this reply','Ուղարկել այս պատասխանը','Отправить этот ответ')}</button>{onReply?<button type="button" className="min-h-11 text-body2 underline" onClick={onReply} disabled={!onReply||pending||status!==null}>{t('Edit reply','Խմբագրել պատասխանը','Изменить ответ')}</button>:<Link className="min-h-11 text-body2 underline" href={`/staff/real/conversations/${card.memberId}` as Route}>{t('Edit reply','Խմբագրել պատասխանը','Изменить ответ')}</Link>}</div>
  <Outcome status={status} locale={locale}/>
 </section>;
}
function PrepareReply({prepare,locale,onReply}:{prepare:ReplyPreparation;locale:Locale;onReply?:()=>void;onRefresh:(saved?:boolean)=>void|Promise<void>}){
 const t=(en:string,hy:string,ru:string)=>st(locale,en,hy,ru);
 return <section className={box}><h3 className="text-h3">{t('Reply to the member','Պատասխանել անդամին','Ответить участнику')}</h3>{onReply?<button type="button" className={button} onClick={onReply} disabled={!onReply}>{t('Open conversation and reply','Բացել զրույցը և պատասխանել','Открыть разговор и ответить')}</button>:<Link className={button} href={`/staff/real/conversations/${prepare.memberId}` as Route}>{t('Open conversation and reply','Բացել զրույցը և պատասխանել','Открыть разговор и ответить')}</Link>}</section>;
}
export function DoctorDecisionCards({data,locale,onRefresh,onReply,single=false}:{data:WorkspaceDecisions;locale:Locale;single?:boolean;onReply?:()=>void;onRefresh?:(saved?:boolean)=>void|Promise<void>}){
 const t=(en:string,hy:string,ru:string)=>st(locale,en,hy,ru);const router=useRouter();
 const refresh=onRefresh??(()=>router.refresh());
 const [active,setActive]=useState(0);
 if(single){
  const cards:{key:string;node:React.ReactNode}[]=[];
  // Alerts take precedence. Keep mounted cards while browsing so pending/frozen actions cannot reset.
  for(const c of data.items??[])if(c.kind==='alert')cards.push({key:`${c.id}:${c.revision}`,node:<ItemDecision card={c} locale={locale}/>});
  for(const kind of ['firstNote','regimen','consultation'] as const){
   if(data.approvals?.[kind])cards.push({key:kind,node:<DoctorApprovalCards data={{firstNote:null,regimen:null,consultation:null,[kind]:data.approvals[kind]}} locale={locale} onReload={refresh}/>});
  }
  for(const c of data.items??[])if(c.kind!=='alert')cards.push({key:`${c.id}:${c.revision}`,node:<ItemDecision card={c} locale={locale}/>});
  if(data.reply?.card)cards.push({key:data.reply.card.intentId,node:<ReplyDecision card={data.reply.card} locale={locale} onReply={onReply}/>});
  else if(data.reply?.prepare)cards.push({key:`reply:${data.reply.prepare.expectedVersion}:${data.reply.prepare.expectedDraftEpoch}`,node:<PrepareReply prepare={data.reply.prepare} locale={locale} onRefresh={refresh} onReply={onReply}/>});
  const unavailable=data.items===null||data.approvals===null||data.reply===null;
  if(!cards.length&&!unavailable)return null;
  const index=Math.min(active,Math.max(0,cards.length-1));
  return <ZoeTurn locale={locale}><section className="space-y-3" aria-label={t('Needs your decision','Պահանջում է ձեր որոշումը','Требуется ваше решение')}>
   {cards.map((c,i)=><div key={c.key} hidden={i!==index} data-decision-position={i}>{c.node}</div>)}
   {cards.length>1&&<div className="flex gap-4">
    <button type="button" className="min-h-11 text-body2 underline" disabled={index===0} onClick={()=>setActive(index-1)}>{t('Previous item','Նախորդ հարցը','Предыдущий вопрос')}</button>
    <button type="button" className="min-h-11 text-body2 underline" disabled={index===cards.length-1} onClick={()=>setActive(index+1)}>{t('Next item','Հաջորդ հարցը','Следующий вопрос')}</button>
   </div>}
   {unavailable&&<p role="alert" className="text-body2">{t('Some decision cards could not be read. Reload or check Today.','Որոշ որոշման քարտեր չհաջողվեց կարդալ։ Թարմացրեք կամ ստուգեք «Այսօր» բաժինը։','Некоторые карточки решений не удалось загрузить. Обновите или проверьте «Сегодня».')}</p>}
   <button type="button" className="min-h-11 text-body2 underline" onClick={()=>refresh()}>{t('Refresh','Թարմացնել','Обновить')}</button>
  </section></ZoeTurn>;
 }

 return <section className="space-y-3" aria-label={t('Needs your decision','Պահանջում է ձեր որոշումը','Требуется ваше решение')}>
  <h2 className="text-h3">{t('Needs your decision','Պահանջում է ձեր որոշումը','Требуется ваше решение')}</h2>
  <p className="text-body2 text-muted-foreground">{t('Zoe prepares. You decide by pressing a card. Chat text alone changes nothing.','Զոյան պատրաստում է։ Դուք որոշում եք՝ սեղմելով քարտը։ Զրույցի տեքստն ինքնին ոչինչ չի փոխում։','Зоя готовит. Вы решаете нажатием на карточку. Текст чата сам по себе ничего не меняет.')}</p>
  <DoctorApprovalCards data={data.approvals} locale={locale} onReload={refresh}/>
  {data.items===null&&<p role="alert" className="text-body2">{t('Decision items could not be read. Check Today.','Որոշման հարցերը չհաջողվեց կարդալ։ Ստուգեք «Այսօր» բաժինը։','Не удалось загрузить вопросы для решения. Проверьте «Сегодня».')}</p>}
  {data.items?.map(c=><ItemDecision key={`${c.id}:${c.revision}`} card={c} locale={locale}/>)}
  {!data.items?.length&&data.items!==null&&<p className="text-body2">{t('No item decision cards are available here. Check Today for other work.','Այստեղ որոշման հարցերի քարտեր հասանելի չեն։ Այլ գործերի համար ստուգեք «Այսօր» բաժինը։','Здесь нет доступных карточек решений по вопросам. Другие задачи можно проверить в разделе «Сегодня».')}</p>}
  {data.reply===null?<p role="alert" className="text-body2">{t('The reply record could not be read. Open the conversation page.','Պատասխանի գրառումը չհաջողվեց կարդալ։ Բացեք զրույցի էջը։','Не удалось прочитать запись ответа. Откройте страницу разговора.')}</p>:data.reply.card?<ReplyDecision key={data.reply.card.intentId} card={data.reply.card} locale={locale} onReply={onReply}/>:data.reply.prepare?<PrepareReply key={`${data.reply.prepare.expectedVersion}:${data.reply.prepare.expectedDraftEpoch}`} prepare={data.reply.prepare} locale={locale} onRefresh={refresh} onReply={onReply}/>:<p className="text-body2">{t('No member conversation is recorded yet.','Անդամի զրույցը դեռ գրանցված չէ։','Разговор участника ещё не записан.')}</p>}
  <button type="button" className="min-h-12 text-body2 underline" onClick={()=>refresh()}>{t('Refresh','Թարմացնել','Обновить')}</button>
 </section>;
}
