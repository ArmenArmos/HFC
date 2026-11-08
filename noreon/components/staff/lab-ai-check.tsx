'use client';
import type {AutoAcceptReason} from '@/lib/lab-ai/auto-accept';
import {labReviewReason} from '@/lib/lab-ai/review-copy';
import {AI_READ_LABEL} from '@/lib/lab-ai/provenance';
import {labEmptyReadMessage} from '@/lib/lab-ai/empty-read-copy';
import {done,notDone} from '@/lib/staff-zoe/outcome-copy';
import {clinicalLocale,type Locale} from '@/lib/locale';
import {useId,useRef,useState} from 'react';
import {st} from '@/lib/staff/staff-locale-copy';
import {useRecordRefresh} from '@/components/staff/record-refresh';
import {AlertTriangle,Bot,CheckCircle2,FileText} from 'lucide-react';
import {buttonClass} from './shell';
import {yerevanStamp} from '@/lib/staff/yerevan-time';
import {analyteDisplayName} from '@/lib/lab-ai/analyte-names';
import {TEST_CATALOGUE} from '@/lib/clinical/seed/tests';
import {labIdentityVersion,labReviewVersion,type IdentityResult,type LabRead,type LabSummaryRead,type LabValueRow,type ReviewResult,type ReviewCommand,type ConfirmPassingResult} from '@/lib/lab-ai/doctor-schema';

type Ready=Extract<LabRead,{enabled:true}>;
const quiet='inline-flex min-h-11 items-center justify-center rounded-md border bg-background px-4 py-2 text-body2 font-medium hover:bg-muted disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-ring';
const field='w-full min-h-11 rounded-md border bg-background px-3 py-2 text-body2 outline-none focus-visible:ring-2 focus-visible:ring-ring';
const enCopy={back:'Back to member',title:'Check values read from this PDF',aiLabel:'Prepared by AI | Not reviewed by a doctor',
  intro:'Software read these values from the clinic PDF. None of them counts until you check it against the page shown beside it.',
  openPdf:'Open the PDF in a new tab',page:'Page',pages:'Pages',showPage:'Show page',
  state:{queued:'Waiting to be read.',running:'Being read now.',rejected:'This file was not read.',failed:'Reading failed three times.',done:'Read.'} as Record<string,string>,
  outcome:{file_too_large:'The file is larger than 4 MB.',too_many_pages:'The file has more than 10 pages.',not_pdf:'The file is not a PDF.',encrypted:'The file is protected in a way automatic reading cannot open. Read it yourself.',input_oversize:'The file holds much more than its pages show, so it was not read. Read it yourself.',malformed:'The file could not be checked safely.',empty_file:'The file is empty.',
   hash_mismatch:'The stored file does not match its record.',attachment_not_current:'The file was moved or detached.',unreadable:'The PDF could not be read as a lab sheet.',no_values:'No values were found.',
   multiple_patients:'This PDF seems to hold results for more than one person. No values were kept: read it yourself.',identity_mismatch:'The name or date of birth on the sheet does not match this member.',
   model_calls_not_permitted:'Automatic reading is switched off.',reading_off:'Automatic reading is switched off.',daily_spend_cap_reached:'Today’s AI spending limit is reached. It will try again later.',tier_spend_cap_reached:'Today’s AI spending limit is reached. It will try again later.'} as Record<string,string>,
  readAgain:'Read again',identity:'Who is on the sheet',nameOnSheet:'Name on sheet',dobOnSheet:'Date of birth on sheet',sampleDate:'Sample date',notPrinted:'not printed',
  identityStatus:{match:'Name and date of birth match this member.',unknown:'The sheet does not show enough to be sure it is this member. Check the PDF, then confirm.',mismatch:'The sheet does not match this member. Check the PDF. Confirm only if it is theirs, and say why.',multiple_patients:'More than one person on this sheet.'} as Record<string,string>,
  confirmIdentity:'This PDF belongs to this member',reason:'Why it is theirs (needed when the sheet does not match)',identityConfirmed:'You confirmed this PDF belongs to this member.',
  values:'Values',noValues:'No values to check.',labRange:'Lab range',labFlag:{high:'High',low:'Low',normal:'Normal',abnormal:'Abnormal',critical:'Critical'} as Record<string,string>,
  status:{unverified:'Not checked',auto_accepted:AI_READ_LABEL.en,verified:'Confirmed',corrected:'Corrected',rejected:'Rejected'} as Record<string,string>,
  introAuto:'Software read these values from the clinic PDF. A value that needs your check counts only after you check it against the page shown beside it.',
  needsCheck:'Needs your check',autoTitle:'Unflagged values confirmed by the rules',
  autoIntro:'These values have no clinical flags and passed identity, extraction, unit, plausibility and sample-date checks. You can confirm, correct or reject each value. You still approve and publish the plan.',
  autoSource:'Show page',
  attention:{threshold:'Doctor attention: clinical rule reached',lab_critical:'Doctor attention: lab marked it critical',needs_doctor:'Doctor attention: outside the lab range'} as Record<string,string>,
  checks:{unmapped:'Not matched to a catalogue test',mapping_conflict:'Test name and match disagree',unit_missing:'No unit printed',unit_unexpected:'Unexpected unit',implausible:'Value outside the possible range: check the decimal and unit',
   censored:'Printed as below or above a limit',not_numeric:'Not a number',date_future:'Date is in the future',date_unparsed:'Date not read',page_unknown:'Page not known',range_unparsed:'Range not read'} as Record<string,string>,
  confirm:'Confirm',correct:'Correct',reject:'Reject (does not apply)',save:'Save correction',cancel:'Cancel',value:'Correct value',unit:'Unit',note:'Note (optional)',original:'Read as',saving:'Saving…',checkAgain:'Check again',
  result:{saved:'Saved.',stale:'This changed. Reload to see the current values.',invalid:'Check what you entered.',disabled:'Lab reading is switched off.','identity-first':'Confirm who is on the sheet first.','open-first':'Open the PDF first, then review.',
   unavailable:'Couldn’t save right now. Try again.',access:'Only the assigned doctor can review these values.','outcome-unknown':'Save outcome unknown. Check again: a review is never recorded twice.',
   confirmed:'Confirmed.',unchanged:'Nothing changed. Reload to see the current state.','not-allowed':'A sheet with several people cannot be confirmed.','reason-required':'Say why the sheet belongs to this member.'} as Record<string,string>,
  summary:'Summary for the doctor',narrative:'In short',priority:'Needs attention',changed:'What changed since earlier checked values',outOfRange:'Outside the lab range',missing:'Missing for the plan',gaps:'Data gaps and limits',none:'None found.',
  dir:{up:'up',down:'down',same:'no change'} as Record<string,string>,
  gap:{values_unverified:'Values are not checked by a person yet.',sheet_unreadable:'The sheet could not be read.',identity_unknown:'Identity on the sheet not confirmed.',identity_mismatch:'Identity on the sheet does not match.',
   value_unmapped:'Some tests did not match the catalogue.',value_mapping_conflict:'Some test matches disagree.',value_unit_missing:'Some units are missing.',value_unit_unexpected:'Some units are unexpected.',value_implausible:'Some values are outside the possible range.',
   value_censored:'Some values are printed as limits.',value_not_numeric:'Some values are not numbers.',value_date_future:'Some dates are in the future.',value_date_unparsed:'Some dates were not read.',value_page_unknown:'Some pages are not known.',
   plan_test_not_checkable:'Some planned tests cannot be checked automatically.',narrative_unavailable:'The short text is unavailable.'} as Record<string,string>,
  source:'Source',readBy:'Read by',stand:'the test stand-in (no AI model)',cost:'Cost',
 };
