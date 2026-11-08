import {AI_READ_LABEL} from '@/lib/lab-ai/provenance';
import type {Locale} from '@/lib/locale';
import {AlertTriangle,Bot} from 'lucide-react';
import type {LabOverview} from '@/lib/lab-ai/doctor-schema';

type File=LabOverview['files'][number];
const enCopy={label:'Values read by AI',unavailable:'AI reading status is unavailable. Reload to check it.',notRequested:'Not read yet.',queued:'Waiting to be read.',running:'Being read now.',rejected:'Not read: the file broke a limit.',failed:'Reading failed.',
  done:(n:number,u:number,a:number,auto:number)=>`${n} values read, ${u} not checked yet${auto?`, ${auto} ${AI_READ_LABEL.en}`:''}${a?`, ${a} need your attention`:''}.`,none:'Read; no values to check.',open:'Check values and AI summary',ai:'Prepared by AI | Not reviewed by a doctor'};
const copy:Record<Locale,typeof enCopy>={
 en:enCopy,
 hy:{label:'AI-ի կարդացած արժեքներ',unavailable:'AI կարդալու կարգավիճակն անհասանելի է։ Թարմացրեք էջը։',notRequested:'Դեռ չի կարդացվել։',queued:'Սպասում է կարդալուն։',running:'Կարդացվում է։',rejected:'Չի կարդացվել․ ֆայլը խախտել է սահմանափակումը։',failed:'Կարդալը ձախողվեց։',
  done:(n:number,u:number,a:number,auto:number)=>`Կարդացվել է ${n} արժեք, ${u}-ը դեռ ստուգված չէ${auto?`, ${auto} ${AI_READ_LABEL.hy}`:''}${a?`, ${a}-ը ձեր ուշադրության կարիքն ունի`:''}։`,none:'Կարդացված է․ ստուգելու արժեք չկա։',open:'Ստուգել արժեքները և AI ամփոփումը',ai:'Պատրաստված է AI-ի միջոցով | Բժշկի կողմից չի վերանայվել'},
 ru:{
  label:"Показатели, распознанные ИИ",unavailable:"Статус распознавания ИИ недоступен. Обновите страницу, чтобы проверить его.",notRequested:"Ещё не распознано.",
  queued:"Ожидает распознавания.",running:"Распознаётся.",rejected:"Не распознано: файл превышает допустимые ограничения.",failed:"Не удалось распознать.",
  none:"Распознано; показателей для проверки нет.",open:"Проверить показатели и сводку ИИ",ai:"Подготовлено ИИ | Не проверено врачом",
  done:(n:number,u:number,a:number,auto:number)=>`Распознано показателей: ${n}, ещё не проверено: ${u}${auto?`, ${AI_READ_LABEL.ru}: ${auto}`:""}${a?`, требуют вашего внимания: ${a}`:""}.`,
 },
};
/** One line under a clinic document: the AI reading's state and a link to check it beside the PDF. */
export function LabAiStatus({file,href,locale,onOpen}:{file:File|null|undefined;href:string;locale:Locale;onOpen?:()=>void}){
 const t=copy[locale];
 if(file===undefined)return null;
 if(file===null)return <p role="status" className="text-caption text-muted-foreground">{t.unavailable}</p>;
 const text=file.state==='not_requested'?t.notRequested:file.state==='done'?(file.counts.total?t.done(file.counts.total,file.counts.unverified,file.counts.attention,file.counts.autoAccepted):t.none):t[file.state];
 const attention=file.state!=='not_requested'&&file.counts.attention>0;
 return <div className="space-y-1 rounded-lg bg-muted p-3">
  <p className="flex items-center gap-2 text-caption font-medium"><Bot className="size-4" aria-hidden/>{t.label}</p>
  <p className="text-body2">{attention&&<AlertTriangle className="mr-1 inline size-4 text-destructive" aria-hidden/>}{text}</p>
  {file.state!=='not_requested'&&file.state==='done'&&file.hasSummary&&<p className="text-caption text-muted-foreground">{t.ai}</p>}
  <>{onOpen?<button type="button" className="inline-flex min-h-11 items-center text-body2 underline" onClick={onOpen}>{t.open}</button>:<a className="inline-flex min-h-11 items-center text-body2 underline" href={href}>{t.open}</a>}</>
 </div>;
}
