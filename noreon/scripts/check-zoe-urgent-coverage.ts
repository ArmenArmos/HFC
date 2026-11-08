import assert from "node:assert/strict";
import {stagingMatches} from "@/lib/zoe/urgent-staging";

/**
 * SYNTHETIC held-out checks for the placeholder urgent list's 19 Oct additions (lead 21:50; Zoe spec v1 §7): wordings not in
 * the go-live suites, in EN, HY and RU (Latin-letter and mixed too), that must take the no-model urgent route, and everyday
 * wordings that must not. The list stays a STAGING PLACEHOLDER pending Tatevik's S1 sign-off; over-matching is the intended failure.
 */
const fire:[string,string][]=[
 ["meningism","My son is 20, has a fever of 39 and his neck is stiff"],["meningism","У дочери температура 39 и болит шея, не может наклонить голову"],["meningism","Աղջկաս ջերմությունը 39 է, վիզը ցավում է, չի կարողանում ծռել"],
 ["head injury","Mum fell, hit her head and has vomited twice"],["head injury","Мама упала, ударилась головой, её рвёт"],["head injury","Հայրս ընկավ, գլուխը խփեց, հիմա փսխում է"],
 ["poisoning","My child swallowed some of grandma's pills"],["poisoning","Երեխաս տատիկի դեղերից կերել է"],["poisoning","Ребёнок проглотил бабушкины таблетки"],["poisoning","We ate wild mushrooms and now we are vomiting"],
 ["anaphylaxis","My lips and tongue are swelling after nuts"],["anaphylaxis","Губы и язык отекли после орехов"],["anaphylaxis","Շրթունքներս ու լեզուս ուռել են"],
 ["GI bleed","I vomited something like coffee grounds"],["GI bleed","Սուրճի նստվածքի նման բան փսխեցի"],["GI bleed","Была рвота с кровью"],
 ["DKA","My sugar is 26 and I keep vomiting"],["DKA","Сахар 25, сильно рвёт"],["DKA","shakars 25 e, pxsum em"],["DKA","Շաքարս 27 է, փսխում եմ"],
 ["hypo","Her sugar is 2.1 and she is confused"],["hypo","Շաքարը 2.0 է, շփոթված է"],["hypo","Сахар 2.3, он какой-то запутанный"],
 ["BP + organ","My BP is 195/125 and I have a terrible headache"],["BP + organ","Ճնշումս 200/120 է, աչքերիս առաջ մշուշ է"],["BP + organ","Давление 190/120, сильная головная боль"],
 ["faint","I blacked out while running"],["faint","Մարզվելիս անջատվեցի"],["faint","Отключился на тренировке"],
 ["seizure","He is having a fit and shaking"],["seizure","Ամուսինս ցնցվում է ու չի պատասխանում"],["seizure","У мужа припадок"],
 ["limb","My leg is cold, pale and numb"],["limb","Ոտքս սառել է ու թմրել"],
 ["bleeding","The bleeding won't stop after the cut"],["bleeding","Առատ արյունահոսություն է, չի կանգնում"],
 ["breath","Вдруг не хватает воздуха"],
 // Astra #355 round 1: across sentences, paraphrases, mixed script.
 ["DKA","My sugar is 25. I keep vomiting."],["DKA","Շաքարս 25 է։ Անընդհատ փսխում եմ։"],["DKA","Сахар 25. Постоянно рвёт."],["DKA","Շաքարս 25 ա, меня рвёт"],
 ["hypo","My sugar is 2.0 and I cannot swallow"],["GI bleed","I am throwing up blood"],["poisoning","My child took a handful of tablets"],["poisoning","Թոռս տատիկի հաբերը կուլ է տվել"],
 // Astra #355 round 2.
 ["hypo","Сахар 2.2, не могу глотать."],["DKA","My sugar is 25, I cannot stop vomiting."],["hypo","My blood sugar is low and I am drowsy"],["GI bleed","I am vomiting. There is blood in it."],["poisoning","My toddler got into the medicine cabinet and swallowed tablets."],["infant breath","Երեխայիս կրծքավանդակը ներս է քաշվում, շնչելիս"],
];
// Fable FB-06 (#360 review): Russian self-harm conjugations and phrasings each take the crisis entry (S-SELF-RU), as EN and HY do.
const selfRu=["Лучше покончу с собой, чем буду звонить","Я покончу с собой","Хочу покончить с жизнью","Он сказал, что покончит с собой","Не хочу жить","Я больше не хочу жить так",
 "Мне не хочется жить","Жить не хочется","Хочется умереть","Умереть хочу","Лучше умереть","Лучше бы я умерла","Я убью себя","Убила бы себя","Думаю свести счёты с жизнью",
 "Думаю свести счеты с жизнью","Хочу наложить на себя руки","Не вижу смысла жить","Жить нет смысла","Незачем жить","Думаю о самоубийстве","Хочу причинить себе вред","Я причиню себе вред","Не могу больше так жить","Больше не могу так жить"];
