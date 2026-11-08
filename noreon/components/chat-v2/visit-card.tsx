"use client";
import {ShowCurrent} from '@/components/patient/zoe-card-controls';
import { zoeName } from '@/lib/brand';
import {VISIT} from '@/lib/zoe-chat-actions/copy';
import {SignInEnded} from '@/components/patient/sign-in-ended';
import {askAdminToChangeVisit} from '@/lib/zoe-chat-actions/labs-actions';
import {bookVisitFromCard} from '@/lib/zoe-chat-actions/booking-actions';
import {acceptVisitFromCard} from '@/lib/zoe-chat-actions/actions';
import {LAB_VISIT,VISIT_REQUEST} from '@/lib/zoe-chat-actions/lab-visit-copy';
import {useCardSave} from './use-card-save';
import {ZoeBooking} from '@/components/patient/zoe-booking';
import {visitProposalAccepted,type ValidCard,type ZoeCard} from '@/lib/zoe-chat-actions/registry';
import {say,type CardLocale} from '@/lib/zoe-chat-actions/copy';
import {DialogTurn} from './dialog-turn';
import {LivingVisitCard} from './living-visit-card';
const c=(en:string,hy:string,ru:string)=>({en,hy,ru});
const visitCopy={title:c('Your lab visit','Ձեր լաբորատոր այցը','Ваш визит на анализы'),
 said:c('I sent my visit choice.','Ուղարկեցի այցի իմ ընտրությունը։','Я отправил(а) свой выбор визита.'),
 saved:c('Your choice is recorded. Your saved visit shows whether it is confirmed.','Ձեր ընտրությունը գրանցված է։ Պահպանված այցում կարող եք տեսնել՝ հաստատված է արդյոք այն։','Ваш выбор записан. В сохранённом визите видно, подтверждён ли он.'),
 failed:c('Your visit is not confirmed. Check your saved visit before trying again.','Ձեր այցը հաստատված չէ։ Կրկին փորձելուց առաջ ստուգեք պահպանված այցը։','Ваш визит не подтверждён. Перед повторной попыткой проверьте сохранённый визит.')};
export function SavedVisitTurn({card,locale:l,time,onCard}:{onCard?:(c:ZoeCard)=>void;card:Extract<ValidCard,{kind:'visit'}>;locale:CardLocale;time:string}){
 const current=onCard?<ShowCurrent kind="visit" locale={l} onCard={onCard}/>:null;
 const result=card.outcome.booking as {ok?:boolean;outcomeUnknown?:boolean;kind?:string};

 if(!result)return <DialogTurn locale={l} action={say(l,VISIT.accept)} time={time}><p>{say(l,VISIT.accepted)}</p>{current}</DialogTurn>;
 // The ordinary care-team message already says the day, time of day and note.
 if(result.kind==='visit_request')return <DialogTurn locale={l} action={null} time={time}><p>{say(l,VISIT_REQUEST.sent)}</p>{current}</DialogTurn>;
 if(result.kind==='admin_change')return <DialogTurn locale={l} action={say(l,LAB_VISIT.adminSaid)} time={time}><p>{say(l,LAB_VISIT.adminReply)}</p>{current}</DialogTurn>;
 return <DialogTurn locale={l} action={say(l,visitCopy.said)} time={time}><p>{say(l,result.ok&&!result.outcomeUnknown?visitCopy.saved:visitCopy.failed)}</p>{current}</DialogTurn>;
}
export function VisitCard({card,locale:l,onCard,onAct,current=false}:{current?:boolean;card:Extract<ValidCard,{kind:'visit'}>;locale:CardLocale;onCard:(c:ZoeCard)=>void;onAct:(id:string,busy:boolean)=>void}){
 const {busy,problem,save,opId}=useCardSave(card.id,l,onCard,onAct);
 if(card.snapshot.living)return <LivingVisitCard card={card} locale={l}>
  {card.snapshot.available&&card.snapshot.proposal&&!visitProposalAccepted(card,card.snapshot.proposal.proposalId)&&<fieldset disabled={busy} aria-busy={busy}>
   <button type="button" className="cv2-reading-save" onClick={()=>save(()=>acceptVisitFromCard({cardId:card.id,commandId:opId,proposalId:card.snapshot.proposal!.proposalId}))}>{say(l,LAB_VISIT.confirm)}</button>
   {problem==='signed_out'?<SignInEnded locale={l}/>:problem&&<p role="alert">{problem}</p>}
  </fieldset>}
 </LivingVisitCard>;
 if(card.state==='done')return null;
 return <article className="cv2-msg cv2-zoe" data-zoe-card="visit" data-chat-card-id={card.id} data-state="open"><p className="cv2-from"><i className="cv2-orb" aria-hidden/>{zoeName(l)}</p>
  <section className="cv2-reading cv2-block">
   <h3>{say(l,visitCopy.title)}</h3>
   <fieldset disabled={busy} aria-busy={busy}>
    {card.snapshot.proposal&&<button type="button" className="cv2-reading-save" onClick={()=>save(()=>bookVisitFromCard({cardId:card.id,opId,kind:'proposal',fields:{proposalId:card.snapshot.proposal!.proposalId,accept:'true'}}))}>{say(l,LAB_VISIT.confirm)}</button>}
    {card.snapshot.next&&<button type="button" className="cv2-link" onClick={()=>save(()=>askAdminToChangeVisit({cardId:card.id,opId}))}>{say(l,LAB_VISIT.adminChange)}</button>}
    {problem==='signed_out'?<SignInEnded locale={l}/>:problem&&<p role="alert">{problem}</p>}
   </fieldset>
   <ZoeBooking card={card} locale={l} onCard={onCard} onAct={onAct} allowRequest/>
   {current&&<ShowCurrent kind="visit" locale={l} onCard={onCard}/>}
  </section>
 </article>;
}
