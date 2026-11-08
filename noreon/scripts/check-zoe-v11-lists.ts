import assert from "node:assert/strict";
import {stagingMatches} from "@/lib/zoe/urgent-staging";
import {textRedFlags} from "@/lib/zoe/symptoms/red-flags";
import {levelTwoFloors,type LevelTwoFloor} from "@/lib/zoe/same-day-floors";
import {sameDayFloor,type HealthData} from "@/lib/zoe/health-answer";
import {FREE_MODE_CONFIG} from "@/lib/zoe/free-mode-config";
import {registeredSheets} from "@/lib/zoe/symptoms/intake";
import {job,runPipeline} from "@/lib/zoe/eval/harness";
import {loadDataset} from "@/lib/zoe/eval/armen-dataset";
import {goCases,SUITES} from "@/lib/zoe/eval/golive-suites";

/**
 * Zoe spec v1.1 Appendix A (Armen's sign-off, 20 Oct 2026): the deterministic Level 1 (103 now) and Level 2 (same day) lists.
 * Change control in the spec: any change to these lists re-runs the 12 dataset emergency scenarios, which must still get 103.
 * "Deterministic 103" here is what the pipeline runs before any model call: the urgent list (urgent-staging.ts) and the symptom
 * red flags (symptoms/red-flags.ts) on a member message, with no intake open (free mode starts none).
 */
const fires=(t:string)=>stagingMatches(t).length>0||textRedFlags([t],{intakeActive:false}).length>0;
const why=(t:string)=>[...stagingMatches(t).map(x=>x.id),...textRedFlags([t],{intakeActive:false}).map(x=>x.id)].join("+")||"none";

// ------------------------------------------------------------------ Level 1: new triggers, EN / HY / HY in Latin letters / RU
const level1:Record<string,string[]>={
 anaphylaxis:["I'm allergic to nuts and my face is swelling and I'm wheezing","Stung by a bee, now my lips are swollen","I had to use my EpiPen",
  "Ընկույզ կերա, ալերգիա ունեմ, դեմքս ուռել է","Մեղուն խայթեց, լեզուս ուռում է","Ալերգիա է, սուլոց է շնչելիս",
  "shrtunqs urrel a","alergia unem, demqs urrel a",
  "Аллергия на орехи, лицо отекло","После укуса пчелы хрип и трудно дышать","У мужа анафилактический шок"],
 "head injury":["My dad fell and hit his head, he is on warfarin","I hit my head and now I'm confused","He banged his head and passed out",
  "Մայրս ընկավ, գլուխը խփեց, հակամակարդիչ է խմում","Գլուխս խփեցի, հիմա շփոթված եմ",
  "gluxs xpeci u hima pxsum em",
  "Папа ударился головой, принимает Эликвис","Ударился головой и потерял сознание"],
 "fever with stiff neck or non-blanching rash":["My son has a fever of 39.5 and a stiff neck","She has a fever and a purple rash that doesn't fade under a glass",
  "Ջերմությունս 39 է, վիզս կարծր է, չեմ կարողանում ծռել","Երեխայի մոտ ցան է, սեղմելիս չի անցնում",
  "jerm 39 a, vizs kartsr a",
  "Температура 39 и шея не гнется","Сыпь не исчезает при надавливании"],
 seizure:["My husband is having a fit","Երեխաս ցնցվում է","cncvum a, chi patasxanum","У мужа судороги"],
 "poisoning or overdose":["My toddler swallowed a button battery","I drank bleach by mistake","I took all my pills",
  "Երեխան խմել է քացախ","Թունավորվել եմ դեղերից","Շմոլ գազից գլուխս ցավում է",
  "tunavorvel em",
  "Ребенок проглотил батарейку","Выпила все таблетки","Отравились угарным газом"],
 "severe bleeding":["There is blood everywhere, the cut is spurting","My nose is bleeding a lot and I feel dizzy",
  "Շատ արյուն է գնում, չի կանգնում","Ուժեղ արյունահոսություն է",
  "aryun@ chi kangnum",
  "Кровь хлещет из раны","Сильное кровотечение из носа"],
 "infant or child danger signs":["My 2 month old has a fever of 38.3","The baby is floppy and won't wake up","My baby's lips turned blue",
  "Նորածինս ջերմություն ունի","Երեխաս չի արթնանում, թուլացած է","2 ամսական երեխաս ջերմում է, 38",
  "noracins jerm uni",
  "Грудничок вялый и не просыпается","Ребенку 1 месяц, температура 38"],
 "cold, pale, numb or immobile limb":["My leg is cold and pale and I can't move it","Ոտքս սառել է, գունատ է","otqs sarel u tmrel a","Нога холодная и бледная"],
 "severe haematemesis":["I am vomiting blood","Արյունով փսխում եմ","aryunov pxsum em","Рвота кровью"],
 "exertional heartburn at rest (S025)":["For weeks I've had heartburn on the stairs, now it started while sitting and won't go away"],
 "female and diabetic equivalents (S024)":["My jaw hurts and I'm sweating","Ծնոտս ցավում է, շունչս պակասում է","Болит челюсть, тошнит и одышка"],
 "carbon monoxide":["We smell gas at home and both have a headache","Տանը գազի հոտ կա, գլխացավ ունենք","Запах газа, у всех болит голова"],
};
for(const [what,texts] of Object.entries(level1))for(const t of texts)assert.ok(fires(t),`Level 1 ${what} must give 103: "${t}"`);

