'use client';
import {useState} from 'react';
import type {Locale} from '@/lib/locale';
import {st} from '@/lib/staff/staff-locale-copy';

/** Editors with their own recovery use that control; other entry cards require explicit discard. */
export function DoctorCardReload({locale,pending,confirmDiscard,onReload}:{locale:Locale;pending:boolean;confirmDiscard:boolean|(()=>boolean);onReload:()=>Promise<void>}){
 const [confirm,setConfirm]=useState(false),[busy,setBusy]=useState(false);
 const needsConfirmation=()=>typeof confirmDiscard==='function'?confirmDiscard():confirmDiscard;
 const t=(en:string,hy:string,ru:string)=>st(locale,en,hy,ru);
 async function reload(){if(busy)return;setBusy(true);try{await onReload();}finally{setBusy(false);}}
 return <div className="space-y-2">
  <button type="button" disabled={pending||busy} className="dw-pill" onClick={()=>needsConfirmation()?setConfirm(true):void reload()}>{t('Refresh','Թարմացնել','Обновить')}</button>
  {confirm&&needsConfirmation()&&<div className="space-y-2" role="alert"><p className="text-body2">{t('Reloading clears the entries on this card. Keep a copy of any unsaved text first. If a save was uncertain, check the saved record before entering it again.','Թարմացումը մաքրում է այս քարտի մուտքագրված տվյալները։ Նախ պատճենեք չպահպանված տեքստը։ Եթե պահպանման արդյունքն անհայտ էր, կրկին մուտքագրելուց առաջ ստուգեք պահպանված գրառումը։','Обновление очистит введённые данные в этой карточке. Сначала скопируйте несохранённый текст. Если результат сохранения неизвестен, проверьте сохранённую запись перед повторным вводом.')}</p>
   <button type="button" disabled={pending||busy} className="dw-pill" onClick={()=>void reload()}>{t('Clear entries and reload','Մաքրել մուտքագրվածը և թարմացնել','Очистить данные и обновить')}</button>{' '}
   <button type="button" disabled={pending||busy} className="dw-pill" onClick={()=>setConfirm(false)}>{t('Keep my entries','Պահել մուտքագրվածը','Сохранить введённые данные')}</button>
  </div>}
 </div>;
}
