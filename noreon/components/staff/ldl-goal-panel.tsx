'use client';
import {useState,type ReactNode} from 'react';
import {useRecordRefresh} from '@/components/staff/record-refresh';
import {buttonClass,fieldClass} from './shell';
import {calendarDate,yerevanStamp} from '@/lib/staff/yerevan-time';
import type {Locale} from '@/lib/locale';
import {LDL_ASCVD_DEFAULT_CATEGORY,LDL_CATEGORIES,LDL_RETEST_WEEKS,LDL_CATEGORY_GOALS,LDL_DEFAULTS_VERSION,LDL_THRESHOLD_CHOICES,type LdlCategory} from '@/lib/ldl/constants';
import {LDL_COMMAND_VERSION,LDL_DRUGS,LDL_EVENT_TYPES,goalNeedsReason,type DoctorLdlOn,type LdlCommandResult} from '@/lib/ldl/schema';
import {assessLdl,formatMmol,formatPercent,ldlPilotEligibility,type LdlObservation} from '@/lib/ldl/status';
import {proposeRetest} from '@/lib/ldl/retest';

type Act=(input:unknown)=>Promise<LdlCommandResult>;
export type LdlActions={addEvent:Act;removeEvent:Act;addTherapy:Act;endTherapy:Act;setGoal:Act;cancelRetest:Act};
type T3=[en:string,hy:string,ru:string];
const secondary='inline-flex min-h-11 items-center justify-center rounded-md border px-3 py-2 text-body2 hover:bg-muted disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-ring';

