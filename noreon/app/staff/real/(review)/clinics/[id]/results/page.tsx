import {parseLocale,pick} from '@/lib/locale';
import{notFound}from'next/navigation';
import{z}from'zod';
import{requireRealAdmin}from'@/lib/staff/real-admin';
import type{ClinicRpc}from'@/lib/clinic-portal/runtime';
import{readResultAttachPage}from'@/lib/clinic-portal/result-attach-runtime';
import{attachClinicResult,detachClinicResult}from'@/lib/clinic-portal/result-attach-actions';
import{resultAttachEnabled}from'@/lib/clinic-portal/result-attach-schema';
import{ResultAttach}from'@/components/clinic-portal/result-attach';

// Lab reading scheduled by upload/attach actions uses the cron worker's function budget.
export const maxDuration=300;
export default async function ClinicResultsPage({params,searchParams}:{params:Promise<{id:string}>;searchParams:Promise<Record<string,string|string[]|undefined>>}){
 if(!resultAttachEnabled())notFound();
 const context=await requireRealAdmin(),{id}=await params,locale=parseLocale((await searchParams).locale,'en'),t=(en:string,hy:string,ru:string)=>pick(locale,{en,hy,ru});
 if(!z.uuid().safeParse(id).success)notFound();
 const result=await readResultAttachPage(context.client as unknown as ClinicRpc,id);
 if(result.status!=='loaded')return <div className="space-y-4"><h1 className="text-h1">{t('Clinic lab results','Կլինիկայի լաբորատոր արդյունքները','Результаты анализов клиники')}</h1><p role="alert" className="text-body2">{t('Clinic uploads are unavailable. Reload to try again.','Կլինիկայի ֆայլերն անհասանելի են։ Նորից փորձելու համար թարմացրեք։','Файлы клиники недоступны. Обновите, чтобы попробовать снова.')}</p></div>;
 return <div className="min-w-0 max-w-3xl space-y-5">
  <h1 className="break-words text-h1">{result.data.clinic.name}: {t('lab results','լաբորատոր արդյունքներ','результаты анализов')}</h1>
  <p className="text-body2 text-muted-foreground">{t('Attach each uploaded lab file to the member’s visit. Samples of that visit that have reached the lab are marked as results received. Samples not yet at the lab are left unchanged. No member is matched from the file’s content. Opening a PDF and detaching an upload are both logged.','Յուրաքանչյուր վերբեռնված լաբորատոր ֆայլ կցեք անդամի այցին։ Լաբորատորիա հասած նմուշների համար նշվում է՝ արդյունքները ստացված են։ Դեռ լաբորատորիա չհասած նմուշները չեն փոխվում։ Ֆայլի բովանդակությամբ անդամ չի ընտրվում։ PDF-ի բացումն ու ֆայլի կցումը հանելը գրանցվում են։','Прикрепите каждый загруженный файл анализов к приёму участника. Для образцов этого приёма, поступивших в лабораторию, отмечается получение результатов. Остальные образцы не меняются. Участник не определяется по содержимому файла. Открытие PDF и открепление файла фиксируются.')}</p>
  <ResultAttach locale={locale} data={result.data} submissionIds={Object.fromEntries(result.data.files.map(file=>[file.id,crypto.randomUUID()]))} detachIds={Object.fromEntries(result.data.files.map(file=>[file.id,crypto.randomUUID()]))} attach={attachClinicResult.bind(null,id)} detach={detachClinicResult.bind(null,id)}/>
 </div>;
}
