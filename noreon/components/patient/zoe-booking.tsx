"use client";
import {useEffect,useRef,useState} from 'react';
import Link from 'next/link';
import {PilotMemberBooking} from '@/components/real-booking/pilot-member';
import {TestPrices} from '@/components/pilot-commerce/member-pricing';
import {testTitle} from '@/lib/patient/catalogue-label';
import {HomeVisitRequest,RealMemberBooking} from '@/components/real-booking/member';
import {BookingRefreshContext} from '@/components/real-booking/recovery-context';
import {bookVisitFromCard,readVisitBookingFromCard} from '@/lib/zoe-chat-actions/booking-actions';
import {openZoeCard} from '@/lib/zoe-chat-actions/actions';
import type {VisitBooking} from '@/lib/zoe-chat-actions/booking-read';
import type {BookingKind,BookingExecution} from '@/lib/zoe-chat-actions/booking';
import type {ValidCard,ZoeCard} from '@/lib/zoe-chat-actions/registry';
import type {PilotActionState} from '@/lib/real-booking/appointment-schema';
import {copy} from '@/components/patient-care/common';
import {ConsultationWindowNotice} from '@/components/patient-care/consultation-window-notice';
import type {PatientLocale} from '@/lib/patient/copy';
import {VISIT_REQUEST} from '@/lib/zoe-chat-actions/lab-visit-copy';
import {VisitRequestForm} from '@/components/chat-v2/visit-request-form';
import {visitRequestAvailable,visitRequestPayload} from '@/lib/zoe-chat-actions/visit-request-contract';