const copy:Record<Locale,typeof enCopy>={
 en:enCopy,
 hy:{back:'Վերադառնալ անդամին',title:'Ստուգել այս PDF-ից կարդացված արժեքները',aiLabel:'Պատրաստված է AI-ի միջոցով | Բժշկի կողմից չի վերանայվել',
  intro:'Այս արժեքները ծրագիրը կարդացել է կլինիկայի PDF-ից։ Դրանցից ոչ մեկը հաշվի չի առնվում, քանի դեռ չեք ստուգել այն կողքին ցուցադրված էջի հետ։',
  openPdf:'Բացել PDF-ը նոր ներդիրում',page:'Էջ',pages:'Էջեր',showPage:'Ցույց տալ էջը',
  state:{queued:'Սպասում է կարդալուն։',running:'Կարդացվում է։',rejected:'Այս ֆայլը չի կարդացվել։',failed:'Կարդալը երեք անգամ ձախողվեց։',done:'Կարդացված է։'} as Record<string,string>,
  outcome:{file_too_large:'Ֆայլը 4 ՄԲ-ից մեծ է։',too_many_pages:'Ֆայլն ունի 10-ից ավելի էջ։',not_pdf:'Ֆայլը PDF չէ։',encrypted:'Ֆայլը պաշտպանված է այնպես, որ ավտոմատ կարդալը չի կարող այն բացել։ Կարդացեք այն ինքներդ։',input_oversize:'Ֆայլը պարունակում է շատ ավելին, քան ցույց են տալիս էջերը, ուստի այն չի կարդացվել։ Կարդացեք այն ինքներդ։',malformed:'Ֆայլը հնարավոր չէր անվտանգ ստուգել։',empty_file:'Ֆայլը դատարկ է։',
   hash_mismatch:'Պահված ֆայլը չի համապատասխանում գրառմանը։',attachment_not_current:'Ֆայլը տեղափոխվել կամ անջատվել է։',unreadable:'PDF-ը հնարավոր չեղավ կարդալ որպես լաբորատոր թերթ։',no_values:'Արժեքներ չեն գտնվել։',
   multiple_patients:'Այս PDF-ը կարծես մեկից ավելի մարդու արդյունքներ ունի։ Արժեքներ չեն պահվել․ կարդացեք այն ինքներդ։',identity_mismatch:'Թերթի անունը կամ ծննդյան ամսաթիվը չի համապատասխանում այս անդամին։',
   model_calls_not_permitted:'Ավտոմատ կարդալն անջատված է։',reading_off:'Ավտոմատ կարդալն անջատված է։',daily_spend_cap_reached:'AI-ի այսօրվա ծախսի սահմանը սպառված է։ Կփորձի ավելի ուշ։',tier_spend_cap_reached:'AI-ի այսօրվա ծախսի սահմանը սպառված է։ Կփորձի ավելի ուշ։'} as Record<string,string>,
  readAgain:'Կարդալ կրկին',identity:'Ով է նշված թերթում',nameOnSheet:'Անունը թերթում',dobOnSheet:'Ծննդյան ամսաթիվը թերթում',sampleDate:'Նմուշի ամսաթիվ',notPrinted:'նշված չէ',
  identityStatus:{match:'Անունը և ծննդյան ամսաթիվը համապատասխանում են այս անդամին։',unknown:'Թերթում բավարար տվյալ չկա համոզվելու, որ սա այս անդամն է։ Ստուգեք PDF-ը, ապա հաստատեք։',mismatch:'Թերթը չի համապատասխանում այս անդամին։ Ստուգեք PDF-ը։ Հաստատեք միայն եթե այն իրենն է, և նշեք պատճառը։',multiple_patients:'Այս թերթում մեկից ավելի մարդ կա։'} as Record<string,string>,
  confirmIdentity:'Այս PDF-ը պատկանում է այս անդամին',reason:'Ինչու է այն իրենը (պարտադիր է, երբ թերթը չի համապատասխանում)',identityConfirmed:'Դուք հաստատել եք, որ այս PDF-ը պատկանում է այս անդամին։',
  values:'Արժեքներ',noValues:'Ստուգելու արժեքներ չկան։',labRange:'Լաբորատորիայի միջակայք',labFlag:{high:'Բարձր',low:'Ցածր',normal:'Նորմալ',abnormal:'Շեղված',critical:'Կրիտիկական'} as Record<string,string>,
  status:{unverified:'Ստուգված չէ',auto_accepted:AI_READ_LABEL.hy,verified:'Հաստատված',corrected:'Ուղղված',rejected:'Մերժված'} as Record<string,string>,
  introAuto:'Այս արժեքները ծրագիրը կարդացել է կլինիկայի PDF-ից։ Ձեր ստուգման կարիք ունեցող արժեքը հաշվի է առնվում միայն այն բանից հետո, երբ այն ստուգեք կողքին ցուցադրված էջի հետ։',
  needsCheck:'Պետք է ստուգեք',autoTitle:'Կանոններով հաստատված չնշված արժեքներ',
  autoIntro:'Այս արժեքները կլինիկական նշումներ չունեն և անցել են անձի, ընթերցման, միավորի, հավանականության և նմուշառման ամսաթվի ստուգումները։ Կարող եք հաստատել, ուղղել կամ մերժել յուրաքանչյուր արժեք։ Դուք դեռ հաստատում և հրապարակում եք պլանը։',
  autoSource:'Ցույց տալ էջը',
  attention:{threshold:'Բժշկի ուշադրություն․ կլինիկական կանոնը գործել է',lab_critical:'Բժշկի ուշադրություն․ լաբորատորիան նշել է կրիտիկական',needs_doctor:'Բժշկի ուշադրություն․ լաբորատորիայի միջակայքից դուրս'} as Record<string,string>,
  checks:{unmapped:'Չի համընկնում կատալոգի հետազոտության հետ',mapping_conflict:'Անվանումը և համընկնումը չեն համաձայնվում',unit_missing:'Միավորը նշված չէ',unit_unexpected:'Անսպասելի միավոր',implausible:'Արժեքը հնարավոր միջակայքից դուրս է․ ստուգեք տասնորդականը և միավորը',
   censored:'Նշված է որպես սահմանից ցածր կամ բարձր',not_numeric:'Թիվ չէ',date_future:'Ամսաթիվը ապագայում է',date_unparsed:'Ամսաթիվը չի կարդացվել',page_unknown:'Էջն անհայտ է',range_unparsed:'Միջակայքը չի կարդացվել'} as Record<string,string>,
  confirm:'Հաստատել',correct:'Ուղղել',reject:'Մերժել (կիրառելի չէ)',save:'Պահպանել ուղղումը',cancel:'Չեղարկել',value:'Ճիշտ արժեք',unit:'Միավոր',note:'Նշում (ըստ ցանկության)',original:'Կարդացվել է որպես',saving:'Պահպանվում է…',checkAgain:'Կրկին ստուգել',
  result:{saved:'Պահպանված է։',stale:'Սա փոխվել է։ Թարմացրեք էջը։',invalid:'Ստուգեք մուտքագրածը։',disabled:'Լաբորատոր կարդալն անջատված է։','identity-first':'Նախ հաստատեք, թե ով է նշված թերթում։','open-first':'Նախ բացեք PDF-ը, ապա ստուգեք։',
   unavailable:'Այս պահին չհաջողվեց պահպանել։ Փորձեք կրկին։',access:'Միայն կցված բժիշկը կարող է ստուգել այս արժեքները։','outcome-unknown':'Պահպանման արդյունքն անհայտ է։ Կրկին ստուգեք․ ստուգումը երբեք երկու անգամ չի գրանցվում։',
   confirmed:'Հաստատված է։',unchanged:'Ոչինչ չփոխվեց։ Թարմացրեք էջը։','not-allowed':'Մի քանի մարդու թերթը հնարավոր չէ հաստատել։','reason-required':'Նշեք, թե ինչու է թերթը պատկանում այս անդամին։'} as Record<string,string>,
  summary:'Ամփոփում բժշկի համար',narrative:'Հակիրճ',priority:'Ուշադրության կարիք ունի',changed:'Ինչ է փոխվել նախկինում ստուգված արժեքներից ի վեր',outOfRange:'Լաբորատորիայի միջակայքից դուրս',missing:'Պլանից բացակայում է',gaps:'Տվյալների բացեր և սահմանափակումներ',none:'Չի գտնվել։',
  dir:{up:'աճ',down:'նվազում',same:'առանց փոփոխության'} as Record<string,string>,
  gap:{values_unverified:'Արժեքները դեռ մարդու կողմից ստուգված չեն։',sheet_unreadable:'Թերթը հնարավոր չեղավ կարդալ։',identity_unknown:'Թերթի անձը հաստատված չէ։',identity_mismatch:'Թերթի անձը չի համապատասխանում։',
   value_unmapped:'Որոշ հետազոտություններ չեն համընկել կատալոգի հետ։',value_mapping_conflict:'Որոշ համընկնումներ հակասական են։',value_unit_missing:'Որոշ միավորներ բացակայում են։',value_unit_unexpected:'Որոշ միավորներ անսպասելի են։',value_implausible:'Որոշ արժեքներ հնարավոր միջակայքից դուրս են։',
   value_censored:'Որոշ արժեքներ նշված են որպես սահման։',value_not_numeric:'Որոշ արժեքներ թվեր չեն։',value_date_future:'Որոշ ամսաթվեր ապագայում են։',value_date_unparsed:'Որոշ ամսաթվեր չեն կարդացվել։',value_page_unknown:'Որոշ էջեր անհայտ են։',
   plan_test_not_checkable:'Որոշ պլանավորված հետազոտություններ հնարավոր չէ ավտոմատ ստուգել։',narrative_unavailable:'Հակիրճ տեքստը հասանելի չէ։'} as Record<string,string>,
  source:'Աղբյուր',readBy:'Կարդացել է',stand:'փորձնական փոխարինողը (առանց AI մոդելի)',cost:'Արժեք',
 },
 ru:{
  back:"Вернуться к участнику",title:"Проверить показатели, распознанные из этого PDF",aiLabel:"Подготовлено ИИ | Не проверено врачом",
  intro:"Программа распознала эти показатели из PDF клиники. Они не учитываются, пока вы не сверите их со страницей, показанной рядом.",openPdf:"Открыть PDF в новой вкладке",page:"Страница",
  pages:"Страницы",showPage:"Показать страницу",
  state:{queued:"Ожидает распознавания.",running:"Распознаётся.",rejected:"Этот файл не распознан.",failed:"Три попытки распознавания завершились неудачно.",done:"Распознано."} as Record<string,string>,
  outcome:{file_too_large:"Размер файла превышает 4 МБ.",too_many_pages:"В файле больше 10 страниц.",not_pdf:"Это не PDF.",encrypted:"Защита файла не позволяет открыть его для автоматического распознавания. Просмотрите его самостоятельно.",input_oversize:"Файл содержит значительно больше данных, чем видно на страницах, поэтому он не распознан. Просмотрите его самостоятельно.",malformed:"Не удалось безопасно проверить файл.",empty_file:"Файл пуст.",hash_mismatch:"Сохранённый файл не соответствует записи о нём.",attachment_not_current:"Файл перемещён или откреплён.",unreadable:"Не удалось распознать PDF как лабораторный бланк.",no_values:"Показатели не найдены.",multiple_patients:"По-видимому, PDF содержит результаты нескольких человек. Показатели не сохранены: просмотрите файл самостоятельно.",identity_mismatch:"Имя или дата рождения на бланке не совпадают с данными этого участника.",model_calls_not_permitted:"Автоматическое распознавание отключено.",reading_off:"Автоматическое распознавание отключено.",daily_spend_cap_reached:"Достигнут дневной лимит расходов на ИИ. Попытка будет повторена позже.",tier_spend_cap_reached:"Достигнут дневной лимит расходов на ИИ. Попытка будет повторена позже."} as Record<string,string>,
  readAgain:"Распознать ещё раз",identity:"Кому принадлежит бланк",nameOnSheet:"Имя на бланке",dobOnSheet:"Дата рождения на бланке",sampleDate:"Дата взятия образца",notPrinted:"не указано",
  identityStatus:{match:"Имя и дата рождения совпадают с данными этого участника.",unknown:"На бланке недостаточно данных, чтобы убедиться, что он принадлежит этому участнику. Проверьте PDF, затем подтвердите.",mismatch:"Данные на бланке не совпадают с данными этого участника. Проверьте PDF. Подтвердите только в том случае, если бланк принадлежит ему, и укажите причину.",multiple_patients:"На этом бланке данные нескольких человек."} as Record<string,string>,
  confirmIdentity:"Этот PDF принадлежит этому участнику",reason:"Почему он принадлежит этому участнику (обязательно при несовпадении данных)",
  identityConfirmed:"Вы подтвердили, что этот PDF принадлежит этому участнику.",values:"Показатели",noValues:"Нет показателей для проверки.",labRange:"Референсный интервал лаборатории",
  labFlag:{high:"Повышен",low:"Понижен",normal:"В норме",abnormal:"Отклонение",critical:"Критический"} as Record<string,string>,
  status:{unverified:"Не проверено",auto_accepted:AI_READ_LABEL.ru,verified:"Подтверждено",corrected:"Исправлено",rejected:"Отклонено"} as Record<string,string>,
  introAuto:"Программа распознала эти показатели из PDF клиники. Показатель, требующий вашей проверки, учитывается только после сверки со страницей, показанной рядом.",
  needsCheck:"Требует вашей проверки",autoTitle:'Показатели без отметок, подтверждённые правилами',
  autoIntro:'Эти показатели не имеют клинических отметок и прошли проверки личности, распознавания, единиц, правдоподобия и даты взятия образца. Вы можете подтвердить, исправить или отклонить каждый показатель. План по-прежнему утверждаете и публикуете вы.',
  autoSource:'Показать страницу',
  attention:{threshold:"Вниманию врача: достигнут порог клинического правила",lab_critical:"Вниманию врача: лаборатория отметила как критический",needs_doctor:"Вниманию врача: за пределами референсного интервала лаборатории"} as Record<string,string>,
  checks:{unmapped:"Не сопоставлено с исследованием из каталога",mapping_conflict:"Название исследования не соответствует сопоставлению",unit_missing:"Единица измерения не указана",unit_unexpected:"Неожиданная единица измерения",implausible:"Значение вне допустимого диапазона: проверьте десятичный разделитель и единицу измерения",censored:"Указано как ниже или выше предела",not_numeric:"Не число",date_future:"Дата в будущем",date_unparsed:"Дата не распознана",page_unknown:"Страница неизвестна",range_unparsed:"Референсный интервал не распознан"} as Record<string,string>,
  confirm:"Подтвердить",correct:"Исправить",reject:"Отклонить (не относится)",save:"Сохранить исправление",cancel:"Отмена",value:"Правильное значение",unit:"Единица измерения",
  note:"Примечание (необязательно)",original:"Распознано как",saving:"Сохраняется…",checkAgain:"Проверить ещё раз",
  result:{saved:"Сохранено.",stale:"Данные изменились. Обновите страницу, чтобы увидеть текущие показатели.",invalid:"Проверьте введённые данные.",disabled:"Распознавание лабораторных документов отключено.","identity-first":"Сначала подтвердите, кому принадлежит бланк.","open-first":"Сначала откройте PDF, затем проверьте показатели.",unavailable:"Сейчас не удалось сохранить. Попробуйте снова.",access:"Только назначенный врач может проверять эти показатели.","outcome-unknown":"Результат сохранения неизвестен. Проверьте ещё раз: проверка никогда не записывается дважды.",confirmed:"Подтверждено.",unchanged:"Ничего не изменилось. Обновите страницу, чтобы увидеть текущее состояние.","not-allowed":"Нельзя подтвердить бланк с данными нескольких человек.","reason-required":"Укажите, почему бланк принадлежит этому участнику."} as Record<string,string>,
  summary:"Сводка для врача",narrative:"Кратко",priority:"Требует внимания",changed:"Что изменилось по сравнению с ранее проверенными показателями",
  outOfRange:"За пределами референсного интервала лаборатории",missing:"Не хватает для плана",gaps:"Пробелы и ограничения данных",none:"Не найдено.",
  dir:{up:"повышение",down:"снижение",same:"без изменений"} as Record<string,string>,
  gap:{values_unverified:"Показатели ещё не проверены человеком.",sheet_unreadable:"Не удалось прочитать бланк.",identity_unknown:"Принадлежность бланка не подтверждена.",identity_mismatch:"Данные человека на бланке не совпадают.",value_unmapped:"Некоторые исследования не сопоставлены с каталогом.",value_mapping_conflict:"Некоторые сопоставления исследований противоречивы.",value_unit_missing:"Некоторые единицы измерения отсутствуют.",value_unit_unexpected:"Некоторые единицы измерения неожиданные.",value_implausible:"Некоторые значения вне допустимого диапазона.",value_censored:"Некоторые значения указаны как пределы.",value_not_numeric:"Некоторые значения не являются числами.",value_date_future:"Некоторые даты в будущем.",value_date_unparsed:"Некоторые даты не распознаны.",value_page_unknown:"Некоторые страницы неизвестны.",plan_test_not_checkable:"Некоторые запланированные исследования нельзя проверить автоматически.",narrative_unavailable:"Краткий текст недоступен."} as Record<string,string>,
  source:"Источник",readBy:"Распознано с помощью",stand:"тестового заменителя (без модели ИИ)",cost:"Стоимость",
 },
};
export const labCheckMessage=(status:string,locale:Locale)=>copy[locale].result[status]??status;
type T=typeof copy.en;
type ConfirmPassingInput={memberId:string;fileId:string;submissionId:string};
type Ports={confirmPassing?:(input:ConfirmPassingInput)=>Promise<ConfirmPassingResult>;review:(input:unknown)=>Promise<ReviewResult>;confirmIdentity:(input:unknown)=>Promise<IdentityResult>;readAgain:()=>Promise<{status:string}>};

