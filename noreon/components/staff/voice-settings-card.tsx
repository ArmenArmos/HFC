'use client';
import {useEffect,useRef,useState,useTransition} from 'react';
import {st,type StaffLocale} from '@/lib/staff/staff-locale-copy';
import {readVoiceSettingsAdmin,updateVoiceSettingsAdmin} from '@/lib/staff-zoe/voice-settings-actions';
import type {VoiceSettingsHistory,VoiceSettingsView} from '@/lib/staff-zoe/voice-settings-schema';

/**
 * WP V: the Noreon administrator's voice settings card in the operations chat. It shows the current switches and the
 * recent changes, and saves only on an explicit press, against the version it showed (a change made elsewhere since
 * then is refused as stale). Every save bumps the version and is recorded in the audit trail by the database.
 */
const FIELD_NAMES:Record<string,[string,string,string]>={enabled:['Voice','Ձայն','Голос'],live_enabled:['Live transcription','Ուղիղ տառադարձում','Потоковое распознавание'],
 live_model:['Live model','Ուղիղ մոդել','Модель Live'],stt_model:['Speech-to-text model','Խոսքից տեքստ մոդել','Модель распознавания'],stt_urgent_model:['Urgent check model','Շտապ ստուգման մոդել','Модель срочной проверки'],
 tts_model:['Speech model','Խոսքի մոդել','Модель речи'],tts_voice:['Voice name','Ձայնի անուն','Имя голоса'],tts_instructions:['Speech style','Խոսքի ոճ','Стиль речи']};

