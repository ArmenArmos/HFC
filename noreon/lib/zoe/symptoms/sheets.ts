/**
 * Symptom sheets for Zoe's symptom intake (Khikar, 18 Oct 2026 11:32; lead safety design).
 *
 * EVERY SHEET HERE IS A DRAFT, PENDING ARMEN'S CLINICAL SIGN-OFF. The questions, the allowed
 * answers and the red flags are clinical content owned by the clinical team; this file is the
 * transcription. The recommended lists, with what is still to decide, are in
 * output/zoe-symptom-intake-2026-10-18/QUESTIONS.md. The HY and RU wording is a draft translation.
 *
 * A sheet is used only while its id and version are registered in zoe_symptom_sheets (the
 * database refuses the intake switch unless every registered sheet is signed, or staging AI mode
 * is on). Changing a question means a new version here and a new registry row.
 *
 * What Zoe does with a sheet: asks its questions, one or two at a time, in the member's language,
 * and fills a structured record. She never asks anything outside the sheet, never interprets,
 * diagnoses, reassures or advises. Red flags: a red-flag question answered "yes" stops the intake
 * and opens the urgent path (red-flags.ts adds the text rules that run before any model).
 */
export type Lang='en'|'hy'|'ru';
export type Text=Record<Lang,string>;
export type RedFlagId='RF-01'|'RF-02'|'RF-03'|'RF-04'|'RF-05';
export type AnswerType=
 |{kind:'yes_no'}
 |{kind:'choice';options:readonly {id:string;label:Text}[]}
 |{kind:'scale';min:0;max:10}
 |{kind:'text';max:number};
export type SheetQuestion={id:string;required:boolean;
 /** What the doctor summary files the answer under. */
 role:'onset'|'location'|'severity'|'character'|'associated'|'context'|'reading';
 /** Short label for the doctor summary (staff app: EN and HY). */
 label:{en:string;hy:string};
 /** The sheet's own wording: what Zoe falls back to when the model's question fails a guard. */
 ask:Text;answer:AnswerType;
 /** "yes" is a red flag: the intake stops and the urgent path opens. RF id when one applies. */
 redFlagIfYes?:{id:string;rf:RedFlagId|null}};
export type SymptomSheet={id:string;version:number;status:'draft'|'signed';owner:string;
 label:{en:string;hy:string};
 /** Deterministic start: the newest member message matches (normalised text). */
 trigger:RegExp;questions:readonly SheetQuestion[]};

const yn={kind:'yes_no'}as const;
const scale={kind:'scale',min:0,max:10}as const;
const text=(max=120)=>({kind:'text',max})as const;
const opt=(id:string,en:string,hy:string,ru:string)=>({id,label:{en,hy,ru}});
const DRAFT={status:'draft'as const,owner:'Armen (clinical sign-off pending)'};

// Questions several sheets share. Same id, same wording, so the summary reads the same.
const ONSET:SheetQuestion={id:'onset',required:true,role:'onset',label:{en:'Started',hy:'Սկսվել է'},answer:text(),
 ask:{en:'When did it start?',hy:'Ե՞րբ է սկսվել։',ru:'Когда это началось?'}};
const SEVERITY:SheetQuestion={id:'severity',required:true,role:'severity',label:{en:'Severity (0 to 10)',hy:'Ուժգնություն (0-ից 10)'},answer:scale,
 ask:{en:'On a scale from 0 to 10, how strong is it?',hy:'0-ից 10 սանդղակով որքա՞ն ուժեղ է։',ru:'Насколько это сильно по шкале от 0 до 10?'}};
const BP:SheetQuestion={id:'bp_reading',required:false,role:'reading',label:{en:'Blood pressure the member reported',hy:'Անդամի նշած ճնշումը'},answer:text(40),
 ask:{en:'Have you measured your blood pressure since this started? If so, what did the monitor show?',hy:'Սա սկսվելուց հետո ճնշման չափում արե՞լ եք։ Եթե այո, ի՞նչ ցույց տվեց սարքը։',ru:'Вы измеряли давление с тех пор, как это началось? Если да, что показал тонометр?'}};