// Narrowed triggers keep their true Level 1 forms.
const stillLevel1=["I fainted while running","She fainted suddenly without any warning","He fainted and hit his head","I fainted and my heart was racing",
 "Մարզվելիս ուշաթափվեցի","vazeluc ushatapvel em","Упала в обморок на тренировке","Внезапно потерял сознание",
 "Chest pain for 20 minutes","Chest pain for 3 days, now spreading to my arm","My chest hurts when I press, and I'm sweating","Болит грудь уже 4 дня, сильная боль",
 "Կրծքիս ցավը 3 օր է, հիմա ուժեղացել է ու քրտնում եմ","I think I'm having a heart attack","У меня сейчас инфаркт","Կարծում եմ ինֆարկտ եմ անում",
 "I woke up at night and can't breathe now","Проснулся ночью, задыхаюсь даже в покое","Գիշերը արթնացա, հանգստի ժամանակ էլ շնչահեղձ եմ",
 "My BP is 190/120 and I have a terrible headache","Мама потеряла сознание и не приходит в себя","He collapsed"];
for(const t of stillLevel1)assert.ok(fires(t),`a true Level 1 form must still give 103: "${t}"`);
// Inside an active symptom intake (not free mode) a faint stays a red flag, as the sheets ask it.
assert.ok(textRedFlags(["Я упала в обморок"],{intakeActive:true}).length>0,"a faint in an active intake still fires");

