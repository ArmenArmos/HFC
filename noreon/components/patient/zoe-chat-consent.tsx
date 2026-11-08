'use client';
import {useState,useTransition} from 'react';
import {Bot} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {IconTile} from '@/components/patient-care/common';
import {tx,type PatientLocale} from '@/lib/patient/copy';
import {consentLines} from '@/lib/zoe-chat-actions/consent-text';
import {acceptZoeConsentShown} from '@/lib/zoe-chat-actions/onboarding-actions';
import {acceptZoeFromChat} from '@/app/patient/account/telegram/zoe-actions';

/**
 * Inline card on the Zoe chat for a member without a current Zoe grant (lead 18 Oct 16:09: a member who
 * signed up before consent at sign-up could not find where to turn Zoe on). The same statement and
 * wording version as sign-up; "Agree and turn on" records the grant (source zoe_screen); "Not now"
 * records nothing and hides the card until the next visit. Messages reach the care team either way.
 * STAGING DRAFT WORDING.
 */
export function ZoeChatConsent({locale:l,directAnswers=false,onResolved,shownText=false}:{locale:PatientLocale;directAnswers?:boolean;onResolved?:(accepted:boolean)=>void;
 /** V3: the card adds what is collected and who sees it, and the grant stores the hash of the text shown. */shownText?:boolean}){
 const [state,setState]=useState<'open'|'done'|'later'|'error'>('open'),[pending,start]=useTransition();
 if(state==='later')return null;
 if(state==='done')return <p role="status" className="journey-card text-body2" data-zoe-chat-consent="done">{tx(l,'Զոյան միացված է։ Գրեք նրան ցանկացած պահի։','Zoe is on. Write to her any time.','Зоя включена. Пишите ей в любое время.')}</p>;
 const c=consentLines(l,directAnswers);
 return <section aria-labelledby="zoe-chat-consent-title" data-zoe-chat-consent className="journey-card space-y-3">
  <header className="flex items-center gap-3"><IconTile icon={Bot}/><h2 id="zoe-chat-consent-title" className="text-h3">{c.title}</h2></header>
  <p className="text-body2">{c.lead}</p>
  <p className="text-body2">{c.statement}</p>
  <p className="text-caption text-muted-foreground">{c.either}</p>
  {shownText&&<details className="cv2-consent-more" data-zoe-consent-more><summary>{c.moreTitle}</summary>{c.more.map(line=><p key={line} className="text-body2">{line}</p>)}</details>}
  {state==='error'&&<p role="alert" className="text-body2 text-destructive">{tx(l,'Չհաջողվեց պահպանել։ Փորձեք նորից։','We could not save your choice. Try again.','Не удалось сохранить ваш выбор. Попробуйте снова.')}</p>}
  <div className="flex flex-wrap gap-3">
   <Button type="button" className="min-h-11 flex-1" disabled={pending} aria-busy={pending} onClick={()=>start(async()=>{try{const saved=(await (shownText?acceptZoeConsentShown({locale:l,directAnswers}):acceptZoeFromChat())).ok;setState(saved?'done':'error');if(saved)onResolved?.(true);}catch{setState('error');}})}>{tx(l,'Համաձայն եմ, միացնել','Agree and turn on','Согласиться и включить')}</Button>
   <Button type="button" variant="outline" className="min-h-11 flex-1" disabled={pending} onClick={()=>{setState('later');onResolved?.(false);}}>{tx(l,'Ոչ հիմա','Not now','Не сейчас')}</Button>
  </div>
 </section>;
}
