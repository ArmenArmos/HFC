'use client';
import {useState,useTransition} from 'react';
import {VoiceMicrophone} from '@/components/chat-v2/conversation';
import {st,type StaffLocale} from '@/lib/staff/staff-locale-copy';
import {confirmStaffCardByVoice,issueStaffVoiceConfirmation} from '@/lib/staff-zoe/voice-confirm-actions';
import type {CareAlert} from '@/lib/care-alerts/contracts';

/**
 * WP V: acknowledge an open care alert by voice. Hold, say yes (or "acknowledge"), release: the recording is transcribed
 * on the server with a staff receipt, the server checks the nonce bound to this alert and its state sequence and the
 * strict confirmation, then runs the same command as the Acknowledge button. A no, or anything else, changes nothing.
 */
export function VoiceAck({alert,locale:l,disabled,onDone}:{alert:Pick<CareAlert,'id'|'stateSeq'>;locale:StaffLocale;disabled:boolean;onDone:(alert:CareAlert|null)=>void}){
 const t=(en:string,hy:string,ru:string)=>st(l,en,hy,ru);
 const [notice,setNotice]=useState(''),[busy,start]=useTransition();
 const heard=(text:string,receipt?:string)=>start(async()=>{
  setNotice('');
  const target={kind:'care_alert_ack'as const,alertId:alert.id,seq:alert.stateSeq};
  const issued=await issueStaffVoiceConfirmation({target}).catch(()=>null);
  if(issued?.status!=='ok'){setNotice(t('Voice confirmation is not available. Use the button.','Ձայնային հաստատումը հասանելի չէ։ Օգտագործեք կոճակը։','Голосовое подтверждение недоступно. Используйте кнопку.'));return;}
  const r=await confirmStaffCardByVoice({target,nonce:issued.nonce,transcript:text,locale:l,origin:'batch',...(receipt?{receipt}:{})}).catch(()=>null);
  if(r?.status==='saved'){setNotice(t('Alert acknowledged.','Ահազանգը հաստատված է։','Оповещение подтверждено.'));onDone((r.alert as CareAlert|undefined)??null);return;}
  setNotice(r?.status==='cancelled'?t('Nothing changed.','Ոչինչ չփոխվեց։','Ничего не изменено.')
   :r?.status==='not_confirmed'?t('Not acknowledged. Say yes, or use the button.','Չհաստատվեց։ Ասեք «այո» կամ օգտագործեք կոճակը։','Не подтверждено. Скажите «да» или используйте кнопку.')
   :r?.status==='changed'||r?.status==='stale'?t('This alert changed. Reload alerts and review the latest signal.','Ահազանգը փոխվել է։ Թարմացրեք ահազանգերը և դիտեք վերջին ազդանշանը։','Оповещение изменилось. Обновите оповещения и проверьте последний сигнал.')
   :t('The change could not be confirmed. Use the button.','Փոփոխությունը չհաջողվեց հաստատել։ Օգտագործեք կոճակը։','Не удалось подтвердить изменение. Используйте кнопку.'));
 });
 return <div className="cv2-voicebar flex-wrap" data-voice-ack={alert.id}>
  <VoiceMicrophone locale={l} endpoint="/api/staff/zoe/voice" disabled={disabled||busy} onBusy={()=>{}} onTranscript={heard}/>
  <p className="text-body2">{t('Hold and say yes to acknowledge','Պահեք և ասեք «այո»՝ հաստատելու համար','Удерживайте и скажите «да», чтобы подтвердить')}</p>
  {notice&&<p role="status" className="text-body2">{notice}</p>}
 </div>;
}
