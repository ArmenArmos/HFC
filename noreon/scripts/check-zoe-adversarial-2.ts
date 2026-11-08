/** C1 offline adversarial audit, 21 Oct 2026. Hand-authored synthetic messages, never real member data.
 * Run from repository root, always with yesterday's unchanged network guard:
 * NODE_OPTIONS='--require ./scripts/zoe-offline-guard.cjs' node --conditions=noreon-server-test --import ./scripts/register-alias.mjs scripts/check-zoe-adversarial-2.ts --out output/codex-audits-2026-10-21
 * Exactly 100 ordinary messages (no prior urgent window) and 100 escalation/window messages.
 * Oracles are explicit, independent of the implementation: current Level 1 signs -> 103;
 * BP >=180 systolic OR >=120 diastolic, glucose >=13.9 mmol/L with qualifying symptoms,
 * SGLT2 illness, K >=6 or <=2.8, raised troponin, new unilateral leg swelling,
 * HF gain >=2kg within <=3 days -> same-day. No inferred diagnosis or new clinical policy.
 * Window: short unqualified help-reached confirmation closes; failed/future/qualified calls do not.
 * These are pure-function guards with symptom intake available; NOT a pipeline/provider/live test.
 */
import {mkdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {stagingMatches,STAGING_LEXICON_VERSION} from '@/lib/zoe/urgent-staging';
import {textRedFlags,SYMPTOM_RED_FLAGS_VERSION} from '@/lib/zoe/symptoms/red-flags';
import {sameDayFloor,HEALTH_ANSWER_VERSION} from '@/lib/zoe/health-answer';
import {levelTwoFloors} from '@/lib/zoe/same-day-floors';
import {bpReadings} from '@/lib/zoe/bp-parse';
import {normaliseText} from '@/lib/zoe/normalise';
import {dangerPassed,urgentWindowOpen,URGENT_WINDOW_VERSION} from '@/lib/zoe/urgent-window';
import {URGENT_TEXT} from '@/lib/zoe/symptoms/intake';

type Route='103'|'same-day'|'ordinary';
type Case={id:string;language:string;text:string;group:'emergency'|'same-day'|'window'|'ordinary';topic:string;expected:Route;reason:string;expectedBp?:number[][];exit?:boolean};
const cases:Case[]=[];
function add(group:Case['group'],language:string,topic:string,expected:Route,reason:string,rows:readonly (string|[string,number[][]])[],exit?:boolean){
 for(const row of rows){const [text,pairs]=typeof row==='string'?[row,undefined]:row;
 cases.push({id:`C1-${String(cases.length+1).padStart(3,'0')}`,language,text,group,topic,expected,reason,...(pairs?{expectedBp:pairs}:{}),...(exit===undefined?{}:{exit})});}
}
// 50 current emergencies. Specific serious signs, carers, older people, common typing/transcription noise.
add('emergency','hy','Current Level 1','103','Current severe chest/breathing, focal neurological, consciousness or other explicit Level 1 sign.',[
 'Զոե ջան 72 տարեկան եմ, հիմա կուրծքս շատ ուժեղ սեղմում ա, քրտինքս սառել ա',
 'Մամաս 68 ա հիմա շնչել չի կարողանում, կողքն եմ նստած',
 'Հորս ժպիտը հենց նոր ծռվեց ու ձախ ձեռքը չի բարձրացնում',
 'Հանկարծ խոսքս խառնվեց, լեզուս կապվել ա, աղջիկս ա գրում',
 'Գլուխս միանգամից պայթելու պես ցավեց, կյանքումս ամենաուժեղ գլխացավն ա',
 'Դեղը խմելուց հետո լեզուս ուռում ա, հիմա էլ կոկորդս ա սեղմում',
 'Պապաս անգիտակից ա հատակին, ձայն տալիս եմ չի պատասխանում',
 'Մեր փոքրիկը մարտկոց է կուլ տվել հենց նոր, ինչ անեմ',
 'Ձեռքս կտրել եմ, առատ արյունահոսություն կա ու չի դադարում',
 'Դիաբետ ունեմ, շաքարս 24 է, հիմա փսխում եմ ու փորս ցավում է',
 'Աջ ոտքս հանկարծ սառել ու գունատվել ա, չեմ կարողանում շարժել',
 'Բարձր ջերմություն ունեմ, պարանոցս կարկամել է, գլուխս էլ ցավում է',
]);
add('emergency','hy-Latn','Current Level 1','103','Current colloquial Level 1 sign must survive Latin Armenian spelling and message noise.',[
 'Zoe jan hima krtsqis ujex tsav ka, 20 rope chi ancnum',
 'mamas 75 a chi karoxanum shnchel hima, inch anem',
 'chem karum shnchel es pahin od chi herikum',
 'papis demqy crvel a hima u chi karoxanum xosel',
 'dzax dzerqs hankarc tmrel a u chi sharjvum',
 'lezus kapvel a hima bare rs chem karum asem',
 'shrtunqs urrum a dexic heto, kokords el a urrum',
 'paps angitakic a, achqery chi bacum',
 'shakars 22 a u pxsum em, diabet unem',
 'otqs sar a u gunat, chem karoxanum sharjel hima',
 'krckis ujex cav unem hima, arajin angam a esqan ujex',
 'hima sirt s ujex sexmum a u chem karum shnchel',
]);
add('emergency','ru','Current Level 1','103','Current serious signs or a carer report must reach at least one emergency guard.',[
 'Мне 74, прямо сейчас давит в груди и холодный пот, терплю минут двадцать',
 'Пишу за маму, ей 81, она сейчас не может дышать',
 'У папы вдруг перекосило лицо, левую руку поднять не может',
 'Речь стала невнятная прямо сейчас, муж печатает за меня',
 'Внезапно самая сильная головная боль в жизни, будто ударили',
 'После таблетки язык отекает и горло отекает, всё быстро',
 'Муж без сознания, на голос не реагирует, я рядом',
 'Ребёнок только что проглотил батарейку от пульта',
 'Порезал руку, кровь хлещет и не останавливается',
 'У меня диабет, сахар 23 ммоль/л и рвота сейчас',
 'Левая нога резко стала холодной и бледной, не шевелится',
 'Температура 39 и шея не гнётся, сильная головная боль',
]);
add('emergency','en','Current Level 1','103','Current severe signs with conversational or voice-to-text noise, including an older parent.',[
 'Typing for dad, 79, crushing chest pressure right now and cold sweat',
 'mum cant breathe properly now she is gasping beside me',
 'Suddenly my smile is crooked and I cannot lift my left arm',
 'My speech is slurred all of a sudden, daughter is writing this',
 'Worst headache of my life came on in seconds just now',
 'My tongue is swelling fast after the new tablet, throat too',
 'My dad is unconscious on the kitchen floor and will not wake up',
 'Our toddler just swallowed a button battery from the remote',
 'Cut my wrist cooking, bleeding heavily and it will not stop',
 'I have diabetes, sugar 26 mmol/L, vomiting and stomach pain now',
 'My left foot is suddenly cold and pale and I cannot move it',
 'Fever 39 and a stiff neck, head hurts badly right now',
 'I fainted while running just now and hit my head on the pavement',
 'Voice typing sorry my chset hurts badly right now cold sweat too',
]);
// 30 same-day cases. Each is without an independent Level 1 sign.
add('same-day','hy','BP','same-day','Repeated BP reaches 180 systolic or 120 diastolic; no current organ symptoms.',[
 ['Ճնշումս երկու անգամ չափեցի 184/122 ու 182/121, ոչ մի գանգատ չունեմ',[[184,122],[182,121]]],
 ['Ճնշումս 18-ի 12 է, 10 րոպեից էլ նույնն էր, ինձ լավ եմ զգում',[[180,120]]],
 ['Ես 76 տարեկան եմ, ճնշումս հիմա 190-ի 100 է, նորից նույնը, ուրիշ գանգատ չկա',[[190,100]]],
]);
add('same-day','hy-Latn','BP','same-day','Current repeated high BP in normal Latin Armenian spelling must be read as BP.',[
 ['chnshums 185/120 a erku angam chapeci, lav em zgum',[[185,120]]],
 ['cnshums 19-i 12 a noric chapeci nuynn a, gngat chka',[[190,120]]],
]);
add('same-day','ru','BP','same-day','Repeated BP at the configured cutoff without organ symptoms.',[
 ['Давление 182 на 121, перемерила столько же, самочувствие обычное',[[182,121]]],
 ['У мамы давление 19 на 12, повторили так же, жалоб нет',[[190,120]]],
]);
add('same-day','en','BP','same-day','Repeated current high BP needs same-day, no emergency sign.',[
 ['My BP is 184/121 twice after resting, I feel my usual self',[[184,121]]],
 ['Dad has BP 190 over 105 on two checks today, feels well',[[190,105]]],
 ['BP １７８/１２２ both times today, feeling well otherwise',[[178,122]]],
]);
add('same-day','hy','Glucose','same-day','Current high glucose with thirst at >=13.9 mmol/L.',[
 'Շաքարս այսօր 15.6 մմոլ/լ է, շատ ծարավ եմ, ուրիշ գանգատ չկա',
]);
add('same-day','hy-Latn','Glucose','same-day','Current high glucose with thirst.',[
 'shakars 16.2 a aysor, shat caravum em, urish ban chka',
]);
add('same-day','ru','Glucose','same-day','Current glucose above 13.9 mmol/L and thirst.',[
 'Сахар сегодня 15,8 ммоль/л, сильная жажда, остального ничего нет',
]);
add('same-day','en','Glucose','same-day','Current glucose 270 mg/dL with frequent urination.',[
 'My sugar is 270 mg/dL today and I am peeing a lot, otherwise okay',
]);
add('same-day','hy','SGLT2 sick day','same-day','Current SGLT2 use with illness/poor intake.',[
 'Ֆորսիգա եմ խմում ամեն օր, այսօր ջերմություն ունեմ ու չեմ ուտում',
]);
add('same-day','hy-Latn','SGLT2 sick day','same-day','Current named SGLT2 with poor intake.',[
 'forxiga em xmem amen or, esor chem utum, shakar s 6 a',
]);
add('same-day','ru','SGLT2 sick day','same-day','SGLT2 with current fever regardless of glucose.',[
 'Пью Форсигу, сегодня заболела, температура 38, сахар 6,1',
]);
add('same-day','en','SGLT2 sick day','same-day','SGLT2 with current poor intake.',[
 'On Jardiance daily, I have barely eaten for two days with this flu',
]);
add('same-day','hy','Potassium','same-day','Current serum potassium >=6 or <=2.8 mmol/L.',[
 'Այսօրվա անալիզում կալիումս 6.3 մմոլ/լ է, ինձ սովորականի պես եմ զգում',
]);
add('same-day','hy-Latn','Potassium','same-day','Current serum potassium >=6 mmol/L.',[
 'aysor analiz em tv el kaliums 6.4 mmol/L a, gngat chunem',
]);
add('same-day','ru','Potassium','same-day','Current serum potassium <=2.8 mmol/L.',[
 'В сегодняшнем анализе калий 2,7 ммоль/л, жалоб пока нет',
]);
add('same-day','en','Potassium','same-day','Current serum potassium >=6 mmol/L.',[
 'My blood test from this morning says potassium 6.2 mmol/L, feel okay',
]);
add('same-day','hy','Troponin','same-day','Current raised troponin without symptoms.',[
 'Տրոպոնինս այսօրվա անալիզով բարձր է, ոչ մի գանգատ չունեմ',
]);
add('same-day','ru','Troponin','same-day','Troponin above its stated reference.',[
 'Сегодня тропонин 60 нг/л при норме до 14 нг/л, самочувствие обычное',
]);
add('same-day','en','Troponin','same-day','Explicit current raised troponin without symptoms.',[
 'My troponin result today is elevated, I have no symptoms at all',
]);
add('same-day','hy','HF weight','same-day','Known HF and gain >=2kg in <=3 days.',[
 'Սրտային անբավարարություն ունեմ, քաշս երկու օրում ավելացել է 2.5 կգ',
]);
add('same-day','ru','HF weight','same-day','Known HF and gain >=2kg in <=3 days.',[
 'У меня ХСН, за три дня прибавила 2,4 кг, других новых жалоб нет',
]);
add('same-day','en','HF weight','same-day','Known HF and rapid gain.',[
 'I have heart failure, put on 2.6 kg since yesterday, otherwise usual',
]);
add('same-day','hy','One leg','same-day','New unilateral swelling without emergency signs.',[
 'Աջ սրունքս այսօր ուռել է, ձախը նույնն է, ուրիշ գանգատ չունեմ',
]);
add('same-day','ru','One leg','same-day','New unilateral swelling without emergency signs.',[
 'У мамы сегодня опухла левая голень, правая обычная, других жалоб нет',
]);
// 20 follow-ups to a fixed urgent answer 5 minutes ago. Explicit exit or keep-open oracle.
add('window','hy','Help reached','ordinary','Unqualified current confirmation of a completed 103 call or hospital arrival.',[
 'Այո, զանգահարեցինք 103-ին։',
 'Ես արդեն հիվանդանոցում եմ։',
 'Շտապ օգնությունը արդեն եկել է։',
],true);
add('window','hy-Latn','Help reached','ordinary','Unqualified Latin Armenian confirmation that help was called/arrived.',[
 'ha zangahareci 103 in',
 'menq arden hivandanocum enq',
 'shtapognutyuny hasav',
],true);
add('window','ru','Help reached','ordinary','Unqualified completed call/help-arrival confirmation.',[
 'Да, мы уже вызвали 103.',
 'Мама уже в больнице.',
],true);
add('window','en','Help reached','ordinary','Unqualified completed call/help-arrival confirmation.',[
 'Okay, we have just called an ambulance.',
 "I've already called the ambulance.",
],true);
add('window','hy','Keep window','103','Future, failed, uncertain or qualified help reports must keep the existing window.',[
 'Հիմա կզանգեմ 103-ին, դեռ չեմ զանգել',
 'Զանգահարեցի 103-ին բայց գիծը զբաղված էր',
 'Շտապօգնությունը եկել է՞ թե դեռ սպասեմ',
],false);
add('window','hy-Latn','Keep window','103','No successful call/arrival confirmation.',[
 'hima kzangem 103 mi qich spasem',
 'zangeci 103 bayc kapy ktrvec',
 'shtapognutyuny der chi hasel',
],false);
add('window','ru','Keep window','103','Failed call or unresolved danger does not close the existing window.',[
 'Уже позвонила 103, но связь оборвалась до ответа',
 'Скорая приехала, но папа всё ещё без сознания',
],false);
add('window','en','Keep window','103','No whole-message successful resolution, keep existing window.',[
 'We called 103 but the line was busy so nobody picked up',
 'The paramedics are here but mum still cannot breathe',
],false);
// Exactly 100 ordinary messages. No prior urgent window. No current Level 1 sign or same-day criterion.
// Includes care/admin, benign numbers, explicit symptom denials, historical recovery and ordinary chronic care.
add('ordinary','hy','Ordinary/negative controls','ordinary','No current emergency or same-day floor; history/denial/educational and routine care must stay below those routes.',[
 'Բարև ձեզ, անալիզի պատասխանը որտեղից բացեմ հեռախոսով',
 'Ես 73 տարեկան եմ, տառերը փոքր են, ոնց մեծացնեմ',
 'Մամայիս համար եմ գրում, բժշկի հետ ժամը քանիսին ենք պայմանավորվել',
 ['Ճնշումս այսօր 128/78 է, գանգատ չունեմ, գրանցե՞մ այստեղ',[[128,78]]],
 ['Առավոտը 145/88 էր, երեկոյան 136/82, լավ եմ զգում',[[145,88],[136,82]]],
 'Կրծքիս ցավ չկա, ուղղակի ուզում եմ հասկանամ քայլելը օգտակար է՞',
 'Շնչելու դժվարություն չունեմ, քիթս մի քիչ փակ ա',
 'Ձեռքս չի թմրել, ոտքս էլ չի թմրել, հարցաթերթիկն եմ լրացնում',
 'Դեմքս չի ուռել, նոր քսուքի անունն էի ուզում գրել',
 'Շաքարս 5.8 է այսօր, ծարավ էլ չունեմ',
 'Գլյուկոզաս 7.2 է, անալիզը ուղարկեմ բժշկին',
 'Կալիումս 4.3 մմոլ/լ է ըստ այսօրվա պատասխանի',
 'Տրոպոնինս նորմալ է գրված այսօրվա թղթի վրա',
 'Երկու տարվա առաջ ինֆարկտ եմ ունեցել, հիմա լավ եմ, թուղթը ուր վերբեռնեմ',
 'Մամաս 2018-ին ինսուլտ է ունեցել, հիմա վերականգնվել է, հին էպիկրիզն եմ ուղարկում',
 'Ինսուլտի կանխարգելման մասին հոդվածը որտեղ կարդամ',
 'Կրծքի ցավի մասին ձեր հոդվածը կարդացի, ես ցավ չունեմ',
 'Ամեն օր Ֆորսիգա եմ խմում, ջերմություն չունեմ, սրտխառնոց էլ չունեմ',
 'Կալիումի անալիզը ամսի 6-ին է, ժամն էլ 10-ին, հիշեցում կդնե՞ք',
 'Խոլեստերինս 5.6 է, բժիշկն ասել է հաջորդ այցին կխոսենք',
 'Մեջքս երկար նստելուց մի քիչ ձգում է, նոր բան չկա',
 'Սրտային անբավարարություն ունեմ, վերջին ամսում քաշս նույն 80 կգ-ն է',
 'Երկու ոտքերիս կոճերը տարիներով երեկոյան մի քիչ ուռում են, փոփոխություն չկա',
 'Շաքարաչափի մարտկոցն եմ փոխել, ցուցումները պահվե՞լ են',
 'Պապաս լավ է այսօր, մենակ դեղերի ցանկը նկարով կուղարկեմ',
]);
add('ordinary','hy-Latn','Ordinary/negative controls','ordinary','Ordinary Latin Armenian; no current Level 1 or same-day criterion.',[
 'barev Zoe jan analizis patasxany vonc bacem',
 'es 70 tarekan em heraxosis tarery chem tesnum lav, vortex mecacnem',
 'mamas hamar em grum, hajord aycy erb a',
 ['chnshums 125/80 a aysor, lav em',[[125,80]]],
 ['cnshums aravot 142/86 er, ereko 130/80, gngat chka',[[142,86],[130,80]]],
 'krtsqis chi cavum, menak chapelu dzevn em harcnum',
 'shnchel normal em karum, qits mi qich pak a',
 'dzerqs chi tmrel, ujegh a sovorakani pes',
 'demqs chi urrel, nkary hima kuxarkem',
 'shakars 5.9 a, carav chunem',
 'glukozas 6.1 a aysor, analizis nkary uxarkem',
 'kaliums 4.5 mmol/L a, doctorin kuxarkem',
 'troponins normal a grvac',
 'ancac tari infarkt em unecel, hima lav em, hin tuxtn em uxarkum',
 'paps 2017in insult er tarel, hima lav a, hin epikrizn em pnt rum',
 'insulti kanxargelman masin ban uni q kardalu',
 'krtsqi cavi masin hodvacy kardaci, es cav chunem',
 'forxiga em xmem, jerm chunem u srtxarnoc chunem',
 'kaliumi analizy amis 6in a, jame 10in',
 'xolesterins 5.4 a, hajord aycin kxosenq asel a doctor s',
 'mejqs erkar nsteluc mi qich dzgum a, hin bann a',
 'srtayin anbavararutyun unem, qashs amboxj amis 78 kg a nuyny',
 'erku otqis kojery tarinerov erekoyan mi qich urrum en, nor ban chka',
 'shakarachapi baterekan poxel em, inchpes miacnem',
 'paps aysor lav a, dexeri cucakn em nkarelu',
]);
add('ordinary','ru','Ordinary/negative controls','ordinary','Routine Russian messages, denied/current-normal values or resolved historical events only.',[
 'Здравствуйте, куда загрузить анализ мамы, я её дочь',
 'Мне 78, случайно закрыл приложение, как открыть дневник',
 'Пишу за папу, во сколько у него приём в пятницу',
 ['Сегодня давление 126/76, самочувствие обычное',[[126,76]]],
 ['Утром было 148/89, вечером 135/83, чувствую себя хорошо',[[148,89],[135,83]]],
 'Грудь сейчас не болит, просто хочу записать обычные показатели',
 'Одышки нет, нос заложен слегка со вчера',
 'Левая рука не онемела, силу проверил, всё как обычно',
 'Губы не опухли, просто сухие после прогулки',
 'Сахар сегодня 5,7 ммоль/л, жажды нет',
 'Глюкоза 7,4 ммоль/л, отправляю сегодняшний анализ без жалоб',
 'В анализе калий 4,2 ммоль/л, записываю сюда',
 'Тропонин в норме по сегодняшнему бланку',
 'Инфаркт был у меня в 2016 году, сейчас всё спокойно, ищу выписку',
 'Мама перенесла инсульт в 2018, восстановилась, загружаю старый эпикриз',
 'Где у вас статья про профилактику инсульта',
 'Читаю памятку про боль в груди, у меня болей нет',
 'Принимаю Форсигу, температуры нет и тошноты нет, всё как обычно',
 'Анализ на калий назначен на 6 октября к десяти утра',
 'Холестерин 5,3, обсудим с врачом на плановом приёме',
 'Спина немного ноет после стула, давно так, ничего нового',
 'У меня ХСН, вес весь месяц 82 кг без прибавки',
 'Обе лодыжки годами слегка отекают к вечеру, сейчас как всегда',
 'Поменяла батарейку в глюкометре, как выставить дату',
 'Папа сегодня в порядке, пришлю фото списка лекарств',
]);
add('ordinary','en','Ordinary/negative controls','ordinary','Routine English messages, benign numbers, explicit denials, history or education only.',[
 'Hi, writing from Yerevan for my mum, where do I upload her test',
 'I am 77 and the text is too small, can I enlarge the diary',
 'My daughter usually helps, what time is my next appointment',
 ['My BP today is 124/78 and I feel well',[[124,78]]],
 ['Morning BP 146/86, evening 132/81, feeling my usual self',[[146,86],[132,81]]],
 'My chest is not painful, just logging my usual readings',
 'No trouble breathing, only a slightly blocked nose today',
 'My left arm is not numb or weak, I am filling in the form',
 'My lips are not swollen, just dry in the cold',
 'Sugar today 5.6 mmol/L, not thirsty, logging it here',
 'Glucose 7.3 mmol/L on the test, no symptoms, uploading the page',
 'Potassium result today is 4.4 mmol/L',
 'My troponin result is normal on the new report',
 'I had a heart attack in 2015, fully recovered, uploading that old discharge letter',
 'Mum had a stroke in 2017 and recovered, I am sending her old records',
 'Where can I read your stroke prevention leaflet',
 'Reading your chest pain leaflet, I do not have any symptoms',
 'I take Jardiance daily and feel well, no fever or nausea',
 'My potassium blood draw appointment is October 6 at ten in the morning',
 'Cholesterol 5.5 today, will discuss at my planned review',
 'My back aches mildly after sitting, same as for years',
 'I have heart failure and my weight has stayed 79 kg all month',
 'Both ankles are a little puffy every evening for years, no change today',
 'Changed the glucose meter battery, how do I set the clock again',
 'Dad is well today, sending a photo of his medicine list',
]);

if(cases.length!==200||cases.filter(c=>c.group==='ordinary').length!==100||new Set(cases.map(c=>c.text)).size!==200)throw Error('Exactly 200 distinct messages, 100 ordinary, required');
const results=cases.map(c=>{
 const lexicon=stagingMatches(c.text).map(x=>x.id);
 const redFlags=textRedFlags([c.text],{intakeActive:false}).map(x=>x.id);
 const redFlagsActive=textRedFlags([c.text],{intakeActive:true}).map(x=>x.id);
 const floor=sameDayFloor([c.text],null);
 const levelTwo=levelTwoFloors([c.text],null);
 const bp=bpReadings(normaliseText(c.text)).map(x=>[x.systolic,x.diastolic]);
 const passed=dangerPassed(c.text);
 const windowOpen=c.group==='window'?urgentWindowOpen([{body:URGENT_TEXT.en,minutesAgo:5}],c.text):false;
 const route:Route=windowOpen||lexicon.length||redFlags.length?'103':floor?'same-day':'ordinary';
 const activeRoute:Route=windowOpen||lexicon.length||redFlagsActive.length?'103':floor?'same-day':'ordinary';
 const routePass=route===c.expected;
 const parserPass=c.expectedBp===undefined||JSON.stringify(c.expectedBp)===JSON.stringify(bp);
 const windowPass=c.exit===undefined||(passed===c.exit&&windowOpen===!c.exit);
 const rank={'ordinary':0,'same-day':1,'103':2};
 const direction=rank[route]<rank[c.expected]?'under-triage':rank[route]>rank[c.expected]?'over-triage':!windowPass?'window mismatch':!parserPass?'parser only':'pass';
 return {...c,actual:{route,lexicon,redFlags,redFlagsActive,activeRoute,sameDay:floor,levelTwo,bp,dangerPassed:passed,windowOpen},routePass,parserPass,windowPass,pass:routePass&&parserPass&&windowPass,direction};
});
const summary={cases:results.length,ordinary:100,other:100,passed:results.filter(r=>r.pass).length,failed:results.filter(r=>!r.pass).length,
 underTriage:results.filter(r=>r.direction==='under-triage').length,overTriage:results.filter(r=>r.direction==='over-triage').length,
 parserOnly:results.filter(r=>r.direction==='parser only').length,
 byGroup:Object.fromEntries(['emergency','same-day','window','ordinary'].map(g=>[g,{cases:results.filter(r=>r.group===g).length,failed:results.filter(r=>r.group===g&&!r.pass).length}])),
 byLanguage:Object.fromEntries([...new Set(results.map(r=>r.language))].map(l=>[l,{cases:results.filter(r=>r.language===l).length,failed:results.filter(r=>r.language===l&&!r.pass).length}])),
 versions:{STAGING_LEXICON_VERSION,SYMPTOM_RED_FLAGS_VERSION,URGENT_WINDOW_VERSION,HEALTH_ANSWER_VERSION}};
console.log(JSON.stringify(summary,null,2));
for(const r of results.filter(r=>!r.pass))console.log(`${r.id} ${r.direction}: ${JSON.stringify(r.text)} => ${r.actual.route}, expected ${r.expected}; bp=${JSON.stringify(r.actual.bp)}; hits=${[...r.actual.lexicon,...r.actual.redFlags].join(',')}`);
const at=process.argv.indexOf('--out');if(at>=0){const dir=process.argv[at+1]!;mkdirSync(dir,{recursive:true});writeFileSync(join(dir,'C1-results.json'),JSON.stringify({summary,results},null,2)+'\n');}
if(results.some(r=>!r.pass))process.exitCode=1;