// Astra Z366-01: ordinary worries in Russian are not self-harm.
const notSelfRu=["Боюсь причинить себе вред неправильной дозой лекарства. Как принимать его безопасно?","Не могу уснуть, а так жить с диабетом трудно.","Не хочу умереть от инфаркта, как отец",
 "Не наврежу ли я себе, если пропущу таблетку?","Лучше утром или вечером мерить давление?"];
const crisisRu=notSelfRu.filter(t=>stagingMatches(t).some(x=>x.selfHarm&&x.id.startsWith("S-SELF-RU-")&&Number(x.id.slice(10))>=9));assert.equal(crisisRu.length,0,`RU new entries must not fire: ${crisisRu.join(" | ")}`);
const notSelf=selfRu.filter(t=>!stagingMatches(t).some(x=>x.selfHarm&&x.locale==="ru"));assert.equal(notSelf.length,0,`RU self-harm must fire: ${notSelf.join(" | ")}`);
const missed=fire.filter(([,t])=>stagingMatches(t).length===0);assert.equal(missed.length,0,`must fire: ${missed.map(([w,t])=>w+": "+t).join(" | ")}`);
const quiet:string[]=[
 "My BP was 186/122 this morning but I have no headache and no chest pain",
 "Ճնշումս 186/122 է, ոչինչ չեմ զգում, ո՛չ գլխացավ, ո՛չ կրծքի ցավ",
 "Is 190/120 dangerous if a headache starts?",
 "Հաբս կերել եմ առավոտյան, ճնշումս 135/85 է",
 "I took my pills with breakfast",
 "Should I check my sugar before or after eating?",
 "My neck is a bit stiff after the gym",
 "Ի՞նչ է նշանակում սրտի ռիթմի խանգարումը",
 "Сахар утром 6.1, это нормально?",
 "My triglycerides were 2.1, no vomiting, all fine",
 // Astra #355 round 1.
 "I'm confused about my sugar results","I swallowed my pills with breakfast","Я проглотил таблетку утром","I have a stiff neck after sleeping awkwardly",
 "I cleaned the coffee grounds from the kitchen","My sugar is 25, no vomiting","My sugar is 25 but I am not vomiting","I hit my head on the cupboard, it's fine now",
 "Շաքարս 12 է, փսխում չկա","My lips are dry",
 // Astra #355 round 2.
 "I have a stiff neck. My temperature is normal.","My child is asleep. I swallowed my usual pills with breakfast.","I ate mushrooms. I do not have nausea or vomiting.","There is no blood in my vomit.","My son took his prescribed medicine this morning.","I vomited without blood.","I am vomiting but there is no blood in it, my sugar is fine",
];
const loud=quiet.filter(t=>stagingMatches(t).length>0);assert.equal(loud.length,0,`must not fire: ${loud.map(t=>t+" ("+stagingMatches(t).map(x=>x.id)+")").join(" | ")}`);
console.log("Zoe urgent list coverage checks passed.");
