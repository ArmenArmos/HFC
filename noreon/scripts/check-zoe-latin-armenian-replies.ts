import assert from 'node:assert/strict';
import {job,runPipeline} from '@/lib/zoe/eval/harness';
import {createFakeProvider} from '@/lib/zoe/provider';
import type {ZoeJob} from '@/lib/zoe/pipeline';
import {readsLatinArmenian} from '@/lib/zoe/scope';
import {registeredSheets} from '@/lib/zoe/symptoms/intake';
import {LATIN_ARMENIAN_MESSAGES,LATIN_ARMENIAN_URGENT,leftoverLatinArmenian} from '@/lib/zoe/eval/latin-armenian';

/**
 * Khikar, 4 Nov: Zoe never answers in Armenian written in Latin letters. When the member writes "barev, inch karogh em utel", every reply is in Armenian script.
 * SYNTHETIC: fake providers, no model, no network, no database. Each message runs as a member with an Armenian app language and as one with none, through the
 * ordinary path, a model that misbehaves and answers in Latin letters, the daily limit, a model that is down, and an open 103 window. Whatever the member sees
 * must have Armenian letters and no Latin-letter Armenian. Nothing visible (a silent run) passes: the rule is about what is shown.
 */
const env={NOREON_ZOE_MEMBER_CLEAR:'true',NOREON_ZOE_URGENT_PLACEHOLDER:'true',NOREON_ZOE_TEST_LEXICON:'false',NOREON_PRELAUNCH_STAGING:'true'};
const conversation=(locale:'hy'|null,spent=0)=>({enabled:true,doctorName:null,answeredThroughSeq:0,memberSpentTodayUsd:spent,injectionsLast24h:0,locale});
const input=(text:string,locale:'hy'|null,extra:Partial<ZoeJob>={})=>job(text,{healthAnswers:true,directAnswers:true,conversation:conversation(locale),intake:{enabled:true,registered:registeredSheets(),active:null,doctorName:null,latestReading:null,redFlagsAfterSeq:0},...extra});
const shown=(r:Awaited<ReturnType<typeof runPipeline>>)=>r.finish?.answer??r.finish?.receipt?.text??'';

// A model that disobeys the language rule: it declares Armenian and writes it in Latin letters.
const LATIN_REPLY='Barev, shat lav hartsum e. Ognutyun e petq, ays pahin dzer ճնշումը chapum eq, bayc ches karox ինքնուրույն dexery poxel. Shnorhakalutyun.';
const base=createFakeProvider();
const rude={...base,complete:async(r:Parameters<typeof base.complete>[0])=>{
 const out=await base.complete(r);
 if(out.kind!=='ok')return out;
 let raw:Record<string,unknown>;try{raw=JSON.parse(out.raw) as Record<string,unknown>;}catch{return out;}
 for(const k of ['reply','direct_answer','draft_reply','question','answer'])if(typeof raw[k]==='string')raw[k]=LATIN_REPLY;
 return {...out,raw:JSON.stringify(raw)};
}};

let runs=0,visibleRuns=0;
const failures:string[]=[];
function judge(label:string,r:Awaited<ReturnType<typeof runPipeline>>){
 runs++;
 const text=shown(r);if(!text)return;
 visibleRuns++;
 const bad=leftoverLatinArmenian(text);
 if(bad.length||readsLatinArmenian(text)||(/\p{L}/u.test(text)&&!/\p{Script=Armenian}/u.test(text)))failures.push(`${label} [${r.reason}]: ${text.slice(0,160)}`);
}

for(const text of LATIN_ARMENIAN_MESSAGES)for(const locale of ['hy',null] as const){
 const label=`${locale??'no-locale'} | ${text}`;
 judge(`ordinary ${label}`,await runPipeline(input(text,locale),{directAnswers:true,env}));
 judge(`model writes Latin ${label}`,await runPipeline(input(text,locale),{directAnswers:true,env,provider:rude}));
 judge(`daily limit ${label}`,await runPipeline(input(text,locale,{conversation:conversation(locale,1000)}),{directAnswers:true,env}));
 judge(`model down ${label}`,await runPipeline(input(text,locale),{directAnswers:true,env,fixture:'server_error'}));
}
for(const text of LATIN_ARMENIAN_URGENT)for(const locale of ['hy',null] as const){
 const label=`${locale??'no-locale'} | ${text}`;
 judge(`urgent ${label}`,await runPipeline(input(text,locale),{directAnswers:true,env}));
 judge(`urgent, model down ${label}`,await runPipeline(input(text,locale),{directAnswers:true,env,fixture:'server_error'}));
 judge(`open 103 window ${label}`,await runPipeline(input(text,locale,{urgentSinceMinutes:3,urgentOpenedBy:'rule',urgentThroughSeq:0,answers:[]}),{directAnswers:true,env}));
}
// The detector itself: Latin-letter Armenian is found, Armenian script and English are not.
assert.ok(readsLatinArmenian('barev, inch karogh em utel'));
assert.ok(readsLatinArmenian('Barev dzez, ognutyun e petq'));
assert.ok(!readsLatinArmenian('Բարև ձեզ, ինչպե՞ս եմ կարող օգնել'));
assert.ok(!readsLatinArmenian('Call 103 now, this is an emergency.'));
assert.ok(!readsLatinArmenian('Ձեր BMI-ը 27.7 է, LDL 3.4, Telegram-ում կարող եք գրել։'));
assert.ok(leftoverLatinArmenian('Barev, ինչպե՞ս եք').length>0);
assert.deepEqual(leftoverLatinArmenian('Ձեր BMI-ը 27.7 է, LDL 3.4, Telegram-ում կարող եք գրել mmHg-ով։'),[]);
// The guard (output-guard.ts) stops a Latin-letter Armenian draft that sits next to Armenian script, where the script share alone would pass it.
{const {guardField}=await import('@/lib/zoe/output-guard');
 const v=guardField('chat',LATIN_REPLY,{memberTexts:['barev'],replyLanguage:'hy',sheetWording:[]});
 assert.ok(v.outcome==='block'&&v.categories.includes('wrong_language'),`guard: ${JSON.stringify(v)}`);
 const mostlyArmenian='Ձեր ճնշումը նորմալ է, շարունակեք չափել այն օրը երկու անգամ առավոտյան և երեկոյան նույն ժամին, նստած վիճակում։ Ognutyun e petq, dexery chpoxel.';
 const w=guardField('chat',mostlyArmenian,{memberTexts:['barev'],replyLanguage:'hy',sheetWording:[]});
 assert.ok(w.outcome==='block'&&w.categories.includes('wrong_language'),`guard, mixed script: ${JSON.stringify(w)}`);
 const ok=guardField('chat','Ձեր ճնշումը նորմալ է, շարունակեք չափել այն օրը երկու անգամ։ Telegram-ում կարող եք գրել ձեր խնամքի թիմին։',{memberTexts:['barev'],replyLanguage:'hy',sheetWording:[]});
 assert.ok(!ok.categories.includes('wrong_language'),`guard keeps a plain Armenian reply: ${JSON.stringify(ok)}`);}

assert.ok(visibleRuns>0,'at least some runs show something');
assert.deepEqual(failures,[],`Latin-letter Armenian shown to the member:\n${failures.slice(0,12).join('\n')}`);
console.log(`Latin-letter Armenian replies: ${LATIN_ARMENIAN_MESSAGES.length+LATIN_ARMENIAN_URGENT.length} messages, ${runs} runs, ${visibleRuns} with a visible reply, none in Latin letters.`);
