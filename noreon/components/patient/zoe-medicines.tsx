'use client';
import {memberInstruction} from "@/lib/text-language";
import {useEffect,useRef,useState} from 'react';
import {Button} from '@/components/ui/button';
import {AddMedicineForm,EditMedicineForm,StopMedicineButton} from '@/components/member-medicines/controls';
import {copy} from '@/components/patient-care/common';
import {SignInEnded} from './sign-in-ended';
import {changeMedicinesFromCard,readMedicinesFromCard} from '@/lib/zoe-chat-actions/medicines-actions';
import type {MedicinesRead} from '@/lib/zoe-chat-actions/medicines-read';
import type {MedicineCommand,MedicineExecution} from '@/lib/zoe-chat-actions/medicines';
import type {MedicineResult} from '@/lib/member-medicines/actions';
import type {MedicineAsk} from '@/lib/member-medicines/asks';
import {ASK_REASONS,MEDICINE_ASK_COPY} from '@/lib/member-medicines/ask-copy';
import type {PatientLocale} from '@/lib/patient/copy';
import type {ValidCard,ZoeCard} from '@/lib/zoe-chat-actions/registry';

/** Shared own-list forms. Plan medicines are read-only; one attempted change seals this card. */
export function ZoeMedicines({card,locale:l,onCard}:{card:Extract<ValidCard,{kind:'medicines'}>;locale:PatientLocale;onCard:(card:ZoeCard)=>void}){
 const [read,setRead]=useState<MedicinesRead|null>(null),[status,setStatus]=useState('loading'),[busy,setBusy]=useState(false),[settled,setSettled]=useState<MedicineExecution|null>(null),[changedName,setChangedName]=useState<string|null>(null);
 const sending=useRef(false),sealed=useRef(false);
 useEffect(()=>{let active=true;void readMedicinesFromCard(card.id).then(r=>{if(active){setStatus(r.status);setRead(r.status==='ok'?r.data:null);}}).catch(()=>{if(active){setRead(null);setStatus('unavailable');}});return ()=>{active=false;};},[card.id,card.state,settled]);
 const perform=async(command:MedicineCommand):Promise<MedicineResult>=>{
  if(sending.current||sealed.current)return {status:'conflict'};
  sending.current=true;setBusy(true);
  const name=command.kind==='add'?command.name:'id'in command?read?.own.find(m=>m.id===command.id)?.name:read?.asks.find(a=>a.id===command.askId)?.medicine.name;
  setChangedName(name??'');
  let result:MedicineExecution;
  let savedCard:ZoeCard|undefined;
  try{const r=await changeMedicinesFromCard({cardId:card.id,opId:crypto.randomUUID(),command});result=r.result??{status:r.status};if(r.status==='ok'&&['added','saved','stopped','answered','sent','already','closed'].includes(result.status))savedCard=r.card;}catch{result={status:'unknown'};}
  // Keep the add form mounted so its signed-out notice can show beside the entered values.
  // This response confirms no save; unknown outcomes still seal the card below.
  if(result.status==='signed_out'&&command.kind==='add'){sending.current=false;setBusy(false);return {status:'signed_out'};}
  sealed.current=true;sending.current=false;setBusy(false);setRead(null);setStatus('loading');setSettled(result);
  if(savedCard)onCard(savedCard);
  // The fieldset seals the card even when the form's reply is lost.
  if(result.status==='unknown')throw Error('Medicine outcome is unknown');
  return {status:result.status as MedicineResult['status']};
 };
 const outcome=card.outcome.medicines as {kind?:string;status?:string}|undefined;
 const isClosed=card.state==='done'||!!outcome;
 const locked=isClosed||!!settled;
 const result=settled??outcome;
 const claimed=card.claims.medicines?.payload.command as {kind?:string;name?:string;id?:string}|undefined;
 const name=changedName??(claimed?.kind==='add'?claimed.name:read?.own.find(m=>m.id===claimed?.id)?.name)??'';
 const confirmation=result?<p role="status" className="text-body2">{medicineConfirmation(l,result.status??'',name)}</p>:null;
 if(status==='signed_out')return <SignInEnded locale={l}/>;
 if(!read)return <div className="space-y-3">{confirmation}<p role="status" className="text-body2">{status==='loading'?copy(l,'Loading your medicines…','Բեռնվում են ձեր դեղերը…','Загружаем ваши лекарства…'):status==='stale'?copy(l,'Your list changed. Show your current medicines before continuing.','Ձեր ցանկը փոխվել է։ Շարունակելուց առաջ ցուցադրեք ընթացիկ դեղերը։','Ваш список изменился. Прежде чем продолжить, откройте текущий список лекарств.'):copy(l,'Your medicines could not be loaded. Try showing the current list again.','Չհաջողվեց բեռնել ձեր դեղերը։ Կրկին փորձեք ցուցադրել ընթացիկ ցանկը։','Не удалось загрузить ваши лекарства. Попробуйте снова открыть текущий список.')}</p></div>;
 if(!read.enabled)return <p role="status" className="text-body2">{copy(l,'Your medicine list is unavailable right now.','Ձեր դեղերի ցանկն այս պահին հասանելի չէ։','Ваш список лекарств сейчас недоступен.')}</p>;
 return <div className="space-y-4" data-zoe-medicines>
  {confirmation}
  <p className="text-body2 text-muted-foreground">{copy(l,'Your own list is your report. Updating it does not change your doctor’s plan. Ask your doctor about medicine or dose changes.','Ձեր սեփական ցանկը ձեր հաղորդածն է։ Այն փոխելը չի փոխում ձեր բժշկի պլանը։ Դեղի կամ դեղաչափի փոփոխության մասին հարցրեք ձեր բժշկին։','Ваш собственный список отражает ваши записи. Его изменение не меняет план вашего врача. Изменения лекарств или доз обсудите с вашим врачом.')}</p>
  <section className="space-y-3"><h3 className="text-body1 font-semibold">{copy(l,'From your doctor’s plan','Ձեր բժշկի պլանից','Из плана вашего врача')}</h3>
   {read.plan.length?read.plan.map(m=><div key={m.id} className="rounded-xl border border-border p-3"><p className="break-words font-semibold">{m.name}</p><p className="break-words text-body2">{m.dose}</p>{m.instructions&&<p className="break-words text-body2">{memberInstruction(m.instructions,l,[m.name])}</p>}<p className="text-caption">{m.times.join(' · ')}</p></div>):<p className="text-body2">{copy(l,'There are no medicines in your care plan.','Ձեր խնամքի պլանում դեղեր չկան։','В вашем плане лечения нет лекарств.')}</p>}
  </section>
  <fieldset disabled={busy||locked} aria-busy={busy} className="min-w-0 space-y-4"><legend className="mb-3 text-body1 font-semibold">{copy(l,'Your own list','Ձեր սեփական ցանկը','Ваш собственный список')}</legend>
   {!read.own.length&&<p className="text-body2">{copy(l,'Your own list is empty.','Ձեր սեփական ցանկը դատարկ է։','Ваш собственный список пуст.')}</p>}
   {read.own.map(m=><div key={m.id} className="space-y-1 rounded-xl border border-border p-3"><p className="break-words font-semibold">{m.name}</p>{m.dose&&<p className="break-words text-body2">{m.dose}</p>}<p className="text-caption">{m.times.join(' · ')}</p><div className="flex flex-wrap gap-2">
    {!locked&&<><EditMedicineForm medicine={m} locale={l} action={async raw=>{const v=raw as {id:string;dose:string;times:string[]};return perform(v.dose===(m.dose??'')?{kind:'times',id:v.id,times:v.times}:{kind:'edit',id:v.id,dose:v.dose,times:v.times});}}/>
    <StopMedicineButton id={m.id} locale={l} action={async()=>perform({kind:'stop',id:m.id})}/></>}
   </div></div>)}
   {!locked&&<><AddMedicineForm locale={l} action={async raw=>{const v=raw as {name:string;dose:string;times:string[]};return perform({kind:'add',name:v.name,dose:v.dose,times:v.times});}}/>
   {read.asks.map(ask=><MedicineQuestion key={ask.id} ask={ask} locale={l} perform={perform}/>)}</>}
  </fieldset>
  {locked&&<div className="space-y-3">{result?.status==='signed_out'&&<SignInEnded locale={l}/>}
  {settled?.next==='doctor'&&<p className="text-body2">{MEDICINE_ASK_COPY[l].doctor.noAdvice}</p>}</div>}
 </div>;
}
function medicineConfirmation(l:PatientLocale,status:string,name:string){
 if(name&&status==='added')return copy(l,`You added ${name} to your list.`,`Դուք ${name}-ն ավելացրիք ձեր ցանկում։`,`Вы добавили ${name} в свой список.`);
 if(name&&status==='saved')return copy(l,`You updated ${name} on your list.`,`Դուք փոխեցիք ${name}-ի տվյալները ձեր ցանկում։`,`Вы обновили ${name} в своём списке.`);
 if(name&&status==='stopped')return copy(l,`You removed ${name} from your list.`,`Դուք ${name}-ը հեռացրիք ձեր ցանկից։`,`Вы убрали ${name} из своего списка.`);
 if(status==='unknown')return copy(l,'The result is unknown. Check your current list before making another change.','Արդյունքն անհայտ է։ Այլ փոփոխություն կատարելուց առաջ ստուգեք ընթացիկ ցանկը։','Результат неизвестен. Прежде чем вносить ещё изменения, проверьте текущий список.');
 if(['added','saved','stopped','answered','sent','already','closed'].includes(status))return copy(l,'Your choice was recorded.','Ձեր ընտրությունը գրանցված է։','Ваш выбор записан.');
 return copy(l,'This change was not confirmed. Check your current list before continuing.','Այս փոփոխությունը չի հաստատվել։ Շարունակելուց առաջ ստուգեք ընթացիկ ցանկը։','Не удалось подтвердить изменение. Прежде чем продолжить, проверьте текущий список.');
}