// Staff copy; clinical wording pending Armen/Yesayi, Armenian pending Tatevik.
const W={
 title:['LDL goal','ՑԽԼ խոլեստերինի նպատակ','Цель по ЛПНП'],
 intro:['Record the event and lipid therapy, then set or confirm the LDL goal. The member sees the goal only after you confirm it; before that they read "Your doctor is setting your goal", with no number.','Գրանցեք դեպքը և լիպիդիջեցնող բուժումը, ապա սահմանեք կամ հաստատեք ՑԽԼ նպատակը։ Անդամը նպատակը տեսնում է միայն ձեր հաստատումից հետո, մինչ այդ՝ «Ձեր բժիշկը սահմանում է ձեր նպատակը», առանց թվի։','Запишите событие и липидснижающую терапию, затем установите или подтвердите цель по ЛПНП. Участник видит цель только после вашего подтверждения; до этого он видит «Ваш врач устанавливает вашу цель», без цифр.'],
 status:['Status','Կարգավիճակ','Статус'],
 goal_not_set:['Goal not yet set','Նպատակը դեռ սահմանված չէ','Цель ещё не установлена'],
 not_assessable:['Not assessable: no reviewed LDL result','Հնարավոր չէ գնահատել. ստուգված ՑԽԼ արդյունք չկա','Нельзя оценить: нет проверенного результата ЛПНП'],
 at_goal:['At goal (below threshold)','Նպատակին հասած է (շեմից ցածր)','Цель достигнута (ниже порога)'],
 above_goal:['Above goal','Նպատակից բարձր','Выше цели'],
 latest:['Latest reviewed LDL','Վերջին ստուգված ՑԽԼ','Последний проверенный ЛПНП'],
 none:['None','Չկա','Нет'],
 reduction:['Reduction from baseline','Նվազումը ելակետից','Снижение от исходного'],
 notApplicable:['Not applied for this goal','Այս նպատակի համար չի կիրառվում','Не применяется для этой цели'],
 baseline_unknown:['Not assessable: no documented pre-treatment baseline','Հնարավոր չէ գնահատել. բուժումից առաջվա փաստաթղթավորված ելակետ չկա','Нельзя оценить: нет документированного исходного значения до лечения'],
 on_treatment:['Not assessable: the baseline was already on treatment','Հնարավոր չէ գնահատել. ելակետն արդեն բուժման ընթացքում էր','Нельзя оценить: исходное значение получено уже на лечении'],
 no_later_value:['Not assessable: no reviewed result after the baseline date','Հնարավոր չէ գնահատել. ելակետից հետո ստուգված արդյունք չկա','Нельзя оценить: нет проверенного результата после исходной даты'],
 met:['met','կատարված է','выполнено'],notMet:['not met','կատարված չէ','не выполнено'],required:['required','պահանջվում է','требуется'],
 belowAlready:['The documented baseline is already below the threshold.','Փաստաթղթավորված ելակետն արդեն շեմից ցածր է։','Документированное исходное значение уже ниже порога.'],
 memberSees:['The member sees','Անդամը տեսնում է','Участник видит'],
 memberBeing:['"Your doctor is setting your goal", with no number','«Ձեր բժիշկը սահմանում է ձեր նպատակը», առանց թվի','«Ваш врач устанавливает вашу цель», без цифр'],
 memberGoal:['the goal, the latest result they can see and the status','նպատակը, իրեն տեսանելի վերջին արդյունքը և կարգավիճակը','цель, последний доступный ему результат и статус'],
 memberNothing:['nothing yet (no event, therapy or goal recorded)','դեռ ոչինչ (դեպք, բուժում կամ նպատակ գրանցված չէ)','пока ничего (событие, терапия или цель не записаны)'],
 trend:['LDL trend','ՑԽԼ դինամիկա','Динамика ЛПНП'],noValues:['No LDL values on record.','ՑԽԼ արժեքներ չկան։','Значений ЛПНП нет.'],
 date:['Date','Ամսաթիվ','Дата'],value:['mmol/L','մմոլ/լ','ммоль/л'],source:['Source','Աղբյուր','Источник'],
 counts:['decides status','որոշում է կարգավիճակը','определяет статус'],shown:['shown only','միայն ցուցադրվում է','только отображается'],
 hidden:['not shared with the member yet','դեռ կիսված չէ անդամի հետ','ещё не показано участнику'],
 src_member:['entered or confirmed by the member','մուտքագրել կամ հաստատել է անդամը','введено или подтверждено участником'],
 src_upload_checked:['member upload, approved by the doctor','անդամի վերբեռնում, հաստատված բժշկի կողմից','загрузка участника, одобрена врачом'],
 src_clinic_result:['clinic or laboratory result','կլինիկայի կամ լաբորատորիայի արդյունք','результат клиники или лаборатории'],
 src_clinic_reviewed:['clinic reading reviewed by the doctor','բժշկի ստուգած կլինիկական ընթերցում','показатель клиники, проверенный врачом'],
 events:['Index event','Ինդեքսային դեպք','Индексное событие'],noEvents:['No event recorded.','Դեպք գրանցված չէ։','Событие не записано.'],
 ev_acs_mi:['Heart attack / acute coronary syndrome','Սրտամկանի ինֆարկտ / սուր կորոնար համախտանիշ','Инфаркт миокарда / острый коронарный синдром'],
 ev_ischaemic_stroke:['Ischaemic stroke','Իշեմիկ ինսուլտ','Ишемический инсульт'],
 ev_haemorrhagic_stroke:['Haemorrhagic stroke','Հեմոռագիկ ինսուլտ','Геморрагический инсульт'],
 pilotExcluded:['Haemorrhagic stroke with no qualifying event: not eligible for the LDL pilot. The member sees no LDL goal and gets no re-test. Proposed rule, under clinical review.','Հեմոռագիկ ինսուլտ՝ առանց համապատասխան դեպքի. անդամը ՑԽԼ փորձնական ծրագրի համար իրավասու չէ։ Անդամը ՑԽԼ նպատակ չի տեսնում և կրկնակի անալիզ չի ստանում։ Առաջարկվող կանոն՝ կլինիկական վերանայման փուլում։','Геморрагический инсульт без подходящего события: не подходит для пилота по ЛПНП. Участник не видит цель по ЛПНП и не получает повторный анализ. Предлагаемое правило, проходит клиническую проверку.'],
 pilotWarning:['Haemorrhagic stroke also on record: eligible through the other event. Check this before setting the goal or treatment.','Գրանցված է նաև հեմոռագիկ ինսուլտ. իրավասու է մյուս դեպքի հիման վրա։ Ստուգեք սա նպատակը կամ բուժումը սահմանելուց առաջ։','Также записан геморрагический инсульт: подходит по другому событию. Проверьте это перед установкой цели или лечения.'],
 ev_tia:['Transient ischaemic attack (TIA)','Անցողիկ իշեմիկ գրոհ (TIA)','Транзиторная ишемическая атака (ТИА)'],
 ev_other:['Other','Այլ','Другое'],
 dateUnknown:['date not known','ամսաթիվն անհայտ է','дата неизвестна'],
 srcDocument:['from a document','փաստաթղթից','из документа'],srcDoctor:['entered by the doctor','մուտքագրել է բժիշկը','введено врачом'],
 type:['Type','Տեսակ','Тип'],describe:['Describe','Նկարագրեք','Опишите'],eventDate:['Event date (leave empty if not known)','Դեպքի ամսաթիվը (թողեք դատարկ, եթե անհայտ է)','Дата события (оставьте пустым, если неизвестна)'],
 recordedFrom:['Source','Աղբյուր','Источник'],note:['Note (optional)','Նշում (ըստ ցանկության)','Примечание (необязательно)'],
 addEvent:['Record event','Գրանցել դեպքը','Записать событие'],remove:['Remove (entered in error)','Հեռացնել (սխալմամբ է մուտքագրվել)','Удалить (введено по ошибке)'],
 therapy:['Lipid therapy','Լիպիդիջեցնող բուժում','Липидснижающая терапия'],noTherapy:['No lipid therapy recorded.','Լիպիդիջեցնող բուժում գրանցված չէ։','Липидснижающая терапия не записана.'],
 drug:['Medicine','Դեղ','Препарат'],dose:['Dose and frequency','Դոզա և հաճախականություն','Доза и частота'],started:['Start date (leave empty if not known)','Սկսելու ամսաթիվը (թողեք դատարկ, եթե անհայտ է)','Дата начала (оставьте пустым, если неизвестна)'],
 maxTol:['Maximally tolerated dose (doctor only, never shown to the member)','Առավելագույն տանելի դոզա (միայն բժշկի համար, անդամին երբեք չի ցուցադրվում)','Максимально переносимая доза (только для врача, участнику не показывается)'],
 maxTolShort:['maximally tolerated','առավելագույն տանելի','максимально переносимая'],
 since:['since','սկսած','с'],stoppedOn:['stopped','դադարեցվել է','отменено'],
 addTherapy:['Record therapy','Գրանցել բուժումը','Записать терапию'],stop:['Mark as stopped today','Նշել որպես այսօր դադարեցված','Отметить как отменённую сегодня'],
 errorEntry:['Entered in error','Սխալմամբ է մուտքագրվել','Введено по ошибке'],
 current:['Current','Ընթացիկ','Текущая'],ended:['Stopped','Դադարեցված','Отменённая'],
 setGoal:['Set the goal','Սահմանել նպատակը','Установить цель'],changeGoal:['Change the goal (new version)','Փոխել նպատակը (նոր տարբերակ)','Изменить цель (новая версия)'],
 category:['Risk category','Ռիսկի կատեգորիա','Категория риска'],
 cat_very_high:['Very high','Շատ բարձր','Очень высокий'],cat_high:['High','Բարձր','Высокий'],cat_moderate:['Moderate','Միջին','Умеренный'],cat_low:['Low','Ցածր','Низкий'],
 ascvdDefault:['Proposed: very high, established ASCVD from the recorded event. Confirm or change.','Առաջարկվում է՝ շատ բարձր, գրանցված դեպքի հիման վրա հաստատված ԱՍԿՀ։ Հաստատեք կամ փոխեք։','Предложено: очень высокий, установленное АССЗ по записанному событию. Подтвердите или измените.'],
 threshold:['LDL threshold (mmol/L, below)','ՑԽԼ շեմ (մմոլ/լ, ցածր)','Порог ЛПНП (ммоль/л, ниже)'],
 defaultFor:['category default','կատեգորիայի լռելյայն','по умолчанию для категории'],
 reductionRule:['Also require a reduction from baseline of at least','Պահանջել նաև ելակետից նվազում առնվազն','Также требовать снижения от исходного не менее'],
 baseline:['Baseline LDL','Ելակետային ՑԽԼ','Исходный ЛПНП'],
 bk_pre_treatment:['Documented, before lipid-lowering treatment','Փաստաթղթավորված, լիպիդիջեցնող բուժումից առաջ','Документировано, до липидснижающей терапии'],
 bk_on_treatment:['Known, but already on treatment (no % is computed)','Հայտնի է, բայց արդեն բուժման ընթացքում (% չի հաշվարկվում)','Известно, но уже на лечении (% не рассчитывается)'],
 bk_unknown:['Unknown','Անհայտ','Неизвестно'],
 baselineValue:['Value (mmol/L)','Արժեք (մմոլ/լ)','Значение (ммоль/л)'],baselineDate:['Date','Ամսաթիվ','Дата'],
 bs_document:['Document','Փաստաթուղթ','Документ'],bs_lab_result:['Lab result on record','Գրանցված լաբորատոր արդյունք','Лабораторный результат в записи'],bs_doctor_entered:['Entered by the doctor','Մուտքագրել է բժիշկը','Введено врачом'],
 nextTest:['Next LDL test (optional, shown to the member)','Հաջորդ ՑԽԼ անալիզը (ըստ ցանկության, ցուցադրվում է անդամին)','Следующий анализ ЛПНП (необязательно, показывается участнику)'],
 reason:['Reason','Պատճառ','Причина'],reasonNeeded:['(required: the goal changes or differs from the category default)','(պարտադիր է. նպատակը փոխվում է կամ տարբերվում է կատեգորիայի լռելյայնից)','(обязательно: цель меняется или отличается от значения по умолчанию)'],
 confirm:['Confirm goal and show it to the member','Հաստատել նպատակը և ցույց տալ անդամին','Подтвердить цель и показать участнику'],
 saveVersion:['Save the new goal version','Պահպանել նպատակի նոր տարբերակը','Сохранить новую версию цели'],
 versions:['Goal versions','Նպատակի տարբերակներ','Версии цели'],byYou:['by you','ձեր կողմից','вами'],
 saving:['Saving…','Պահպանվում է…','Сохраняется…'],
 retestBook:['This is a change to lipid treatment: book a re-test blood draw','Սա լիպիդիջեցնող բուժման փոփոխություն է. նշանակել կրկնակի արյան անալիզ','Это изменение липидснижающей терапии: назначить повторный анализ крови'],
 retestWindow:['Re-test window','Կրկնակի անալիզի ժամկետ','Срок повторного анализа'],
 retestAcs:['4 to 6 weeks after a heart attack (default, under clinical review)','սրտամկանի ինֆարկտից հետո 4–6 շաբաթ (լռելյայն, կլինիկական վերանայման փուլում)','4–6 недель после инфаркта (по умолчанию, проходит клиническую проверку)'],
 retestOther:[`${LDL_RETEST_WEEKS.other[0]} to ${LDL_RETEST_WEEKS.other[1]} weeks (default, under clinical review)`,`${LDL_RETEST_WEEKS.other[0]}–${LDL_RETEST_WEEKS.other[1]} շաբաթ (լռելյայն, կլինիկական վերանայման փուլում)`,`${LDL_RETEST_WEEKS.other[0]}–${LDL_RETEST_WEEKS.other[1]} недель (по умолчанию, проходит клиническую проверку)`],
 pending:['Default values, under clinical review','Լռելյայն արժեքները կլինիկական վերանայման փուլում են','Значения по умолчанию проходят клиническую проверку'],
 retestRequest:['The home-visit request for the blood draw goes to the admin queue on','Արյան նմուշառման տնային այցի հայտը ադմինի հերթ կանցնի','Заявка на выезд медсестры для забора крови поступит в очередь администратора'],
 retestPast:['This start date is too long ago for a re-test window. Set the next test on the goal instead.','Այս մեկնարկի ամսաթիվը չափազանց հին է կրկնակի անալիզի համար։ Փոխարենը նշեք հաջորդ անալիզը նպատակում։','Дата начала слишком давняя для срока повторного анализа. Укажите следующий анализ в цели.'],
 loop:['Re-test and results','Կրկնակի անալիզ և արդյունքներ','Повторный анализ и результаты'],
 noRetests:['No re-test booked.','Կրկնակի անալիզ նշանակված չէ։','Повторный анализ не назначен.'],
 rs_scheduled:['Booked, request not sent yet','Նշանակված է, հայտը դեռ չի ուղարկվել','Назначен, заявка ещё не отправлена'],
 rs_requested:['Home-visit request in the admin queue','Տնային այցի հայտը ադմինի հերթում է','Заявка на выезд в очереди администратора'],
 rs_fenced:['Waiting: the member has another open visit or cannot have a request yet; the admin is told and Noreon retries','Սպասում է. անդամն ունի այլ բաց այց կամ դեռ չի կարող հայտ ունենալ. ադմինը տեղեկացված է, Noreon-ը կփորձի կրկին','Ожидание: у участника другой открытый визит или заявка пока невозможна; администратор уведомлён, Noreon повторит попытку'],
 rs_done:['Result received','Արդյունքը ստացված է','Результат получен'],rs_cancelled:['Cancelled','Չեղարկված','Отменён'],rs_superseded:['Replaced by a newer change','Փոխարինվել է ավելի նոր փոփոխությամբ','Заменён более новым изменением'],
 overdueTag:['Overdue','Ժամկետանց','Просрочен'],cancelRetest:['No re-test needed','Կրկնակի անալիզ պետք չէ','Повторный анализ не нужен'],
 responses:['Response checks','Արձագանքի ստուգումներ','Проверки ответа'],
 st_at_goal:['At goal','Նպատակին հասել է','Цель достигнута'],st_above_goal:['Above goal','Նպատակից բարձր','Выше цели'],st_not_assessable:['Not assessable','Հնարավոր չէ գնահատել','Нельзя оценить'],
 reviewedOn:['reviewed','վերանայված','рассмотрено'],openOnToday:['open on Today','բաց է «Այսօր» էջում','открыто на странице «Сегодня»'],retry:['Check again','Կրկին ստուգել','Проверить снова'],
 heldNote:['Checking the earlier save: your edits are not sent until it is resolved.','Ստուգվում է նախորդ պահպանումը. ձեր փոփոխություններն այդ ընթացքում չեն ուղարկվում։','Проверяется предыдущее сохранение: ваши правки не отправляются, пока оно не прояснится.'],
 r_saved:['Saved.','Պահպանված է։','Сохранено.'],r_replayed:['Already saved.','Արդեն պահպանված է։','Уже сохранено.'],
 r_stale:['This changed meanwhile. Reload and check.','Միջանկյալ փոփոխություն է եղել։ Թարմացրեք էջը և ստուգեք։','Данные изменились. Обновите страницу и проверьте.'],
 r_invalid:['Check the fields.','Ստուգեք դաշտերը։','Проверьте поля.'],r_disabled:['The LDL goal is switched off.','ՑԽԼ նպատակն անջատված է։','Цель по ЛПНП отключена.'],
 'r_not-found':['Not found. Reload.','Չի գտնվել։ Թարմացրեք էջը։','Не найдено. Обновите страницу.'],r_unavailable:['Couldn’t save right now. Try again.','Այս պահին չհաջողվեց պահպանել։ Փորձեք կրկին։','Сейчас не удалось сохранить. Попробуйте снова.'],
 r_access:['Only the assigned doctor can change this.','Միայն կցված բժիշկը կարող է փոխել սա։','Изменить это может только назначенный врач.'],
 'r_outcome-unknown':['Save outcome unknown. Check again: nothing is saved twice.','Պահպանման արդյունքն անհայտ է։ Կրկին ստուգեք. ոչինչ երկու անգամ չի պահվում։','Результат сохранения неизвестен. Проверьте снова: ничего не сохраняется дважды.'],
} satisfies Record<string,T3>;
type Key=keyof typeof W;

