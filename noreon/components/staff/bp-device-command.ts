'use client';
import{useState}from'react';
import{useRouter}from'next/navigation';
import type{BpDeviceCommand,BpDeviceCommandPort,BpDeviceResult}from'@/lib/bp-device/schema';

import type{Locale}from'@/lib/locale';

export type BpLocale=Locale;
const text={
 en:{saved:'Saved.',invalid:'Check the details. A time cannot be in the future, and a nurse can record a hand-over up to 24 hours back.',stale:'This changed since you opened the page. Reload to see the current state.',
  access:'You can’t make this change for this member.',unavailable:'Couldn’t save right now. Try again.',unknown:'Save outcome unknown. Check again: the change is never recorded twice.',
  duplicate:'A monitor with this serial number is already registered.',reason:'Add a reason. It is kept in the history.',deviceUnavailable:'This monitor can’t be handed over in its current state.',
  memberHas:'This member already holds a monitor. Record its return first.',overlap:'That time overlaps an earlier holding period or readings already attached to someone. Pick a later time.',
  stillHeld:'Still held: the history does not show this member holding the monitor at that time.',disabled:'BP monitors are switched off.'},
 hy:{saved:'Պահպանված է։',invalid:'Ստուգեք տվյալները։ Ժամը չի կարող լինել ապագայում, իսկ բուժքույրը կարող է գրանցել հանձնումը մինչև 24 ժամ առաջ։',stale:'Էջը բացելուց հետո տվյալները փոխվել են։ Թարմացրեք էջը։',
  access:'Դուք չեք կարող կատարել այս փոփոխությունը այս անդամի համար։',unavailable:'Այս պահին չհաջողվեց պահպանել։ Փորձեք կրկին։',unknown:'Պահպանման արդյունքն անհայտ է։ Կրկին ստուգեք․ փոփոխությունը երբեք երկու անգամ չի գրանցվում։',
  duplicate:'Այս սերիական համարով սարք արդեն գրանցված է։',reason:'Նշեք պատճառը։ Այն պահվում է պատմության մեջ։',deviceUnavailable:'Այս սարքը ներկա վիճակում չի կարող հանձնվել։',
  memberHas:'Այս անդամն արդեն ունի սարք։ Նախ գրանցեք դրա վերադարձը։',overlap:'Այդ ժամը համընկնում է նախորդ ժամանակահատվածի կամ արդեն կցված չափումների հետ։ Ընտրեք ավելի ուշ ժամ։',
  stillHeld:'Դեռ սպասման մեջ է․ պատմության համաձայն այդ ժամին սարքը այս անդամի մոտ չէր։',disabled:'Ճնշման սարքերն անջատված են։'},
 ru:{saved:'Сохранено.',invalid:'Проверьте данные. Время не может быть в будущем, а медсестра может записать передачу за последние 24 часа.',stale:'После открытия страницы данные изменились. Обновите страницу, чтобы увидеть текущее состояние.',
  access:'Вы не можете внести это изменение для этого участника.',unavailable:'Не удалось сохранить сейчас. Попробуйте снова.',unknown:'Результат сохранения неизвестен. Проверьте еще раз: изменение никогда не записывается дважды.',
  duplicate:'Тонометр с этим серийным номером уже зарегистрирован.',reason:'Укажите причину. Она сохраняется в истории.',deviceUnavailable:'Этот тонометр нельзя передать в его текущем состоянии.',
  memberHas:'У этого участника уже есть тонометр. Сначала запишите его возврат.',overlap:'Это время пересекается с предыдущим периодом пользования или измерениями, уже закрепленными за участником. Выберите более позднее время.',
  stillHeld:'Остается у владельца: в истории нет записи о том, что в это время тонометр был у этого участника.',disabled:'Тонометры отключены.'},
} satisfies Record<Locale,{saved:string;invalid:string;stale:string;access:string;unavailable:string;unknown:string;duplicate:string;reason:string;deviceUnavailable:string;memberHas:string;overlap:string;stillHeld:string;disabled:string}>;
export function bpResultText(result:BpDeviceResult,locale:BpLocale){
 const t=text[locale];
 switch(result.status){
  case 'saved':return t.saved;case 'invalid':return t.invalid;case 'stale':return t.stale;case 'access':return t.access;case 'unavailable':return t.unavailable;
  case 'duplicate-serial':return t.duplicate;case 'reason-required':return t.reason;case 'device-unavailable':return t.deviceUnavailable;
  case 'member-has-device':return t.memberHas;case 'overlap':return t.overlap;case 'still-held':return t.stillHeld;case 'disabled':return t.disabled;
  default:return t.unknown;
 }
}

/** One command form. An unknown outcome keeps the exact command so "Check
 * again" resends the same submission, which the database replays. */
export function useBpCommand(command:BpDeviceCommandPort,locale:BpLocale){
 const router=useRouter();
 const [pending,setPending]=useState(false),[result,setResult]=useState<BpDeviceResult|null>(null),[frozen,setFrozen]=useState<BpDeviceCommand|null>(null);
 async function send(input:BpDeviceCommand){
  setPending(true);setResult(null);setFrozen(input);
  const outcome=await command(input).catch(():BpDeviceResult=>({status:'outcome-unknown'}));
  setPending(false);setResult(outcome);
  if(outcome.status!=='outcome-unknown')setFrozen(null);
  if(outcome.status==='saved'||outcome.status==='still-held')router.refresh();
  return outcome;
 }
 return{pending,result,frozen,send,message:result?bpResultText(result,locale):null,failed:!!result&&result.status!=='saved'};
}