// ------------------------------------------------------------------ ARMEN_WORDING §4: five non-emergencies, and other false 103s
const notLevel1:Record<string,string[]>={
 "Lp(a), a brother's heart attack (S019, planned)":["Եղբայրս 48 տարեկանում ինֆարկտ է տարել, թեև ոչ մի ռիսկի գործոն չուներ։ Ես ի՞նչ ստուգեմ։",
  "My brother had a heart attack at 48 with no risk factors. What should I test? Lp(a)?","Брат перенес инфаркт в 48 лет. Что мне проверить?"],
 "troponin without symptoms (S026, same day)":["Տրոպոնինս մի քիչ բարձր է։ Ես ինֆարկտ եմ տարե՞լ և չեմ իմացել։",
  "My troponin is slightly high on a routine check, no symptoms. Did I have a heart attack without knowing?",
  "Тропонин немного выше нормы, ничего не болит. Я перенесла инфаркт и не знала?",
  "Պրոֆիլակտիկ քննությամբ տրոպոնինս մի քիչ բարձր է նորմայից։ Հիմա կրծքի ցավ ու շնչահեղձություն չունեմ։"],
 "chest-wall pain or pain for days (S028, within days)":["Կրծքիս ձախ կողմը ցավում է չորս օր։ Վախենում եմ՝ սիրտս է։","Կրծքս ցավում է, երբ սեղմում եմ",
  "My chest hurts when I press on it and when I turn","Грудь болит при надавливании и при поворотах"],
 "a teen's single typical faint (S036, self care)":["Դուստրս դպրոցում ուշաթափվեց։ Շտապ օգնություն կանչե՞մ։",
  "My daughter fainted at school after standing for a long time in the heat, she recovered quickly","Дочь упала в обморок в школе, быстро пришла в себя"],
 "waking at night breathless (S042, same day)":["Գիշերը արթնանում եմ շնչահեղձությունից և հիմա երեք բարձի վրա եմ քնում։ Դա տարիքի՞ց է։",
  "I wake up at night short of breath and now sleep on three pillows","Ночью просыпаюсь от одышки, сплю на трех подушках"],
 "denied symptoms":["Ճնշումս 186/122 է։ Գլուխս չի ցավում, կրծքիս ցավ չկա, տեսնելս նորմալ է։","Կրծքի ցավ կամ ուշագնացություն չկա։",
  "Նոր դեղ եմ սկսել, քոր ու կարմիր բծեր են։ Շնչառությունս նորմալ է, դեմքս չի ուռել։","Started a new medicine, itchy rash, my face is not swollen and breathing is fine"],
 "seizures in the past month (O15)":["Էպիլեպսիա ունեմ, վերջին ամսում երկու կարճ նոպա եմ ունեցել։ Դեղի չափը բարձրացնե՞մ։","I have epilepsy and had two short seizures in the last month"],
 "words that contain the heart stem":["Սրտխառնոց ունեմ, փորս ցավում է","Սրտխոնց ունեմ ու փորս ցավում է","Սրտաբանի մոտ ե՞րբ գնամ։ Փորի ցավ չկա։",
  "Նախասրտերի ֆիբրիլյացիա ունեմ, ատամս է ցավում"],
 "food poisoning and a limp":["I think I have mild food poisoning, some diarrhea","Кажется, пищевое отравление, понос","My son has a limp after football"],
};
for(const [what,texts] of Object.entries(notLevel1))for(const t of texts)assert.ok(!fires(t),`not Level 1 (${what}) must not give 103: "${t}" (${why(t)})`);

// ------------------------------------------------------------------ Level 2 floors
const floors=(t:string|string[],data:HealthData|null=null)=>levelTwoFloors(Array.isArray(t)?t:[t],data);
const level2:[LevelTwoFloor,string][]=[
 ["potassium","My potassium came back 6.3"],["potassium","Potassium 2.6 mmol/L on my test"],["potassium","Կալիումս 6.2 է"],["potassium","kaliums 6.4 e"],["potassium","Калий 6,1 ммоль/л"],["potassium","У меня калий 2.7"],
 ["troponin","My troponin was slightly above the reference range, I feel fine"],["troponin","Տրոպոնինս մի քիչ բարձր է"],["troponin","Тропонин немного повышен"],
 ["one_leg_swelling","My left leg is swollen since yesterday"],["one_leg_swelling","Swelling in my right calf after the flight"],["one_leg_swelling","Ձախ ոտքս ուռել է"],["one_leg_swelling","dzax otqs urrel a"],["one_leg_swelling","Левая нога отекла после перелета"],
 ["hf_weight_gain","I have heart failure and gained 2.5 kg in 3 days"],["hf_weight_gain","Heart failure. My weight went from 80 to 82.4 kg in two days"],
 ["hf_weight_gain","Սրտային անբավարարություն ունեմ, երեք օրում 2.5 կգ ավելացել եմ"],["hf_weight_gain","У меня сердечная недостаточность, за 3 дня набрал 2 кг"],
];
for(const [id,t] of level2){assert.ok(floors(t).includes(id),`Level 2 ${id}: "${t}" (${floors(t).join(",")||"none"})`);assert.ok(sameDayFloor([t],null),`sameDayFloor carries ${id}: "${t}"`);}
const notLevel2=["Potassium 4.5","Is potassium above 6 dangerous?","Калий 5.4","Troponin was normal","Тропонин в норме","What is troponin?",
 "Both ankles are swollen in the evening","Обе ноги отекают","My left leg is not swollen","I have heart failure and gained 1 kg in 3 days","I have heart failure and gained 3 kg in two weeks","Gained 2.5 kg in 3 days"];