function useCommand(act:Act){
 const refresh=useRecordRefresh();
 const [pending,setPending]=useState(false),[result,setResult]=useState<LdlCommandResult|null>(null);
 // After an unknown outcome the exact command is held and resent unchanged (same submission id, same fields),
 // so a commit whose answer was lost replays it rather than "replaying" an edited one that was never saved.
 const [held,setHeld]=useState<unknown>(null);
 async function send(build:(submissionId:string)=>unknown){
  if(pending)return null;setPending(true);setResult(null);
  const command=held??build(crypto.randomUUID());
  const r=await act(command).catch(():LdlCommandResult=>({status:'outcome-unknown'}));
  setPending(false);setResult(r);setHeld(r.status==='outcome-unknown'?command:null);
  if(r.status==='saved'||r.status==='replayed')refresh();
  return r;
 }
 return {send,pending,result,held:held!==null};
}

export function LdlGoalPanel({data,memberId,locale,actions}:{data:DoctorLdlOn;memberId:string;locale:Locale;actions:LdlActions}){
 const i=locale==='hy'?1:locale==='ru'?2:0;const t=(k:Key)=>W[k][i];
 const current=data.goals[0]??null;
 const a=assessLdl({goal:current,observations:data.observations});
 const day=(d:string)=>calendarDate(d,locale);
 const unit=t('value');
 const inPathway=!!current||data.events.length>0||data.therapies.length>0;
 return <section id="ldl-goal" aria-labelledby="ldl-goal-title" className="scroll-mt-6 space-y-5 rounded-xl border bg-card p-4 sm:p-5">
  <header className="space-y-1">
   <h2 id="ldl-goal-title" className="text-h3">{t('title')}</h2>
   <p className="text-body2 text-muted-foreground">{t('intro')}</p>
   <p className="text-caption text-muted-foreground">{t('pending')}</p>
  </header>

  <dl className="grid gap-3 sm:grid-cols-2">
   <Item label={t('status')}><span className="font-semibold">{t(a.status)}</span></Item>
   <Item label={t('latest')}>{a.latest?<>{formatMmol(a.latest.mmol,current?.thresholdMmol)} {unit} · {day(a.latest.on)} · {t(`src_${a.latest.source}` as Key)}{!a.latest.memberVisible&&<> · <em>{t('hidden')}</em></>}</>:t('none')}</Item>
   {current&&<Item label={t('reduction')}>{a.reduction.state==='not_applicable'?t('notApplicable'):a.reduction.state==='not_assessable'?t(a.reduction.why)
    :<>{formatPercent(a.reduction.percent,a.reduction.requiredPct)}% · {a.reduction.state==='met'?t('met'):t('notMet')} ({t('required')} ≥{a.reduction.requiredPct}%)</>}
    {a.baselineBelowThreshold&&<span className="block text-caption">{t('belowAlready')}</span>}</Item>}
   <Item label={t('memberSees')}>{current?t('memberGoal'):inPathway?t('memberBeing'):t('memberNothing')}</Item>
  </dl>

  <Trend observations={a.observations} threshold={current?.thresholdMmol??null} t={t} day={day} unit={unit}/>
  <Events data={data} memberId={memberId} t={t} day={day} actions={actions}/>
  <Therapies data={data} memberId={memberId} t={t} day={day} actions={actions}/>
  {data.loop&&<Loop loop={data.loop} memberId={memberId} t={t} day={day} actions={actions}/>}
  <GoalForm key={current?.version??0} data={data} memberId={memberId} t={t} day={day} actions={actions}/>
  {data.goals.length>0&&<details><summary className="min-h-11 cursor-pointer text-body2">{t('versions')} ({data.goals.length})</summary>
   <ol className="divide-y">{data.goals.map(g=><li key={g.version} className="py-2 text-body2">
    v{g.version} · {t(`cat_${g.category}` as Key)} · &lt;{formatMmol(g.thresholdMmol)} {unit}{g.reductionRule?` · ≥${g.reductionPct}%`:''} · {t(`bk_${g.baseline.kind}` as Key)}{g.baseline.mmol!==null?` ${g.baseline.mmol} (${g.baseline.on?day(g.baseline.on):''})`:''}
    <span className="block text-caption text-muted-foreground">{yerevanStamp(g.setAt,locale)}{g.doctorName?` · ${g.doctorName}`:''}{g.byYou?` (${t('byYou')})`:''}{g.reason?` · ${g.reason}`:''}</span></li>)}</ol>
  </details>}
 </section>;
}