export function VoiceSettingsCard({locale:l,onClose}:{locale:StaffLocale;onClose?:()=>void}){
 const t=(en:string,hy:string,ru:string)=>st(l,en,hy,ru);
 const [settings,setSettings]=useState<VoiceSettingsView|null>(null),[history,setHistory]=useState<VoiceSettingsHistory>([]);
 const [status,setStatus]=useState<'loading'|'ready'|'access'|'unavailable'>('loading'),[notice,setNotice]=useState('');
 const [draft,setDraft]=useState<{enabled:boolean;liveEnabled:boolean;liveModel:string}|null>(null);
 const [busy,start]=useTransition();const request=useRef<string|null>(null);
 const load=()=>{void readVoiceSettingsAdmin().then(r=>{
  if(r.status==='ok'){setSettings(r.settings);setHistory(r.history);setDraft({enabled:r.settings.enabled,liveEnabled:r.settings.liveEnabled,liveModel:r.settings.liveModel});setStatus('ready');}
  else setStatus(r.status);
 },()=>setStatus('unavailable'));};
 useEffect(load,[]);
 if(status!=='ready'||!settings||!draft)return <section className="space-y-2 rounded-xl bg-card p-4" aria-label={t('Voice settings','Ձայնի կարգավորումներ','Настройки голоса')}>
  <h2 className="text-h3">{t('Voice settings','Ձայնի կարգավորումներ','Настройки голоса')}</h2>
  <p role={status==='loading'?'status':'alert'} className="text-body2">{status==='loading'?t('Reading the settings…','Կարդում եմ կարգավորումները…','Загружаю настройки…'):status==='access'?t('Only a Noreon administrator can change voice settings.','Ձայնի կարգավորումները կարող է փոխել միայն Նորեոն Հելթի ադմինիստրատորը։','Настройки голоса может менять только администратор Нореон Хелс.'):t('The settings could not be read. Try again.','Կարգավորումները չհաջողվեց կարդալ։ Փորձեք կրկին։','Не удалось загрузить настройки. Попробуйте ещё раз.')}</p>
 </section>;
 const patch={...(draft.enabled!==settings.enabled?{enabled:draft.enabled}:{}),...(draft.liveEnabled!==settings.liveEnabled?{live_enabled:draft.liveEnabled}:{}),...(draft.liveModel.trim()!==settings.liveModel?{live_model:draft.liveModel.trim()}:{})};
 const changed=Object.keys(patch).length>0;
 const save=()=>{
  if(!changed||busy)return;
  request.current??=crypto.randomUUID();
  const requestId=request.current;
  start(async()=>{
   setNotice('');
   const r=await updateVoiceSettingsAdmin({requestId,expectedVersion:settings.version,patch}).catch(()=>({status:'unavailable'as const}));
   if(r.status==='saved'||r.status==='unchanged'){request.current=null;setNotice(t('Saved. The new settings apply within a minute.','Պահպանված է։ Նոր կարգավորումները կգործեն մեկ րոպեի ընթացքում։','Сохранено. Новые настройки начнут действовать в течение минуты.'));load();}
   else if(r.status==='stale'){request.current=null;setNotice(t('The settings changed since you opened them. Check the current values and save again.','Կարգավորումները փոխվել են բացելուց հետո։ Ստուգեք ընթացիկ արժեքները և նորից պահպանեք։','Настройки изменились после открытия. Проверьте текущие значения и сохраните снова.'));load();}
   else setNotice(r.status==='invalid'?t('Check the model name.','Ստուգեք մոդելի անունը։','Проверьте название модели.'):r.status==='access'?t('Only a Noreon administrator can change voice settings.','Ձայնի կարգավորումները կարող է փոխել միայն Նորեոն Հելթի ադմինիստրատորը։','Настройки голоса может менять только администратор Нореон Хелс.'):t('Not saved. Try again.','Չպահպանվեց։ Փորձեք կրկին։','Не сохранено. Попробуйте ещё раз.'));
  });
 };
 return <section className="space-y-4 rounded-xl bg-card p-4" aria-label={t('Voice settings','Ձայնի կարգավորումներ','Настройки голоса')} data-voice-settings>
  <h2 className="text-h3">{t('Voice settings','Ձայնի կարգավորումներ','Настройки голоса')}</h2>
  <p className="text-caption text-muted-foreground">{t('Version','Տարբերակ','Версия')} {settings.version}</p>
  <fieldset disabled={busy} className="space-y-3">
   <label className="flex min-h-11 items-center gap-3 text-body2"><input type="checkbox" className="size-6" checked={draft.enabled} onChange={e=>setDraft({...draft,enabled:e.target.checked})}/>{t('Voice for members and staff','Ձայն անդամների և աշխատակիցների համար','Голос для участников и сотрудников')}</label>
   <label className="flex min-h-11 items-center gap-3 text-body2"><input type="checkbox" className="size-6" checked={draft.liveEnabled} onChange={e=>setDraft({...draft,liveEnabled:e.target.checked})}/>{t('Live transcription (Gemini Live; also needs the deployment switch)','Ուղիղ տառադարձում (Gemini Live, պահանջում է նաև տեղակայման անջատիչը)','Потоковое распознавание (Gemini Live; нужен также переключатель развёртывания)')}</label>
   <label className="block space-y-1 text-body2"><span>{t('Live model (text responses)','Ուղիղ մոդել (տեքստային պատասխաններ)','Модель Live (текстовые ответы)')}</span>
    <input type="text" className="block min-h-11 w-full rounded-md border bg-background px-3" value={draft.liveModel} maxLength={86} onChange={e=>setDraft({...draft,liveModel:e.target.value})}/></label>
  </fieldset>
  <p className="text-body2 text-muted-foreground">{t('Zoe never speaks with Live audio. Live only turns speech into text; every reply still passes the safety checks before it is spoken.','Զոյան երբեք չի խոսում Live ձայնով։ Live-ը միայն խոսքը տեքստի է վերածում, իսկ յուրաքանչյուր պատասխան անցնում է անվտանգության ստուգումները, նախքան հնչելը։','Зоя никогда не говорит голосом Live. Live только превращает речь в текст; каждый ответ проходит проверки безопасности, прежде чем прозвучать.')}</p>
  <div className="flex flex-wrap gap-2">
   <button type="button" className="dw-pill min-h-11" disabled={busy||!changed} aria-busy={busy} onClick={save}>{t('Save voice settings','Պահպանել ձայնի կարգավորումները','Сохранить настройки голоса')}</button>
   {onClose&&<button type="button" className="min-h-11 underline" disabled={busy} onClick={onClose}>{t('Close','Փակել','Закрыть')}</button>}
  </div>
  {notice&&<p role="status" className="text-body2">{notice}</p>}
  {history.length>0&&<details><summary className="min-h-11 cursor-pointer content-center text-body2">{t('Recent changes','Վերջին փոփոխությունները','Последние изменения')}</summary>
   <ul className="space-y-1 text-body2">{history.map(h=><li key={`${h.toVersion}:${h.at}`}><time dateTime={h.at}>{h.at.replace('T',' ').replace(/\.\d+Z$/,' UTC')}</time> · {t('version','տարբերակ','версия')} {h.toVersion} · {h.changed.map(c=>st(l,...(FIELD_NAMES[c]??[c,c,c]))).join(', ')}</li>)}</ul>
  </details>}
 </section>;
}
