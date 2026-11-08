import {typedHandover} from './typed-handover';
/** A local boundary for the doctor's main composer, never for quoted member data.
 * Match only the opening action, not verbs elsewhere in a record question or paste.
 * This classifies intent; it never authorizes or performs an action.
 */
export type Boundary='approve'|'reject'|'send'|'dose'|'delete'|'order'|'scope';

// Medication change or prescribing is refused locally. A medicine is recognised by a known name,
// a typical generic-name ending, a medicine noun or a number with a unit, so "stop amlodipine"
// and "give him aspirin" count without a dose. Verbs that only ever mean prescribing (prescribe,
// назначь, նշանակիր) accept any word as the medicine unless the object itself is a test, visit,
// reminder, task or referral. Later words never decide: "prescribe aspirin before the visit" is a
// prescription. Noun phrases that start like a command ("start date of ...", "change in ...") stay reads.
const UNIT='(?:mg|mcg|µg|g|ml|iu|units?|tabs?|tablets?|pills?|capsules?|drops?|puffs?|sprays?|patch(?:es)?|injections?|ampoules?|inhalations?|мг|мкг|г|мл|ед|таблет\\p{L}*|капсул\\p{L}*|единиц\\p{L}*|капл\\p{L}*|капел\\p{L}*|пластыр\\p{L}*|ампул\\p{L}*|спрей\\p{L}*|ингаляц\\p{L}*|укол\\p{L}*|инъекц\\p{L}*|մգ|մկգ|գ|մլ|հաբ\\p{L}*|միավոր\\p{L}*|կաթիլ\\p{L}*|սպեղանի\\p{L}*|ներարկ\\p{L}*|ամպուլ\\p{L}*)';
const AMOUNT=`\\d+(?:[.,]\\d+)?\\s?${UNIT}(?![\\p{L}\\p{M}])`;
const LATIN_DRUGS='amlodipin|norvasc|lisinopril|enalapril|ramipril|perindopril|losartan|valsartan|telmisartan|candesartan|irbesartan|bisoprolol|concor|metoprolol|nebivolol|carvedilol|atenolol|hydrochlorothiazide|hctz|indapamide|furosemide|spironolactone|aspirin|clopidogrel|warfarin|apixaban|rivaroxaban|metformin|insulin|gliclazide|empagliflozin|dapagliflozin|semaglutide|atorvastatin|rosuvastatin|simvastatin|pravastatin|pitavastatin|fluvastatin|ezetimibe|inclisiran|evolocumab|alirocumab|statin|levothyroxine|amoxicillin|lactulose|paracetamol|ibuprofen|omeprazole|pantoprazole|crestor|lipitor|zocor|plavix|glucophage|lasix|eliquis|xarelto|coumadin|synthroid|diovan|micardis|betaloc|tritace|prestarium|lozap|ezetrol|lantus|novorapid|jardiance|ozempic|medicine|medication|drug|pill|capsule|tablet|antibiotic|supplement|therapy|dose|dosage|dosing|\\p{L}{3,}(?:pril|sartan|olol|statin|dipine|formin|gliptin|gliflozin|cillin|mycin|floxacin|parin|xaban|prazole)';
const RU_DRUGS='амлодипин|норваск|лизиноприл|эналаприл|рамиприл|периндоприл|лозартан|валсартан|телмисартан|бисопролол|конкор|метопролол|небиволол|карведилол|атенолол|гидрохлортиазид|индапамид|фуросемид|спиронолактон|аспирин|клопидогрел|варфарин|апиксабан|ривароксабан|метформин|инсулин|гликлазид|эмпаглифлозин|дапаглифлозин|семаглутид|аторвастатин|розувастатин|симвастатин|правастатин|питавастатин|эзетимиб|статин|левотироксин|амоксициллин|лактулоз|парацетамол|ибупрофен|омепразол|пантопразол|крестор|липитор|плавикс|глюкофаж|лазикс|эликвис|ксарелто|эутирокс|беталок|небилет|престариум|лозап|лекарств|препарат|таблетк|капсул|антибиотик|добавк|терапи|доз|\\p{L}{3,}(?:прил|сартан|олол|статин|дипин|формин|глиптин|глифлозин|циллин|мицин|флоксацин|парин|ксабан|празол)';
const HY_DRUGS='ամլոդիպին|նորվասկ|լիզինոպրիլ|էնալապրիլ|ռամիպրիլ|լոզարտան|վալսարտան|բիսոպրոլոլ|կոնկոր|մետոպրոլոլ|նեբիվոլոլ|կարվեդիլոլ|ատենոլոլ|ինդապամիդ|ֆուրոսեմիդ|սպիրոնոլակտոն|ասպիրին|կլոպիդոգրել|վարֆարին|մետֆորմին|ինսուլին|գլիկլազիդ|ատորվաստատին|ռոզուվաստատին|սիմվաստատին|էզետիմիբ|ստատին|լևոթիրոքսին|ամոքսիցիլին|պարացետամոլ|իբուպրոֆեն|օմեպրազոլ|կրեստոր|լիպիտոր|պլավիքս|լազիքս|էլիքվիս|քսարելտո|դեղ|հաբ|պրեպարատ|դոզա|դեղաչափ|թերապիա|հակաբիոտիկ|կապսուլ|\\p{L}{3,}(?:իպին|պրիլ|սարտան|ոլոլ|ստատին|ֆորմին)';
// Reuse the typed boundary's medicine vocabulary. This only pauses a draft; it never classifies clinical intent.
const VOICE_MEDICINE=new RegExp(`(?<![\\p{L}\\p{M}])(?:${LATIN_DRUGS}|${RU_DRUGS}|${HY_DRUGS}|${UNIT})[\\p{L}\\p{M}]*(?![\\p{L}\\p{M}])`,'iu');
const VOICE_NUMBER_WORD=/(?<![\p{L}\p{M}])(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|half|quarter|нол\p{L}*|нул\p{L}*|один|одна|одну|одной|одиннадц\p{L}*|два|две|двух|двум|двумя|двенадц\p{L}*|двест\p{L}*|тринадц\p{L}*|трист\p{L}*|четырнадц\p{L}*|четырест\p{L}*|пятнадц\p{L}*|пятьсот|шестнадц\p{L}*|шестьсот|семнадц\p{L}*|семьсот|восемнадц\p{L}*|восемьсот|девятнадц\p{L}*|девятьсот|тр[иеё]\p{L}*|четыр\p{L}*|пят\p{L}*|шест\p{L}*|сем\p{L}*|семь|восем\p{L}*|девят\p{L}*|десят\p{L}*|двадц\p{L}*|тридц\p{L}*|сорок|пятьдесят|шестьдесят|семьдесят|восемьдесят|девяносто|сто|тысяч\p{L}*|половин\p{L}*|քառորդ|կես|զրո|մեկ\p{L}*|երկու\p{L}*|երեք\p{L}*|չորս\p{L}*|հինգ\p{L}*|վեց\p{L}*|յոթ\p{L}*|ութ\p{L}*|ինը|իննը|ինն\p{L}*|տաս\p{L}*|քսան\p{L}*|երեսուն\p{L}*|քառասուն\p{L}*|հիսուն\p{L}*|վաթսուն\p{L}*|յոթանասուն\p{L}*|ութսուն\p{L}*|իննսուն\p{L}*|հարյուր\p{L}*|հազար\p{L}*)(?![\p{L}\p{M}])/iu;
/** Conservative staff default: any number or medicine/dose-like token requires tapping Send. */
export function staffVoiceNeedsReview(raw:string):boolean{
 const text=raw.normalize('NFKC');
 return /\p{N}/u.test(text)||VOICE_NUMBER_WORD.test(text)||VOICE_MEDICINE.test(text);
}
const NOT_A_MEDICINE='(?! (?:list|history|record|records|plan|chart|report|schedule|summary|section|tab|список|списка|истори\\p{L}*|запис\\p{L}*|план\\p{L}*|график\\p{L}*|отчет\\p{L}*|ցանկ\\p{L}*|պատմությ\\p{L}*|գրառում\\p{L}*|պլան\\p{L}*|գրաֆիկ\\p{L}*))';
const drug=(...names:string[])=>`(?<![\\p{L}\\p{M}])(?:${names.join('|')})[\\p{L}\\p{M}]*${NOT_A_MEDICINE}`;
const DRUG_EN=drug(LATIN_DRUGS);
const DRUG_RU=drug(RU_DRUGS,LATIN_DRUGS);
const DRUG_HY=drug(HY_DRUGS,LATIN_DRUGS);
const QUOTE='[«"“\'‘]?';
const NOT_TEST_EN='(?<!(?:after|before|until|following)\\s+(?:(?:the|his|her|their|a|an|this|next)\\s+)?(?:(?!(?:a|an|the|visit|appointment|exam|test|tests|scan|panel)(?![\\p{L}]))[\\p{L}’\\x27]+\\s+){0,2})(?:test|tests|panel|visit|appointment|reminder|follow-?up|task|handoff|referral|x-?ray|scan|ecg|ekg|check-?up|consultation|exam|message|note|question)';
const NOT_TEST_RU=`(?<!(?:после|перед|до)\\s+(?:(?!(?:визит|анализ|обследован|осмотр|прием|встреч)[\\p{L}]*)[\\p{L}’']+\\s+){0,2})(?:анализ|исследован|обследован|прием(?! (?:(?:его|ее|их|этого|любого)\\s+)?(?:${RU_DRUGS}))|визит|напомин|задач|контрол|липидограмм|направлен|консультац|экг|узи|осмотр|встреч|сообщен|заметк|вопрос)`;
const NOT_TEST_HY='(?:(?:քննությ|անալիզ|այց|հիշեցում|առաջադրանք|ուղղորդ|ուղեգիր|խորհրդատվ|զննում|հաղորդագրությ|գրառում|հարց)(?![\\p{L}\\p{M}]*(?: [\\p{L}’\\x27]+){0,2} (?:հետո|առաջ|մինչև)))';
// Prescribing verbs take the medicine right after them; change verbs take it anywhere in the next few words,
// unless a test, visit or reminder word comes first ("add a reminder about aspirin" is an order).
const EN_RECIPIENT='(?: (?:to |for )?(?:him|her|them|the member|it))?';
const RU_RECIPIENT='(?: (?:ему|ей|им|его|ее|их|участнику|пациенту|emu))?';
const RU_RECIPIENT_BEFORE='(?:(?:ему|ей|им|участнику) )?';
const HY_RECIPIENT='(?: (?:նրան|իրեն|անդամին|nran))?';
const HY_RECIPIENT_BEFORE='(?:(?:նրան|իրեն|անդամին|\\p{L}{2,}ին) )?';
const gap=(notTest:string)=>`(?:(?!(?<![\\p{L}\\p{M}])${notTest}).){0,60}?`;
const prescribed=(drugs:string,notTest:string)=>`${QUOTE}(?:${drugs}|${AMOUNT}|(?!(?:him|her|them|his|its|their|the|some|member|participant|ему|ей|им|его|ее|их|участнику|նրան|իրեն|անդամին)(?![\\p{L}\\p{M}]))(?!(?:[\\p{L}\\p{M}-]+ ){0,5}${notTest})[\\p{L}\\p{M}-]{3,})`;
const changed=(drugs:string,notTest:string)=>`${gap(notTest)}(?:${drugs}|${AMOUNT})`;