type Chat={inlinePdf?:boolean;onPdfLoad?:()=>void;onOpenPdf:(page:number)=>void;onReviewed:(value:LabValueRow,command:ReviewCommand,savedStatus?:string)=>void};

export function LabAiCheck({ruleBlocks={},identityRequired=false,data,memberId,locale,submissionIds,ports,pdfHref,chat}:{ruleBlocks?:Record<string,AutoAcceptReason|null>;identityRequired?:boolean;data:Ready;memberId:string;locale:Locale;submissionIds:Record<string,string>;ports:Ports;pdfHref?:string;chat?:Chat}){
 const t=copy[locale];
 const refresh=useRecordRefresh();
 const id=useId(),valuesId=chat?`${id}-values`:'lab-values';
 const [page,setPage]=useState(1);
 const pdf=pdfHref??`/staff/real/members/${memberId}/documents/${data.fileId}`;
 const job=data.job;
 // The audited read reports unconfirmed clinic overrides as mismatch, even if AI guessed match.
 const needsIdentity=identityRequired||(!job?.identityConfirmedAt&&job?.identityStatus!=='match');
 const onPage=chat?.onOpenPdf??setPage;
 return <div className="space-y-4" lang={locale}>
  <header className="space-y-2">
   {!chat&&<a className="inline-flex min-h-11 items-center text-body2 underline" href={`/staff/real/members/${memberId}`}>{t.back}</a>}
   <p className="inline-flex items-center gap-2 rounded-md bg-surface-subtle-gold px-3 py-1 text-caption font-medium"><Bot className="size-4" aria-hidden/>{t.aiLabel}</p>
   <h1 className="text-h2">{t.title}</h1>
   <p className="max-w-3xl text-body2 text-muted-foreground">{chat?st(locale,'Check each value against the PDF.','Յուրաքանչյուր արժեքը ստուգեք PDF-ի հետ։','Сверьте каждый показатель с PDF.') :data.values.some(v=>v.status==='auto_accepted')?t.introAuto:t.intro}</p>
   <p className="text-caption text-muted-foreground"><FileText className="mr-1 inline size-4" aria-hidden/>{data.name} · {data.clinic} · <time dateTime={data.uploadedAt}>{yerevanStamp(data.uploadedAt,locale)}</time></p>
  </header>
  <div className={chat?undefined:"grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]"}>
   {(!chat||chat.inlinePdf)&&<section aria-label="PDF" className={chat?"space-y-2":"space-y-2 lg:sticky lg:top-4 lg:self-start"}>
    <iframe key={page} title={`${t.page} ${page}`} src={`${pdf}#page=${page}`} onLoad={chat?chat.onPdfLoad:()=>refresh(undefined,false)} className={chat?"h-[45vh] min-h-64 w-full rounded-lg border bg-muted":"h-[70vh] min-h-96 w-full rounded-lg border bg-muted"}/>
    {!chat&&<a className="inline-flex min-h-11 items-center text-body2 underline" href={`${pdf}#page=${page}`} target="_blank" rel="noreferrer">{t.openPdf}</a>}
   </section>}
   {chat&&<button type="button" className={quiet} onClick={()=>onPage(page)}>{st(locale,'Open the PDF','Բացել PDF-ը','Открыть PDF')}</button>}
   <div className="min-w-0 space-y-4">
    <JobState data={data} t={t} ports={ports} locale={locale} chat={!!chat}/>
    {job?.state==='done'&&data.values.length===0&&<p className="text-body2">{labEmptyReadMessage(locale)}</p>}
    {!needsIdentity&&job?.summary&&<Summary summary={job.summary} t={t} locale={locale} onPage={onPage} headingId={chat?`${id}-summary`:undefined}/>}
    {job?.identity&&<Identity locale={locale} chat={!!chat} data={data} memberId={memberId} t={t} ports={ports} headingId={chat?`${id}-identity`:undefined}/>}
    {!needsIdentity&&job?.state==='done'&&data.values.length>0&&<section className="min-w-0 space-y-3 rounded-xl border bg-background p-4" aria-labelledby={valuesId}>
     <h2 id={valuesId} className="text-h3">{t.values}</h2>
     {chat&&!data.openedByYou&&<p role="status" className="text-body2">{t.result['open-first']}</p>}
     {data.values.length?<ValueLists chat={!!chat} locale={locale} ruleBlocks={ruleBlocks} values={data.values} bulk={ports.confirmPassing?<ConfirmPassing count={data.values.filter(v=>v.status==='unverified'&&!hasClinicalFlag(v)&&ruleBlocks[v.valueId]===null).length} opened={data.openedByYou} memberId={memberId} fileId={data.fileId} locale={locale} t={t} confirm={ports.confirmPassing}/>:undefined} render={v=><Value key={v.valueId} v={v} ruleReason={ruleBlocks[v.valueId]} locale={locale} memberId={memberId} t={t} submissionIds={submissionIds} ports={ports} onPage={onPage} chat={chat}/>} t={t}/>:<p className="text-body2">{t.noValues}</p>}
    </section>}
   </div>
  </div>
 </div>;
}

