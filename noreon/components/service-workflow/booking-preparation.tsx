import type {ReactNode} from 'react';
import {clinicalLocale,type Locale} from '@/lib/locale';
import type {ServiceBooking,ServiceWorkflow} from '@/lib/service-workflow/types';
import {bookingApplies,bookingResultsReceived,bookingHasReceipt} from '@/lib/service-workflow/reconciliation';
import {demoPreparation} from '@/lib/service-workflow/model';
import {copy,stamp} from '@/components/patient-care/common';
/** Display only provider-supplied text for this applicable booking. */
export function BookingPreparation({workflow,booking,locale='hy',pendingInstructionsAction}:{workflow:ServiceWorkflow;booking:ServiceBooking;locale?:Locale;pendingInstructionsAction?:ReactNode}) {
  const complete=bookingResultsReceived(workflow,booking);
  if (complete) return <p className="text-caption text-muted-foreground">{copy(locale,"Results received for this booking. Preparation is no longer pending.","Այս պլանավորման արդյունքները ստացված են։ Նախապատրաստում այլևս չի սպասվում։", "Результаты по этой записи получены. Подготовка больше не требуется.")}</p>;
  const tasks=booking.testSnapshots ?? workflow.tests.filter(test=>booking.testIds.includes(test.id));
  if (tasks.length>0 && tasks.every(test=>test.method==='home-log')) return <div className="space-y-1 text-caption text-muted-foreground">
    <p className="font-medium">{copy(locale,"Home recording instructions","Տնային գրառման ցուցումներ", "Инструкции для домашних записей")}</p>
    <details><summary className="min-h-11 cursor-pointer text-body2 font-medium text-primary">{copy(locale,'View instructions','Դիտել ցուցումները', "Посмотреть инструкции")}</summary><div className="space-y-2 pb-2">{tasks.map(task=><p key={task.id} className="whitespace-pre-wrap break-words">{task.preparation || copy(locale,"Follow your clinician’s measurement instructions. This is a home recording task.","Հետևեք բժշկի չափման ցուցումներին։ Սա տնային գրառման առաջադրանք է։", "Следуйте указаниям вашего врача по измерениям. Это задание для домашних записей.")}</p>)}</div></details>
  </div>;
  const preparation=bookingApplies(workflow,booking) ? booking.providerPreparation : undefined;
  if (!preparation && bookingHasReceipt(workflow,booking)) return <p className="text-caption text-muted-foreground">{copy(locale,"Results are being received for this booking. Preparation was not recorded before receipt.","Այս պլանավորման արդյունքները ստացվում են։ Նախապատրաստման ցուցումները չեն գրանցվել մինչև արդյունքների ստացումը։", "Результаты по этой записи поступают. Инструкции по подготовке не были записаны до получения результатов.")}</p>;
  return preparation ? <div className="space-y-1">
    <p className="text-body2 font-medium">{copy(locale,'Preparation recorded','Նախապատրաստումը գրանցված է', "Подготовка записана")}</p>
    <details><summary className="min-h-11 cursor-pointer text-body2 font-medium text-primary">{copy(locale,'View instructions','Դիտել ցուցումները', "Посмотреть инструкции")}</summary><div className="space-y-2 pb-2">
    <p className="text-caption text-muted-foreground">{preparation.provider} · {stamp(preparation.recordedAt,locale)}</p>
    <p className="whitespace-pre-wrap break-words text-body2">{preparation.instructions}</p></div></details>
  </div> : <div className="space-y-1 text-caption text-muted-foreground">
    <p className="font-medium">{copy(locale,'Preparation needs provider confirmation','Նախապատրաստումը ճշտեք բուժծառայություն մատուցողի հետ', "Уточните подготовку у поставщика медицинских услуг")}</p>
    {pendingInstructionsAction ?? <p>{demoPreparation[clinicalLocale(locale)]}</p>}
  </div>;
}