// Verb forms and their objects stay together as language data. Keep read/navigation
// verbs narrow: showing results, opening tasks and summarizing a plan remain reads.
const languages=[
 {
  filler: /^(?:hi|hello|hey|good morning|zoe|please|ok|okay)[\s,.:!։՝]+/u,
  person: /^(?:(?:can|could|would|will) you (?:please )?|(?:can|could|may|shall|should) we (?:please )?|i will |i'll |i want to |i am going to |i need to |i should |would it be possible to |is it possible to |could you possibly |would you mind |have (?:him|her|them) |let (?:him|her|them) |i[’']d like to |i would like to |i[’']m going to |we[’']ll |we will |let me |we should |we need to |you should |should we |let's |i )/u,
  actions: {
   approve: ['approve','accept','sign off','publish','release'],
   reject: ['reject','decline','send back','(?:edit|change|revise) (?:the |this )?(?:text|draft|report|plan)'],
   send: ['(?:write|message|tell|reply|send)(?: to)? (?:him|her|them|the member|a member|member)'],
   dose: [`(?:prescribe|prescibe|presribe|prescirbe|write (?:him |her |them )?a prescription for):?${EN_RECIPIENT}(?! (?:in|of|to|since|from|after|before|on|was|is|means?|has|had)\\b) (?:(?:a|an|some|the|his|her|their) )?${prescribed(DRUG_EN,NOT_TEST_EN)}`,
    `(?:start|stop|add|increase|raise|reduce|lower|decrease|switch|change|swap|replace|discontinue|double|halve|up|begin|restart|resume|titrate|taper|recommend|continue|cancel|give|put|take|cut|split)(?! (?:in|of|since|date|dates|time|times|history|was|is|at|from \\d+)\\b) ${changed(DRUG_EN,NOT_TEST_EN)}`,
    '(?:set|enable|apply|create) .{0,60}(?:dose|dosing) rules',
    'if [^.!?:"“«\\n]{1,120} (?:double|raise|lower|change|stop|increase|reduce) .{0,60}(?:dose|medicine|medication) .{0,40}automatically'],
   delete: ['(?:delete|erase|remove|hide) .{0,90}(?:reading|result|message|history|pressure|record)[\\p{L}\\p{M}]*'],
   order: ['(?:order|book|schedule|set|create|draft|prepare|prescribe) .{0,90}(?:test|panel|visit|appointment|reminder|follow-up|follow up|task|handoff|referral)[\\p{L}\\p{M}]*','remind me','follow up with'],
   scope: ['forget (?:all |the |all the )?(?:rules|instructions)','ignore (?:all |the |previous |all previous )?(?:rules|instructions)',
    '(?:show|list|open) (?:everything|all (?:the )?(?:patients|members)(?: of the clinic)?|(?:another|the other) clinic[’\x27]s member|(?:a |the )?member (?:from|of) (?:another|the other) clinic)'],
  },
 },
 {
  filler: /^(?:բարև|բարի լույս|զոյա|zoe|խնդրում եմ|լավ)[\s,.:!։՝]+/u,
  person: /^(?:(?:կարող) (?:ես|եք|ենք) |(?:կարելի է|պետք է|անհրաժեշտ է|արժե|եկեք) |ես (?!\S+ել (?:եմ|էի)))/u,
  actions: {
   approve: ['հաստատիր','հաստատի','հաստատել','հաստատում եմ','կհաստատեմ','ընդունիր','հրապարակիր','ստորագրիր'],
   reject: ['մերժիր','մերժել','մերժում եմ','կմերժեմ','հետ ուղարկիր','(?:խմբագրիր|փոխիր) .{0,60}(?:տեքստ|նախագիծ|պլան)[\\p{L}\\p{M}]*',
    '(?:էս|այս) լաբի տեքստից հանիր'],
   send: ['(?:գրի|գրիր|գրել|գրում եմ|կգրեմ|ուղարկիր|կուղարկեմ|ասա|պատասխանիր) (?:իրեն|նրան|անդամին)',
    '\\p{L}+ի հարցին [^.!?:"“«\\n]{0,70}պատասխան գրիր'],
   dose: [`${HY_RECIPIENT_BEFORE}(?:նշանակենք|նշանակիր|նշանկիր|նշանակի|նշանակել|նշանակեմ|կնշանակեմ|nshanakir|nshanakel|դուրս գրիր|դուրս գրել|խորհուրդ տուր|խորհուրդ տալ)${HY_RECIPIENT} ${prescribed(DRUG_HY,NOT_TEST_HY)}`,
    `${DRUG_HY}(?: ${AMOUNT})?(?: \\p{L}+)? (?:նշանակիր|դուրս գրիր|սկսիր|դադարեցրու|ավելացրու|բարձրացրու|իջեցրու|նվազեցրու|կրկնապատկիր|կիսիր|փոխիր|տուր|հանիր|դիր|շարունակիր|չեղարկիր)`,
    `${HY_RECIPIENT_BEFORE}(?:սկսենք|դադարեցնենք|ավելացնենք|բարձրացնենք|իջեցնենք|փոխենք|սկսիր|սկսել|սկսեմ|կսկսեմ|դադարեցրու|դադարեցնել|դադարեցնեմ|կդադարեցնեմ|ավելացրու|ավելացնել|կավելացնեմ|բարձրացրու|բարձրացնել|իջեցրու|իջեցնել|նվազեցրու|նվազեցնել|կրկնապատկիր|կիսիր|կիսել|փոխիր|փոխել|կփոխեմ|փոխարինիր|փոխարինել|տուր|տալ|հանիր|հանել|դիր|անցկացրու|վերսկսիր|վերսկսել|շարունակիր|չեղարկիր|նշանակիր)${HY_RECIPIENT} ${changed(DRUG_HY,NOT_TEST_HY)}`],
   delete: ['(?:ջնջիր|ջնջել|կջնջեմ|հեռացրու|թաքցրու) .{0,90}(?:ճնշում|արդյունք|հաղորդագրություն|պատմություն|գրառում|չափում)[\\p{L}\\p{M}]*'],
   order: ['(?:պատվիրիր|ամրագրիր|ստեղծիր|պլանավորիր|նշանակիր|դուրս գրիր) .{0,90}(?:քննություն|անալիզ|այց|հիշեցում|առաջադրանք|ուղղորդում|ուղեգիր)[\\p{L}\\p{M}]*','հիշեցրու','կհիշեցնեմ','(?:քննություն|անալիզ)[\\p{L}\\p{M}]* (?:պատվիրի|պատվիրիր|պատվիրել)'],
   scope: ['(?:մոռացիր|անտեսիր) (?:բոլոր |նախորդ |բոլոր նախորդ )?(?:կանոնները|հրահանգները)',
    'ցույց տուր (?:ամեն ինչ|կլինիկայի բոլոր (?:անդամներին|պացիենտներին)|բոլոր (?:անդամներին|պացիենտներին)|(?:մյուս|այլ) կլինիկայի)'],
  },
 },
 {
  filler: /^(?:привет|здравствуйте|доброе утро|zoe|зоя|пожалуйста|ладно|хорошо)[\s,.:!]+/u,
  person: /^(?:(?:можешь|можете|сможешь|сможете|можем|сможем) (?:пожалуйста )?|не могли бы вы |я хотел бы |я хотела бы |(?:можно|нужно|надо|необходимо|стоит|давайте|давай|лучше|предлагаю) (?:ли )?|я (?:хочу |буду )?)/u,
  actions: {
   approve: ['одобри','одобрить','одобряю','одобрю','утверди','утвердить','утверждаю','подпиши','опубликуй','прими'],
   reject: ['отклони','отклонить','отклоняю','отклоню','откажи','верни','отправь на доработку','(?:исправь|измени|отредактируй) .{0,60}(?:текст|черновик|план|отчет)[\\p{L}\\p{M}]*'],
   send: ['(?:напиши|написать|напишу|пишу|сообщи|скажи|ответь|отправь)(?: сообщение)? (?:ему|ей|им|участнику)'],
   dose: [`${RU_RECIPIENT_BEFORE}(?:назнач(?:ь|ьте|те|ить|у|аю|им)?|выпишем|naznach(?:i|it|u)?|выпиш(?:и|ите|у)|выписать|пропиш(?:и|ите|у)|прописать|порекомендуй(?:те)?|рекомендуй(?:те)?|рекомендовать)${RU_RECIPIENT} ${prescribed(DRUG_RU,NOT_TEST_RU)}`,
    `${DRUG_RU}(?: ${AMOUNT})?(?: \\p{L}+)? (?:назначь|назначьте|выпиши|выпишите|пропиши|рекомендуй|начни|начните|отмени|отмените|прекрати|прекратите|повысь|подними|понизь|снизь|уменьши|увеличь|удвой|измени|смени|замени|добавь|останови|сними|дай|дайте|поставь|переведи)`,
    `${RU_RECIPIENT_BEFORE}(?:начни|начните|начать|начнем|отменим|прекратим|увеличим|снизим|заменим|добавим|начну|отмени|отмените|отменить|отменю|прекрати|прекратите|прекратить|прекращу|повысь|повысьте|повысить|повышай|подними|поднять|понизь|понизить|снизь|снизьте|снизить|уменьши|уменьшите|уменьшить|увеличь|увеличьте|увеличить|удвой|удвоить|удвою|измени|измените|изменить|изменю|смени|сменить|замени|заменить|заменю|добавь|добавьте|добавить|добавлю|продолжай|возобнови|останови|остановить|сними|дай|дайте|дать|давай|переведи|переведите|поставь|посади|посадить)(?! (?:дата|даты|время|истори\\p{L}*|в|из|после|перед)\\b)${RU_RECIPIENT}(?: (?:на|с))? ${changed(DRUG_RU,NOT_TEST_RU)}`],
   delete: ['(?:удали|удалить|удалю|сотри|скрой|убери) .{0,90}(?:давление|результат|сообщение|истори|запись|измерение)[\\p{L}\\p{M}]*'],
   order: ['(?:закажи|назначь|выпиши|запиши|забронируй|создай|поставь|подготовь) .{0,90}(?:анализ|липидограмм|исследован|обследован|прием|визит|напоминание|задач|контроль|направлен)[\\p{L}\\p{M}]*','запиши (?:его|ее|их|меня) (?:к|на)','напомни','напомню',
    'через (?:две|[0-9]+) недели контроль'],
   scope: ['(?:забудь|игнорируй) (?:все |предыдущие |все предыдущие )?(?:правила|инструкции)',
    '(?:покажи|открой|выведи) (?:все(?=$|[.!?])|всех (?:пациентов|участников)|участника (?:другой|чужой) клиники)'],
  },
 },
];
const rules=languages.map(language=>({
 ...language,
 actions:Object.entries(language.actions).map(([boundary,phrases])=>({
  boundary:boundary as Boundary,
  pattern:new RegExp(`^(?:${phrases.join('|')})(?![\\p{L}\\p{M}])`,'u'),
 })),
}));

