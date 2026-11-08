import {bpUnit} from '@/lib/bp-unit';
import {collectionCopy,collectionStatus} from './collection';
import {pick,type Locale} from '@/lib/locale';
import {testTitle} from '@/lib/patient/catalogue-label';
import {protocolLabel,protocolSource} from './protocol-copy';
import {sampleKind,type NurseVisitReady,type NurseVisitItem} from './schema';
import {yerevanStamp} from '@/lib/staff/yerevan-time';
export const c=(l:Locale,en:string,hy:string,ru:string)=>pick(l,{en,hy,ru});
type Mark=NonNullable<NurseVisitItem['mark']>;

/** Existing visit screen copy. Keep every locale sentence identical across both entry points. */
export function visitCopy(l:Locale){const t={
  notConfirmed:c(l,'Not confirmed. Check your connection and tap again; the same entry is resent.','Չհաստատվեց։ Ստուգեք կապը և կրկին սեղմեք․ նույն գրառումը կուղարկվի։',"Не подтверждено. Проверьте соединение и нажмите ещё раз. Будет отправлена та же запись."),
  bpTitle:c(l,'Blood pressure and pulse','Զարկերակային ճնշում և զարկերակ',"Артериальное давление и пульс"),
  weightTitle:c(l,'Weight','Քաշ',"Вес"),
  waistTitle:c(l,'Waist circumference','Գոտկատեղի շրջագիծ',"Окружность талии"),
  deviceTitle:(item:Extract<NurseVisitItem,{kind:'device'}>)=>c(l,`Hand over and connect the BP monitor ${item.serial}`,`Հանձնել և միացնել ճնշման սարքը՝ ${item.serial}`,`Передать и подключить тонометр ${item.serial}`),
  bloodSample:c(l,'Blood sample','Արյան նմուշ',"Образец крови"),
  urineSample:c(l,'Urine sample','Մեզի նմուշ',"Образец мочи"),
  unknownSample:c(l,'Sample type not in the catalogue','Նմուշի տեսակը կատալոգում չկա',"Тип образца отсутствует в каталоге"),
  tubeRequirements:c(l,'Check the tube requirements with the care team before collecting.','Նմուշը վերցնելուց առաջ խնամքի թիմի հետ ճշտեք փորձանոթի պահանջները։','Перед взятием уточните у медицинской команды требования к пробирке.'),
  source:c(l,'Source','Աղբյուր',"Источник"),
  bpDetail:c(l,'Enter the reading you take at this visit.','Մուտքագրեք այս այցի ընթացքում կատարված չափումը։',"Введите результат измерения, выполненного во время этого визита."),
  weightDetail:c(l,'In kilograms. Ordered for this visit.','Կիլոգրամով։ Նշանակված է այս այցի համար։',"В килограммах. Назначено для этого визита."),
  waistDetail:c(l,'In centimetres. Ordered for this visit.','Սանտիմետրով։ Նշանակված է այս այցի համար։',"В сантиметрах. Назначено для этого визита."),
  todo:c(l,'To do','Անելիք',"Предстоит выполнить"),
  done:c(l,'Done','Արված է',"Выполнено"),
  notDone:c(l,'Not done','Չի արվել',"Не выполнено"),
  mmHg:bpUnit(l),
  pulse:c(l,'Pulse','Զարկերակ',"Пульс"),
  kg:c(l,'kg','կգ','кг'),
  cm:c(l,'cm','սմ','см'),
  completionSummary:(data:NurseVisitReady)=>c(l,`Visit completed ${yerevanStamp(data.completion!.completedAt,l)} by ${data.completion!.nurseName}. ${data.completion!.summary.samplesTaken} of ${data.completion!.summary.samplesPlanned} samples taken.`,`Այցն ավարտվել է ${yerevanStamp(data.completion!.completedAt,l)}, ${data.completion!.nurseName}։ Վերցված նմուշներ՝ ${data.completion!.summary.samplesTaken}/${data.completion!.summary.samplesPlanned}։`,`Визит завершён ${yerevanStamp(data.completion!.completedAt,l)}, ${data.completion!.nurseName}. Взято образцов: ${data.completion!.summary.samplesTaken} из ${data.completion!.summary.samplesPlanned}.`),
  reasonHeading:c(l,'Reason for incomplete items','Չարված կետերի պատճառը','Причина невыполнения пунктов'),
  visitSteps:c(l,'Visit steps','Այցի քայլերը',"Этапы визита"),
  safety:c(l,'Safety','Անվտանգություն','Безопасность'),
  samples:c(l,'Samples to take','Վերցնելու նմուշներ',"Образцы для взятия"),
  noTests:c(l,'No lab tests are ordered for this visit.','Այս այցի համար լաբորատոր հետազոտություն նշանակված չէ։',"Для этого визита лабораторные исследования не назначены."),
  measurements:c(l,'Measurements','Չափումներ',"Измерения"),
  devices:c(l,'Devices','Սարքեր',"Устройства"),
  noDevice:c(l,'No BP monitor is assigned to this member. If one should be handed over, assign it on the member page first.','Այս անդամին ճնշման սարք կցված չէ։ Եթե սարքը պետք է հանձնել, նախ կցեք այն անդամի էջում։',"Участнику не назначен тонометр. Если его нужно передать, сначала назначьте устройство на странице участника."),
  confirmed:c(l,'I confirmed the visit with the member','Ես հաստատել եմ այցը անդամի հետ',"Подтверждено с участником"),
  started:c(l,'I have arrived','Ես ժամանել եմ',"Прибытие на место"),
  onDay:c(l,"On the visit day.","Այցի օրը։","В день визита."),
  samplesCollected:c(l,'Samples collected','Նմուշները վերցված են',"Образцы взяты"),
  sampleRequired:c(l,'Tick at least one sample as taken first.','Նախ նշեք առնվազն մեկ նմուշ որպես վերցված։',"Сначала отметьте хотя бы один образец как взятый."),
  samplesAtLab:c(l,'Samples handed to the lab','Նմուշները հանձնված են լաբորատորիա',"Образцы переданы в лабораторию"),
  afterCollection:c(l,'After samples are collected.','Նմուշները վերցնելուց հետո։',"После взятия образцов."),
  you:c(l,'you','դուք',"вы"),
  saved:c(l,'Saved','Պահպանված է',"Сохранено"),
  stepOnDay:c(l,'This step can be recorded on the visit day.','Այս քայլը կարելի է գրանցել այցի օրը։',"Этот этап можно записать в день визита."),
  recordSamples:c(l,'Record the samples first.','Նախ գրանցեք նմուշները։',"Сначала запишите взятые образцы."),
  noLabEntries:c(l,'No collected samples were recorded with this visit, so nothing can be handed to the lab. Tell the admin.','Այս այցի հետ վերցված նմուշ չի գրանցվել, ուստի լաբորատորիա հանձնելու բան չկա։ Տեղեկացրեք ադմինիստրատորին։',"Для этого визита не записано взятых образцов, поэтому передать в лабораторию нечего. Сообщите администратору."),
  alreadyCompleted:c(l,'This visit is already completed.','Այս այցն արդեն ավարտված է։',"Этот визит уже завершён."),
  changedElsewhere:c(l,'This visit changed on another device, so what you were writing was not used. Check the question and answer it again.','Այցը փոխվել է մեկ այլ սարքում, ուստի ձեր գրածը չի օգտագործվել։ Ստուգեք հարցը և նորից պատասխանեք։','Визит изменился на другом устройстве, поэтому написанное вами не использовано. Проверьте вопрос и ответьте снова.'),
  changed:c(l,'This visit changed. Reload the page.','Այցը փոխվել է։ Թարմացրեք էջը։',"Данные визита изменились. Обновите страницу."),
  optional:c(l,'(optional)','(ըստ ցանկության)',"(необязательно)"),
  saving:c(l,'Saving…','Պահպանվում է…',"Сохраняется…"),
  useComplete:c(l,'Use Complete visit below.','Օգտագործեք ներքևի «Ավարտել այցը» կոճակը։',"Нажмите «Завершить визит» ниже."),
  bpRange:c(l,'Check the readings: whole numbers, systolic 60 to 300 and above diastolic, diastolic 30 to 200, pulse 20 to 250.','Ստուգեք չափումները՝ ամբողջ թվեր, սիստոլիկը 60-300 և դիաստոլիկից բարձր, դիաստոլիկը 30-200, զարկերակը 20-250։',"Проверьте измерения: целые числа, систолическое давление от 60 до 300 и выше диастолического, диастолическое от 30 до 200, пульс от 20 до 250."),
  scalarRange:(lo:number,hi:number)=>c(l,`Enter a number from ${lo} to ${hi}.`,`Մուտքագրեք թիվ ${lo}-ից ${hi}։`,`Введите число от ${lo} до ${hi}.`),
  markOnDay:c(l,'This can be recorded on the visit day.','Սա կարելի է գրանցել այցի օրը։',"Это можно записать в день визита."),
  disabled:c(l,'Nurse visits are switched off.','Բուժքրոջ այցերն անջատված են։',"Визиты медсестры отключены."),
  invalidMark:c(l,'This entry was not accepted. Check the details.','Գրառումը չընդունվեց։ Ստուգեք տվյալները։',"Запись не принята. Проверьте данные."),
  editItem:c(l,'Record or change this item','Գրանցել կամ փոխել այս կետը','Записать или изменить пункт'),
  systolic:c(l,'Systolic','Սիստոլիկ',"Систолическое"),
  diastolic:c(l,'Diastolic','Դիաստոլիկ',"Диастолическое"),
  optionalPulse:c(l,'Pulse (optional)','Զարկերակ (ըստ ցանկության)',"Пульс (необязательно)"),
  weightInput:c(l,'Weight, kg','Քաշ, կգ',"Вес, кг"),
  waistInput:c(l,'Waist, cm','Գոտկատեղ, սմ',"Окружность талии, см"),
  commentLabel:c(l,'Comment (optional). The doctor and the admin see it; the member does not.','Մեկնաբանություն (ըստ ցանկության)։ Այն տեսնում են բժիշկը և ադմինիստրատորը, անդամը՝ ոչ։',"Комментарий (необязательно). Его видят врач и администратор. Участнику он недоступен."),
  commentHelp:c(l,'Write the reading in the fields above, not here: the admin does not see readings.','Չափումը գրեք վերևի դաշտերում, ոչ այստեղ․ ադմինիստրատորը չափումները չի տեսնում։',"Введите результат измерения в полях выше, а не здесь: администратору измерения недоступны."),
  addComment:c(l,'Add a comment','Ավելացնել մեկնաբանություն',"Добавить комментарий"),
  saveReading:c(l,'Save reading','Պահպանել չափումը',"Сохранить измерение"),
  sampleTaken:c(l,'Sample taken','Նմուշը վերցված է',"Образец взят"),
  deviceDone:c(l,'Handed over and connected','Հանձնված և միացված է',"Передано и подключено"),
  measurementNotTaken:c(l,'Not taken','Չի չափվել',"Не взят"),
  notTaken:c(l,'Not taken','Չի վերցվել',"Не взят"),
  reasonError:c(l,'Say why these items are not done (at least 3 characters).','Նշեք, թե ինչու այս կետերը չեն արվել (առնվազն 3 նիշ)։',"Укажите, почему эти пункты не выполнены (не менее 3 символов)."),
  completed:c(l,'Visit completed.','Այցն ավարտված է։',"Визит завершён."),
  reasonRequired:c(l,'Some items changed. Say why the items not done were not done.','Որոշ կետեր փոխվել են։ Նշեք, թե ինչու չարված կետերը չեն արվել։',"Некоторые пункты изменились. Укажите причины невыполнения оставшихся пунктов."),
  completeOnDay:c(l,'This visit can be completed on its day.','Այս այցը կարելի է ավարտել իր օրը։',"Этот визит можно завершить в день его проведения."),
  bookingStale:c(l,'This booking changed, for example the member\'s tests were updated, so the samples cannot be recorded against it. Open the member file and check the booking with the admin before completing.','Այս ամրագրումը փոխվել է (օրինակ՝ թարմացվել են անդամի հետազոտությունները), ուստի նմուշները չեն կարող գրանցվել դրա դիմաց։ Բացեք անդամի քարտը և ադմինիստրատորի հետ ստուգեք ամրագրումը՝ ավարտելուց առաջ։',"Данные записи на визит изменились, например обновился список исследований участника. Взятые образцы нельзя связать с этой записью. Прежде чем завершить визит, откройте карту участника и проверьте запись с администратором."),
  notConfirmedComplete:c(l,'Not confirmed. Check your connection and tap Complete visit again; it is not recorded twice.','Չհաստատվեց։ Ստուգեք կապը և կրկին սեղմեք «Ավարտել այցը»․ այն երկու անգամ չի գրանցվի։',"Не подтверждено. Проверьте соединение и снова нажмите «Завершить визит». Повторная запись не создастся."),
  completeFailed:c(l,'The visit could not be completed. Reload the page and check it.','Այցը չհաջողվեց ավարտել։ Թարմացրեք էջը և ստուգեք։',"Не удалось завершить визит. Обновите страницу и проверьте его состояние."),
  completeQuestion:c(l,'Complete this visit?','Ավարտե՞լ այս այցը',"Завершить этот визит?"),
  completeExplanation:c(l,'The booking is marked completed, and the member and the care team see that the visit is done.','Այցը կնշվի ավարտված, և անդամն ու խնամքի թիմը կտեսնեն, որ այցը կայացել է։',"Запись на визит будет отмечена как завершённая. Участник и медицинская команда увидят, что визит завершён."),
  incompleteCount:(open:number)=>c(l,`${open} ${open===1?'item is':'items are'} not done:`,`Չարված կետեր՝ ${open}`,`Не выполнено пунктов (${open}):`),
  reasonLabel:c(l,'Why are these not done? (required)','Ինչու՞ դրանք չեն արվել (պարտադիր)',"Почему эти пункты не выполнены? (обязательно)"),
  allDone:c(l,'All items are done.','Բոլոր կետերն արված են։',"Все пункты выполнены."),
  completing:c(l,'Completing…','Ավարտվում է…',"Завершение…"),
  completeVisit:c(l,'Complete visit','Ավարտել այցը',"Завершить визит"),
  goBack:c(l,'Go back','Հետ գնալ',"Вернуться"),
  earlyCompletion:c(l,'You can complete this visit on its day.','Այս այցը կարող եք ավարտել իր օրը։',"Завершить визит можно в день его проведения."),
  counts:(open:number)=>c(l,`${open} not done yet`,`Դեռ չարված՝ ${open}`,`Ещё не выполнено: ${open}`),
  allItemsDone:c(l,'All items done','Բոլոր կետերն արված են',"Все пункты выполнены"),
};return {...t,
 careTeamHeading:c(l,'Check with your care team','Ճշտեք խնամքի թիմի հետ','Уточните у медицинской команды'),
 careTeamBody:c(l,'Ask the responsible doctor or administrator to check alerts and safety restrictions before the visit. This workspace does not show their status.','Այցից առաջ խնդրեք պատասխանատու բժշկին կամ ադմինիստրատորին ստուգել ահազանգերն ու անվտանգության սահմանափակումները։ Այս աշխատատարածքը դրանց վիճակը չի ցույց տալիս։','Перед визитом попросите ответственного врача или администратора проверить оповещения и ограничения безопасности. Это рабочее пространство не показывает их статус.'),
 completeLabel:t.completeVisit,
 stepButtons:{confirmed:t.confirmed,started:t.started,'samples-collected':t.samplesCollected,'samples-at-lab':t.samplesAtLab},
 markError:(status:string)=>status==='completed'?t.alreadyCompleted:status==='too-early'?t.markOnDay:status==='disabled'?t.disabled:status==='invalid'?t.invalidMark:t.changed,
 stepError:(status:string)=>status==='pending-samples'?collectionCopy(l).pending:status==='too-early'?t.stepOnDay:status==='no-samples'?t.recordSamples:status==='no-lab-entries'?t.noLabEntries:status==='completed'?t.alreadyCompleted:t.changed,
 completeError:(status:string)=>status==='pending-samples'?collectionCopy(l).pending:status==='reason-required'?t.reasonRequired:status==='too-early'?t.completeOnDay:status==='booking-stale'?t.bookingStale:status==='completed'?t.alreadyCompleted:status==='outcome-unknown'||status==='unavailable'?t.notConfirmedComplete:t.completeFailed,
};}

