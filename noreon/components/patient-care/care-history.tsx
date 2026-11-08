import {memberDoctorLabel} from "@/lib/member-staff-name.mjs";
import {memberInstruction} from '@/lib/text-language';
import { ClipboardList, ChevronDown, History, Pill, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import {DoseButtons} from './controls';
import {canReportDose} from '@/lib/patient-care/model';
import type {CareData} from '@/lib/patient-care/types';
import type {Locale} from '@/lib/locale';
import {CareSection,copy,stamp,Status} from './common';

function HistorySummary({icon: Icon, children}: {icon: LucideIcon; children: ReactNode}) {
  return <summary className="flex min-h-11 cursor-pointer list-none items-center gap-3 rounded-lg px-3 py-3 text-body2 font-semibold transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden">
    <Icon className="size-4 shrink-0 text-brand-teal" aria-hidden />
    <span className="min-w-0 flex-1">{children}</span>
    <ChevronDown className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" aria-hidden />
  </summary>;
}

/** Published snapshots and member reports only; no unpublished draft content. */
export function CareHistory({care,locale:l,audience='staff'}:{care:CareData;locale:Locale;audience?:'member'|'staff'}) {
  const instruction=(text:string,identifiers:string[]=[])=>audience==='member'?memberInstruction(text,l,identifiers):text;
  const plans=care.planHistory ?? [];
  const medicines=care.medicationHistory ?? [];
  if (!plans.length && !medicines.length && !care.events.length && !care.doseHistory?.length) return null;
  return <CareSection title={copy(l,'Your care history','Ձեր խնամքի պատմությունը', 'Ваша история лечения')}>
    {!!plans.length && <details className="group rounded-xl border"><HistorySummary icon={ClipboardList}>{copy(l,'Previous published plans','Նախկին հրապարակված պլանները', 'Предыдущие опубликованные планы')} · {plans.length}</HistorySummary>
      <div className="space-y-5 border-t px-4 py-4">{[...plans].reverse().map(plan=><article key={plan.id} className="space-y-2 border-b pb-4">
        <h3 className="text-body1 font-semibold">{stamp(plan.publishedAt,l)} · {memberDoctorLabel(plan.clinician,l)}</h3>
        <p className="whitespace-pre-wrap text-body2">{instruction(plan.explanation??'',plan.medications.map(m=>m.name))}</p>
        <p className="whitespace-pre-wrap text-body2">{instruction(plan.instructions,plan.medications.map(m=>m.name))}</p>
        {plan.medications.map(m=><p className="text-body2" key={m.id}>{m.name} · {m.dose} · {m.times.join(', ')}<br />{instruction(m.instructions,[m.name])}</p>)}
        <p className="text-caption text-muted-foreground">{plan.acknowledged || plan.acknowledgedAt ? `${copy(l,'Marked as read','Նշված է որպես կարդացված', 'Отмечено как прочитанное')} · ${plan.acknowledgedAt ? stamp(plan.acknowledgedAt,l) : copy(l,'Date not recorded','Ամսաթիվը գրանցված չէ', 'Дата не записана')}` : copy(l,'No acknowledgement recorded','Կարդալու հաստատում գրանցված չէ', 'Подтверждение прочтения не записано')}</p>
      </article>)}</div>
    </details>}
    {!!medicines.length && <details className="group rounded-xl border"><HistorySummary icon={Pill}>{copy(l,'Medication orders and changes','Դեղերի նշանակումները և փոփոխությունները', 'Назначения лекарств и изменения')}</HistorySummary>
      <div className="space-y-4 border-t px-4 py-4">{[...medicines].reverse().map(m=><article key={m.id} className="space-y-2 border-b pb-4">
        <h3 className="text-body1 font-semibold">{m.name} · {m.dose}</h3>
        <p className="text-body2">{instruction(m.instructions,[m.name])} · {m.times.join(', ')}</p>
        <p className="text-caption">{copy(l,'Started','Սկիզբ', 'Начало')} · {m.effectiveAt ? stamp(m.effectiveAt,l) : m.startDate}</p>
        <Status>{m.active ? copy(l,'Current order','Ընթացիկ նշանակում', 'Текущее назначение') : copy(l,'Replaced or stopped','Փոխարինված կամ դադարեցված', 'Заменено или отменено')}</Status>
        {m.endDate && <p className="text-caption">{copy(l,'Ended','Ավարտ', 'Окончание')} · {m.endDate}</p>}
      </article>)}</div>
    </details>}
    {!!care.events.length && <details className="group rounded-xl border"><HistorySummary icon={History}>{copy(l,'Your medication check-ins','Դեղերի ընդունման ձեր գրառումները', 'Ваши записи о приёме лекарств')} · {care.events.length}</HistorySummary>
      <ul className="space-y-3 border-t px-4 py-4">{[...care.events].sort((a,b)=>Date.parse(b.dueAt)-Date.parse(a.dueAt)).map(event=>{
        const medicine=medicines.find(m=>m.id===event.medicationId) ?? care.plan?.medications.find(m=>m.id===event.medicationId);
        const plan=[...(care.plan ? [care.plan] : []),...plans].find(p=>p.id===event.planId);
        const now=new Date();
        const correctionMedication=care.doseCorrectionScope==='current-plan'
          ? event.revision && canReportDose(care,event.medicationId,event.dueAt,now)
            ? care.plan?.medications.find(m=>m.id===event.medicationId)
            : undefined
          : medicine && event.planId && event.revision && new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Yerevan'}).format(new Date(event.dueAt))===new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Yerevan'}).format(now)
            ? {...medicine,planId:event.planId}
            : undefined;
        return <li key={`${event.medicationId}-${event.dueAt}`} className="space-y-1 border-b pb-3 text-body2">
          <p>{medicine ? `${medicine.name} · ${medicine.dose}` : copy(l,'Earlier medication; details unavailable','Նախկին դեղ․ մանրամասները հասանելի չեն', 'Предыдущее лекарство; подробности недоступны')} · {stamp(event.dueAt,l)}</p>
          <p>{event.status==='taken' ? copy(l,'Reported taken','Գրանցված է՝ ընդունված', 'Отмечено: принято') : copy(l,'Reported skipped','Գրանցված է՝ բաց թողնված', 'Отмечено: пропущено')}</p>
          <p className="text-caption text-muted-foreground">{copy(l,'Recorded','Գրանցված է', 'Записано')} · {stamp(event.recordedAt,l)} · {plan ? `${copy(l,'Plan published','Պլանը հրապարակված է', 'План опубликован')} ${stamp(plan.publishedAt,l)}` : copy(l,'Original plan not recorded','Սկզբնական պլանը գրանցված չէ', 'Исходный план не записан')}</p>
          {correctionMedication&&<DoseButtons locale={l} dose={{medication:correctionMedication,dueAt:event.dueAt,status:event.status,revision:event.revision}}/>}
        </li>;
      })}</ul>
    </details>}
    {!!care.doseHistory?.length && <details className="group rounded-xl border"><HistorySummary icon={History}>{copy(l,'Your check-in history and corrections (past 30 days)','Ձեր գրառումների պատմությունն ու ուղղումները (վերջին 30 օրը)', 'История ваших записей и исправлений за последние 30 дней')}</HistorySummary>
      <ul className="space-y-3 border-t px-4 py-4">{[...care.doseHistory].sort((a,b)=>Date.parse(b.recordedAt)-Date.parse(a.recordedAt)).map(event=>{
        const medicine=medicines.find(m=>m.id===event.medicationId) ?? care.plan?.medications.find(m=>m.id===event.medicationId);
        return <li key={`${event.medicationId}-${event.dueAt}-${event.revision}`} className="space-y-1 border-b pb-3 text-body2">
          <p>{medicine?.name ?? copy(l,'Earlier medication','Նախկին դեղ', 'Предыдущее лекарство')} · {stamp(event.dueAt,l)}</p>
          <p>{event.status==='taken' ? copy(l,'Reported taken','Գրանցված է՝ ընդունված', 'Отмечено: принято') : copy(l,'Reported skipped','Գրանցված է՝ բաց թողնված', 'Отмечено: пропущено')} · {copy(l,'Revision','Տարբերակ', 'Версия')} {event.revision}</p>
          <p className="text-caption text-muted-foreground">{stamp(event.recordedAt,l)}{event.kind==='baseline' ? ` · ${copy(l,'Earlier report; prior changes were not recorded','Նախկին գրառում․ ավելի վաղ փոփոխությունները չեն գրանցվել', 'Предыдущая запись; более ранние изменения не записывались')}` : ''}</p>
        </li>;
      })}</ul>
    </details>}
  </CareSection>;
}