const CHEST:SheetQuestion={id:'chest_pain',required:true,role:'associated',label:{en:'Chest pain or pressure',hy:'Կրծքավանդակի ցավ կամ ճնշում'},answer:yn,redFlagIfYes:{id:'chest_pain',rf:'RF-01'},
 ask:{en:'Do you also have any pain or pressure in your chest?',hy:'Կրծքավանդակում ցա՞վ կամ ճնշում էլ ունեք։',ru:'Есть ли у вас также боль или давление в груди?'}};
const NEURO:SheetQuestion={id:'weakness_numbness',required:true,role:'associated',label:{en:'Weakness or numbness in the face, arm or leg',hy:'Դեմքի, ձեռքի կամ ոտքի թուլություն կամ թմրածություն'},answer:yn,redFlagIfYes:{id:'weakness_numbness',rf:'RF-04'},
 ask:{en:'Do you have any weakness or numbness in your face, an arm or a leg?',hy:'Դեմքի, ձեռքի կամ ոտքի թուլություն կամ թմրածություն ունե՞ք։',ru:'Есть ли слабость или онемение лица, руки или ноги?'}};
const SPEECH:SheetQuestion={id:'speech_trouble',required:true,role:'associated',label:{en:'Trouble speaking',hy:'Խոսելու դժվարություն'},answer:yn,redFlagIfYes:{id:'speech_trouble',rf:'RF-04'},
 ask:{en:'Is it hard to speak or find your words?',hy:'Դժվա՞ր է խոսել կամ բառեր գտնել։',ru:'Трудно ли говорить или подбирать слова?'}};
const FAINT:SheetQuestion={id:'fainting',required:true,role:'associated',label:{en:'Fainted or nearly fainted',hy:'Ուշագնացություն կամ դրան մոտ վիճակ'},answer:yn,redFlagIfYes:{id:'fainting',rf:'RF-02'},
 ask:{en:'Have you fainted or felt you were about to faint?',hy:'Ուշագնա՞ց եք եղել կամ զգացե՞լ եք, որ կարող եք ուշագնաց լինել։',ru:'Вы теряли сознание или чувствовали, что вот-вот потеряете?'}};
const BREATH_REST:SheetQuestion={id:'breathless_at_rest',required:true,role:'associated',label:{en:'Short of breath at rest',hy:'Հանգստի ժամանակ շնչարգելություն'},answer:yn,redFlagIfYes:{id:'breathless_at_rest',rf:'RF-02'},
 ask:{en:'Are you short of breath even while resting?',hy:'Շնչահեղձություն ունե՞ք նույնիսկ հանգստի ժամանակ։',ru:'Есть ли одышка даже в покое?'}};
const RIGHT_NOW=(id:string,rf:RedFlagId,en:string,hy:string,ru:string):SheetQuestion=>({id,required:true,role:'associated',label:{en:'Happening right now',hy:'Հենց հիմա է'},answer:yn,redFlagIfYes:{id,rf},ask:{en,hy,ru}});
const MEDICINE_CHANGE:SheetQuestion={id:'medicine_change',required:false,role:'context',label:{en:'Started or changed a medicine recently',hy:'Վերջերս սկսել կամ փոխել է դեղ'},answer:yn,
 ask:{en:'Have you started or changed any medicine recently?',hy:'Վերջերս նոր դեղ սկսե՞լ կամ փոխե՞լ եք։',ru:'Вы недавно начинали или меняли какое-либо лекарство?'}};

