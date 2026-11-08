'use client';
import {startTransition,useActionState,useEffect,useRef,useState} from 'react';
import {useRouter} from 'next/navigation';
import {requestRealStaffRecovery,verifyRealStaffRecovery,resetRealStaffPassword,confirmRealStaffPasswordReset,type RecoveryActionState} from '@/lib/staff/real-recovery-actions';
const initial:RecoveryActionState={ok:false,message:''};
const button='min-h-11 rounded-md bg-primary px-4 py-2 text-body2 text-primary-foreground disabled:opacity-50';
const input='mt-1 min-h-11 w-full rounded-md border bg-background px-3 py-2 text-body2';
function Feedback({state}:{state:RecoveryActionState}){return state.message?<p role={state.ok?'status':'alert'} className="text-body2">{state.message}</p>:null;}
export function RequestStaffRecoveryForm({staffId,version,requestId,disabled=false}:{staffId:string;version:string;requestId:string;disabled?:boolean}){
 const router=useRouter();const [operation]=useState({version,requestId});
 const [state,action,pending]=useActionState(async(previous:RecoveryActionState,data:FormData)=>{try{const next=await requestRealStaffRecovery(previous,data);router.refresh();return next;}catch{router.refresh();return {ok:false,outcomeUnknown:true,message:'Recovery is unconfirmed. Reload the directory before requesting another link.'};}},initial);
 return <form action={action} aria-label="Send password recovery" aria-busy={pending} className="space-y-2">
  <input type="hidden" name="staffId" value={staffId}/><input type="hidden" name="expectedVersion" value={operation.version}/><input type="hidden" name="requestId" value={operation.requestId}/>
  <p className="text-caption text-muted-foreground">Send a recovery link to the account email. Wait one minute between requests.</p>
  <button disabled={disabled||pending||!!state.operationCreated||!!state.outcomeUnknown||version!==operation.version} className={button}>{pending?'Sending recovery…':'Send password recovery'}</button>
  <Feedback state={state}/>{(state.operationCreated||state.outcomeUnknown||version!==operation.version)&&<a href="/staff/real/doctors" className="inline-flex min-h-11 items-center underline">Reload directory</a>}
 </form>;
}
type LinkPayload={token:string;operationId:string;generation:string;type:'recovery'};
export function parseRecoveryLink(fragment:string):LinkPayload|null{
 if(fragment.length>1024)return null;const fields=new URLSearchParams(fragment.replace(/^#/,'')),keys=['token','operation','generation','type'];
 if(keys.some(key=>fields.getAll(key).length!==1)||[...fields.keys()].some(key=>!keys.includes(key)))return null;
 const token=fields.get('token')??'',operationId=fields.get('operation')??'',generation=fields.get('generation')??'';
 if(!/^[A-Za-z0-9_-]{32,256}$/.test(token)||! /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(operationId)||! /^[1-9]\d{0,9}$/.test(generation)||Number(generation)>2147483647||fields.get('type')!=='recovery')return null;
 return {token,operationId,generation,type:'recovery'};
}
export function VerifyStaffRecoveryForm({ready=true}:{ready?:boolean}){
 const [payload,setPayload]=useState<LinkPayload|null|undefined>();const parsed=useRef(false);
 const [state,action,pending]=useActionState(verifyRealStaffRecovery,initial);
 useEffect(()=>{if(parsed.current)return;parsed.current=true;const value=parseRecoveryLink(window.location.hash);window.history.replaceState(null,'',window.location.pathname);startTransition(()=>setPayload(value));},[]);
 if(!ready)return <p role="status">Password recovery is unavailable. Contact your administrator.</p>;
 if(payload===undefined)return <p role="status">Checking your recovery link…</p>;
 if(!payload)return <p role="alert">Open the link in your recovery email again. If it still does not work, ask your administrator for a new link.</p>;
 return <form action={action} aria-label="Verify password recovery" aria-busy={pending} className="space-y-4">
  {Object.entries(payload).map(([key,value])=><input key={key} type="hidden" name={key} value={value}/>)}
  <button disabled={pending||state.ok} className={button}>{pending?'Verifying email…':'Verify email for recovery'}</button><Feedback state={state}/>
 </form>;
}
function PasswordFields({disabled}:{disabled:boolean}){
 const [password,setPassword]=useState(''),[confirmation,setConfirmation]=useState('');
 return <fieldset disabled={disabled} className="space-y-3"><label className="block text-body2">New password<input name="password" type="password" value={password} onChange={e=>setPassword(e.target.value)} required minLength={12} maxLength={128} autoComplete="new-password" className={input}/></label><label className="block text-body2">Confirm new password<input name="confirmation" type="password" value={confirmation} onChange={e=>setConfirmation(e.target.value)} required minLength={12} maxLength={128} autoComplete="new-password" className={input}/></label><p className="text-caption text-muted-foreground">Use at least 12 characters. Sign in with your new password after recovery.</p></fieldset>;
}
export function ResetStaffPasswordForm(){
 const [state,action,pending]=useActionState(resetRealStaffPassword,initial);
 if(state.restartRequired)return <Feedback state={state}/>;
 if(state.passwordSaved)return <div className="space-y-4"><Feedback state={state}/><ConfirmStaffPasswordResetForm/></div>;
 return <form action={action} aria-label="Reset your staff password" aria-busy={pending} className="space-y-4"><PasswordFields disabled={pending||state.ok}/><button disabled={pending||state.ok} className={button}>{pending?'Saving password…':'Reset password'}</button><Feedback state={state}/></form>;
}
export function ConfirmStaffPasswordResetForm(){
 const [state,action,pending]=useActionState(confirmRealStaffPasswordReset,initial);
 return <form action={action} aria-label="Confirm password reset" aria-busy={pending} className="space-y-4"><button disabled={pending||state.ok} className={button}>{pending?'Confirming reset…':'Retry confirmation'}</button><Feedback state={state}/></form>;
}
