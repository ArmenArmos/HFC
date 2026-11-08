import type {ValidCard} from '@/lib/zoe-chat-actions/registry';
import {LIVING_VISIT,VISIT_STEPS} from '@/lib/zoe-chat-actions/living-visit';
import {say,VISIT,type CardLocale} from '@/lib/zoe-chat-actions/copy';
import {formatMemberDate} from '@/lib/patient/date-format';
import {memberInstruction} from '@/lib/text-language';

export function LivingVisitCard({card,locale:l,children}:{card:Extract<ValidCard,{kind:'visit'}>;locale:CardLocale;children?:React.ReactNode}){
 const visit=card.snapshot.living;if(!visit)return null;
 const proposal=card.snapshot.available?card.snapshot.proposal:null;
 const current=VISIT_STEPS.indexOf(visit.status);
 return <article className="cv2-msg cv2-zoe" data-zoe-card="visit" data-chat-card-id={card.id} data-state={visit.status} tabIndex={-1}>
  <p className="cv2-from"><i className="cv2-orb" aria-hidden/>Zoe</p>
  <section className="cv2-reading cv2-block">
   <h3>{say(l,LIVING_VISIT.title)}</h3>
   <p role="status">{say(l,!card.snapshot.available?LIVING_VISIT.unavailable:proposal?VISIT.pending:LIVING_VISIT[visit.status])}</p>
   {proposal&&<p>{say(l,VISIT.proposed(formatMemberDate(proposal.startsAt,l,{timeZone:'Asia/Yerevan',day:'numeric',month:'long',hour:'2-digit',minute:'2-digit'}),proposal.clinicName))}</p>}
   {card.snapshot.available&&<ol className="cv2-visit-steps" aria-label={say(l,LIVING_VISIT.title)}>{VISIT_STEPS.map((step,i)=><li key={step} aria-current={i===current?'step':undefined} data-step-state={i<current?'done':i===current?'current':'next'}><span aria-hidden>{i<current?'✓':i+1}</span> {say(l,proposal&&step==='awaiting'?VISIT.pending:LIVING_VISIT[step])}</li>)}</ol>}
   {children}
   {card.snapshot.available&&visit.status==='confirmed'&&<>
    {visit.startsAt&&<p><time dateTime={visit.startsAt}>{formatMemberDate(visit.startsAt,l,{timeZone:'Asia/Yerevan',day:'numeric',month:'long',hour:'2-digit',minute:'2-digit'})}</time></p>}
    {visit.location&&<p>{visit.location}</p>}
    {/* TODO: apply the member-language guard from fix/member-mixed-language after it lands. */}
    {visit.preparation&&<div><h4>{say(l,LIVING_VISIT.preparation)}</h4><p className="whitespace-pre-wrap">{memberInstruction(visit.preparation,l)}</p></div>}
   </>}
   {visit.status==='plan_published'&&visit.planId&&<a className="cv2-link" href="/patient/care">{say(l,LIVING_VISIT.plan)}</a>}
   {visit.source!=='request'&&<a className="cv2-link" href="/patient/service">{say(l,LIVING_VISIT.details)}</a>}
  </section>
 </article>;
}
