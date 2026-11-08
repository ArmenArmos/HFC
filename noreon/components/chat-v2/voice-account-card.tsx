"use client";
import {BellRing} from "lucide-react";
import {ZoeAccount} from "@/components/patient/zoe-account";
import {zoeName} from "@/lib/brand";
import {tx,type PatientLocale} from "@/lib/patient/copy";
import type {ValidCard,ZoeCard} from "@/lib/zoe-chat-actions/registry";

/**
 * WP V: the reminders settings card a spoken request opens ("remind me at 20:00"). It is the existing account card
 * (ZoeAccount, its own forms, validation and save), opened on the reminders section. What was asked is shown above the
 * form; nothing is saved until the member presses save or says yes to the spoken read-back.
 */
export function VoiceAccountCard({card,locale:l,onCard,requested}:{card:Extract<ValidCard,{kind:"account"}>;locale:PatientLocale;onCard:(card:ZoeCard)=>void;requested?:{time:string;target:"bp"|"medicine"}|null}){
 return <article className="cv2-msg cv2-zoe" data-zoe-card="account" data-chat-card-id={card.id} tabIndex={-1}>
  <p className="cv2-from"><i className="cv2-orb" aria-hidden />{zoeName(l)}</p>
  <div className="cv2-block">
   <h3><BellRing size={18} aria-hidden />{tx(l,"Հիշեցումներ","Reminders","Напоминания")}</h3>
   {requested&&<p>{requested.target==="bp"
    ?tx(l,`Դուք խնդրեցիք ճնշումը չափելու հիշեցում ժամը ${requested.time}-ին։`,`You asked for a reminder to measure your blood pressure at ${requested.time}.`,`Вы попросили напоминание измерить давление в ${requested.time}.`)
    :tx(l,"Դուք խնդրեցիք դեղերի հիշեցում։ Դրանք գալիս են ձեր պլանի ժամերին։","You asked for medicine reminders. They come at the times in your plan.","Вы попросили напоминания о лекарствах. Они приходят во время, указанное в вашем плане.")}</p>}
   <ZoeAccount card={card} locale={l} onCard={onCard} initialSection="reminders"/>
   {requested&&card.state==="open"&&<p className="cv2-voice-hint">{tx(l,"Ասեք «այո»՝ պահպանելու համար","Say yes to save","Скажите «да», чтобы сохранить")}</p>}
  </div>
 </article>;
}
