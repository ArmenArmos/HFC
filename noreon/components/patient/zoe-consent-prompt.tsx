'use client';
import {useState,useTransition} from 'react';
import {Bot} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {IconTile} from '@/components/patient-care/common';
import {tx,type PatientLocale} from '@/lib/patient/copy';
import {clinicalLocale} from '@/lib/locale';
import {zoeStatement} from '@/lib/zoe/consent-copy';
import {acceptZoePrompt,postponeZoePrompt} from '@/app/patient/account/telegram/zoe-actions';

/**
 * One-time Home card for members who never decided about Zoe reading their messages. "OK"
 * records the grant; "Not now" records nothing and the card returns after a day. STAGING DRAFT
 * WORDING (lib/zoe/consent-copy.ts).
 */
export function ZoeConsentPrompt({locale:l,directAnswers=false}:{locale:PatientLocale;directAnswers?:boolean}){
 const [state,setState]=useState<'open'|'done'|'later'|'error'>('open'),[pending,start]=useTransition();
 if(state==='later')return null;
 if(state==='done')return <p role="status" className="journey-card text-body2">{tx(l,'Պատրաստ է։ Ձեր ընտրությունը պահպանված է։','Done. Your choice is saved.','Готово. Ваш выбор сохранён.')}</p>;
 return <section aria-labelledby="zoe-consent-prompt-title" data-zoe-consent-prompt className="journey-card space-y-4">
  <header className="flex items-center gap-3"><IconTile icon={Bot}/><h2 id="zoe-consent-prompt-title" className="text-h3">{tx(l,'Ծանոթացեք Զոյային','Meet Zoe','Познакомьтесь с Зоей')}</h2></header>
  <p className="text-body2">{zoeStatement(clinicalLocale(l),directAnswers)}</p>
  {state==='error'&&<p role="alert" className="text-body2 text-destructive">{tx(l,'Չհաջողվեց պահպանել։ Փորձեք նորից։','We could not save your choice. Try again.','Не удалось сохранить ваш выбор. Попробуйте снова.')}</p>}
  <div className="flex flex-wrap gap-3">
   <Button type="button" className="min-h-11 flex-1" disabled={pending} onClick={()=>start(async()=>{try{setState((await acceptZoePrompt()).ok?'done':'error');}catch{setState('error');}})}>{tx(l,'Լավ','OK','Хорошо')}</Button>
   <Button type="button" variant="outline" className="min-h-11 flex-1" disabled={pending} onClick={()=>start(async()=>{try{await postponeZoePrompt();}catch{}setState('later');})}>{tx(l,'Ոչ հիմա','Not now','Не сейчас')}</Button>
  </div>
 </section>;
}