const hasClinicalFlag=(v:LabValueRow)=>!!v.attention||!!(v.labFlag&&v.labFlag!=='normal');

/** Clinical flags stay visible first, even when the rules confirmed the extraction. */
function ValueLists({values,render,t,chat,locale,ruleBlocks,bulk}:{bulk?:React.ReactNode;ruleBlocks:Record<string,AutoAcceptReason|null>;locale:Locale;chat?:boolean;values:LabValueRow[];render:(v:LabValueRow)=>React.ReactNode;t:T}){
 const flagged=values.filter(hasClinicalFlag);
 const unflagged=values.filter(v=>!hasClinicalFlag(v));
 const auto=unflagged.filter(v=>v.status==='auto_accepted'),rest=unflagged.filter(v=>v.status!=='auto_accepted');
 const needs=rest.filter(v=>v.status==='unverified'&&ruleBlocks[v.valueId]!==null);
 const passing=rest.filter(v=>v.status==='unverified'&&ruleBlocks[v.valueId]===null);
 const reviewed=rest.filter(v=>v.status!=='unverified');
 const [autoOpen,setAutoOpen]=useState(()=>!chat&&!flagged.length&&!rest.length);
 // Keep manual rows under one parent so regrouping cannot discard an uncertain review's retry.
 const group=(label:string,rows:LabValueRow[],controls?:React.ReactNode)=>rows.length||controls?[<li key={label} className="space-y-2">{rows.length>0&&<h3 className="text-body1 font-medium">{label} ({rows.length})</h3>}{controls}</li>,...rows.map(render)]:[];
 const attention=group(st(locale,'Needs attention','Ուշադրության կարիք ունի','Требует внимания'),flagged);
 const manual=[
  ...attention,
  ...group(chat?st(locale,'Needs your eyes','Ձեր ուշադրության կարիքն ունի','Нужно ваше внимание'):t.needsCheck,needs),
  ...group(st(locale,'Pass the rules','Համապատասխանում են կանոններին','Прошли правила'),passing,bulk),
  ...group(st(locale,'Reviewed','Վերանայված','Проверены'),reviewed),
 ];
 return <div className="space-y-4">
  {manual.length>0&&<ul className="space-y-3">{manual}</ul>}
  {auto.length>0&&<details className="space-y-2 rounded-lg border bg-surface-subtle-teal p-3" open={autoOpen} onToggle={e=>setAutoOpen(e.currentTarget.open)}>
   <summary className="min-h-11 cursor-pointer py-2 text-body1 font-medium">{t.autoTitle} ({auto.length})</summary>
   <p className="text-caption text-muted-foreground">{t.autoIntro}</p>
   <ul className="mt-2 space-y-3">{auto.map(render)}</ul>
  </details>}
 </div>;
}