export const notConfirmed=(l:Locale)=>visitCopy(l).notConfirmed;

export function itemTitle(item:NurseVisitItem,l:Locale){
 if(item.kind==='sample')return visitTestTitle(item,l);
 if(item.kind==='check')return protocolLabel(item,l);
 if(item.kind==='measurement')return item.field==='bp'?visitCopy(l).bpTitle:item.field==='weight'?visitCopy(l).weightTitle:visitCopy(l).waistTitle;
 return visitCopy(l).deviceTitle(item);
}
export function itemDetail(item:NurseVisitItem,l:Locale){
 if(item.kind==='sample'){const kind=sampleKind(item.testId);const k=kind==='blood'?visitCopy(l).bloodSample:kind==='urine'?visitCopy(l).urineSample:visitCopy(l).unknownSample;
  return `${k} · ${visitCopy(l).tubeRequirements}`;}
 if(item.kind==='check')return `${visitCopy(l).source}: ${protocolSource(item.source,l)}`;
 if(item.kind==='measurement')return item.field==='bp'?visitCopy(l).bpDetail:item.field==='weight'?visitCopy(l).weightDetail:visitCopy(l).waistDetail;
 return item.model;
}

/** Known catalogue aliases only. Provider-authored titles remain recorded content. */
export function visitTestTitle(item:Extract<NurseVisitItem,{kind:'sample'}>,l:Locale){
 if(item.testId==='lipid-panel'&&item.title==='Lipid panel')return c(l,item.title,'Լիպիդային վահանակ','Липидная панель');
 if(item.testId==='ldl-retest-lipid-panel'&&item.title==='Lipid panel (LDL cholesterol) after a change to lipid treatment')return c(l,item.title,'Լիպիդային վահանակ (LDL խոլեստերին)՝ լիպիդների բուժման փոփոխությունից հետո','Липидная панель (холестерин ЛПНП) после изменения лечения липидных нарушений');
 return testTitle({id:item.testId,title:item.title},l);
}
export function stateLabel(mark:Mark|null,l:Locale){return !mark?visitCopy(l).todo:mark.done?visitCopy(l).done:visitCopy(l).notDone;}
export function valueText(item:NurseVisitItem,mark:Mark,l:Locale){
 const v=mark.values;if(!v)return null;
 if('systolic'in v)return `${v.systolic}/${v.diastolic} ${visitCopy(l).mmHg}${v.pulse!=null?` · ${visitCopy(l).pulse} ${v.pulse}`:''}`;
 return `${v.value} ${item.kind==='measurement'&&item.field==='weight'?visitCopy(l).kg:visitCopy(l).cm}`;
}