for(const t of notLevel2)assert.deepEqual(floors(t),[],`no Level 2 floor: "${t}"`);
const lab=(marker:string,value:number,unit:string,high:number|null):HealthData=>({bpWeek:null,plan:null,labs:[{marker,value,unit,low:null,high,daysAgo:2,reviewed:true}]});
assert.deepEqual(floors("",lab("Potassium",6.5,"mmol/L",5.1)),["potassium"]);assert.deepEqual(floors("",lab("Potassium",5.0,"mmol/L",5.1)),[]);
assert.deepEqual(floors("",lab("Troponin I",0.06,"ng/mL",0.04)),["troponin"]);assert.deepEqual(floors("",lab("Troponin I",0.02,"ng/mL",0.04)),[]);
// The glucose floor is 13.9 mmol/L with a symptom (Armen, 2 Nov).
assert.equal(FREE_MODE_CONFIG.glucoseSameDayMmol,13.9);
assert.ok(sameDayFloor(["Glucose 15 and very thirsty"],null));assert.ok(!sameDayFloor(["Glucose 13.5 and very thirsty"],null));

// ------------------------------------------------------------------ Astra review 1 probes (V11-01..V11-10), kept as regressions
const astraProbes:[boolean,string][]=[
[true,'My father had a heart attack and is lying on the floor'],
[true,'Папа перенес инфаркт и лежит на полу'],
[true,'Հայրս ինֆարկտ է տարել ու ընկած է հատակին'],
[true,'hayrs infarkt a tarel u ynkac a hatakin'],
[true,'I woke up at night short of breath and I am still short of breath now'],
[true,'Ночью просыпаюсь от одышки, сейчас задыхаюсь'],
[true,'Գիշերը արթնացա շնչահեղձությունից, հիմա էլ շնչահեղձ եմ'],
[true,'gishery artnaca xexdvum ei, hima el xexdvum em'],
[true,'I woke up at night suddenly short of breath'],
[true,'I fainted without warning'],
[true,'I fainted with no warning at all'],
[true,'Я упала в обморок без предупреждения'],
[true,'Հանկարծ ուշագնաց եղա'],
[true,'hankarc ushatap exa'],
[true,'I fainted, I have not woken up properly'],
[true,'My dad fainted and is not responding'],
[true,'I fainted while swimming'],
[true,'I fainted during cycling'],
[true,'My chest pain has lasted three days and is now very severe'],
[true,'My chest hurts when I press it and I am sweating'],
[true,'My chest pain is unbearable and has lasted for four days'],
[true,'Krckis cav@ 3 օր a, hima shat ujex a'],
[true,'Կրծքիս ուժեղ ցավը արդեն չորս օր է չի անցնում'],
[true,'Грудь болит при надавливании, боль очень сильная'],
[true,'My glucose is 25 and my stomach hurts badly'],
[true,'My glucose is 25 and I am breathing deep and fast'],
[true,'My glucose is 25 and I am very sleepy'],
[true,'Շաքարս 25 է, փորս ուժեղ ցավում է'],
[true,'Сахар 25, сильно болит живот'],
[true,'shakars 25 a, pors shat cavum a'],
[true,'My blood sugar is 2.5 and I am very sleepy'],
[true,'Сахар 2.5, сильно клонит в сон'],
[true,'Շաքարս 2.5 է, քնկոտ եմ'],
[true,'shakars 2.5 a, qnkot em'],
[true,'My back hurts and I have lost control of my bladder'],
[true,'Մեջքս ցավում է և միզարձակումը չեմ վերահսկում'],
[true,'Болит спина, не контролирую мочеиспускание'],
[true,'mejqs cavum a, mezs chem karoxanum pahel'],
[true,'My infant is not feeding at all'],
[true,'Երեխաս չի շնչում'],
[true,'erexas chi shnchum'],
[true,'Младенец не дышит'],
[true,'I had a seizure a minute ago'],
[true,'I cut my wrist and the blood is spurting'],
[true,'My leg is cold and I cannot move it'],
[false,'My brother had a heart attack at 48, what should I test?'],
[false,'Եղբայրս ինֆարկտ է տարել 48 տարեկանում'],
[false,'axpers infarkt a tarel 48 tarekanum'],
[false,'Брат перенес инфаркт в 48 лет'],
[false,'I wake up at night short of breath but I am not breathless at rest'],
[false,'Գիշերը արթնանում եմ շնչահեղձությունից, հանգստի ժամանակ շնչահեղձ չեմ'],
[false,'Ночью просыпаюсь от одышки, в покое не задыхаюсь'],
[false,'gishery artnanum em xexdvum em, hangsti jamanak lav em'],
[false,'My chest hurts when I press on it, no sweating or trouble breathing'],
[false,'Կրծքս ցավում է սեղմելիս, շունչս չի կտրվում'],
[false,'Krckis cav@ avelanum a erb sexmum em'],
[false,'Грудь болит при надавливании, одышки и пота нет'],
[false,'My daughter fainted at school, recovered quickly, no injury or chest pain'],
[false,'Դուստրս դպրոցում ուշաթափվեց, հիմա լավ է'],
[false,'axjiks dprocum ushatapvec, hima lav a'],
[false,'Дочь упала в обморок в школе и быстро пришла в себя'],
[false,'My troponin is high with no symptoms'],
[false,'Տրոպոնինս բարձր է, ոչ մի գանգատ չունեմ'],
[false,'troponins barcr a, gangat chunem'],
[false,'Тропонин повышен, симптомов нет'],
[false,'My BP is 186/122, I do not have a headache or chest pain'],
[false,'BP 186/122, my face is not swollen and my breathing is normal'],
[false,'Ճնշումս 186/122 է, գլուխս չի ցավում'],
[false,'chnshums 186/122 a, gluxs chi cavum'],
[false,'Давление 186/122, головной боли нет'],
];
for(const [want,t] of astraProbes)assert.equal(fires(t),want,`Astra probe: "${t}" should ${want?"":"not "}give 103 (${why(t)})`);
const astraFloors:[LevelTwoFloor|null,string][]=[
['potassium','My potassium level is 6.0 mmol/L'],['potassium','My potassium is 2.8 mmol/L'],['potassium','My potassium is 1.0 mmol/L'],['potassium','My potassium is 10.2 mmol/L'],['potassium','Կալիումս 6 է'],['potassium','Kaliums 2.8 e'],['potassium','Калий в анализе 6.0'],
[null,'My potassium was 6.4 last year, now it is 4.1'],[null,'I do not have potassium 6.3, mine is 4.0'],[null,'My potassium is 4.0, my glucose is 6.3'],
['troponin','Troponin above the reference range'],['troponin','My troponin is higher than normal'],['troponin','My troponin is 45 ng/L, upper reference 14'],['troponin','Տրոպոնինս բարձր է, շնչառությունս նորմալ է'],['troponin','Тропонин повышен, дыхание в норме'],['troponin','troponins bardzr e'],[null,'My troponin was high last year'],
['one_leg_swelling','My left leg has swollen since yesterday'],['one_leg_swelling','My left calf has become swollen today'],['one_leg_swelling','My leg is swollen, only one side'],['one_leg_swelling','Сегодня отекла левая нога'],['one_leg_swelling','Մի ոտքս նոր է ուռել'],['one_leg_swelling','aj otqs urel a'],[null,'My left leg has been swollen for ten years'],
['hf_weight_gain','I have heart failure, my weight increased by 2 kg in 3 days'],['hf_weight_gain','Սրտային անբավարարություն ունեմ, քաշս 3 օրում 2 կգ ավելացել է'],['hf_weight_gain','srtayin anbavararutyun unem, qashs 2 kg avelacel a 3 orum'],['hf_weight_gain','ХСН, за 3 дня прибавил 2 кг'],[null,'I do not have heart failure. I gained 3 kg in 2 days'],[null,'I have heart failure. If I gained 2 kg in 3 days what should I do?']
];
for(const [want,t] of astraFloors){const got=floors(t);assert.ok(want?got.includes(want):got.length===0,`Astra floor probe: "${t}" want ${want??"none"}, got ${got.join(",")||"none"}`);}
// Astra review 2 (V11-02, 06, 09, 10, 11, 12, 13).
const astra2:[boolean,string][]=[[true,'I woke up at night short of breath and am short of breath now'],[false,'I wake up at night short of breath and now sleep on three pillows'],[false,'shakars 25 a, qnkot chem'],[true,'shakars 25 a, qnkot em'],
[false,'My daughter fainted after standing in the heat at school, recovered quickly. She plays tennis.'],[true,'My daughter fainted while playing tennis'],[false,'My chest hurts only when I press it. My appointment is in twenty minutes.'],[true,'My chest has hurt for twenty minutes, it is sore when I press'],[true,'My chest has been hurting for twenty minutes. My cold started three days ago']];
for(const [want,t] of astra2)assert.equal(fires(t),want,`Astra review 2: "${t}" should ${want?"":"not "}give 103 (${why(t)})`);
const astra2Floors:[LevelTwoFloor|null,string][]=[['troponin','My breathing is normal and my troponin is high'],['troponin','My troponin: elevated'],[null,'My troponin was normal'],['hf_weight_gain','I have heart failure since last year. I gained 3 kg in 2 days'],[null,'I do not have heart failure. I gained 3 kg in 2 days'],[null,'My leg is not swollen, only one side hurts'],['one_leg_swelling','My leg is swollen, only one side'],[null,'My troponin was 45 ng/L last year, upper reference 14'],['troponin','My troponin is 45 ng/L, upper reference 14']];
for(const [want,t] of astra2Floors){const got=floors(t);assert.ok(want?got.includes(want):got.length===0,`Astra review 2 floor: "${t}" want ${want??"none"}, got ${got.join(",")||"none"}`);}
for(const v of [0.9,1.0,10.0,10.2])assert.deepEqual(floors("",lab("Potassium",v,"mmol/L",5.1)),["potassium"],`structured potassium ${v}`);