/** A retry keeps the exact request: the server owns eligibility and the saved counts. */
function ConfirmPassing({count,opened,memberId,fileId,locale,t,confirm}:{count:number;opened:boolean;memberId:string;fileId:string;locale:Locale;t:T;confirm:NonNullable<Ports['confirmPassing']>}){
 const refresh=useRecordRefresh();
 const busy=useRef(false);
 const [pending,setPending]=useState(false),[frozen,setFrozen]=useState<ConfirmPassingInput|null>(null),[result,setResult]=useState<ConfirmPassingResult|null>(null);
 async function send(){
  if(busy.current||!opened)return;
  busy.current=true;setPending(true);setResult(null);
  const input=frozen??{memberId,fileId,submissionId:crypto.randomUUID()};
  setFrozen(input);
  const next=await confirm(input).catch(():ConfirmPassingResult=>({status:'outcome-unknown'}));
  setResult(next);setPending(false);busy.current=false;
  if(next.status!=='outcome-unknown')setFrozen(null);
  if(next.status==='saved')refresh();
 }
 const saved=result?.status==='saved'?st(locale,`${result.confirmed} confirmed. ${result.remaining} still need you.`,`${result.confirmed} արժեք հաստատված է։ ${result.remaining} արժեքի համար դեռ ձեր ստուգումն է պետք։`,`Подтверждено: ${result.confirmed}. Ещё требуют вашей проверки: ${result.remaining}.`):null;
 const message=result?.status==='saved'?`${result.replayed?st(locale,'Already saved. ','Արդեն պահպանված է։ ','Уже сохранено. '):''}${saved}`
  :result?.status==='stale'?st(locale,'Something changed, reload and check','Տվյալները փոխվել են, թարմացրեք և ստուգեք','Данные изменились, обновите и проверьте')
  :result?.status==='open-first'?st(locale,'Open the PDF first','Նախ բացեք PDF-ը','Сначала откройте PDF')
  :result?t.result[result.status]??t.result.unavailable:null;
 if(!count&&!frozen&&!result)return null;
 return <div className="space-y-2">
  {opened&&(count>0||frozen)&&<button type="button" className={buttonClass} disabled={pending} onClick={()=>void send()}>{pending?t.saving:frozen?t.checkAgain:st(locale,`Confirm all ${count} that pass the rules`,`Հաստատել կանոններին համապատասխանող բոլոր ${count} արժեքները`,`Подтвердить все ${count} показателя, прошедшие правила`)}</button>}
  {message&&<p role={result?.status==='saved'?'status':'alert'} className="text-body2">{message}</p>}
 </div>;
}

