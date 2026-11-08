import type {ReplyLanguage} from './provider';

/**
 * A plain request to log a dose or a blood pressure ("I took my pill, can you log it"), while the chat cards are on. The whole message
 * has to be exactly that: any other word, any number, any symptom falls to the ordinary health answer. So "I took all my pills and feel
 * dizzy" never matches, and it reaches this check only after the urgent words, the red flags and the same-day floors in any case.
 * Matched on the text as the card route reads it, not the guards' normalised text, which drops pictographs and invisible characters:
 * "I took my pill 🤮" must reach the health answer (Astra ZMR-02), and the line promises a card, so every pattern stays inside what the
 * card route's cardIntent offers; check-zoe-member-record.ts walks them together. A request worded any other way, or a question, goes to the health answer.
 * STAGING WORDING pending Armen and Tatevik.
 */
export const LOGGING_REQUEST_VERSION='zoe-logging-request-1';

const END=`[.,!?։\\s]*$`,STATED=`[.,!։\\s]*$`;
const PILL_EN=`(?:my|the) (?:pills?|tablets?|medicines?|medication|meds|dose)`,WHEN_EN=`(?: (?:today|this morning|this evening|tonight))?`,ASK_EN=`(?:[.,]? *(?:please )?(?:can|could) you (?:log|record|note|save|mark) (?:it|this|that)(?: please)?|[.,]? *please (?:log|record|note|save) (?:it|this|that))`;
const DOSE_LAT=`(?:habs|haberys|haby|dexs|dexers|dexy|deghs|deghy)`,DONE_LAT=`(?:xmeci|khmeci|yndunetsi|yndunechi)`,ASK_LAT=`(?:grancir|grancek|nshi|nshek)`,BP_LAT=`(?:chnshums|chnshumy|chnshumn)`;
const DOSE_RU=`(?:таблетк[уи]|лекарство|лекарства|дозу)`,DOSE_HY=`(?:դեղս|դեղերս|հաբս|հաբերս|դեղը|հաբը)`;
const PATTERNS=[
 new RegExp(`^(?:i )?(?:took|have taken|i've taken) ${PILL_EN}${WHEN_EN}${ASK_EN}${END}`,'u'),
 new RegExp(`^(?:i )?(?:took|have taken|i've taken) ${PILL_EN}${WHEN_EN}${STATED}`,'u'),
 new RegExp(`^(?:please )?(?:(?:can|could) you )?(?:log|record|mark) ${PILL_EN}${WHEN_EN}(?: please)?(?: as taken)?${END}`,'u'),
 new RegExp(`^(?:please )?(?:(?:can|could) you )?(?:log|record|save) my (?:blood pressure|bp)(?: reading)?(?: please)?${END}`,'u'),
 new RegExp(`^(?:я )?(?:выпил|выпила|принял|приняла) ${DOSE_RU}(?: сегодня| утром| вечером)?(?:[.,]? *(?:запиши|запишите|отметь|отметьте)(?: это)?)?${STATED}`,'u'),
 new RegExp(`^(?:запиши|запишите|отметь|отметьте) (?:что )?(?:я )?(?:выпил|выпила|принял|приняла) ${DOSE_RU}${END}`,'u'),
 new RegExp(`^(?:ես )?(?:${DOSE_HY} (?:խմեցի|ընդունեցի)|(?:խմեցի|ընդունեցի) ${DOSE_HY})(?: այսօր| առավոտյան| երեկոյան)?(?:[.,]? *(?:գրանցիր|գրանցեք|նշիր|նշեք))?${STATED}`,'u'),
 // Armenian in Latin letters, the same plain requests (Khikar's chat, row 11).
 new RegExp(`^(?:es )?(?:${DOSE_LAT} ${DONE_LAT}|${DONE_LAT} ${DOSE_LAT})(?: aysor| esor| aravotyan| erekoyan)?(?:[.,]? *${ASK_LAT})?${STATED}`,'u'),
 new RegExp(`^(?:${ASK_LAT} ${BP_LAT}|${BP_LAT} ${ASK_LAT})(?: xndrum em)?${END}`,'u'),
];
export const plainLoggingRequest=(text:string)=>{const t=text.normalize('NFC').toLowerCase().replace(/\s+/gu,' ').replaceAll('’',"'").trim();return t.length<=80&&PATTERNS.some(p=>p.test(t));};

export const LOGGING_LINE:Record<ReplyLanguage,string>={
 en:'You can log it on the card here.',
 hy:'Կարող եք գրանցել այստեղի քարտով։',
 ru:'Вы можете отметить это на карточке здесь.',
};
/** The new chat has no card: what really happens to it there. STAGING wording. */
export const LOGGING_LINE_CHAT_V2:Record<ReplyLanguage,string>={
 en:'It stays here in our chat and your care team can read it. I can\'t add it to your record from this chat yet.',
 hy:'Սա մնում է մեր զրույցում, և ձեր խնամքի թիմը կարող է կարդալ այն։ Այս զրույցից դեռ չեմ կարող այն ավելացնել ձեր գրառումներին։',
 ru:'Это останется здесь, в нашем чате, и ваша команда сможет это прочитать. Добавить это в вашу карту из этого чата я пока не могу.',
};
