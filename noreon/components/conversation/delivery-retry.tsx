'use client';
import {useRef,useState} from 'react';
import {canRetryDelivery,retryFailureText,retryLabel,type DeliveryState} from '@/lib/telegram-runtime/delivery-copy';
import {retryDeliveryResultSchema} from '@/lib/conversation-persistence/contracts';
import {st,type StaffLocale} from '@/lib/staff/staff-locale-copy';

/** Eligibility is a server decision. A repeated request is idempotent in SQL. */
export function DeliveryRetry({delivery,locale,retry}:{delivery:{id:string;state:DeliveryState;reason:string|null;can_retry?:boolean};locale:StaffLocale;retry?:(id:string)=>Promise<unknown>}){
 const locked=useRef(false),[busy,setBusy]=useState(false),[notice,setNotice]=useState('');
 if(!retry||!canRetryDelivery(delivery))return null;
 async function request(){
  if(locked.current)return;locked.current=true;setBusy(true);setNotice('');
  try{
   const result=retryDeliveryResultSchema.parse(await retry!(delivery.id));
   setNotice(result.ok?st(locale,'Retry queued. Waiting for Telegram to accept it.','Կրկին ուղարկումը հերթում է։ Սպասում ենք, որ Telegram-ն ընդունի այն։','Повторная отправка в очереди. Ожидаем, когда Telegram примет сообщение.'):retryFailureText(result.code,locale));
  }catch{setNotice(st(locale,'The retry result could not be confirmed. Reload the conversation to check its status.','Կրկին ուղարկման արդյունքը չհաջողվեց հաստատել։ Կարգավիճակը ստուգելու համար թարմացրեք զրույցը։','Не удалось подтвердить результат повторной отправки. Обновите разговор, чтобы проверить статус.'));}
  finally{locked.current=false;setBusy(false);}
 }
 return <div><button type="button" data-delivery-retry={delivery.id} disabled={busy} onClick={()=>void request()} className="min-h-12 rounded-md border px-4 py-2 text-body2 font-semibold hover:bg-muted disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">{retryLabel(locale)}</button>{notice&&<p role="status" className="text-body2">{notice}</p>}</div>;
}