function JobState({data,t,ports,locale,chat}:{data:Ready;t:T;ports:Ports;locale:Locale;chat:boolean}){
 const refresh=useRecordRefresh();const [pending,setPending]=useState(false),[msg,setMsg]=useState<string|null>(null);
 const job=data.job;
 const state=job?t.state[job.state]:t.state.queued;
 const outcome=job?.outcome?t.outcome[job.outcome]:null;
 const stand=job?.provider==='noreon.fake';
 return <section className="space-y-2 rounded-xl border bg-background p-4" aria-live="polite">
  <p className="text-body2 font-medium">{state}{outcome?` ${outcome}`:''}</p>
  {job?.state==='done'&&<p className="text-caption text-muted-foreground">{t.readBy}: {stand?t.stand:job.model} · {t.pages}: {job.pageCount} · {t.cost}: US${job.calls.costUsd.toFixed(4)}</p>}
  {(!job||job.state==='failed')&&<button type="button" className={quiet} disabled={pending} onClick={async()=>{setPending(true);const r=await ports.readAgain().catch(()=>({status:'unavailable'}));setPending(false);setMsg(chat?(r.status==='queued'?done('lab-queued',locale):notDone('action',locale,t.result[r.status]??t.result.unavailable!)):t.result[r.status]??null);refresh(undefined,false);}}>{pending?t.saving:t.readAgain}</button>}
  {msg&&<p role="status" className="text-body2">{msg}</p>}
 </section>;
}

