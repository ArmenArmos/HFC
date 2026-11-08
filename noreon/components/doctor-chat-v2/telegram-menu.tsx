'use client';
import {startTransition,useState} from 'react';
import {st,type StaffLocale} from '@/lib/staff/staff-locale-copy';
import {connectDoctorTelegram,disconnectDoctorTelegram,verifyDoctorTelegram} from '@/lib/doctor-telegram/actions';

export function DoctorTelegramMenu({locale:l,connected:initial,onConnectionChange}:{locale:StaffLocale;connected:boolean;onConnectionChange?:(connected:boolean)=>void}){
 const [connected,setConnected]=useState(initial),[step,setStep]=useState<'idle'|'password'|'code'>('idle'),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const t=(en:string,hy:string,ru:string)=>st(l,en,hy,ru);
 function run(form?:FormData){
  if(busy)return;setBusy(true);setError('');
  startTransition(async()=>{
   try{
    const result=connected?await disconnectDoctorTelegram():step==='code'?await verifyDoctorTelegram(form!):await connectDoctorTelegram(form!);
    if(result.kind==='connected'){setConnected(true);onConnectionChange?.(true);setStep('idle');}
    else if(result.kind==='disconnected'){setConnected(false);onConnectionChange?.(false);setStep('idle');}
    else if(result.kind==='code')setStep('code');
    else setError(result.kind==='password'?t('Wrong password.','Սխալ գաղտնաբառ։','Неверный пароль.'):result.kind==='invalid'?t('Incorrect code. Try again.','Սխալ կոդ։ Փորձեք նորից։','Неверный код. Попробуйте снова.'):t('Could not connect. Try again.','Չհաջողվեց կապվել։ Փորձեք նորից։','Не удалось подключиться. Попробуйте снова.'));
   }catch{setError(t('Could not connect. Try again.','Չհաջողվեց կապվել։ Փորձեք նորից։','Не удалось подключиться. Попробуйте снова.'));}
   finally{setBusy(false);}
  });
 }
 return <section className="dtg-menu" aria-label="Telegram">
  {connected?<button type="button" disabled={busy} onClick={()=>run()}>{t('Disconnect Telegram','Անջատել Telegram-ը','Отключить Telegram')}</button>:step==='idle'?<button type="button" onClick={()=>setStep('password')}>{t('Connect Telegram','Կապել Telegram-ը','Подключить Telegram')}</button>:
   <form action={run}>
    <label>{step==='code'?t('Telegram code','Telegram-ի կոդ','Код из Telegram'):t('Your password','Ձեր գաղտնաբառը','Ваш пароль')}
     {step==='code'?<input key="code" name="code" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} autoComplete="one-time-code" required disabled={busy}/>:<input key="password" name="password" type="password" autoComplete="current-password" maxLength={4096} required disabled={busy}/>}
    </label>
    <button type="submit" disabled={busy}>{busy?t('Connecting…','Կապվում է…','Подключение…'):step==='code'?t('Confirm code','Հաստատել կոդը','Подтвердить код'):t('Connect Telegram','Կապել Telegram-ը','Подключить Telegram')}</button>
    <button type="button" disabled={busy} onClick={()=>{setStep('idle');setError('');}}>{t('Cancel','Չեղարկել','Отмена')}</button>
   </form>}
  {error&&<p role="alert">{error}</p>}
  {connected&&<p role="status">{t('Connected to Noreon','Կապված է Noreon-ին','Подключено к Noreon')}</p>}
 </section>;
}