/** The page's actual forms, pinned to this card. Only an explicit refresh opens another snapshot. */
export function ZoeBooking({card,locale:l,onCard,onAct,allowRequest=false}:{card:Extract<ValidCard,{kind:'visit'}>;locale:PatientLocale;onCard:(card:ZoeCard)=>void;onAct?:(id:string,busy:boolean)=>void;allowRequest?:boolean}){
 const [read,setRead]=useState<VisitBooking|null>(null);
 const [status,setStatus]=useState('loading');
 const [busy,setBusy]=useState(false);
 const [settled,setSettled]=useState<BookingExecution|null>(null);
 const [loadVersion,setLoadVersion]=useState(0);
 const sending=useRef(false);
 const sealed=useRef(false);
 const refresh=useRef<{id:string;busy:boolean}|null>(null);
 const onCurrent=()=>{
  if(refresh.current?.busy)return;
  const request=refresh.current??{id:crypto.randomUUID(),busy:false};
  refresh.current=request;request.busy=true;
  void openZoeCard({requestId:request.id,kind:'visit',sourceSeq:null}).then(r=>{
   if(r.status==='ok'){refresh.current=null;onCard(r.card);}
   else {request.busy=false;setStatus('unavailable');}
  }).catch(()=>{request.busy=false;setStatus('unavailable');});
 };
 useEffect(()=>{
  let active=true;
  if(card.state==='done')return;
  void readVisitBookingFromCard(card.id).then(r=>{
   if(active){setStatus(r.status);if(r.status==='ok')setRead(r.data);}
  }).catch(()=>{if(active)setStatus('unavailable');});
  return ()=>{active=false;};
 },[card.id,card.state,loadVersion]);
 const perform=async(kind:BookingKind,_previous:unknown,form:FormData):Promise<BookingExecution>=>{
  if(sending.current||sealed.current)return {ok:false,code:'conflict'};
  sending.current=true;setBusy(true);onAct?.(card.id,true);
  const opId=crypto.randomUUID();
  const fields:Record<string,string>={};
  for(const [key,value]of form)if(typeof value==='string')fields[key]=value;
  let result:BookingExecution;
  let savedCard:ZoeCard|undefined;
  try{
   const r=await bookVisitFromCard({cardId:card.id,opId,kind,fields});
   result=r.result??{ok:false,code:r.status==='stale'||r.status==='closed'?'conflict':'unavailable'};
   if(r.status==='ok'&&(onAct||(result.ok&&!result.outcomeUnknown)))savedCard=r.card;
  }catch{result={ok:false,code:'unknown',outcomeUnknown:true};}
  // A lost response may have written. All forms on this card stay locked until current details are opened.
  sealed.current=true;sending.current=false;setBusy(false);setSettled(result);
  if(savedCard)onCard(savedCard);else if(!result.outcomeUnknown)onAct?.(card.id,false);
  return result;
 };
 const legacyAction=async(previous:unknown,form:FormData)=>{
  const result=await perform('legacy',previous,form);
  return {ok:result.ok,providerPending:result.providerPending,code:result.ok?'saved' as const:result.code==='invalid'?'invalid' as const:result.code==='conflict'?'conflict' as const:'unavailable' as const,message:result.ok?'Your request is recorded. Check its saved status for the result.':'Check the saved booking before continuing.',messageHy:result.ok?'Ձեր հարցումը գրանցված է։ Արդյունքը տեսնելու համար ստուգեք պահպանված վիճակը։':'Շարունակելուց առաջ ստուգեք պահպանված այցը։',messageRu:result.ok?'Ваша заявка зарегистрирована. Проверьте её сохранённый статус, чтобы узнать результат.':'Прежде чем продолжить, проверьте сохранённую запись.'};
 };
 if(settled?.ok)return <p role="status" className="text-body2">{copy(l,'Your request is recorded. Check its saved status for the result.','Ձեր հարցումը գրանցված է։ Արդյունքը տեսնելու համար ստուգեք պահպանված վիճակը։','Ваша заявка зарегистрирована. Проверьте её сохранённый статус, чтобы узнать результат.')}</p>;
 const saved=card.outcome.booking as PilotActionState|undefined;
 if(card.state==='done'||saved)return <p role="status" className="text-body2">{copy(l,'This card is closed. Show current details before continuing.','Այս քարտը փակված է։ Շարունակելուց առաջ ցուցադրեք ընթացիկ տվյալները։','Эта карточка закрыта. Прежде чем продолжить, откройте актуальные данные.')}</p>;
 if(!read)return <><p role="status" className="text-body2">{status==='loading'?copy(l,'Loading visit choices…','Բեռնվում են այցի տարբերակները…','Загружаем варианты визита…'):status==='stale'?copy(l,'Your booking details changed. Show current details before continuing.','Ձեր այցի տվյալները փոխվել են։ Շարունակելուց առաջ ցուցադրեք ընթացիկ տվյալները։','Данные вашего визита изменились. Прежде чем продолжить, откройте актуальные данные.'):copy(l,'Visit choices could not be loaded. Show current details to try again.','Չհաջողվեց բեռնել այցի տարբերակները։ Կրկին փորձելու համար ցուցադրեք ընթացիկ տվյալները։','Не удалось загрузить варианты визита. Откройте актуальные данные, чтобы попробовать снова.')}</p>{allowRequest&&status!=='loading'&&<button type="button" className="cv2-reading-save" onClick={()=>status==='stale'?onCurrent():setLoadVersion(v=>v+1)}>{VISIT_REQUEST.reload[l]}</button>}</>;
 if(read.hold)return <div className="space-y-3">
  {(read.hold==='urgent'||read.crisis)&&<a href="tel:103" className="emergency-call flex min-h-14 items-center justify-center rounded-md px-5 py-3">{copy(l,'Call 103','Զանգահարել 103','Позвонить 103')}</a>}
  <p className="text-body2">{copy(l,'Review your health guidance before arranging tests.','Հետազոտություններն ամրագրելուց առաջ ստուգեք առողջության ցուցումները։','Перед записью на анализы проверьте рекомендации по здоровью.')}</p>
  <Link href={read.hold==='urgent'?'/patient/urgent':'/patient/questions'} className="inline-flex min-h-12 items-center underline">{read.hold==='urgent'?copy(l,'View health guidance','Տեսնել առողջության ցուցումները','Посмотреть рекомендации по здоровью'):copy(l,'Continue questionnaire','Շարունակել հարցաշարը','Продолжить анкету')}</Link>
 </div>;
 const {data,pilot,pricing,decision,homeAvailable,doneTestIds}=read.booking!;
 const pendingRequest=visitRequestPayload.safeParse(card.claims.booking?.payload).success;
 const keepBookingGuidance=data.clinicalHold||pilot.appointments.length>0||['clinical-hold','profile-mismatch'].includes(pilot.unavailableReason??'')
  ||data.requests.some(r=>r.status!=='cancelled'&&r.status!=='completed');
 if(allowRequest&&onAct&&read.requestEnabled&&!keepBookingGuidance&&(pendingRequest||visitRequestAvailable(read)))return <>
  <ConsultationWindowNotice decision={decision} locale={l} headingId={`consultation-${card.id}`}/>
  <TestPrices items={data.requirements.map(t=>({id:t.id,title:testTitle(t,l)}))} pricing={pricing} locale={l}/>
  <VisitRequestForm card={card} days={read.requestDays} locale={l} onCard={onCard} onAct={onAct} onReload={()=>setLoadVersion(v=>v+1)}/>
 </>;

 const ids=Object.fromEntries(pilot.appointments.map(a=>[a.id,card.id]));
 return <BookingRefreshContext.Provider value={onCurrent}>
  <ConsultationWindowNotice decision={decision} locale={l} headingId={`consultation-${card.id}`}/>
  <fieldset disabled={busy||!!settled} aria-busy={busy} className="min-w-0 space-y-4 [&_h1]:!text-[1.125rem] [&_h2]:!text-[1.125rem]" data-zoe-booking>
   {data.legacyCreationAvailable?<RealMemberBooking data={data} locale={l} pricing={pricing} action={legacyAction}/>:<>
    <PilotMemberBooking data={pilot} locale={l} pricing={pricing} commandId={card.id} changeCommandIds={ids} cancelCommandIds={ids} proposalCommandIds={ids} selectAction={(p,f)=>perform('select',p,f)} changeAction={(p,f)=>perform('change',p,f)} cancelAction={(p,f)=>perform('cancel',p,f)} proposalAction={(p,f)=>perform('proposal',p,f)} refreshHref="/patient/service" doneTestIds={doneTestIds} homeRequestOpen={data.requests.some(r=>r.status!=='cancelled'&&r.status!=='completed')} homeVisit={homeAvailable?<HomeVisitRequest data={data} locale={l} pricing={pricing} action={legacyAction}/>:undefined}/>
    {data.requests.length>0&&<RealMemberBooking data={{...data,legacyCreationAvailable:false}} locale={l} pricing={pricing} action={legacyAction}/>}
   </>}
  </fieldset>
  {settled&&<p role="status" className="text-body2">{settled.outcomeUnknown?copy(l,'The booking result is unknown. Check the saved booking before continuing.','Գրանցման արդյունքն անհայտ է։ Շարունակելուց առաջ ստուգեք պահպանված այցը։','Результат записи неизвестен. Прежде чем продолжить, проверьте сохранённую запись.'):copy(l,'Show current details to check the saved booking before continuing.','Շարունակելուց առաջ ցուցադրեք ընթացիկ տվյալները՝ պահպանված այցը ստուգելու համար։','Прежде чем продолжить, откройте актуальные данные и проверьте сохранённую запись.')}</p>}
 </BookingRefreshContext.Provider>;
}
