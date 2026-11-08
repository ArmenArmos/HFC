'use client';
import {useActionState,useState} from 'react';
import {pick,type Locale} from '@/lib/locale';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Label} from '@/components/ui/label';
import {sendStaffTelegramCode,verifyStaffTelegramCode,type StaffVerifyState} from '@/app/staff/real/verify/actions';

const idle:StaffVerifyState={status:'idle',message:''};
type Action=(previous:StaffVerifyState,form:FormData)=>Promise<StaffVerifyState>;
/** Telegram second step. Staff workspace by default; the clinic portal passes its own actions and language. */
export function StaffTelegramVerifyForm({send=sendStaffTelegramCode as Action,verify=verifyStaffTelegramCode as Action,locale='en',next=''}:{send?:Action;verify?:Action;locale?:Locale;next?:string}){
 const t=(en:string,hy:string,ru:string)=>pick(locale,{en,hy,ru});
 const [sent,sendAction,sending]=useActionState(send,idle);
 const [checked,check,checking]=useActionState(verify,idle);
 const message=checked.status==='error'?checked:sent;
 // The code field appears once a code is sent, or when the person says they already have one.
 const [haveCode,setHaveCode]=useState(false);
 const showCode=haveCode||sent.status==='sent'||checked.status==='error';
 return <div className="space-y-4">
  <form action={sendAction}><input type="hidden" name="locale" value={locale}/><Button type="submit" variant={sent.status==='sent'?'outline':'default'} className="h-11 w-full" disabled={sending}>{sending?t('Sending…','Ուղարկվում է…','Отправляется…'):sent.status==='sent'?t('Send a new code','Ուղարկել նոր կոդ','Отправить новый код'):t('Send me a code','Ուղարկել կոդը','Отправить мне код')}</Button></form>
  {!showCode&&<button type="button" className="min-h-11 text-body2 underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-ring" onClick={()=>setHaveCode(true)}>{t('I already have a code','Արդեն ունեմ կոդ','У меня уже есть код')}</button>}
  {showCode&&<form action={check} className="space-y-3"><input type="hidden" name="next" value={next}/>
   <input type="hidden" name="locale" value={locale}/>
   <div className="space-y-2"><Label htmlFor="staff-code">{t('6-digit code','Վեցանիշ կոդ','6-значный код')}</Label><Input id="staff-code" name="code" className="h-12 text-base" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required disabled={checking}/></div>
   <Button type="submit" className="h-11 w-full" disabled={checking}>{checking?t('Checking…','Ստուգվում է…','Проверяется…'):t('Confirm and continue','Հաստատել և շարունակել','Подтвердить и продолжить')}</Button>
  </form>}
  {message.message&&<p role={message.status==='error'?'alert':'status'} className={message.status==='error'?'text-body2 text-destructive':'text-body2'}>{message.message}</p>}
 </div>;
}