// Second layer: free word order. A short imperative or first-person sentence that holds a medication verb and a
// medicine, dose noun or amount is a medication request wherever the words sit ("Анне назначь 5 мг амлодипина",
// "start after her visit amlodipine 5 mg"). Questions, reports and read starters stay reads; a test, visit or
// reminder word before the medicine means the object is that order ("add a reminder about aspirin").
const EN_VERBS='prescribe|start|stop|add|increase|raise|reduce|lower|decrease|switch|change|swap|replace|discontinue|double|halve|up|begin|restart|resume|titrate|taper|recommend|continue|cancel|give|put|take|cut|split';
const RU_VERBS='назнач(?:ь|ьте|те|ить|у|аю|им)?|выпиш(?:и|ите|у|ем)|выписать|пропиш(?:и|ите|у)|прописать|рекомендуй(?:те)?|порекомендуй(?:те)?|рекомендовать|начн(?:и|ите|у|ем)|начать|отмен(?:и|ите|ить|ю|им)|прекрат(?:и|ите|ить|ю|им)|повы(?:сь|сьте|сить|шай)|подним(?:и|ите)|поднять|пониз(?:ь|ьте|ить)|сниз(?:ь|ьте|ить|им)|уменьш(?:и|ите|ить)|увелич(?:ь|ьте|ить|им)|удво(?:й|йте|ить|ю)|измен(?:и|ите|ить|ю)|смен(?:и|ите|ить)|замен(?:и|ите|ить|ю|им)|добав(?:ь|ьте|ить|лю|им)|продолжай(?:те)?|возобнов(?:и|ите|ить)|остан(?:ови|овите|овить)|сними|снять|дай(?:те)?|дать|давай|поставь|посади|посадить|переведи(?:те)?|перевести';
const HY_VERBS='նշանակ(?:իր|ել|եմ|ենք)|նշանկիր|կնշանակեմ|դուրս գրիր|դուրս գրել|խորհուրդ տուր|սկս(?:իր|ել|եմ|ենք)|կսկսեմ|դադարեց(?:րու|նել|նեմ|նենք)|կդադարեցնեմ|ավելաց(?:րու|նել|նենք)|կավելացնեմ|բարձրաց(?:րու|նել|նենք)|իջեց(?:րու|նել|նենք)|նվազեց(?:րու|նել)|կրկնապատկիր|կիսիր|կիսել|վերսկս(?:իր|ել)|փոխ(?:իր|ել|ենք)|կփոխեմ|փոխարին(?:իր|ել)|տուր|տալ|հանիր|հանել|դիր|անցկացրու|վերսկսիր|շարունակիր|չեղարկիր';
const WORD=(body:string)=>`(?<![\\p{L}\\p{M}])(?:${body})(?![\\p{L}\\p{M}])`;
const scanVerb=new RegExp(WORD(`${EN_VERBS}|${RU_VERBS}|${HY_VERBS}`),'u');
const afterVerbNoun=/^ (?:in|of|since|date|dates|time|times|history|was|is|at|from \d+|дата|даты|время|истори\p{L}*|в|из|me|us|a look|a glance|an overview|мне|нам|ինձ|մեզ|եմ|ես|է|էր|էի|ենք|են|էին)(?![\p{L}\p{M}])/u;
const scanObject=new RegExp(`(?:${DRUG_EN}|${DRUG_RU}|${DRUG_HY})|${AMOUNT}`,'u');
const scanNotTest=new RegExp(`(?<![\\p{L}\\p{M}])(?:${NOT_TEST_EN}|${NOT_TEST_RU}|${NOT_TEST_HY})`,'u');
const readStarter=/^(?:what|when|why|how|which|who|where|whose|is|are|was|were|did|does|do|has|have|had|show|list|open|display|explain|compare|summar\p{L}*|read|find|check|see|view|he|she|they|it|the|a|an|member|nurse|doctor|patient|participant|that|this|these|those|что|когда|почему|как|какой|какая|какие|какое|кто|где|сколько|покажи|покажите|открой|объясни|сравни|прочитай|найди|проверь|он|она|они|оно|врач|медсестра|участник\p{L}*|пациент\p{L}*|это|эти|ինչ|ինչու|երբ|ինչպես|ով|որտեղ|քանի|ցույց|բացիր|բացատրիր|համեմատիր|նա|նրանք|բժիշկ|անդամ|բուժքույր|սա|սրանք)(?![\p{L}\p{M}])/u;
const reported=/(?<![\p{L}\p{M}])(?:wrote|writes|said|says|asked|asks|asking|told|tells|requested|wants|needs|documented|documents|noted|wonder\p{L}*|when|why|who|написал\p{L}*|пишет|сказал\p{L}*|говорит|просит|просил\p{L}*|попроси\p{L}*|спрашива\p{L}*|спросил\p{L}*|интересу\p{L}*|документир\p{L}*|отметил\p{L}*|хочет|хотел\p{L}*|когда|почему|кто|գրել|ասաց|ասում|խնդրեց|երբ|ով|ինչու|թե|գտնել|իմանալ|ուզում է|ուզում են|խնդրում է|խնդրում են)(?![\p{L}\p{M}])/u;
// Documentation work is not a medication change: "add aspirin to the medication history", "change the spelling of amlodipine in this note".
const recordWork=/(?<![\p{L}\p{M}])(?:record|records|history|list|lists|log|note|notes|summary|entry|draft|header|title|spelling|font|allerg\p{L}*|comment|comments|chart|report|translate|review\p{L}*|reading|read|recorded|date|conversation|discussion|talk|chat|запис\p{L}*|истори\p{L}*|список|списк\p{L}*|журнал\p{L}*|заметк\p{L}*|черновик\p{L}*|заголов\p{L}*|итог\p{L}*|аллерги\p{L}*|шрифт|читать|разговор\p{L}*|обсужден\p{L}*|бесед\p{L}*|дат(?:а|ы|у|ой|е)|просмотр\p{L}*|показыва\p{L}*|посмотр\p{L}*|названи\p{L}*|ցանկ\p{L}*|պատմությ\p{L}*|գրառմ\p{L}*|գրառում\p{L}*|մատյան|օրագր\p{L}*|վերնագր\p{L}*|նշում\p{L}*|նկարագր\p{L}*|պատճեն\p{L}*|ամսաթիվ\p{L}*|հիշեցում\p{L}*|առաջադրանք\p{L}*|առաջնահերթ\p{L}*|զրույց\p{L}*|քննարկ\p{L}*|դիտում\p{L}*|նախագիծ|ամփոփ\p{L}*|ալերգ\p{L}*|թարգմանիր|կարդալ)(?![\p{L}\p{M}])/u;
const prescribingStart=/^(?:prescri?be|prescibe|presribe|write|назнач|выпиш|пропиш|рекоменд|порекоменд|նշանակ|նշանկ|դուրս գր|խորհուրդ)/u;
const temporalLead=/^(?:after|before|until|following|once|после|перед|до)\s/u;
// "Give me everything about aspirin" and "take a look at his dose" ask for information, not for a change.
const asksForMe=/^(?:give|take|put|cut|split|дай(?:те)?|давай|дать|տուր|տալ)(?: (?:me|us|a look|a glance|together|an overview|мне|нам|ինձ|մեզ))(?![\p{L}\p{M}])/u;
function scansMedication(sentence:string):boolean{
 const clause=sentence.trim();
 if(!clause||readStarter.test(clause)||recordWork.test(clause))return false;
 const verb=scanVerb.exec(clause);
 if(!verb)return false;
 const before=clause.slice(0,verb.index);
 if(/[«"“‘:]/u.test(before)||reported.test(before))return false;
 // The request opens the sentence: at most a recipient or two (or a short timing clause) comes first.
 const lead=before.split(/\s+/u).filter(Boolean).length;
 const objectFirst=scanObject.exec(clause);
 if(lead>(temporalLead.test(clause)?8:objectFirst&&objectFirst.index<verb.index&&objectFirst.index<=2?6:4))return false;
 if(afterVerbNoun.test(clause.slice(verb.index+verb[0].length)))return false;
 if(asksForMe.test(clause.slice(verb.index)))return false;
 const object=scanObject.exec(clause);
 if(!object)return false;
 const test=scanNotTest.exec(clause);
 if(test&&test.index<object.index)return false;
 // "cancel the metformin reminder": a test, visit or reminder word right after the medicine names the real object.
 const next=clause.slice(object.index+object[0].length).trim().split(/\s+/u).slice(0,2).join(' ');
 return !(next&&scanNotTest.test(next));
}

export function typedBoundary(text:string):Boundary|null{
 if(typedHandover(text))return null;
 let opening=text.normalize('NFC').toLowerCase().replace(/ё/gu,'е').replace(/[՚-՟]/gu,'').replace(/\s+/gu,' ').trim();
 // Remove only known greetings/fillers. Never strip a quotation or scan later sentences.
 let previous:string;
 do{previous=opening;for(const {filler} of rules)opening=opening.replace(filler,'').trim();}while(opening!==previous);
 for(const {person,actions} of rules){
  const action=opening.replace(person,'');
  for(const {boundary,pattern} of actions)if(pattern.test(action)&&!(boundary==='dose'&&(asksForMe.test(action)||!prescribingStart.test(action)&&recordWork.test(action))))return boundary;
 }
 const variants=[opening,...rules.map(({person})=>opening.replace(person,''))];
 if(variants.some(variant=>variant.split(/[.!?։\n]+/u).slice(0,3).some(scansMedication)))return 'dose';
 return null;
}