export function measurementRangeError(field:'bp'|'weight'|'waist',l:Locale){
 const t=visitCopy(l);return field==='bp'?t.bpRange:t.scalarRange(...(field==='weight'?[20,400]:[30,250]) as [number,number]);
}
/** Non-clinical block controls. Clinical instructions continue to come from the visit items. */
export function visitBlockCopy(l:Locale){return {
 allDone:c(l,'All done','Բոլորը կատարված են','Всё выполнено'),
 allDonePartial:(n:number,m:number)=>c(l,`${n} of ${m} recorded, retry`,`${m}-ից ${n}-ը գրանցված է, փորձեք կրկին`,`${n} из ${m} записано, повторите попытку`),
 details:c(l,'Details','Մանրամասներ','Подробности'),
 arrival:c(l,'Arrival','Ժամանում','Прибытие'),
 bpProtocol:c(l,'BP protocol checked','Ճնշման չափման կարգը ստուգված է','Протокол измерения АД проверен'),
 briefBp:c(l,'BP','Ճնշում','АД'),
 briefBody:c(l,'Weight/waist','Քաշ/գոտկատեղ','Вес/талия'),
 briefSamples:(names:string)=>c(l,`Samples: ${names}`,`Նմուշներ՝ ${names}`,`Образцы: ${names}`),
 allCollected:c(l,'All samples collected.','Բոլոր նմուշները վերցված են։','Все образцы взяты.'),
 leaveUntouched:c(l,'Leave unchanged','Չփոխել','Оставить без изменений'),
 undo:c(l,'Undo','Չեղարկել','Отменить'),
 baselineUnavailable:c(l,'ECG and home log are not part of this visit.','ԷՍԳ-ն և տնային չափումների օրագիրը այս այցի մաս չեն։','ЭКГ и домашний дневник не входят в этот визит.'),
 // Draft interface copy for Armen/Roo review. Protocol and safety text is unchanged.
 bpPending:(count:number)=>c(l,`Mark the remaining protocol and safety items first (${count}).`,`Նախ նշեք կարգի և անվտանգության մնացած կետերը (${count})։`,`Сначала отметьте оставшиеся пункты протокола и безопасности (${count}).`),
 next:c(l,'Next','Հաջորդը','Далее'),
 progress:(at:number,total:number)=>c(l,`${at} of ${total}`,`${at}՝ ${total}-ից`,`${at} из ${total}`),
 preview:c(l,'Check your entry','Ստուգեք ձեր գրառումը','Проверьте запись'),
 savedComment:c(l,'Saved comment','Պահպանված մեկնաբանություն','Сохранённый комментарий'),
 noteConflict:c(l,'The saved comment changed. Check both comments before confirming your entry.','Պահպանված մեկնաբանությունը փոխվել է։ Գրառումը հաստատելուց առաջ ստուգեք երկու մեկնաբանություններն էլ։','Сохранённый комментарий изменился. Проверьте оба комментария перед подтверждением записи.'),
 previewHelp:c(l,'Only the fields below will be saved after you confirm. Other items stay untouched. Empty readings need your input.','Հաստատելուց հետո կպահպանվեն միայն ներքևի դաշտերը։ Մյուս կետերը չեն փոխվի։ Լրացրեք դատարկ չափումները։','После подтверждения сохранятся только поля ниже. Остальные пункты не изменятся. Заполните пустые измерения.'),
 markRestCollected:c(l,'Mark the rest collected','Մնացածը նշել որպես վերցված','Отметить остальные как взятые'),
 checkOtherSamples:c(l,'Check the other samples','Ստուգեք մյուս նմուշները','Проверьте остальные образцы'),
 confirm:c(l,'Confirm entry','Հաստատել գրառումը','Подтвердить запись'),
 cancel:c(l,'Discard entry','Հեռացնել գրառումը','Отменить запись'),
 untouched:c(l,'Not parsed, left untouched','Չի վերլուծվել, չի փոխվել','Не распознано, оставлено без изменений'),
 collectionConflict:c(l,'Conflicting sample collection. Choose each sample status below before you confirm collection.','Նմուշառման հակասող տվյալներ։ Նմուշառումը հաստատելուց առաջ ներքևում ընտրեք յուրաքանչյուր նմուշի վիճակը։','Противоречивые данные о взятии образцов. Перед подтверждением выберите ниже статус каждого образца.'),
 collectionUnresolved:c(l,'Your collection text needs clarification. Choose each sample status below before you confirm collection.','Ձեր նմուշառման գրառումը հստակեցման կարիք ունի։ Նմուշառումը հաստատելուց առաջ ներքևում ընտրեք յուրաքանչյուր նմուշի վիճակը։','Вашу запись о взятии образцов нужно уточнить. Перед подтверждением выберите ниже статус каждого образца.'),
 shortcut:c(l,'Type a visit update or choose above','Գրեք այցի տվյալները կամ ընտրեք վերևում','Напишите данные визита или выберите выше'),
 baseline:c(l,'Baseline visit items','Ելակետային այցի կետեր','Пункты исходного визита'),
 repeatedBp:c(l,'Repeated blood pressure','Ճնշման կրկնակի չափում','Повторное измерение давления'),
 weightWaist:c(l,'Weight and waist','Քաշ և գոտկատեղ','Вес и талия'),
 ecg:c(l,'ECG','ԷՍԳ','ЭКГ'),
 homeLog:c(l,'7-day home log','Տնային չափումների 7-օրյա օրագիր','Домашний дневник за 7 дней'),
 missingItem:c(l,'No visit item is available to record this. Check with your care team.','Սա գրանցելու համար այցի կետ չկա։ Ճշտեք խնամքի թիմի հետ։','Нет пункта визита для записи. Уточните у медицинской команды.'),
 singleBp:c(l,'This visit has one BP record. Use its comment for repeated readings.','Այս այցն ունի ճնշման մեկ գրառում։ Կրկնակի չափումները նշեք դրա մեկնաբանության մեջ։','В этом визите одна запись давления. Повторные измерения укажите в её комментарии.'),
 interrupted:c(l,'Saving stopped. Check the saved ticks before preparing another entry.','Պահպանումը դադարեց։ Նոր գրառում պատրաստելուց առաջ ստուգեք պահպանված նշումները։','Сохранение остановлено. Проверьте сохранённые отметки перед новой записью.'),
 decrease:c(l,'Decrease','Նվազեցնել','Уменьшить'),
 increase:c(l,'Increase','Ավելացնել','Увеличить'),
};}

