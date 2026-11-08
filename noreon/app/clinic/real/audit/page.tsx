import {clinicLocale} from '@/lib/clinic-portal/locale';
import Link from 'next/link';
import type {Route} from 'next';
import {redirect,unstable_rethrow} from 'next/navigation';
import {requireClinicPortal} from '@/lib/clinic-portal/identity';
import {ClinicShell} from '@/components/clinic-portal/shell';
import {clinicTimestamp} from '@/lib/clinic-portal/display-time';
import {clinicAuditCategories,clinicAuditPageSchema,clinicAuditPeopleSchema,EXPORT_LIMIT,filterQuery,parseFilters,rpcArgs,withDefaultWindow} from '@/lib/activity-log/contracts';
import {actionLabel,auditCategoryName,auditRoleName,profileChangeLines} from '@/lib/activity-log/labels';
export const dynamic='force-dynamic';

export default async function ClinicAuditPage({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}){
 const query=await searchParams,locale=await clinicLocale(query.locale),t=(en:string,hy:string,ru:string)=>locale==='hy'?hy:locale==='ru'?ru:en;
 const context=await requireClinicPortal(typeof query.clinic==='string'?query.clinic:null,{page:true}),clinicId=context.identity.clinicId;
 if(context.identity.capability!=='clinic_admin')redirect(`/clinic/real/bookings?clinic=${clinicId}&locale=${locale}` as Route);
 const asked=parseFilters(query),filters=withDefaultWindow(asked),base={...filters,cursor:null,memberInvalid:null};
 const href=(path:string,extra:Parameters<typeof filterQuery>[0]=base)=>`${path}?clinic=${clinicId}&locale=${locale}&${filterQuery(extra)}`;
 let page:ReturnType<typeof clinicAuditPageSchema.parse>|null=null,people:ReturnType<typeof clinicAuditPeopleSchema.parse>|null=null;
 try{
  const [log,who]=await Promise.all([
   asked.memberInvalid?Promise.resolve(null):context.rpc.rpc('clinic_audit_log',{p_profile_values:true,p_clinic:clinicId,...rpcArgs(filters),p_cursor:filters.cursor??undefined,p_limit:100}),
   context.rpc.rpc('clinic_audit_people',{p_clinic:clinicId}),
  ]);
  if(log?.error||who.error)throw Error('Audit log unavailable');
  page=log?clinicAuditPageSchema.parse(log.data):null;people=clinicAuditPeopleSchema.parse(who.data);
 }catch(error){unstable_rethrow(error);}
 const disabled=(page&&'status'in page&&page.status==='disabled')||(people&&'status'in people&&people.status==='disabled');
 const loaded=page&&'ok'in page&&people&&'ok'in people?page:null;
 const field='min-h-12 w-full min-w-0 rounded-md border bg-background px-3 py-2 text-body2';
 return <ClinicShell identity={context.identity} locale={locale} current="audit"><div className="min-w-0 space-y-5">
  <header className="space-y-2"><h1 className="text-h1">{t('Audit log','Գործողությունների մատյան','Журнал действий')}</h1>
   <p className="text-body2 text-muted-foreground">{t('See record access, care and permission changes, and message delivery. Message contents and reasons are not shown.','Դիտեք քարտերի հասանելիությունը, խնամքի և իրավունքների փոփոխություններն ու հաղորդագրությունների առաքումը։ Հաղորդագրությունների բովանդակությունը և պատճառները չեն ցուցադրվում։','Просматривайте доступ к картам, изменения в уходе и правах, доставку сообщений. Содержимое сообщений и причины не показываются.')}</p></header>
  <form method="get" className="grid min-w-0 gap-3 rounded-xl border bg-background p-4 sm:grid-cols-2 lg:grid-cols-3">
   <input type="hidden" name="clinic" value={clinicId}/><input type="hidden" name="locale" value={locale}/>
   <label className="min-w-0 space-y-1 text-body2"><span>{t('Person','Անձ','Кто')}</span><select name="actor" defaultValue={filters.actor??''} className={field}>
    <option value="">{t('Anyone','Բոլորը','Все')}</option>{people&&'ok'in people&&people.people.map(p=><option key={p.id} value={p.id}>{p.name} · {auditRoleName(p.role,locale)}</option>)}
   </select></label>
   <label className="min-w-0 space-y-1 text-body2"><span>{t('Member reference','Անդամի հղում','Идентификатор участника')}</span><input name="member" defaultValue={filters.member??asked.memberInvalid??''} autoComplete="off" aria-invalid={asked.memberInvalid?true:undefined} className={field}/></label>
   <label className="min-w-0 space-y-1 text-body2"><span>{t('Type of action','Գործողության տեսակ','Тип действия')}</span><select name="category" defaultValue={filters.category??''} className={field}>
    <option value="">{t('All actions','Բոլոր գործողությունները','Все действия')}</option>{clinicAuditCategories.map(c=><option key={c} value={c}>{auditCategoryName(c,locale)}</option>)}
   </select></label>
   <label className="min-w-0 space-y-1 text-body2"><span>{t('From','Սկսած','С')}</span><input type="date" name="from" defaultValue={filters.from??''} className={field}/></label>
   <label className="min-w-0 space-y-1 text-body2"><span>{t('To','Մինչև','По')}</span><input type="date" name="to" defaultValue={filters.to??''} className={field}/></label>
   <div className="flex flex-wrap items-end gap-3"><button className="min-h-12 rounded-md border px-4 text-body2 font-semibold">{t('Show activity','Ցույց տալ գործողությունները','Показать действия')}</button><Link href={`/clinic/real/audit?clinic=${clinicId}&locale=${locale}` as Route} className="py-3 text-body2 underline">{t('Clear filters','Մաքրել զտիչները','Сбросить фильтры')}</Link></div>
  </form>
  {asked.memberInvalid?<p role="alert" className="break-words text-body2">{t('This is not a member reference. Copy the reference from the member record.','Սա անդամի հղում չէ։ Պատճենեք հղումը անդամի քարտից։','Это не идентификатор участника. Скопируйте его из карты участника.')}</p>
   :disabled?<p role="status" className="text-body2">{t('The audit log is not switched on yet.','Գործողությունների մատյանը դեռ միացված չէ։','Журнал действий пока не включён.')}</p>
   :!loaded?<p role="alert" className="text-body2">{t('The audit log could not load. Try again.','Գործողությունների մատյանը չհաջողվեց բեռնել։ Նորից փորձեք։','Не удалось загрузить журнал действий. Попробуйте снова.')}</p>
   :<section className="min-w-0 space-y-4" aria-label={t('Recorded activity','Գրանցված գործողություններ','Записанные действия')}>
    <p className="text-caption text-muted-foreground">{t('Newest first, Yerevan time (UTC+4). The default is the last 7 days. Views and exports are recorded.','Նորերը՝ սկզբում, Երևանի ժամանակով (UTC+4)։ Լռելյայն՝ վերջին 7 օրը։ Դիտումները և արտահանումները գրանցվում են։','Сначала новые, время Еревана (UTC+4). По умолчанию последние 7 дней. Просмотры и выгрузки записываются.')}</p>
    <p className="text-body2"><a href={href('/clinic/real/audit/export')} className="font-semibold underline">{t('Download these rows as CSV','Ներբեռնել այս տողերը CSV ձևաչափով','Скачать эти строки в CSV')}</a><span className="text-muted-foreground"> · {t(`Up to ${EXPORT_LIMIT} rows. Narrow the dates if more match.`,`Մինչև ${EXPORT_LIMIT} տող։ Ավելի շատ արդյունքների դեպքում կրճատեք ամսաթվերի միջակայքը։`,`До ${EXPORT_LIMIT} строк. Если их больше, сузьте диапазон дат.`)}</span></p>
    {!loaded.rows.length?<p role="status" className="text-body2">{t('Nothing recorded for these filters.','Այս զտիչներով գրառումներ չկան։','Для этих фильтров записей нет.')}</p>:<ul className="min-w-0 divide-y">{loaded.rows.map(r=><li key={r.key} className="min-w-0 space-y-1 py-4 text-body2">
     <p className="text-caption text-muted-foreground"><time dateTime={r.at}>{clinicTimestamp(r.at,locale)}</time> · {auditCategoryName(r.category,locale)}</p>
     <p className="break-words font-semibold">{actionLabel(r.source,r.action,locale)}</p>
     <p className="break-words">{t('Who','Ով','Кто')}: {r.actorRole==='noreon'?auditRoleName('noreon',locale):r.actorName??(r.actorId?t('Unnamed account','Անանուն հաշիվ','Без имени'):t('System','Համակարգ','Система'))}{r.actorRole&&r.actorRole!=='noreon'&&<> · {auditRoleName(r.actorRole,locale)}</>}{r.actorId&&<> · <Link href={href('/clinic/real/audit',{...base,actor:r.actorId}) as Route} className="underline">{t('Only this person','Միայն այս անձը','Только этот человек')}</Link></>}</p>
     {r.memberId&&<p className="break-words">{t('Member','Անդամ','Участник')}: <Link href={href('/clinic/real/audit',{...base,member:r.memberId}) as Route} className="underline" title={r.memberId}>{r.memberName??r.memberId.slice(0,8)}</Link></p>}
     {profileChangeLines(r.profileChange,locale).map(line=><p key={line} className="break-words">{line}</p>)}
     {r.ref&&<p className="break-all text-caption text-muted-foreground">{t('Reference','Հղում','Ссылка')}: <span title={r.ref}>{r.ref.slice(0,8)}</span></p>}
    </li>)}</ul>}
    {loaded.next&&<Link href={href('/clinic/real/audit',{...base,cursor:loaded.next}) as Route} className="inline-block py-3 text-body2 font-semibold underline">{t('Older activity','Ավելի վաղ գործողություններ','Более ранние действия')}</Link>}
   </section>}
 </div></ClinicShell>;
}