function MedicineQuestion({ask,locale:l,perform}:{ask:MedicineAsk;locale:PatientLocale;perform:(command:MedicineCommand)=>Promise<MedicineResult>}){
 const c=MEDICINE_ASK_COPY[l];
 return <section className="space-y-3 rounded-xl border border-border p-3"><p className="break-words text-body2 font-semibold">{ask.medicine.name}</p>{ask.state==='open'?<><p className="text-body2">{c.why}</p><div className="flex flex-wrap gap-2">{ASK_REASONS.map(reason=><Button key={reason} type="button" variant="outline" className="h-auto min-h-11 whitespace-normal" onClick={()=>void perform({kind:'reason',askId:ask.id,reason}).catch(()=>{})}>{c.reasons[reason]}</Button>)}<Button type="button" variant="ghost" onClick={()=>void perform({kind:'keep',askId:ask.id}).catch(()=>{})}>{c.notNow}</Button></div></>:<><p className="text-body2">{c.refill.body}</p>{ask.careTeamAsked?<p role="status" className="text-body2">{c.refill.already}</p>:<Button type="button" className="h-auto min-h-11 whitespace-normal" onClick={()=>void perform({kind:'refill',askId:ask.id}).catch(()=>{})}>{c.refill.action}</Button>}</>}</section>;
}