function Item({label,children}:{label:string;children:ReactNode}){
 return <div><dt className="text-caption text-muted-foreground">{label}</dt><dd className="text-body2">{children}</dd></div>;
}
/** While a save is unresolved the button resends the held command: no form validation, and the form keeps the doctor's edits. */
function SubmitOrRetry({c,label,t}:{c:ReturnType<typeof useCommand>;label:string;t:(k:Key)=>string}){
 return c.held?<button type="button" className={buttonClass} disabled={c.pending} onClick={()=>void c.send(()=>null)}>{c.pending?t('saving'):t('retry')}</button>
  :<button className={buttonClass} disabled={c.pending}>{c.pending?t('saving'):label}</button>;
}
function Result({r,t}:{r:LdlCommandResult|null;t:(k:Key)=>string}){
 if(!r)return null;const ok=r.status==='saved'||r.status==='replayed';
 return <p role={ok?'status':'alert'} className="text-body2">{t(`r_${r.status}` as Key)}{r.status==='outcome-unknown'&&<span className="block">{t('heldNote')}</span>}</p>;
}

function Trend({observations,threshold,t,day,unit}:{observations:LdlObservation[];threshold:number|null;t:(k:Key)=>string;day:(d:string)=>string;unit:string}){
 const pts=observations;
 const w=320,h=90,pad=8;
 const vals=[...pts.map(p=>p.mmol),...(threshold!==null?[threshold]:[])];
 const lo=Math.min(...vals,0),hi=Math.max(...vals,1);
 const t0=pts.length?Date.parse(pts[0].on):0,t1=pts.length?Date.parse(pts.at(-1)!.on):1;
 const x=(d:string)=>pts.length<2||t1===t0?w/2:pad+(Date.parse(d)-t0)/(t1-t0)*(w-2*pad);
 const y=(v:number)=>h-pad-(v-lo)/(hi-lo||1)*(h-2*pad);
 return <div className="space-y-2">
  <h3 className="text-body1 font-semibold">{t('trend')}</h3>
  {!pts.length?<p className="text-body2 text-muted-foreground">{t('noValues')}</p>:<>
   {pts.length>1&&<svg viewBox={`0 0 ${w} ${h}`} className="h-24 w-full max-w-md text-primary" role="img" aria-label={t('trend')}>
    {threshold!==null&&<line x1={0} x2={w} y1={y(threshold)} y2={y(threshold)} className="text-muted-foreground" stroke="currentColor" strokeDasharray="4 4"/>}
    <polyline fill="none" stroke="currentColor" strokeWidth={2} points={pts.filter(p=>p.counts).map(p=>`${x(p.on)},${y(p.mmol)}`).join(' ')}/>
    {pts.map(p=><circle key={p.id} cx={x(p.on)} cy={y(p.mmol)} r={3} fill={p.counts?'currentColor':'none'} stroke="currentColor"/>)}
   </svg>}
   <table className="w-full text-left text-body2"><thead><tr className="text-caption text-muted-foreground"><th className="py-1 font-normal">{t('date')}</th><th className="py-1 font-normal">{unit}</th><th className="py-1 font-normal">{t('source')}</th></tr></thead>
    <tbody className="divide-y">{[...pts].reverse().map(p=><tr key={p.id}><td className="py-1">{day(p.on)}</td><td className="py-1">{formatMmol(p.mmol,threshold??undefined)}</td>
     <td className="py-1">{t(`src_${p.source}` as Key)} · {p.counts?t('counts'):t('shown')}{!p.memberVisible&&<> · {t('hidden')}</>}</td></tr>)}</tbody></table>
  </>}
 </div>;
}

