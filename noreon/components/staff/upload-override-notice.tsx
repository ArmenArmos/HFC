import {stamp} from '@/components/patient-care/common';
import {st,type StaffLocale} from '@/lib/staff/staff-locale-copy';
import type {UploadOverride} from '@/lib/staff/upload-overrides';
/** "Attached despite a mismatch": shown to the admin and the assigned doctor or nurse so they check the file. */
export function UploadOverrideNotice({rows,locale}:{rows:UploadOverride[];locale:StaffLocale}){
 if(!rows.length)return null;
 const what=(m:UploadOverride['mismatch'])=>m==='name'?st(locale,'name','անունը',"имя"):m==='birth_date'?st(locale,'date of birth','ծննդյան ամսաթիվը',"дата рождения"):st(locale,'name and date of birth','անունը և ծննդյան ամսաթիվը',"имя и дата рождения");
 return <section role="note" aria-labelledby="upload-override" className="space-y-2 rounded-lg border border-destructive bg-background p-4">
  <h2 id="upload-override" className="text-h3">{st(locale,'Attached despite a mismatch','Կցված է՝ չնայած անհամապատասխանությանը',"Прикреплено при несовпадении данных")}</h2>
  <p className="text-body2 text-muted-foreground">{st(locale,'The clinic attached these lab PDFs although the sheet did not match this member. Check the person on each sheet before using its values.','Կլինիկան կցել է այս լաբորատոր PDF-ները, թեև թերթիկը չէր համապատասխանում այս անդամին։ Արժեքներն օգտագործելուց առաջ ստուգեք յուրաքանչյուր թերթիկի անձը։',"Клиника прикрепила эти PDF с результатами анализов, хотя данные в бланке не совпадали с данными участника. Проверьте, кому принадлежит каждый бланк, прежде чем использовать значения.")}</p>
  <ul className="divide-y">{rows.map(r=><li key={r.fileId} className="space-y-1 py-2 text-body2"><p className="break-words font-medium">{r.fileName}</p>
   <p className="text-caption text-muted-foreground">{r.clinicName} · {stamp(r.at,locale)} · {st(locale,'Differed:','Տարբերվել է՝',"Не совпали:")} {what(r.mismatch)}</p>
   <p className="break-words text-caption">{st(locale,'Sheet:','Թերթիկ՝',"Бланк:")} {r.sheet.name??'–'}, {r.sheet.birthDate??'–'} · {st(locale,'Member:','Անդամ՝',"Участник:")} {r.member.name??'–'}, {r.member.birthDate??'–'}{r.reason?` · ${st(locale,'Reason:','Պատճառ՝',"Причина:")} ${r.reason}`:''}</p></li>)}</ul>
 </section>;
}
