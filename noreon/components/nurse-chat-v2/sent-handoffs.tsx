import {memberIdentityLine} from '@/lib/staff/member-identity';
import {yerevanStamp} from '@/lib/staff/yerevan-time';
import {handoffTopicLabel} from '@/lib/nurse-chat/handoff-copy';
import {handoffResolved,sentHandoffStatus,sentHandoffsCopy,type SentHandoffs} from '@/lib/nurse-chat/sent-handoffs';
import type {StaffLocale} from '@/lib/staff/staff-locale-copy';

/** The only control opens the conversation. No task commands or history enter this view. */
export function NurseSentHandoffs({page,locale,onMember,disabled=false}:{page:SentHandoffs;locale:StaffLocale;onMember:(member:SentHandoffs['items'][number]['member'])=>void;disabled?:boolean}){
 const c=sentHandoffsCopy(locale);
 return <div data-nurse-sent-handoffs>
  <p><strong>{c.title}</strong></p>
  {page.items.length?<ul className="ncv2-list">{page.items.map(item=><li key={item.taskId}>
   <p>{memberIdentityLine(item.member,locale)}</p>
   <p className="cv2-time">{yerevanStamp(item.sentAt,locale)} · {handoffTopicLabel(locale,item.topic)}</p>
   <p><span className="ncv2-handoff-status" data-sent-status={item.status}>{sentHandoffStatus(locale,item.status)}</span></p>
   <p className="ncv2-body">{c.observation}: {item.observation}</p>
   {handoffResolved(item.status)&&item.resolution&&<div data-handoff-resolution>
    <p className="cv2-time">{c.resolution} · {item.resolution.by} · {yerevanStamp(item.resolution.at,locale)}</p>
    <p className="ncv2-body">{item.resolution.note}</p>
   </div>}
   <button type="button" className="ncv2-choice" disabled={disabled} onClick={()=>onMember(item.member)} onPointerDown={event=>event.preventDefault()} onMouseDown={event=>event.preventDefault()}>{c.open}</button>
  </li>)}</ul>:<p>{c.empty}</p>}
  {page.hasMore&&<p className="cv2-time">{c.older}</p>}
 </div>;
}