/** Safety wording stays in its existing question, without duplicating protected translations. */
export function briefingItemTitle(item:NurseVisitItem,l:Locale){return item.kind==='check'&&item.section==='safety'?visitCopy(l).safety:itemTitle(item,l);}
/** Short names for the standard visit; full catalogue wording remains in Details. */
export function visitSampleShortTitle(item:Extract<NurseVisitItem,{kind:'sample'}>,l:Locale){
 if(['lipid-panel','lipids','ldl-retest-lipid-panel'].includes(item.testId))return c(l,'Lipid','Լիպիդներ','Липиды');
 if(item.testId==='hba1c-glucose')return 'HbA1c';
 return visitTestTitle(item,l);
}
export function visitBriefing(data:NurseVisitReady,l:Locale){
 const copy=visitCopy(l),block=visitBlockCopy(l),v=data.visit;
 const place=[v.clinic,v.location].filter(Boolean).join(', ')||c(l,v.mode==='home'?'Home visit':'Clinic visit',v.mode==='home'?'Տնային այց':'Այց կլինիկա',v.mode==='home'?'Визит на дом':'Визит в клинику');
 const measurements=data.items.filter(i=>i.kind==='measurement'&&!i.mark?.done);
 const tasks=[...(measurements.some(i=>i.kind==='measurement'&&i.field==='bp')?[block.briefBp]:[]),...(measurements.some(i=>i.kind==='measurement'&&i.field!=='bp')?[block.briefBody]:[])];
 const samples=data.items.filter((i):i is Extract<NurseVisitItem,{kind:'sample'}>=>i.kind==='sample');
 const remaining=samples.filter(i=>collectionStatus(i)!=='collected');
 if(remaining.length)tasks.push(block.briefSamples(remaining.map(i=>visitSampleShortTitle(i,l)).join(', ')));
 const todo=tasks.length?` ${copy.todo}: ${tasks.join(' · ')}`:'';
 const stamp=yerevanStamp(v.startsAt,l),today=new Date(Date.parse(v.startsAt)+4*3600_000).toISOString().slice(0,10)===data.today;
 const time=today?stamp.split(', ').at(-1)!:stamp;
 const collected=samples.length&&!remaining.length?` ${block.allCollected}`:'';
 return c(l,`You have ${v.memberName} at ${time}, ${place}.${todo}${collected}`,`Ձեր այցը՝ ${v.memberName}, ${time}, ${place}։${todo}${collected}`,`У вас визит: ${v.memberName}, ${time}, ${place}.${todo}${collected}`);
}
