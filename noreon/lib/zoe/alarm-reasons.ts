import type {ReplyLanguage} from './provider';

export const ALARM_REASONS:Record<string,Record<ReplyLanguage,string>>={
 DKA:{en:'You reported high blood sugar together with warning symptoms.',hy:'Դուք նշել եք բարձր շաքար և վտանգի ախտանիշներ միասին։',ru:'Вы сообщили о высоком сахаре вместе с тревожными симптомами.'},
 POIS:{en:'Your message described a possible poisoning.',hy:'Ձեր հաղորդագրությունը նկարագրել է հնարավոր թունավորում։',ru:'В вашем сообщении описано возможное отравление.'},
 ANA:{en:'Your message described swelling or breathing trouble suggesting an urgent reaction.',hy:'Ձեր հաղորդագրությունը նկարագրել է այտուց կամ շնչառության դժվարություն՝ որպես շտապ արձագանքի նշան։',ru:'В вашем сообщении описан отёк или затруднение дыхания как признак срочной реакции.'},
 BLEED:{en:'Your message described a warning sign involving bleeding.',hy:'Ձեր հաղորդագրությունը նկարագրել է արյունահոսության վտանգի նշան։',ru:'В вашем сообщении описан тревожный признак кровотечения.'},
 LIMB:{en:'Your message described warning signs affecting a limb.',hy:'Ձեր հաղորդագրությունը նկարագրել է վերջույթի վտանգի նշաններ։',ru:'В вашем сообщении описаны тревожные признаки в конечности.'},
 SELF:{en:'Your message described a concern about self-harm.',hy:'Ձեր հաղորդագրությունը նկարագրել է ինքնավնասման մտահոգություն։',ru:'В вашем сообщении описана обеспокоенность самоповреждением.'},

 problem_worsening:{en:'You said the problem was getting worse.',hy:'Դուք նշել եք, որ խնդիրը վատանում է։',ru:'Вы сообщили, что состояние ухудшается.'},
 thunderclap:{en:'You described a sudden or unusually severe headache.',hy:'Դուք նկարագրել եք հանկարծակի կամ անսովոր ուժեղ գլխացավ։',ru:'Вы описали внезапную или необычно сильную головную боль.'},
 vision_loss:{en:'You reported a warning sign affecting your sight.',hy:'Դուք նշել եք տեսողության վտանգի նշան։',ru:'Вы сообщили о тревожном изменении зрения.'},
 fever_stiff_neck:{en:'You reported fever together with a stiff neck.',hy:'Դուք նշել եք ջերմություն և պարանոցի կարկամություն միասին։',ru:'Вы сообщили о температуре вместе со скованностью шеи.'},
 head_injury:{en:'You reported a head injury in the symptom conversation.',hy:'Ախտանիշի մասին զրույցում նշել եք գլխի վնասվածք։',ru:'В разговоре о симптоме вы сообщили о травме головы.'},
 face_lips_tongue:{en:'You reported swelling involving the face, lips or tongue.',hy:'Դուք նշել եք դեմքի, շրթունքների կամ լեզվի այտուց։',ru:'Вы сообщили об отёке лица, губ или языка.'},

 'RF-01':{en:'The recorded trigger was a warning sign involving chest discomfort.',hy:'Գրանցված պատճառը կրծքավանդակի անհանգստության հետ կապված վտանգի նշան էր։',ru:'Записанной причиной был тревожный признак, связанный с дискомфортом в груди.'},
 'RF-02':{en:'The recorded trigger was a warning sign involving breathing or fainting.',hy:'Գրանցված պատճառը շնչառության կամ ուշագնացության հետ կապված վտանգի նշան էր։',ru:'Записанной причиной был тревожный признак, связанный с дыханием или обмороком.'},
 'RF-04':{en:'The recorded trigger was a warning sign involving movement, feeling or speech.',hy:'Գրանցված պատճառը շարժման, զգացողության կամ խոսքի հետ կապված վտանգի նշան էր։',ru:'Записанной причиной был тревожный признак, связанный с движением, чувствительностью или речью.'},
 'RF-05':{en:'The recorded trigger was a warning sign involving consciousness or seizures.',hy:'Գրանցված պատճառը գիտակցության կամ ցնցումների հետ կապված վտանգի նշան էր։',ru:'Записанной причиной был тревожный признак, связанный с сознанием или судорогами.'},
};
/** Recorded aliases only; this changes presentation, never the warning decision. */
export function alarmRuleReason(rule:string,lang:ReplyLanguage):string|null{
 const family:Record<string,string>={CHEST:'RF-01',BREATH:'RF-02',FAINT:'RF-02',STROKE:'RF-04',SEIZ:'RF-05',MEN:'fever_stiff_neck'};
 const group=rule.startsWith('S-')?rule.split('-')[1]!:rule;
 return ALARM_REASONS[rule]?.[lang]??ALARM_REASONS[family[group]??group]?.[lang]??null;
}