function Summary({summary,t,locale,onPage,headingId='lab-summary'}:{headingId?:string;summary:LabSummaryRead;t:T;locale:Locale;onPage:(n:number)=>void}){
 const list=<X,>(items:X[],render:(x:X,i:number)=>React.ReactNode)=>items.length?<ul className="space-y-1">{items.map((x,i)=><li key={i} className="text-body2">{render(x,i)}</li>)}</ul>:<p className="text-body2 text-muted-foreground">{t.none}</p>;
 const unit=(u:string|null)=>u?` ${u}`:'';
 return <section className="space-y-3 rounded-xl border border-brand-gold bg-surface-subtle-gold p-4" aria-labelledby={headingId}>
  <div className="space-y-1"><h2 id={headingId} className="text-h3">{t.summary}</h2><p className="text-caption font-medium">{t.aiLabel}</p></div>
  {summary.narrative&&<div><h3 className="text-body2 font-medium">{t.narrative}</h3><p className="text-body2">{summary.narrative[clinicalLocale(locale)]}</p></div>}
  <div><h3 className="text-body2 font-medium">{t.priority}</h3>{list(summary.priority,p=><><AlertTriangle className="mr-1 inline size-4" aria-hidden/>{analyteDisplayName(p.testName,locale)}: {p.valueText}{unit(p.unit)} · {t.attention[p.reason]} · <button type="button" className="underline" onClick={()=>onPage(p.page)}>{t.page} {p.page}</button></>)}</div>
  <div><h3 className="text-body2 font-medium">{t.changed}</h3>{list(summary.changed,c=><>{analyteDisplayName(c.testName,locale,c.analyte)}: {c.previous.value}{unit(c.previous.unit)}{c.previous.date?` (${c.previous.date})`:''} → {c.latest.valueText}{unit(c.latest.unit)}{c.latest.date?` (${c.latest.date})`:''} · {t.dir[c.direction]}</>)}</div>
  <div><h3 className="text-body2 font-medium">{t.outOfRange}</h3>{list(summary.outOfRange,o=><>{analyteDisplayName(o.testName,locale)}: {o.valueText}{unit(o.unit)}{o.refText?` · ${t.labRange} ${o.refText}`:''}{o.labFlag?` · ${t.labFlag[o.labFlag]??o.labFlag}`:''}</>)}</div>
  <div><h3 className="text-body2 font-medium">{t.missing}</h3>{list(summary.missingForPlan,m=><>{TEST_CATALOGUE.find(x=>x.id===m.testId)?.name[locale]??m.title}</>)}</div>
  <div><h3 className="text-body2 font-medium">{t.gaps}</h3>{list(summary.dataGaps,g=><>{t.gap[g]??g}</>)}</div>
 </section>;
}

function Identity({data,memberId,t,ports,locale,chat,headingId='lab-identity'}:{headingId?:string;data:Ready;memberId:string;t:T;ports:Ports;locale:Locale;chat:boolean}){
 const refresh=useRecordRefresh();const job=data.job!;const id=job.identity!;
 const [note,setNote]=useState(''),[pending,setPending]=useState(false),[msg,setMsg]=useState<string|null>(null);
 const needs=job.identityStatus!=='match'&&job.identityStatus!=='multiple_patients'&&!job.identityConfirmedAt&&job.state==='done';
 return <section className="space-y-2 rounded-xl border bg-background p-4" aria-labelledby={headingId}>
  <h2 id={headingId} className="text-h3">{t.identity}</h2>
  <dl className="grid gap-2 sm:grid-cols-3">
   <div><dt className="text-caption text-muted-foreground">{t.nameOnSheet}</dt><dd className="break-words text-body2">{id.nameOnSheet??t.notPrinted}</dd></div>
   <div><dt className="text-caption text-muted-foreground">{t.dobOnSheet}</dt><dd className="text-body2">{id.birthDateOnSheet??t.notPrinted}</dd></div>
   <div><dt className="text-caption text-muted-foreground">{t.sampleDate}</dt><dd className="text-body2">{id.sampleDate??t.notPrinted}</dd></div>
  </dl>
  <p role={job.identityStatus==='match'?undefined:'alert'} className="text-body2">{job.identityStatus==='match'?<CheckCircle2 className="mr-1 inline size-4" aria-hidden/>:<AlertTriangle className="mr-1 inline size-4" aria-hidden/>}{t.identityStatus[job.identityStatus??'unknown']}</p>
  {job.identityConfirmedAt&&<p className="text-body2">{t.identityConfirmed}{job.identityNote?` ${job.identityNote}`:''}</p>}
  {needs&&<form className="space-y-2" onSubmit={async e=>{e.preventDefault();if(pending)return;setPending(true);setMsg(null);
    const r=await ports.confirmIdentity({version:labIdentityVersion,memberId,jobId:job.jobId,...(note.trim()?{note:note.trim()}:{})}).catch(():IdentityResult=>({status:'outcome-unknown'}));
    setPending(false);setMsg(chat?(r.status==='confirmed'?done('lab-identity',locale):notDone('action',locale,t.result[r.status]??t.result.unavailable!)):t.result[r.status]??null);if(r.status==='confirmed')refresh();}}>
   <label className="block text-caption">{t.reason}<textarea className={`${field} mt-1`} rows={2} maxLength={300} value={note} onChange={e=>setNote(e.target.value)} required={job.identityStatus==='mismatch'}/></label>
   <button className={buttonClass} disabled={pending}>{pending?t.saving:t.confirmIdentity}</button>
  </form>}
  {msg&&<p role="status" className="text-body2">{msg}</p>}
 </section>;
}