function Events({data,memberId,t,day,actions}:{data:DoctorLdlOn;memberId:string;t:(k:Key)=>string;day:(d:string)=>string;actions:LdlActions}){
 const add=useCommand(actions.addEvent),remove=useCommand(actions.removeEvent);
 const [type,setType]=useState<(typeof LDL_EVENT_TYPES)[number]>('acs_mi');
 return <div className="space-y-2">
  <h3 className="text-body1 font-semibold">{t('events')}</h3>
  {!data.events.length?<p className="text-body2 text-muted-foreground">{t('noEvents')}</p>:<ul className="divide-y">{data.events.map(e=><li key={e.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-body2">
   <span>{t(`ev_${e.type}` as Key)}{e.other?`: ${e.other}`:''} · {e.on?day(e.on):t('dateUnknown')} · {e.source==='document'?t('srcDocument'):t('srcDoctor')}{e.note?` · ${e.note}`:''}</span>
   <button type="button" className={secondary} disabled={remove.pending} onClick={()=>void remove.send(()=>({memberId,eventId:e.id}))}>{t('remove')}</button></li>)}</ul>}
  <Result r={remove.result} t={t}/>
  <form className="grid gap-2 sm:grid-cols-2" onSubmit={e=>{e.preventDefault();const form=e.currentTarget,f=new FormData(form);
   void add.send(sub=>({version:LDL_COMMAND_VERSION,memberId,submissionId:sub,type,other:type==='other'?String(f.get('other')??'').trim()||null:null,
    on:String(f.get('on')??'')||null,source:String(f.get('source')),note:String(f.get('note')??'').trim()||null})).then(r=>{if(r?.status==='saved')form.reset();});}}>
   <label className="text-caption">{t('type')}<select className={`${fieldClass} mt-1`} value={type} onChange={e=>setType(e.target.value as typeof type)}>
    {LDL_EVENT_TYPES.map(v=><option key={v} value={v}>{t(`ev_${v}` as Key)}</option>)}</select></label>
   {type==='other'&&<label className="text-caption">{t('describe')}<input name="other" required maxLength={120} className={`${fieldClass} mt-1`}/></label>}
   <label className="text-caption">{t('eventDate')}<input name="on" type="date" max={data.today} className={`${fieldClass} mt-1`}/></label>
   <label className="text-caption">{t('recordedFrom')}<select name="source" className={`${fieldClass} mt-1`} defaultValue="document"><option value="document">{t('srcDocument')}</option><option value="doctor_entered">{t('srcDoctor')}</option></select></label>
   <label className="text-caption sm:col-span-2">{t('note')}<input name="note" maxLength={300} className={`${fieldClass} mt-1`}/></label>
   <div className="sm:col-span-2"><SubmitOrRetry c={add} label={t('addEvent')} t={t}/></div>
  </form>
  <Result r={add.result} t={t}/>
 </div>;
}

function Loop({loop,memberId,t,day,actions}:{loop:NonNullable<DoctorLdlOn['loop']>;memberId:string;t:(k:Key)=>string;day:(d:string)=>string;actions:LdlActions}){
 const cancel=useCommand(actions.cancelRetest);
 const open=['scheduled','requested','fenced'];
 return <div className="space-y-2">
  <h3 className="text-body1 font-semibold">{t('loop')}</h3>
  {!loop.retests.length?<p className="text-body2 text-muted-foreground">{t('noRetests')}</p>:<ul className="divide-y">{loop.retests.map(r=><li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-body2">
   <span>{day(r.dueFrom)} – {day(r.dueTo)} · {t(`rs_${r.state}` as Key)}{r.overdue&&<> · <strong>{t('overdueTag')}</strong></>}{r.requestStatus?` · ${r.requestStatus}`:''}</span>
   {open.includes(r.state)&&<button type="button" className={secondary} disabled={cancel.pending} onClick={()=>void cancel.send(()=>({memberId,retestId:r.id}))}>{t('cancelRetest')}</button>}
  </li>)}</ul>}
  <Result r={cancel.result} t={t}/>
  {loop.responses.length>0&&<><h4 className="text-body2 font-semibold">{t('responses')}</h4><ul className="divide-y">{loop.responses.map(x=><li key={x.id} className="py-2 text-body2">
   {day(x.observedOn)} · {t(`st_${x.status}` as Key)} · {x.closedAt?t('reviewedOn'):t('openOnToday')}</li>)}</ul></>}
 </div>;
}

function drugLabel(d:string,other:string|null){return d==='other'?other??'':d.replace('_',' ').replace(/^./,c=>c.toUpperCase());}
function Therapies({data,memberId,t,day,actions}:{data:DoctorLdlOn;memberId:string;t:(k:Key)=>string;day:(d:string)=>string;actions:LdlActions}){
 const add=useCommand(actions.addTherapy),end=useCommand(actions.endTherapy);
 const [drug,setDrug]=useState<(typeof LDL_DRUGS)[number]>('atorvastatin');
 const [startedOn,setStartedOn]=useState(''),[book,setBook]=useState(true);
 const current=data.therapies.filter(x=>!x.endedAt),ended=data.therapies.filter(x=>x.endedAt);
 // Phase 2 (dark: the loop switch): the re-test window from lib/ldl/constants.ts, which the doctor keeps or unticks.
 const proposal=data.loop?proposeRetest({eventTypes:data.events.map(e=>e.type),startedOn:startedOn||null,today:data.today}):null;
 return <div className="space-y-2">
  <h3 className="text-body1 font-semibold">{t('therapy')}</h3>
  {!current.length&&<p className="text-body2 text-muted-foreground">{t('noTherapy')}</p>}
  {current.length>0&&<ul className="divide-y">{current.map(x=><li key={x.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-body2">
   <span>{drugLabel(x.drug,x.other)} · {x.dose}{x.startedOn?` · ${t('since')} ${day(x.startedOn)}`:''}{x.maximallyTolerated?<> · <strong>{t('maxTolShort')}</strong></>:''}</span>
   <span className="flex flex-wrap gap-2">
    <button type="button" className={secondary} disabled={end.pending} onClick={()=>void end.send(()=>({memberId,therapyId:x.id,reason:'stopped',stoppedOn:data.today}))}>{t('stop')}</button>
    <button type="button" className={secondary} disabled={end.pending} onClick={()=>void end.send(()=>({memberId,therapyId:x.id,reason:'entered_in_error',stoppedOn:null}))}>{t('errorEntry')}</button>
   </span></li>)}</ul>}
  {ended.length>0&&<p className="text-caption text-muted-foreground">{t('ended')}: {ended.map(x=>`${drugLabel(x.drug,x.other)} ${x.dose}${x.stoppedOn?` (${t('stoppedOn')} ${day(x.stoppedOn)})`:''}`).join('; ')}</p>}
  <Result r={end.result} t={t}/>
  <form className="grid gap-2 sm:grid-cols-2" onSubmit={e=>{e.preventDefault();const form=e.currentTarget,f=new FormData(form);
   void add.send(sub=>({version:LDL_COMMAND_VERSION,memberId,submissionId:sub,drug,other:drug==='other'?String(f.get('other')??'').trim()||null:null,
    dose:String(f.get('dose')??'').trim(),startedOn:String(f.get('startedOn')??'')||null,maximallyTolerated:f.get('maxTol')==='on',
    ...(data.loop?{retest:book&&proposal?proposal:null}:{})})).then(r=>{if(r?.status==='saved'){form.reset();setStartedOn('');setBook(true);}});}}>
   <label className="text-caption">{t('drug')}<select className={`${fieldClass} mt-1`} value={drug} onChange={e=>setDrug(e.target.value as typeof drug)}>
    {LDL_DRUGS.map(v=><option key={v} value={v}>{v==='other'?t('ev_other'):drugLabel(v,null)}</option>)}</select></label>
   {drug==='other'&&<label className="text-caption">{t('describe')}<input name="other" required maxLength={80} className={`${fieldClass} mt-1`}/></label>}
   <label className="text-caption">{t('dose')}<input name="dose" required maxLength={60} placeholder="40 mg" className={`${fieldClass} mt-1`}/></label>
   <label className="text-caption">{t('started')}<input name="startedOn" type="date" max={data.today} value={startedOn} onChange={e=>setStartedOn(e.target.value)} className={`${fieldClass} mt-1`}/></label>
   <label className="flex min-h-11 items-center gap-2 text-body2 sm:col-span-2"><input name="maxTol" type="checkbox" className="size-5 shrink-0"/>{t('maxTol')}</label>
   {data.loop&&<div className="space-y-1 rounded-md border p-3 sm:col-span-2">
    {proposal?<>
     <label className="flex min-h-11 items-center gap-2 text-body2"><input type="checkbox" className="size-5 shrink-0" checked={book} onChange={e=>setBook(e.target.checked)}/>{t('retestBook')}</label>
     {book&&<p className="text-body2">{t('retestWindow')}: {day(proposal.dueFrom)} – {day(proposal.dueTo)} · {proposal.rule==='acs'?t('retestAcs'):t('retestOther')}
      <span className="block text-caption text-muted-foreground">{t('retestRequest')} {day(proposal.requestOn)}.</span></p>}
    </>:<p className="text-body2 text-muted-foreground">{t('retestPast')}</p>}
   </div>}
   <div className="sm:col-span-2"><SubmitOrRetry c={add} label={t('addTherapy')} t={t}/></div>
  </form>
  <Result r={add.result} t={t}/>
 </div>;
}

function GoalForm({data,memberId,t,day,actions}:{data:DoctorLdlOn;memberId:string;t:(k:Key)=>string;day:(d:string)=>string;actions:LdlActions}){
 const set=useCommand(actions.setGoal);
 const current=data.goals[0]??null;
 const eligibility=ldlPilotEligibility(data.events);
 const ascvd=eligibility==='eligible'||eligibility==='eligible_with_warning';
 const initial:LdlCategory=current?.category??(ascvd?LDL_ASCVD_DEFAULT_CATEGORY:'very_high');
 const [category,setCategory]=useState<LdlCategory>(initial);
 const [threshold,setThreshold]=useState<number>(current?Number(current.thresholdMmol):LDL_CATEGORY_GOALS[initial].thresholdMmol);
 const [rule,setRule]=useState<boolean>(current?current.reductionRule:LDL_CATEGORY_GOALS[initial].reductionPct!==null);
 const [pct,setPct]=useState<number>(current?.reductionPct??LDL_CATEGORY_GOALS[initial].reductionPct??50);
 const [kind,setKind]=useState(current?.baseline.kind??'unknown');
 const expectedVersion=current?.version??0;
 const reductionPct=rule?pct:null;
 const needsReason=goalNeedsReason({expectedVersion,category,thresholdMmol:threshold,reductionPct});
 const pickCategory=(c:LdlCategory)=>{setCategory(c);setThreshold(LDL_CATEGORY_GOALS[c].thresholdMmol);setRule(LDL_CATEGORY_GOALS[c].reductionPct!==null);setPct(LDL_CATEGORY_GOALS[c].reductionPct??50);};
 const choices=[...new Set([...LDL_THRESHOLD_CHOICES,threshold])].sort((x,y)=>x-y);
 // Excluded with no goal yet: no form, so no category is preselected.
 if(eligibility==='excluded'&&!current)return <p role="alert" className="text-body2" data-ldl-pilot-excluded>{t('pilotExcluded')}</p>;
 return <form className="space-y-3 rounded-lg border p-3" onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget);
   const known=kind!=='unknown';const bv=known?Number(String(f.get('baselineMmol')).replace(',','.')):null;
   void set.send(sub=>({version:LDL_COMMAND_VERSION,memberId,submissionId:sub,expectedVersion,category,thresholdMmol:threshold,reductionRule:rule,reductionPct,
    baselineKind:kind,baselineMmol:bv,baselineOn:known?String(f.get('baselineOn')??'')||null:null,baselineSource:known?String(f.get('baselineSource')):null,
    nextTestOn:String(f.get('nextTestOn')??'')||null,reason:String(f.get('reason')??'').trim()||null,defaultsVersion:LDL_DEFAULTS_VERSION}));}}>
  {eligibility==='excluded'&&<p role="alert" className="text-body2" data-ldl-pilot-excluded>{t('pilotExcluded')}</p>}
  {eligibility==='eligible_with_warning'&&<p role="alert" className="text-body2" data-ldl-pilot-warning>{t('pilotWarning')}</p>}
  <h3 className="text-body1 font-semibold">{current?t('changeGoal'):t('setGoal')}</h3>
  {!current&&ascvd&&<p className="text-body2">{t('ascvdDefault')}</p>}
  <div className="grid gap-2 sm:grid-cols-2">
   <label className="text-caption">{t('category')}<select className={`${fieldClass} mt-1`} value={category} onChange={e=>pickCategory(e.target.value as LdlCategory)}>
    {LDL_CATEGORIES.map(c=><option key={c} value={c}>{t(`cat_${c}` as Key)}</option>)}</select></label>
   <label className="text-caption">{t('threshold')}<select className={`${fieldClass} mt-1`} value={String(threshold)} onChange={e=>setThreshold(Number(e.target.value))}>
    {choices.map(c=><option key={c} value={String(c)}>&lt; {formatMmol(c)}{c===LDL_CATEGORY_GOALS[category].thresholdMmol?` (${t('defaultFor')})`:''}</option>)}</select></label>
  </div>
  <label className="flex min-h-11 flex-wrap items-center gap-2 text-body2"><input type="checkbox" className="size-5 shrink-0" checked={rule} onChange={e=>setRule(e.target.checked)}/>{t('reductionRule')}
   <input type="number" min={10} max={90} step={1} value={pct} disabled={!rule} onChange={e=>setPct(Number(e.target.value))} className="min-h-11 w-20 rounded-md border bg-background px-2" aria-label="%"/>%</label>
  <fieldset className="space-y-1"><legend className="text-caption">{t('baseline')}</legend>
   {(['pre_treatment','on_treatment','unknown'] as const).map(k=><label key={k} className="flex min-h-11 items-center gap-2 text-body2"><input type="radio" name="baselineKind" className="size-5 shrink-0" checked={kind===k} onChange={()=>setKind(k)}/>{t(`bk_${k}` as Key)}</label>)}
  </fieldset>
  {kind!=='unknown'&&<div className="grid gap-2 sm:grid-cols-3">
   <label className="text-caption">{t('baselineValue')}<input name="baselineMmol" required inputMode="decimal" pattern="\d{1,2}([.,]\d{1,2})?" defaultValue={current?.baseline.mmol??''} className={`${fieldClass} mt-1`}/></label>
   <label className="text-caption">{t('baselineDate')}<input name="baselineOn" type="date" required max={data.today} defaultValue={current?.baseline.on??''} className={`${fieldClass} mt-1`}/></label>
   <label className="text-caption">{t('source')}<select name="baselineSource" className={`${fieldClass} mt-1`} defaultValue={current?.baseline.source??'document'}>
    {(['document','lab_result','doctor_entered'] as const).map(s=><option key={s} value={s}>{t(`bs_${s}` as Key)}</option>)}</select></label>
  </div>}
  <label className="block text-caption">{t('nextTest')}<input name="nextTestOn" type="date" min={data.today} defaultValue={current?.nextTestOn&&current.nextTestOn>=data.today?current.nextTestOn:''} className={`${fieldClass} mt-1 sm:max-w-xs`}/>
   {current?.nextTestOn&&<span className="text-caption text-muted-foreground"> {day(current.nextTestOn)}</span>}</label>
  <label className="block text-caption">{t('reason')} {needsReason&&t('reasonNeeded')}<textarea name="reason" required={needsReason} maxLength={500} rows={2} className={`${fieldClass} mt-1`}/></label>
  <SubmitOrRetry c={set} label={current?t('saveVersion'):t('confirm')} t={t}/>
  <Result r={set.result} t={t}/>
 </form>;
}