export const SHEETS:readonly SymptomSheet[]=Object.freeze([
 {id:'headache',version:1,...DRAFT,label:{en:'Headache',hy:'Գլխացավ'},
  trigger:/\b(headaches?|migraines?|head ?aches?|(my|the) head (hurts|is hurting|aches|is aching|is pounding|is throbbing|is killing me|is splitting)|pain in my head)\b|գլխացավ|գլուխս ցավ|գլուխը ցավ|(?<![a-z])glux\w*\s*cav\w*|голов\p{L}* бол|бол\p{L}* голов|мигрен/u,
  questions:[ONSET,
   {id:'sudden',required:true,role:'character',label:{en:'Came on suddenly, worst within about a minute',hy:'Սկսվել է հանկարծակի, մեկ րոպեում հասել առավելագույնին'},answer:yn,redFlagIfYes:{id:'thunderclap',rf:null},
    ask:{en:'Did it come on suddenly, reaching its worst within about a minute?',hy:'Հանկարծակի՞ սկսվեց և մոտ մեկ րոպեում հասավ ամենաուժեղին։',ru:'Она началась внезапно и стала максимальной примерно за минуту?'}},
   {id:'location',required:true,role:'location',label:{en:'Where in the head',hy:'Գլխի որ մասում'},
    answer:{kind:'choice',options:[opt('front','Front','Ճակատ','Лоб'),opt('back','Back of the head','Ծոծրակ','Затылок'),opt('one_side','One side','Մի կողմը','Одна сторона'),opt('whole_head','Whole head','Ամբողջ գլուխը','Вся голова'),opt('around_eyes','Around the eyes','Աչքերի շուրջը','Вокруг глаз'),opt('other','Somewhere else','Այլ տեղ','Другое место')]},
    ask:{en:'Where in your head do you feel it?',hy:'Գլխի ո՞ր մասում եք զգում։',ru:'В какой части головы вы это чувствуете?'}},
   SEVERITY,
   {id:'dizziness',required:true,role:'associated',label:{en:'Dizziness',hy:'Գլխապտույտ'},answer:yn,ask:{en:'Do you feel dizzy as well?',hy:'Գլխապտույտ է՞լ ունեք։',ru:'Есть ли также головокружение?'}},
   {id:'nausea',required:true,role:'associated',label:{en:'Nausea or vomiting',hy:'Սրտխառնոց կամ փսխում'},answer:yn,ask:{en:'Do you feel sick or have you vomited?',hy:'Սրտխառնո՞ց ունեք կամ փսխե՞լ եք։',ru:'Есть ли тошнота или рвота?'}},
   {id:'vision',required:true,role:'associated',label:{en:'Loss of vision or double vision',hy:'Տեսողության կորուստ կամ կրկնակի տեսողություն'},answer:yn,redFlagIfYes:{id:'vision_loss',rf:null},
    ask:{en:'Have you lost any vision or started seeing double?',hy:'Տեսողությունը վատացե՞լ է կամ կրկնակի՞ եք տեսնում։',ru:'Пропадало ли зрение или двоится ли в глазах?'}},
   NEURO,SPEECH,
   {id:'confusion',required:true,role:'associated',label:{en:'Confusion',hy:'Շփոթվածություն'},answer:yn,redFlagIfYes:{id:'confusion',rf:'RF-05'},
    ask:{en:'Do you feel confused, or has anyone said you seem confused?',hy:'Շփոթվա՞ծ եք զգում, կամ որևէ մեկն ասե՞լ է, որ շփոթված եք թվում։',ru:'Чувствуете ли вы спутанность, или кто-то говорил, что вы кажетесь растерянным?'}},
   {id:'fever_stiff_neck',required:true,role:'associated',label:{en:'Fever with a stiff neck',hy:'Ջերմություն՝ պարանոցի կարկամությամբ'},answer:yn,redFlagIfYes:{id:'fever_stiff_neck',rf:null},
    ask:{en:'Do you have a fever together with a stiff neck?',hy:'Ջերմություն ունե՞ք պարանոցի կարկամության հետ։',ru:'Есть ли температура вместе с напряжением в шее?'}},
   {id:'head_injury',required:true,role:'context',label:{en:'Recent head injury',hy:'Վերջերս գլխի վնասվածք'},answer:yn,redFlagIfYes:{id:'head_injury',rf:null},
    ask:{en:'Did it start after a knock or injury to your head?',hy:'Սկսվե՞լ է գլխին հարվածից կամ վնասվածքից հետո։',ru:'Она началась после удара или травмы головы?'}},
   BP,
   {id:'similar_before',required:false,role:'context',label:{en:'Had headaches like this before',hy:'Նման գլխացավ նախկինում եղել է'},answer:yn,
    ask:{en:'Have you had headaches like this before?',hy:'Նախկինում նման գլխացավ ունեցե՞լ եք։',ru:'Бывали ли у вас такие головные боли раньше?'}}]},
 {id:'dizziness',version:1,...DRAFT,label:{en:'Dizziness',hy:'Գլխապտույտ'},
  trigger:/\b(dizz\w*|light-?headed\w*|vertigo|(room|everything) (is )?spinning|unsteady)\b|գլխապտույտ|գլուխս պտտ|головокруж|кружится голова|голова кружится/u,
  questions:[ONSET,
   {id:'character',required:true,role:'character',label:{en:'What it feels like',hy:'Ինչպես է զգացվում'},
    answer:{kind:'choice',options:[opt('spinning','The room spins','Շուրջը պտտվում է','Всё кружится'),opt('lightheaded','Light-headed, as if about to faint','Թեթևություն գլխում, կարծես ուշագնաց կլինեմ','Дурнота, будто вот-вот потеряю сознание'),opt('unsteady','Unsteady on my feet','Անկայուն եմ քայլում','Неустойчивость при ходьбе'),opt('other','Something else','Այլ','Другое')]},
    ask:{en:'What does it feel like: does the room spin, do you feel light-headed, or unsteady on your feet?',hy:'Ինչպե՞ս է զգացվում. շուրջը պտտվո՞ւմ է, թեթևություն ունե՞ք գլխում, թե՞ անկայուն եք քայլում։',ru:'Как это ощущается: всё кружится, дурнота или неустойчивость при ходьбе?'}},
   {id:'when',required:true,role:'context',label:{en:'When it happens',hy:'Երբ է լինում'},
    answer:{kind:'choice',options:[opt('standing_up','When standing up','Վեր կենալիս','При вставании'),opt('constant','All the time','Անընդհատ','Постоянно'),opt('head_movement','When moving the head','Գլուխը շրջելիս','При движении головой'),opt('other','Other times','Այլ ժամանակ','В другое время')]},
    ask:{en:'When does it happen: when you stand up, all the time, or when you move your head?',hy:'Ե՞րբ է լինում. վեր կենալի՞ս, անընդհա՞տ, թե՞ գլուխը շրջելիս։',ru:'Когда это бывает: при вставании, постоянно или при движении головой?'}},
   FAINT,
   {id:'palpitations',required:true,role:'associated',label:{en:'Racing or irregular heartbeat',hy:'Արագ կամ անկանոն սրտխփոց'},answer:yn,
    ask:{en:'Is your heart racing or beating irregularly?',hy:'Սիրտն արագ կամ անկանո՞ն է խփում։',ru:'Сердце бьётся учащённо или неровно?'}},
   CHEST,NEURO,SPEECH,
   {id:'headache',required:false,role:'associated',label:{en:'Headache',hy:'Գլխացավ'},answer:yn,ask:{en:'Do you have a headache too?',hy:'Գլխացավ է՞լ ունեք։',ru:'Болит ли также голова?'}},
   BP,MEDICINE_CHANGE]},
 {id:'chest_discomfort',version:1,...DRAFT,label:{en:'Chest discomfort',hy:'Անհանգստություն կրծքավանդակում'},
  trigger:/\bchest\b|կրծք|(?<![a-z])krt?c?sk\w*|груд/u,
  questions:[
   // "Right now" first (the clinical algorithm's rule): yes opens the urgent route.
   RIGHT_NOW('right_now','RF-01','Is the discomfort in your chest happening right now?','Կրծքավանդակի անհանգստությունը հենց հիմա՞ է։','Дискомфорт в груди есть прямо сейчас?'),
   ONSET,
   {id:'character',required:true,role:'character',label:{en:'What it feels like',hy:'Ինչպես է զգացվում'},
    answer:{kind:'choice',options:[opt('pressure','Pressure or tightness','Ճնշում կամ սեղմում','Давление или сжатие'),opt('burning','Burning','Այրոց','Жжение'),opt('sharp','Sharp','Սուր','Острая'),opt('ache','Dull ache','Բութ ցավ','Ноющая'),opt('other','Something else','Այլ','Другое')]},
    ask:{en:'What did it feel like: pressure, burning, sharp, or a dull ache?',hy:'Ինչպե՞ս էր զգացվում. ճնշո՞ւմ, այրո՞ց, սո՞ւր, թե՞ բութ ցավ։',ru:'Как это ощущалось: давление, жжение, острая или ноющая боль?'}},
   {id:'spreads',required:true,role:'associated',label:{en:'Spread to the arm, jaw, neck or back',hy:'Տարածվել է ձեռքին, ծնոտին, պարանոցին կամ մեջքին'},answer:yn,redFlagIfYes:{id:'spreads',rf:'RF-01'},
    ask:{en:'Did it spread to your arm, jaw, neck or back?',hy:'Տարածվե՞լ է ձեռքին, ծնոտին, պարանոցին կամ մեջքին։',ru:'Отдавало ли в руку, челюсть, шею или спину?'}},
   {id:'with_sweat_or_breath',required:true,role:'associated',label:{en:'With sweating, sickness or breathlessness',hy:'Քրտնարտադրությամբ, սրտխառնոցով կամ շնչարգելությամբ'},answer:yn,redFlagIfYes:{id:'with_sweat_or_breath',rf:'RF-01'},
    ask:{en:'Did it come with sweating, feeling sick, or shortness of breath?',hy:'Ուղեկցվե՞լ է քրտնարտադրությամբ, սրտխառնոցով կամ շնչարգելությամբ։',ru:'Сопровождалось ли это потливостью, тошнотой или одышкой?'}},
   {id:'when',required:true,role:'context',label:{en:'When it came on',hy:'Երբ է սկսվել'},
    answer:{kind:'choice',options:[opt('exertion','During effort','Ծանրաբեռնվածության ժամանակ','При нагрузке'),opt('rest','At rest','Հանգստի ժամանակ','В покое'),opt('both','Both','Երկուսն էլ','И то, и другое'),opt('other','Other','Այլ','Другое')]},
    ask:{en:'Did it come on during effort, such as walking or stairs, or at rest?',hy:'Սկսվե՞լ է ծանրաբեռնվածության ժամանակ, օրինակ՝ քայլելիս կամ աստիճաններով բարձրանալիս, թե՞ հանգստի ժամանակ։',ru:'Это началось при нагрузке, например при ходьбе или на лестнице, или в покое?'}},
   {id:'duration',required:true,role:'context',label:{en:'How long it lasted',hy:'Որքան է տևել'},answer:text(),ask:{en:'How long did it last?',hy:'Որքա՞ն է տևել։',ru:'Сколько это длилось?'}},
   BP]},
 {id:'palpitations',version:1,...DRAFT,label:{en:'Palpitations',hy:'Սրտխփոց'},
  trigger:/\b(palpitat\w*|heart (is )?(racing|pounding|fluttering|skipping|beating (fast|hard|irregularly|strangely))|irregular heart ?beat|heart ?beat (is )?(fast|irregular|racing))\b|սրտխփոց|սիրտս (արագ|ուժեղ|անկանոն)|сердцебиен|сердц\p{L}*[^.!?\n]{0,20}(колот|бь[её]тся|выпрыг|скач)|перебои/u,
  questions:[
   RIGHT_NOW('right_now','RF-02','Is your heart racing or beating irregularly right now?','Հենց հիմա՞ է սիրտն արագ կամ անկանոն խփում։','Сердце бьётся учащённо или неровно прямо сейчас?'),
   ONSET,
   {id:'duration',required:true,role:'context',label:{en:'How long an episode lasts',hy:'Որքան է տևում'},answer:text(),ask:{en:'How long does it last each time?',hy:'Ամեն անգամ որքա՞ն է տևում։',ru:'Сколько длится каждый эпизод?'}},
   {id:'with_dizzy_breath_faint',required:true,role:'associated',label:{en:'With dizziness, breathlessness or near-fainting',hy:'Գլխապտույտով, շնչարգելությամբ կամ ուշագնացության զգացումով'},answer:yn,redFlagIfYes:{id:'with_dizzy_breath_faint',rf:'RF-02'},
    ask:{en:'Does it come with dizziness, shortness of breath, or feeling you might faint?',hy:'Ուղեկցվո՞ւմ է գլխապտույտով, շնչարգելությամբ կամ ուշագնաց լինելու զգացումով։',ru:'Сопровождается ли это головокружением, одышкой или ощущением, что можете потерять сознание?'}},
   CHEST,
   {id:'frequency',required:true,role:'context',label:{en:'How often',hy:'Որքան հաճախ'},answer:text(),ask:{en:'How often does it happen?',hy:'Որքա՞ն հաճախ է լինում։',ru:'Как часто это бывает?'}},
   {id:'triggers',required:false,role:'context',label:{en:'What seems to bring it on (member’s words)',hy:'Ինչն է առաջացնում (անդամի խոսքերով)'},answer:text(),
    ask:{en:'Have you noticed anything that seems to bring it on, such as coffee, effort or stress?',hy:'Նկատե՞լ եք, թե ինչն է այն առաջացնում, օրինակ՝ սուրճը, ծանրաբեռնվածությունը կամ սթրեսը։',ru:'Замечали ли вы, что его вызывает, например кофе, нагрузка или стресс?'}},
   {id:'pulse_reading',required:false,role:'reading',label:{en:'Pulse the member reported',hy:'Անդամի նշած զարկերակը'},answer:text(40),
    ask:{en:'If you measured your pulse or blood pressure during it, what did it show?',hy:'Եթե այդ ժամանակ զարկերակի կամ ճնշման չափում եք արել, ի՞նչ ցույց տվեց։',ru:'Если вы измеряли пульс или давление в это время, что показал прибор?'}}]},
 {id:'shortness_of_breath',version:1,...DRAFT,label:{en:'Shortness of breath',hy:'Շնչարգելություն'},
  trigger:/\b(short(ness)? of breath|breathless\w*|out of breath|hard to breathe|difficulty breathing|trouble breathing|can'?t catch my breath)\b|շնչարգել|շնչահեղձ|դժվար եմ շնչում|одышк|тяжело дышать|не хватает воздуха|трудно дышать/u,
  questions:[
   RIGHT_NOW('at_rest_now','RF-02','Are you short of breath right now, even while resting?','Հենց հիմա՞ շնչարգելություն ունեք, նույնիսկ հանգստի ժամանակ։','Есть ли одышка прямо сейчас, даже в покое?'),
   ONSET,
   {id:'when',required:true,role:'context',label:{en:'When it happens',hy:'Երբ է լինում'},
    answer:{kind:'choice',options:[opt('exertion','During effort','Ծանրաբեռնվածության ժամանակ','При нагрузке'),opt('lying_flat','Lying flat','Պառկած ժամանակ','Лёжа'),opt('rest','At rest','Հանգստի ժամանակ','В покое'),opt('other','Other','Այլ','Другое')]},
    ask:{en:'When does it happen: during effort, when lying flat, or at rest?',hy:'Ե՞րբ է լինում. ծանրաբեռնվածության ժամանա՞կ, պառկա՞ծ, թե՞ հանգստի ժամանակ։',ru:'Когда это бывает: при нагрузке, лёжа или в покое?'}},
   CHEST,
   {id:'leg_swelling',required:true,role:'associated',label:{en:'Swollen ankles or legs',hy:'Այտուցված կոճեր կամ ոտքեր'},answer:yn,ask:{en:'Are your ankles or legs swollen?',hy:'Կոճերը կամ ոտքերը այտուցվա՞ծ են։',ru:'Отекают ли лодыжки или ноги?'}},
   {id:'cough',required:true,role:'associated',label:{en:'Cough',hy:'Հազ'},answer:yn,ask:{en:'Do you have a cough?',hy:'Հազ ունե՞ք։',ru:'Есть ли кашель?'}},
   {id:'worse_than_usual',required:true,role:'context',label:{en:'Worse than usual for the member',hy:'Սովորականից վատ է'},answer:yn,ask:{en:'Is this worse than usual for you?',hy:'Սա ձեզ համար սովորականից վա՞տ է։',ru:'Сейчас хуже, чем у вас бывает в другие дни?'}},
   BP]},
 {id:'swelling',version:1,...DRAFT,label:{en:'Swelling',hy:'Այտուց'},
  trigger:/\b(swell\w*|swollen|puffy|o?edema)\b|այտուց|ուռ(ել|ած|չել)|отек|отёк|опух|отекают|отекли/u,
  questions:[
   {id:'where',required:true,role:'location',label:{en:'Where',hy:'Որտեղ'},
    answer:{kind:'choice',options:[opt('ankles_feet','Ankles or feet','Կոճեր կամ ոտնաթաթեր','Лодыжки или стопы'),opt('legs','Both legs','Երկու ոտքերը','Обе ноги'),opt('one_leg','One leg only','Միայն մեկ ոտքը','Только одна нога'),opt('face_lips','Face, lips or tongue','Դեմք, շրթունքներ կամ լեզու','Лицо, губы или язык'),opt('hands','Hands','Ձեռքեր','Руки'),opt('other','Somewhere else','Այլ տեղ','Другое место')]},
    ask:{en:'Where is the swelling?',hy:'Որտե՞ղ է այտուցը։',ru:'Где отёк?'}},
   {id:'face_lips_tongue',required:true,role:'associated',label:{en:'Swelling of the face, lips or tongue',hy:'Դեմքի, շրթունքների կամ լեզվի այտուց'},answer:yn,redFlagIfYes:{id:'face_lips_tongue',rf:null},
    ask:{en:'Is your face, lips or tongue swollen?',hy:'Դեմքը, շրթունքները կամ լեզուն այտուցվա՞ծ են։',ru:'Отекли ли лицо, губы или язык?'}},
   ONSET,
   {id:'one_leg_red_painful',required:true,role:'associated',label:{en:'One leg swollen, red or painful',hy:'Մեկ ոտքն այտուցված, կարմիր կամ ցավոտ է'},answer:yn,redFlagIfYes:{id:'one_leg_red_painful',rf:null},
    ask:{en:'Is only one leg swollen, and is it red, warm or painful?',hy:'Միայն մեկ ոտքն է՞ այտուցված, և այն կարմի՞ր, տա՞ք կամ ցավո՞տ է։',ru:'Отекла только одна нога, и она красная, горячая или болит?'}},
   BREATH_REST,
   {id:'weight_gain',required:false,role:'context',label:{en:'Quick weight gain',hy:'Արագ քաշի ավելացում'},answer:yn,ask:{en:'Have you put on weight quickly in the last few days?',hy:'Վերջին մի քանի օրում քաշն արագ ավելացե՞լ է։',ru:'Вы быстро набрали вес за последние несколько дней?'}},
   MEDICINE_CHANGE]},
 {id:'fatigue',version:1,...DRAFT,label:{en:'Tiredness',hy:'Հոգնածություն'},
  trigger:/\b(tired(?! of)|tiredness|so tired|fatigue[ds]?|exhausted|exhaustion|no energy|worn out|(feel|feeling|felt) weak|weak all over)\b|հոգնած|ուժասպառ|թուլություն|ուժ չունեմ|устал\p{L}*(?! от)|утомл|слабост|нет сил/u,
  questions:[ONSET,SEVERITY,
   {id:'daily_activities',required:true,role:'context',label:{en:'Stopping usual activities',hy:'Խանգարում է սովորական գործերին'},answer:yn,ask:{en:'Is it stopping you from doing your usual daily activities?',hy:'Խանգարո՞ւմ է ձեր սովորական ամենօրյա գործերին։',ru:'Мешает ли это вашим повседневным делам?'}},
   {id:'sleep',required:false,role:'context',label:{en:'Sleep (member’s words)',hy:'Քուն (անդամի խոսքերով)'},answer:text(),ask:{en:'How have you been sleeping?',hy:'Ինչպե՞ս եք քնում վերջերս։',ru:'Как вы спите в последнее время?'}},
   BREATH_REST,CHEST,FAINT,
   {id:'other_symptoms',required:false,role:'associated',label:{en:'Other symptoms (member’s words)',hy:'Այլ ախտանիշներ (անդամի խոսքերով)'},answer:text(),ask:{en:'Have you noticed anything else along with it?',hy:'Դրա հետ մեկտեղ ուրիշ բան նկատե՞լ եք։',ru:'Заметили ли вы что-то ещё вместе с этим?'}},
   MEDICINE_CHANGE]},
 // Last: anything else that sounds like feeling unwell. Free text, the red-flag basics.
 {id:'other',version:1,...DRAFT,label:{en:'Other symptom',hy:'Այլ ախտանիշ'},
  trigger:/\b(symptoms?|pains?|painful|hurts?|hurting|aches?|aching|feel(ing)? (unwell|sick|ill|bad|awful|terrible|weird|strange|off|not (well|good|right))|not feeling (well|good|right)|nause\w*|vomit\w*|fever|numb\w*|tingl\w*|blurr\w*)\b|(?<!\p{L})ցավ(ում|ս|ը|եր|երս|ոտ|ի|ն|եց|ել|ած)?(?!\p{L})|վատ եմ զգում|լավ չեմ զգում|սրտխառն|ջերմ|(?<![a-z])cav\w*(?![a-z])|(?<!\p{L})бол(ит|ят|ь|и|ел|ела|ело|ели|ью)(?!\p{L})|плохо себя чувствую|тошн|температур|онем/u,
  questions:[
   {id:'what',required:true,role:'character',label:{en:'What the member feels (their words)',hy:'Ինչ է զգում անդամը (իր խոսքերով)'},answer:text(200),ask:{en:'Could you tell me a little more about what you feel?',hy:'Կարո՞ղ եք մի փոքր ավելին պատմել, թե ինչ եք զգում։',ru:'Расскажите, пожалуйста, чуть подробнее, что вы чувствуете?'}},
   {id:'where',required:true,role:'location',label:{en:'Where in the body',hy:'Մարմնի որ մասում'},answer:text(),ask:{en:'Where in your body do you feel it?',hy:'Մարմնի ո՞ր մասում եք զգում։',ru:'В какой части тела вы это чувствуете?'}},
   ONSET,SEVERITY,
   {id:'getting_worse',required:true,role:'context',label:{en:'Getting worse',hy:'Վատանում է'},answer:yn,ask:{en:'Is it getting worse?',hy:'Վատանո՞ւմ է։',ru:'Становится ли хуже?'}},
   CHEST,BREATH_REST,NEURO]},
]);

export const sheetById=(id:string,version?:number)=>SHEETS.find(s=>s.id===id&&(version===undefined||s.version===version));

/** The sheet a newest message starts, specific sheets before "other"; null when none. */
export function sheetFor(normalisedText:string):SymptomSheet|null{
 return SHEETS.find(s=>s.trigger.test(normalisedText))??null;
}
