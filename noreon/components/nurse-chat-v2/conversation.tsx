import {quotesTypedBp} from '@/lib/staff-zoe/chat-reported';
import {unverifiedBpLabel} from '@/lib/patient/bp-provenance';
import {ReportedBpLabel} from '@/components/chat-v2/reported-bp-label';
import {ChatMemberIdentity} from '@/components/staff/chat-member-identity';
import {Fragment,type ReactNode} from 'react';
import {st,type StaffLocale} from '@/lib/staff/staff-locale-copy';
import {yerevanStamp} from '@/lib/staff/yerevan-time';
import {nurseConversationCopy} from '@/lib/nurse-chat/conversation-copy';
import {nurseHandoffCopy,handoffTopicLabel,handoffStateLabel} from '@/lib/nurse-chat/handoff-copy';
import {handoffState} from '@/lib/nurse-chat/handoff-state';
import {handoffTopics} from '@/lib/nurse-chat/handoffs';
import {taskStatusLabel} from '@/lib/staff/real-coordination/status-copy';
import type {useNurseConversation} from './use-nurse-conversation';

type Conversation=ReturnType<typeof useNurseConversation>;
export function NurseConversation({conversation:c,locale:l,nurseName,onRetry,onAction,onNotes,workHeld=false,workTurns=[]}:{conversation:Conversation;locale:StaffLocale;nurseName:string;onRetry:()=>void;onAction:(action:()=>void)=>void;onNotes?:()=>void;workHeld?:boolean;workTurns?:{id:string;at:string;node:ReactNode}[]}){
 const data=c.session?.data,copy=nurseConversationCopy(l,data?.ok?data:undefined),hcopy=nurseHandoffCopy(l),h=c.handoff;
 const t=(en:string,hy:string,ru:string)=>st(l,en,hy,ru);
 const reply=(content:ReactNode)=> <article className="cv2-msg cv2-zoe"><div className="cv2-say ncv2-card">{content}</div></article>;
 if(!data)return reply(<p role="status">{copy.reading}</p>);
 if(!data.ok)return reply(<p role="alert">{copy[data.code]}</p>);
 // The workspace member rows are typed conversation_messages, as on the doctor's quote card.
 const reported=data.items.filter(item=>item.senderRole==='member').map(item=>item.text);
 const stale=t('A new member message arrived. Read it before sending your reply.','Անդամից նոր հաղորդագրություն է ստացվել։ Կարդացեք այն՝ նախքան պատասխանն ուղարկելը։','Поступило новое сообщение участника. Прочитайте его перед отправкой ответа.');
 const notices={unknown:copy.unknown,unconfirmed:copy.unconfirmed,stale,
  savedUnread:t('Your reply is saved. The updated conversation is unavailable. We will check again automatically.','Ձեր պատասխանը պահպանվել է։ Նորացված զրույցն անհասանելի է։ Մենք ինքնաշխատ կրկին կստուգենք։','Ваш ответ сохранён. Обновлённый разговор недоступен. Мы проверим его снова автоматически.')};
 const rows:{id:string;at:string;node:ReactNode}[]=data.items.map(item=>({id:item.id,at:item.at,node:<article data-conversation-item={item.id} className={`cv2-msg ${item.senderRole==='nurse'?'cv2-me':'cv2-zoe'}`}>
  <div className="cv2-say" role="button" tabIndex={0} aria-expanded={h.selected===item.id&&!h.active&&!c.frozen&&!workHeld&&!h.remembered.includes(item.id)} onClick={event=>{event.stopPropagation();if(!c.frozen&&!workHeld)h.select(item.id);}}
   onKeyDown={event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();event.stopPropagation();if(!c.frozen&&!workHeld)h.select(item.id);}}}
   onPointerDown={event=>{if(event.pointerType==='touch')event.preventDefault();}}>
   <p className="cv2-time">{item.senderName||copy[item.senderRole]} · {copy[item.senderRole]} · {yerevanStamp(item.at,l)}</p><p className="ncv2-body">{item.text}</p>
   {item.senderRole==='member'&&quotesTypedBp(item.text)&&<p className="text-caption" data-bp-provenance>{unverifiedBpLabel(l)}</p>}
   {item.senderRole==='zoe'&&<ReportedBpLabel text={item.text} locale={l} reported={reported}/>}
   {item.senderRole==='nurse'&&<p className="cv2-time" data-nurse-reply-state>{copy.sentToApp}</p>}
  </div>
  {h.remembered.includes(item.id)?<p className="cv2-time">{hcopy.handedOver}</p>:h.selected===item.id&&!h.active&&!c.frozen&&!workHeld&&<button type="button" className="ncv2-choice" onClick={event=>{event.stopPropagation();onAction(()=>h.start(item.id,`${hcopy.handOver}\n${item.text.slice(0,90)}`));}} onPointerDown={event=>event.preventDefault()} onMouseDown={event=>event.preventDefault()}>{hcopy.action}</button>}
 </article>}));
 for(const item of h.page?.items??[])rows.push({id:`handoff-${item.task.id}`,at:item.task.createdAt,node:<article className="cv2-msg cv2-me" data-handoff-saved={item.task.id}>
  <div className="cv2-say"><p className="cv2-time">{item.nurseName} · {yerevanStamp(item.task.createdAt,l)}</p><p>{hcopy.handedOver} · {handoffTopicLabel(l,item.topic)}</p><p className="ncv2-body">{item.observation}</p><p className="cv2-time">{handoffStateLabel(l,handoffState(item.task).state)} · {taskStatusLabel(l,item.task.status)}</p>{handoffState(item.task).note&&<p className="ncv2-body">{handoffState(item.task).by}: “{handoffState(item.task).note}”</p>}</div>
 </article>});
 for(const flow of [...h.failed,...(h.flow?[h.flow]:[])])for(const turn of flow.turns)rows.push({id:turn.id,at:turn.at,node:<article className="cv2-msg cv2-me" data-handoff-turn={turn.kind} data-handoff-state={turn.state}>
  <div className="cv2-say"><p className="ncv2-body">{turn.text}</p>{turn.state==='saving'&&<p className="cv2-time" role="status">{copy.saving}</p>}{turn.state==='failed'&&<p role="alert">{hcopy.alreadyExists}</p>}</div>
 </article>});
 for(const saved of h.fallbacks)rows.push({id:`unread-${saved.taskId}`,at:saved.at,node:<article className="cv2-msg cv2-me" data-handoff-unread={saved.taskId}><div className="cv2-say"><p>{hcopy.handedOver} · {handoffTopicLabel(l,saved.topic)}</p><p className="ncv2-body">{saved.observation}</p><p role="status">{hcopy.saved}</p></div></article>});
 for(const item of c.optimistic)rows.push({id:item.request.requestId,at:item.at,node:<article className="cv2-msg cv2-me" data-pending-reply={item.state}>
  <p className="cv2-time">{nurseName} · {copy.nurse}{item.state==='saving'&&<> · {copy.saving}</>}</p><div className="cv2-say"><p className="ncv2-body">{item.request.body}</p>{item.state==='sent'&&<p className="cv2-time" data-nurse-reply-state>{copy.sentToApp}</p>}</div>
 </article>});
 rows.push(...workTurns);
 const flow=h.flow;
 if(flow&&(!flow.turns.some(turn=>turn.kind==='observation')||flow.notice))rows.push({id:'handoff-prompt',at:flow.promptAt,node:reply(<>
  {!flow.topic?<><p>{hcopy.explanation}</p><div className="ncv2-topics">{handoffTopics.map(topic=><button key={topic} type="button" className="ncv2-choice" onClick={()=>onAction(()=>h.topic(topic,handoffTopicLabel(l,topic)))} onPointerDown={event=>event.preventDefault()} onMouseDown={event=>event.preventDefault()}>{handoffTopicLabel(l,topic)}</button>)}</div></>:!flow.turns.some(turn=>turn.kind==='observation')&&<p>{hcopy.observation}</p>}
  {flow.notice&&<p role="alert">{flow.notice==='stale'?stale:flow.notice==='refused'?hcopy.refused:hcopy.unknown}</p>}
  {flow.notice==='unknown'&&<button type="button" className="ncv2-choice" disabled={h.sending} onClick={onRetry} onPointerDown={event=>event.preventDefault()} onMouseDown={event=>event.preventDefault()}>{hcopy.retry}</button>}
 </>)});
 return <>
  {reply(<>
   <p><strong>{c.session&&<ChatMemberIdentity memberId={c.session.member.id} name={data.memberName||copy.member} member={c.session.member} locale={l}/>}</strong></p><p>{copy.responsibleDoctor}{data.doctorName}</p>
   <p>{nurseName} · {copy.nurse}. {copy.detail}</p><p data-nurse-telegram-handoff={copy.telegramHandoff||undefined}>{copy.nextStep}</p><p>{hcopy.hint}</p>
   {(data.unsupportedMedia||data.unsavedOverLimit)&&<p role="alert">{copy.missingMessages}</p>}
   {!data.items.length&&<p role="status">{copy.empty}</p>}
   {!data.canSend&&<p role="status">{copy.readOnly}</p>}
  </>)}
  {rows.sort((a,b)=>Date.parse(a.at)-Date.parse(b.at)).map(row=><Fragment key={row.id}>{row.node}</Fragment>)}

  {c.notice&&reply(<><p role="alert">{notices[c.notice]}</p>{c.notice==='unknown'&&<button type="button" className="ncv2-choice" disabled={c.sending} onClick={onRetry} onPointerDown={event=>event.preventDefault()} onMouseDown={event=>event.preventDefault()}>{copy.retry}</button>}</>)}
  {onNotes&&!h.active&&<button type="button" className="ncv2-choice" disabled={c.frozen||workHeld} onClick={()=>onAction(onNotes)} onPointerDown={event=>event.preventDefault()} onMouseDown={event=>event.preventDefault()}>{t('Notes','Նշումներ','Заметки')}</button>}
  <p className="cv2-time ncv2-safety" data-nurse-safety>{copy.safety}</p>
 </>;
}