function Value({v,ruleReason,locale,memberId,t,submissionIds,ports,onPage,chat}:{v:LabValueRow;ruleReason?:AutoAcceptReason|null;locale:Locale;memberId:string;t:T;submissionIds:Record<string,string>;ports:Ports;onPage:(n:number)=>void;chat?:Chat}){
 const refresh=useRecordRefresh();
 const [mode,setMode]=useState<'view'|'correct'>('view'),[value,setValue]=useState(''),[unit,setUnit]=useState(v.unit??''),[note,setNote]=useState('');
 const [pending,setPending]=useState(false),[msg,setMsg]=useState<{ok:boolean;text:string}|null>(null),[frozen,setFrozen]=useState<ReviewCommand|null>(null);
 async function send(input:ReviewCommand){
  setPending(true);setMsg(null);
  const r=await ports.review(input).catch(():ReviewResult=>({status:'outcome-unknown'}));
  setPending(false);
  if(r.status==='saved'){setFrozen(null);setMode('view');setMsg({ok:true,text:t.result.saved!});chat?.onReviewed(v,input,r.valueStatus);refresh();return;}
  if(r.status!=='outcome-unknown')setFrozen(null);
  setMsg({ok:false,text:t.result[r.status]??r.status});
 }
 function act(action:'confirm'|'correct'|'reject'){
  if(pending)return;
  const submissionId=submissionIds[`${v.valueId}:${action}`];if(!submissionId)return;
  const n=Number(value.replace(',','.'));
  if(action==='correct'&&(!value.trim()||!Number.isFinite(n))){setMsg({ok:false,text:t.result.invalid!});return;}
  const input={version:labReviewVersion,submissionId,memberId,valueId:v.valueId,action,...(action==='correct'?{value:n,...(unit.trim()?{unit:unit.trim()}:{})}:{}),...(note.trim()?{note:note.trim()}:{})};
  setFrozen(input);void send(input);
 }
 if(chat&&!hasClinicalFlag(v)&&!frozen&&mode==='view'&&['verified','corrected','rejected'].includes(v.status))return <li className="text-body2" data-reviewed-value={v.valueId}>
  {analyteDisplayName(v.testName,locale,v.catalogueRef)} {v.status==='corrected'?v.correctedValue:v.valueText} {v.status==='corrected'?v.correctedUnit:v.unit} · {t.status[v.status]}
  {v.labFlag&&v.labFlag!=='normal'&&<> · {t.labFlag[v.labFlag]}</>}
  {v.attention&&<span className="font-medium text-destructive"> · <AlertTriangle className="mr-1 inline size-4" aria-hidden/>{t.attention[v.attention]}{v.attentionRule?` (${v.attentionRule})`:''}</span>}
 </li>;
 const reviewed=v.status!=='unverified';
 return <li className={`min-w-0 space-y-2 rounded-lg border p-3 ${v.attention?'border-destructive':''}`}>
  <div className="flex flex-wrap items-baseline justify-between gap-2">
   <p className="break-words text-body1 font-medium">{analyteDisplayName(v.testName,locale,v.catalogueRef)}</p>
   <span className={`rounded-md px-2 py-0.5 text-caption ${reviewed?'bg-surface-subtle-teal':'bg-muted'}`}>{t.status[v.status]}</span>
  </div>
  <p className="text-body1">{v.status==='corrected'?<><span className="font-medium">{v.correctedValue}{v.correctedUnit?` ${v.correctedUnit}`:''}</span> <span className="text-caption text-muted-foreground">({t.original} {v.valueText}{v.unit?` ${v.unit}`:''})</span></>:<span className={v.status==='rejected'?'line-through':''}>{v.valueText}{v.unit?` ${v.unit}`:''}</span>}
   {v.refText&&<span className="ml-2 text-caption text-muted-foreground">{t.labRange} {v.refText}</span>}{v.labFlag&&v.labFlag!=='normal'&&<span className="ml-2 text-caption font-medium">{t.labFlag[v.labFlag]}</span>}</p>
  {v.attention&&<p className="text-caption font-medium text-destructive"><AlertTriangle className="mr-1 inline size-4" aria-hidden/>{t.attention[v.attention]}{v.attentionRule?` (${v.attentionRule})`:''}</p>}
  {chat&&v.status==='unverified'&&labReviewReason(v,ruleReason,locale)&&<p className="text-caption">{labReviewReason(v,ruleReason,locale)}</p>}
  {v.checks.length>0&&<ul className="text-caption text-muted-foreground">{v.checks.map(c=><li key={c}>{t.checks[c]??c}</li>)}</ul>}
  <p className="text-caption text-muted-foreground"><button type="button" className="min-h-11 underline" onClick={()=>onPage(v.page)}>{v.status==='auto_accepted'?t.autoSource:t.showPage} {v.page}</button>{v.snippet?<> · <q className="break-words">{v.snippet}</q></>:null}{v.collectedOn?` · ${v.collectedOn}`:''}</p>
  {v.reviewNote&&<p className="text-caption">{v.reviewNote}</p>}
  {mode==='correct'&&!frozen&&<div className="grid gap-2 sm:grid-cols-[1fr_8rem]">
   <label className="text-caption">{t.value}<input className={`${field} mt-1`} inputMode="decimal" value={value} onChange={e=>setValue(e.target.value)}/></label>
   <label className="text-caption">{t.unit}<input className={`${field} mt-1`} maxLength={30} value={unit} onChange={e=>setUnit(e.target.value)}/></label>
   <label className="text-caption sm:col-span-2">{t.note}<input className={`${field} mt-1`} maxLength={300} value={note} onChange={e=>setNote(e.target.value)}/></label>
  </div>}
  {msg&&<p role={msg.ok?'status':'alert'} className="text-body2">{chat?(msg.ok?done('action',locale,msg.text):notDone('action',locale,msg.text)):msg.text}</p>}
  {frozen&&msg&&!msg.ok?<button type="button" className={buttonClass} disabled={pending} onClick={()=>void send(frozen)}>{pending?t.saving:t.checkAgain}</button>
   :<div className="flex flex-wrap gap-2">
    {mode==='view'?<>
     {/* A corrected value is not confirmed again: Confirm would read as the AI's number (Astra A3-3). */}
     {v.status!=='verified'&&v.status!=='corrected'&&<button type="button" className={buttonClass} disabled={pending} onClick={()=>act('confirm')}>{pending?t.saving:t.confirm}</button>}
     <button type="button" className={quiet} disabled={pending} onClick={()=>{setMode('correct');setMsg(null);}}>{t.correct}</button>
     {v.status!=='rejected'&&<button type="button" className={quiet} disabled={pending} onClick={()=>act('reject')}>{t.reject}</button>}
    </>:<>
     <button type="button" className={buttonClass} disabled={pending} onClick={()=>act('correct')}>{pending?t.saving:t.save}</button>
     <button type="button" className={quiet} disabled={pending} onClick={()=>setMode('view')}>{t.cancel}</button>
    </>}
   </div>}
 </li>;
}
