import {pick,type Locale} from '@/lib/locale';
import type {RegimenChange,RegimenMedicine} from '@/lib/patient-care/regimen';
const times=(t:readonly string[])=>t.join(', ');
/** One line per recorded change, in the doctor's own words for names and doses. Nothing here interprets a change. */
function changeLine(c:RegimenChange,l:Locale){
 const say=(en:string,hy:string,ru:string)=>pick(l,{en,hy,ru});
 switch(c.kind){
  case 'started':return say(`Started: ${c.name}, ${c.dose}, at ${times(c.times)}`,`Սկսված է՝ ${c.name}, ${c.dose}, ժամը ${times(c.times)}`,`Начато: ${c.name}, ${c.dose}, в ${times(c.times)}`);
  case 'stopped':return say(`Stopped: ${c.name}, ${c.dose}`,`Դադարեցված է՝ ${c.name}, ${c.dose}`,`Отменено: ${c.name}, ${c.dose}`);
  case 'dose_changed':return say(`Dose changed: ${c.name}, from ${c.fromDose} to ${c.toDose}`,`Դեղաչափը փոխվել է՝ ${c.name}, ${c.fromDose}-ից ${c.toDose}`,`Изменена доза: ${c.name}, с ${c.fromDose} на ${c.toDose}`);
  case 'schedule_changed':return say(`Times changed: ${c.name}, from ${times(c.fromTimes)} to ${times(c.toTimes)}`,`Ժամերը փոխվել են՝ ${c.name}, ${times(c.fromTimes)}-ից ${times(c.toTimes)}`,`Изменено время: ${c.name}, с ${times(c.fromTimes)} на ${times(c.toTimes)}`);
  case 'instructions_changed':return say(`Instructions changed: ${c.name}`,`Ցուցումները փոխվել են՝ ${c.name}`,`Изменены указания: ${c.name}`);
 }
}
export function RegimenChanges({changes,locale}:{changes:readonly RegimenChange[];locale:Locale}){
 return <ul className="space-y-1">{changes.map(c=><li key={`${c.kind}:${c.name}`} data-change={c.kind} className={`break-words text-body2${c.kind==='stopped'?' font-semibold':''}`}>{changeLine(c,locale)}</li>)}</ul>;
}
export function RegimenList({medicines}:{medicines:readonly RegimenMedicine[]}){
 return <ul className="divide-y">{medicines.map(m=><li key={m.name} className="min-w-0 py-2"><p className="break-words text-body2 font-medium">{m.name} · {m.dose}</p><p className="break-words text-caption text-muted-foreground">{[times(m.times),m.instructions].filter(Boolean).join(' · ')}</p></li>)}</ul>;
}