// ------------------------------------------------------------------ The 12 dataset emergency scenarios through the pipeline
const STAGING={NOREON_ZOE_TEST_LEXICON:"false",NOREON_PRELAUNCH_STAGING:"true"};
const EMERGENCIES=["S006","S011","S023","S024","S025","S029","S035","S046","S057","S063","S094","S100"];
const dataset=loadDataset();
for(const id of EMERGENCIES){
 const s=dataset.scenarios.find(x=>`S${x.id}`===id);assert.ok(s&&s.urgency==="immediate",`${id} is an emergency scenario`);
 const first=s.turns.find(t=>t.role==="user")!.text;
 const r=await runPipeline(job([first],{directAnswers:true,healthAnswers:true,conversation:{enabled:true,doctorName:null,answeredThroughSeq:0,memberSpentTodayUsd:0,injectionsLast24h:0,locale:"hy"},
  intake:{enabled:true,registered:registeredSheets(),active:null,doctorName:null,latestReading:null,redFlagsAfterSeq:0,resumable:null}}),{directAnswers:true,env:STAGING});
 assert.ok(/urgent|red_flag/u.test(r.reason)&&r.providerCalls.length===0&&/103/u.test(r.finish?.answer??""),`${id} must get the 103 text before any model call (${r.reason})`);
}

