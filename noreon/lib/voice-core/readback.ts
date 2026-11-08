import type {Locale} from '@/lib/locale';

/**
 * What Zoe says aloud around a voice action, and the card hint. Code-written, never model text, so nothing here needs
 * the output guard: numbers are only read back exactly as the parser read them, and no line judges a value.
 * UNAPPROVED DRAFT copy (WP V, voice-copy-draft-1): Armenian, English and Russian, second person, no exclamation marks.
 */
export const VOICE_COPY_VERSION='voice-copy-draft-1';
type Lines=Readonly<Record<Locale,string>>;
const say=(l:Locale,lines:Lines)=>lines[l];

export function bpReadback(l:Locale,v:{systolic:number;diastolic:number;pulse:number|null}):string{
 const pulse=v.pulse===null?'':l==='hy'?`, զարկը՝ ${v.pulse}`:l==='ru'?`, пульс ${v.pulse}`:`, pulse ${v.pulse}`;
 return say(l,{
  hy:`Ճի՞շտ եմ հասկացել՝ վերինը ${v.systolic}, ստորինը ${v.diastolic}${pulse}։ Թվերը քարտի վրա են։ Ասեք «այո»՝ պահպանելու համար, կամ «ոչ»՝ չեղարկելու համար։`,
  en:`Did I hear you right: upper ${v.systolic}, lower ${v.diastolic}${pulse}? The numbers are on the card. Say yes to save, or no to cancel.`,
  ru:`Правильно ли я поняла: верхнее ${v.systolic}, нижнее ${v.diastolic}${pulse}? Цифры на карточке. Скажите «да», чтобы сохранить, или «нет», чтобы отменить.`,
 });
}
export function reminderReadback(l:Locale,time:string,target:'bp'|'medicine'):string{
 return target==='bp'?say(l,{
  hy:`Ավելացնե՞մ ճնշումը չափելու հիշեցում ժամը ${time}-ին։ Ասեք «այո»՝ պահպանելու համար, կամ «ոչ»՝ չեղարկելու համար։`,
  en:`Shall I add a reminder to measure your blood pressure at ${time}? Say yes to save, or no to cancel.`,
  ru:`Добавить напоминание измерить давление в ${time}? Скажите «да», чтобы сохранить, или «нет», чтобы отменить.`,
 }):say(l,{
  hy:'Դեղերի հիշեցումները գալիս են ձեր պլանի ժամերին։ Միացնե՞մ դրանք։ Ասեք «այո»՝ պահպանելու համար, կամ «ոչ»՝ չեղարկելու համար։',
  en:'Medicine reminders come at the times in your plan. Shall I switch them on? Say yes to save, or no to cancel.',
  ru:'Напоминания о лекарствах приходят во время, указанное в вашем плане. Включить их? Скажите «да», чтобы сохранить, или «нет», чтобы отменить.',
 });
}
export const VOICE_LINES={
 sayYes:{hy:'Ասեք «այո»՝ պահպանելու համար',en:'Say yes to save',ru:'Скажите «да», чтобы сохранить'},
 confirmHint:{hy:'Ասեք «այո»՝ հաստատելու համար, կամ սեղմեք կոճակը։',en:'Say yes to confirm, or press the button.',ru:'Скажите «да», чтобы подтвердить, или нажмите кнопку.'},
 saved:{hy:'Պահպանված է։',en:'Saved.',ru:'Сохранено.'},
 cancelled:{hy:'Լավ, ոչինչ չեմ պահպանել։ Քարտը մնում է, եթե ուզեք ուղղել։',en:'All right, I have not saved anything. The card stays if you want to change it.',ru:'Хорошо, я ничего не сохранила. Карточка остаётся, если захотите исправить.'},
 notConfirmed:{hy:'Ոչինչ չեմ պահպանել։ Ասեք «այո» կամ սեղմեք քարտի կոճակը։',en:'I have not saved anything. Say yes, or press the button on the card.',ru:'Я ничего не сохранила. Скажите «да» или нажмите кнопку на карточке.'},
 stale:{hy:'Քարտը փոխվել է։ Ստուգեք այն և պահպանեք սեղմելով։',en:'The card has changed. Check it and press the button to save.',ru:'Карточка изменилась. Проверьте её и нажмите кнопку, чтобы сохранить.'},
 failed:{hy:'Չհաջողվեց պահպանել։ Փորձեք քարտի կոճակով։',en:'That could not be saved. Try the button on the card.',ru:'Не удалось сохранить. Попробуйте кнопку на карточке.'},
 dose:{hy:'Ահա ձեր դեղերը։ Նշեք քարտի վրա այն, ինչ արդեն խմել եք։',en:'Here are your medicines. Mark on the card the ones you have taken.',ru:'Вот ваши лекарства. Отметьте на карточке те, что вы уже приняли.'},
 overview:{hy:'Բացում եմ ձեր ամփոփումը։',en:'Opening your overview.',ru:'Открываю ваш обзор.'},
 contact:{hy:'Գրեք ձեր հաղորդագրությունը քարտում և ուղարկեք այն խնամքի թիմին։',en:'Write your message on the card and send it to your care team.',ru:'Напишите сообщение на карточке и отправьте его команде заботы.'},
 unavailable:{hy:'Սա հիմա հասանելի չէ։ Կարող եք գրել ինձ։',en:'That is not available right now. You can type to me.',ru:'Сейчас это недоступно. Вы можете написать мне.'},
 staffOpened:{hy:'Բացում եմ։',en:'Opening it.',ru:'Открываю.'},
 staffHelp:{hy:'Կարող եմ բացել ձեր աշխատանքային ցուցակը, ահազանգերը կամ գործերը։ Անդամին անունով չեմ բացում։',en:'I can open your worklist, alerts or operations. I do not open a member by name.',ru:'Я могу открыть ваш список работ, оповещения или дела. Участника по имени я не открываю.'},
} as const satisfies Record<string,Lines>;
export const voiceLine=(l:Locale,key:keyof typeof VOICE_LINES)=>VOICE_LINES[key][l];

/** Which reminder a spoken request is about: a blood pressure measurement, or (otherwise) medicines from the plan. */
export const reminderTarget=(transcript:string):'bp'|'medicine'=>/(?<![\p{L}])(?:bp|blood pressure|pressure|measure\p{L}*|давлени\p{L}*|измер\p{L}*|ճնշ\p{L}*|չափ\p{L}*)(?![\p{L}])/iu.test(transcript)?'bp':'medicine';
