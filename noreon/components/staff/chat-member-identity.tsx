'use client';
import {createContext,useContext,useEffect,useRef,useState,useCallback,type ReactNode,type ButtonHTMLAttributes} from 'react';
import {readStaffChatMemberIdentities} from '@/lib/staff/chat-member-identity-actions';
import type {ChatMemberIdentity as Identity} from '@/lib/staff/chat-member-identity-schema';
import type {MemberIdentity as IdentityFields} from '@/lib/staff/member-identity';
import {st,type StaffLocale} from '@/lib/staff/staff-locale-copy';
import {MemberIdentity} from './member-identity';

type Context={records:Record<string,Identity|null>;request:(id:string)=>void};
const IdentityContext=createContext<Context|null>(null);

/** Cache only inside this signed-in staff tree. Batch list/card reads, at most 50 per RPC. */
export function ChatMemberIdentityProvider({children}:{children:ReactNode}){
 const [records,setRecords]=useState<Context['records']>({});
 const requested=useRef(new Set<string>()),queued=useRef(new Set<string>()),scheduled=useRef(false),mounted=useRef(true);
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
 const request=useCallback((id:string)=>{
  if(requested.current.has(id))return;
  requested.current.add(id);queued.current.add(id);
  if(scheduled.current)return;
  scheduled.current=true;
  void Promise.resolve().then(()=>{
   scheduled.current=false;const ids=[...queued.current];queued.current.clear();
   void (async()=>{
    for(let at=0;at<ids.length;at+=50){
     const batch=ids.slice(at,at+50);
     const rows=await readStaffChatMemberIdentities(batch).catch(()=>null);
     if(mounted.current)setRecords(previous=>({...previous,...Object.fromEntries(batch.map(id=>[id,rows?.find(row=>row.id===id)??null]))}));
    }
   })();
  });
 },[]);
 return <IdentityContext.Provider value={{records,request}}>{children}</IdentityContext.Provider>;
}

export function useChatMemberIdentity(memberId:string,provided?:IdentityFields){
 const context=useContext(IdentityContext),[single,setSingle]=useState<{id:string;identity:Identity|null}|null>(null);
 // A supplied chat payload already passed the role-based RPC. Generic search rows still need enrichment.
 const complete=provided&&'sex'in provided&&'clinic'in provided;
 const cached=context?.records[memberId],request=context?.request;
 useEffect(()=>{
  if(complete||cached!==undefined)return;
  if(request){request(memberId);return;}
  let current=true;
  void readStaffChatMemberIdentities([memberId]).then(rows=>{if(current)setSingle({id:memberId,identity:rows?.find(row=>row.id===memberId)??null});},()=>{if(current)setSingle({id:memberId,identity:null});});
  return()=>{current=false;};
 },[memberId,complete,cached,request]); // Only request changes, never record-map identity.
 return complete?provided:context?cached:single&&single.id===memberId?single.identity:undefined;
}

export function ChatMemberIdentity({memberId,name,member,locale,className=''}:{memberId:string;name:string|null;member?:IdentityFields;locale:StaffLocale;className?:string}){
 const identity=useChatMemberIdentity(memberId,member);
 return <span data-member-identity={memberId} className={className}>
  <MemberIdentity member={identity??{...member,name}} locale={locale}/>
  {identity===undefined&&<span className="text-caption"> · {st(locale,'Loading identity…','Տվյալները բեռնվում են…','Загрузка данных…')}</span>}
  {identity===null&&<span className="text-caption"> · {st(locale,'Identity unavailable. Reload to try again.','Տվյալներն անհասանելի են։ Թարմացրեք՝ կրկին փորձելու համար։','Данные недоступны. Обновите для повторной попытки.')}</span>}
 </span>;
}

export function MemberDisambiguationCard({rows,locale,busy,onChoose,used=false,className='dcv2-row',actionLabel}:{rows:({id:string}&IdentityFields)[];locale:StaffLocale;busy?:boolean;onChoose:(row:{id:string;name:string})=>void;used?:boolean;className?:string;actionLabel?:string}){
 return <div data-member-disambiguation><p>{st(locale,'Which member do you mean?','Ո՞ր անդամին նկատի ունեք։','Какого участника вы имеете в виду?')}</p>
  {rows.map(row=><IdentityChoice key={row.id} row={row} locale={locale} disabled={busy||used} onChoose={onChoose} buttonClassName={className} actionLabel={actionLabel}/>)}</div>;
}
function IdentityChoice({row,locale,disabled,onChoose,buttonClassName,actionLabel}:{row:{id:string}&IdentityFields;locale:StaffLocale;disabled?:boolean;onChoose:(row:{id:string;name:string})=>void;buttonClassName:string;actionLabel?:string}){
 const identity=useChatMemberIdentity(row.id,row);
 return <button type="button" className={buttonClassName} disabled={disabled||!identity} onClick={()=>{if(identity&&!disabled)onChoose({id:row.id,name:identity.name??row.name??''});}} onPointerDown={event=>event.preventDefault()} onMouseDown={event=>event.preventDefault()}>
  <ChatMemberIdentity memberId={row.id} name={row.name} member={identity??row} locale={locale}/>
  {actionLabel&&<span className="dcv2-tag">{actionLabel}</span>}
 </button>;
}

/** An identity must be readable before a queue row can open its member. */
export function MemberIdentityButton({memberId,name,member,locale,children,disabled,buttonClassName,onClick,...props}:Omit<ButtonHTMLAttributes<HTMLButtonElement>,'name'|'className'>&{memberId:string;name:string|null;member?:IdentityFields;locale:StaffLocale;buttonClassName?:string}){
 const identity=useChatMemberIdentity(memberId,member);
 return <button {...props} type="button" className={buttonClassName} disabled={disabled||!identity} onClick={event=>{if(identity&&!disabled)onClick?.(event);}}>
  <ChatMemberIdentity memberId={memberId} name={name} member={identity??member} locale={locale}/>{children}
 </button>;
}
