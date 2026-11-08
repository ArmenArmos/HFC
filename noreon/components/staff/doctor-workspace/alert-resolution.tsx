'use client';
import {useRef,useState} from 'react';
import {stamp} from '@/components/patient-care/common';
import type {Locale} from '@/lib/locale';
import {closeResolutions,resolutionLabel,type CareAlert,type AlertResolution} from '@/lib/care-alerts/contracts';
import {st} from '@/lib/staff/staff-locale-copy';

type Resolution={alertId:string;seq:number;resolution:AlertResolution;note:string};
/** The displayed signal version is retained through confirmation and every outcome. */
export function DoctorAlertResolution({alert,locale,command,onRefresh}:{alert:CareAlert;locale:Locale;onRefresh?:()=>void;command:(input:Resolution)=>Promise<{kind:string;resolvedBy?:string|null;resolvedAt?:string|null}>}){
 const t=(en:string,hy:string,ru:string)=>st(locale,en,hy,ru);
 const [resolution,setResolution]=useState<AlertResolution|' '>(' '),[note,setNote]=useState('');
 const [expanded,setExpanded]=useState(false),[notice,setNotice]=useState(''),[locked,setLocked]=useState(false);
 const [saved,setSaved]=useState(false);
 const [closed,setClosed]=useState<{by:string|null;at:string|null}|null>(null);
 const busy=useRef(false);
 const status=<p className="text-caption">{saved||closed||alert.state==='resolved'?t('Resolved','Լուծված','Закрыто'):alert.state==='acknowledged'?t('Acknowledged','Հաստատված','Подтверждено'):t('Open','Բաց','Открыто')} · {stamp(alert.lastSeenAt,locale)}</p>;
 if(alert.state==='resolved')return <div className="text-body2">{status}<p>{alert.resolution&&resolutionLabel(alert.resolution,locale)}</p><p className="whitespace-pre-wrap">{alert.resolutionNote}</p></div>;
 async function save(){
  if(resolution===' '||!note.trim()||busy.current||locked)return;busy.current=true;setLocked(true);
  const entry={alertId:alert.id,seq:alert.stateSeq,resolution,note};
  try{
   const result=await command(entry);
   if(result.kind==='saved'){setSaved(true);try{onRefresh?.();}catch{/* Confirmed save stays confirmed. */}}
   if(result.kind==='already_resolved')setClosed({by:result.resolvedBy??null,at:result.resolvedAt??null});
   setNotice(result.kind==='saved'?t('Alert resolved.','Ահազանգը լուծված է։','Оповещение закрыто.'):
    result.kind==='already_resolved'?t('Your outcome and note were not saved. Your note is kept here.','Ձեր արդյունքն ու նշումը չեն պահպանվել։ Ձեր նշումը մնացել է այստեղ։','Ваш исход и заметка не сохранены. Ваша заметка остаётся здесь.'):
    result.kind==='changed'?t('The alert changed. Your note is kept here. Reload and review the latest signal before continuing.','Ահազանգը փոխվել է։ Ձեր նշումն այստեղ պահպանված է։ Շարունակելուց առաջ թարմացրեք և ստուգեք վերջին ազդակը։','Оповещение изменилось. Ваша заметка сохранена здесь. Перед продолжением обновите карточку и проверьте последний сигнал.'):
    t('The outcome could not be confirmed. Your note is kept here. Check the current alert before making another change.','Արդյունքը չհաջողվեց հաստատել։ Ձեր նշումն այստեղ պահպանված է։ Նոր փոփոխությունից առաջ ստուգեք ընթացիկ ահազանգը։','Не удалось подтвердить результат. Ваша заметка сохранена здесь. Проверьте текущее оповещение перед новым изменением.'));
  }catch{setNotice(t('The save result is unknown. Your note is kept here. Reload to check the alert before continuing.','Պահպանման արդյունքն անհայտ է։ Ձեր նշումն այստեղ պահպանված է։ Շարունակելուց առաջ թարմացրեք՝ ահազանգը ստուգելու համար։','Результат сохранения неизвестен. Ваша заметка сохранена здесь. Обновите карточку и проверьте оповещение перед продолжением.'));}
  finally{busy.current=false;}
 }
 return <div className="space-y-3">
  {status}
  {saved&&<div className="space-y-2"><p className="text-body2 font-semibold">{resolution!==' '&&resolutionLabel(resolution,locale)}</p><p className="whitespace-pre-wrap text-body2">{note}</p></div>}
  {!expanded&&!saved?<button type="button" className="dw-pill" onClick={()=>setExpanded(true)}>{t('Resolve alert','Լուծել ահազանգը','Закрыть оповещение')}</button>:<form hidden={saved} data-saved={saved||undefined} className="space-y-3" onSubmit={e=>{e.preventDefault();void save();}}>
   <label className="block text-body2">{t('Outcome','Արդյունք','Исход')}<select required disabled={locked} value={resolution} onChange={e=>{setResolution(e.target.value as AlertResolution);}} className="block min-h-11 w-full rounded-md border bg-background px-3"><option value=" " disabled>{t('Choose an outcome','Ընտրեք արդյունքը','Выберите исход')}</option>{closeResolutions.map(r=><option key={r} value={r}>{resolutionLabel(r,locale)}</option>)}</select></label>
   <label className="block text-body2">{t('Resolution note','Լուծման նշում','Заметка о закрытии')}<textarea required maxLength={1000} disabled={locked} value={note} onChange={e=>{setNote(e.target.value);}} className="block min-h-24 w-full rounded-md border bg-background p-3"/></label>
   <p className="text-caption">{t('Resolve approves this outcome and note. Urgent advice and safety holds stay in place.','Լուծելը հաստատում է այս արդյունքն ու նշումը։ Շտապ խորհուրդն ու անվտանգության սահմանափակումները մնում են ուժի մեջ։','Закрытие подтверждает этот исход и заметку. Срочные рекомендации и ограничения безопасности сохраняются.')}</p>
   <button className="dw-pill" disabled={locked||resolution===' '||!note.trim()}>{t('Resolve this alert','Լուծել այս ահազանգը','Закрыть это оповещение')}</button>
  </form>}
  {closed&&<p className="text-body2">{t('Already resolved by','Արդեն լուծված է՝','Уже закрыто:')} {closed.by??t('Name unavailable','Անունն անհասանելի է','Имя недоступно')} · {closed.at?<time dateTime={closed.at}>{stamp(closed.at,locale)}</time>:t('Time unavailable','Ժամը հասանելի չէ','Время недоступно')}</p>}
  {notice&&<p role="status" className="text-body2">{notice}</p>}
 </div>;
}