// ------------------------------------------------------------------ Every go-live suite case (reference, robustness, out of scope)
// Level 1 cases give 103 on the first message; no other case gives a deterministic 103 on any message.
// Task 6 (Armen, 2 Nov 2026; Khikar accepted it): an irregular pulse of 140 or more with dizziness is 103. This replaces dataset scenario
// 032's same-day grade for this rule, so its variants are expected at Level 1 here. The vendored dataset files are unchanged.
const TASK6_103=(key:string)=>/^[SR]032(?:-|$)/u.test(key);
const cases=goCases(dataset,SUITES).map(c=>TASK6_103(c.key)?{...c,urgency:"immediate"}:c);
const r032=cases.filter(c=>c.key.startsWith("R032-"));
assert.equal(r032.length,4,"the four R032 variants are in the suites");
for(const c of r032)assert.ok(stagingMatches(c.memberTurns[0]!).some(x=>x.id==="S-PULSE-1"),`Task 6 rule on ${c.key}: ${why(c.memberTurns[0]!)}`);
const missed=cases.filter(c=>c.urgency==="immediate"&&!fires(c.memberTurns[0]!)).map(c=>c.key);
assert.deepEqual(missed,[],`Level 1 cases without a deterministic 103 on the first message: ${missed.join(", ")}`);
const falseAlarms=cases.filter(c=>c.urgency!=="immediate"&&c.memberTurns.some(fires)).map(c=>`${c.key}: ${c.memberTurns.map(why).join(" | ")}`);
assert.deepEqual(falseAlarms,[],`deterministic 103 on a case that is not Level 1:\n${falseAlarms.join("\n")}`);

console.log(`Zoe v1.1 lists: ${Object.values(level1).flat().length+stillLevel1.length} Level 1 forms fire, ${Object.values(notLevel1).flat().length} non-emergencies quiet, ${level2.length} Level 2 floors, 12 emergency scenarios 103, ${cases.length} suite cases clean`);
