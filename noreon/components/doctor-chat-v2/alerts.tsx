import {useChatMemberIdentity} from '@/components/staff/chat-member-identity';
import {done,notDone} from '@/lib/staff-zoe/outcome-copy';
import {st,type StaffLocale} from '@/lib/staff/staff-locale-copy';
import {type AlertResolution} from '@/lib/care-alerts/contracts';
import type {AlertItem} from '@/lib/doctor-inbox/contracts';
import type {EverydayResult} from '@/lib/staff-zoe/everyday-runtime';
import {CareAlertResolve} from '@/components/staff/care-alert-resolve';
import {ReplyOutcome} from './conversation';
export type AlertPress='acknowledge'|AlertResolution;
export type AlertControls={busy?:boolean;active?:boolean;closer?:string;onAct?:(item:AlertItem,press:AlertPress,note?:string)=>void;onCheck?:(item:AlertItem)=>void};
export function AlertButtons({item,locale:l,busy,active=true,closer,onAct,onOpen}:AlertControls&{item:AlertItem;locale:StaffLocale;onOpen?:()=>void}){
 const t=(en:string,hy:string,ru:string)=>st(l,en,hy,ru);
 const identity=useChatMemberIdentity(item.memberId);
 const canAct=active&&!!onAct&&item.alert.state!=='resolved';
 const held=busy||!identity;
 if(!canAct&&!onOpen)return null;
 return <div className="dcv2-controls">
  {onOpen&&<button type="button" className="dcv2-choice" disabled={held} onClick={onOpen} onPointerDown={e=>e.preventDefault()}>{t('Open member','Բացել անդամին','Открыть участника')}</button>}
  {canAct&&item.alert.state==='open'&&<button type="button" className="dcv2-choice" disabled={held} onClick={()=>onAct?.(item,'acknowledge')} onPointerDown={e=>e.preventDefault()}>{t('Acknowledge','Հաստատել','Подтвердить')}</button>}
  {canAct&&<CareAlertResolve alert={item.alert} locale={l} closer={closer} disabled={held} onConfirm={form=>onAct?.(item,form.get('resolution') as AlertResolution,String(form.get('note')??''))}/>}
 </div>;
}
export function AlertOutcome({item,result,locale:l,active=true,busy,onCheck}:AlertControls&{item:AlertItem;result:EverydayResult;locale:StaffLocale}){
 const t=(en:string,hy:string,ru:string)=>st(l,en,hy,ru);
 const retry=result.kind==='changed'||result.kind==='unavailable'||result.kind==='invalid';
 return <div data-alert-outcome={item.alert.id}>
  {result.kind==='saved'?<p role="status">{result.notice==='acknowledged'?done('alert-acknowledged',l):done('alert-resolved',l)}</p>:
   result.kind==='changed'?<p role="alert">{notDone('alert-changed',l)}</p>:
   result.kind==='already_resolved'?<p role="status">{notDone('already-resolved',l)} {result.resolvedBy??t('Name unavailable','Անունն անհասանելի է','Имя недоступно')} · {result.resolvedAt?<time dateTime={result.resolvedAt}>{new Intl.DateTimeFormat(l,{timeZone:'Asia/Yerevan',dateStyle:'medium',timeStyle:'short',hourCycle:'h23'}).format(new Date(result.resolvedAt))}</time>:t('Time unavailable','Ժամը հասանելի չէ','Время недоступно')}</p>:
   result.kind==='invalid'?<p role="alert">{notDone('invalid-action',l)}</p>:
   <ReplyOutcome status={result.kind==='off'?'disabled':result.kind==='refused'?'access':'outcome-unknown'} locale={l}/>}
  {retry&&active&&onCheck&&<button type="button" className="dcv2-choice" disabled={busy} onClick={()=>onCheck(item)} onPointerDown={e=>e.preventDefault()}>{t('Check again','Ստուգել կրկին','Проверить снова')}</button>}
 </div>;
}
