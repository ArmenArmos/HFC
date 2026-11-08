import assert from 'node:assert/strict';
import {job,runPipeline,type PipelineRun} from '@/lib/zoe/eval/harness';
import {SAME_DAY_LINE} from '@/lib/zoe/health-answer';
import type {ZoeJob} from '@/lib/zoe/pipeline';

// Synthetic entry-point checks: real pipeline, fake provider and in-memory database ports, no network.
const env={NOREON_ZOE_URGENT_PLACEHOLDER:'true',NOREON_ZOE_TEST_LEXICON:'false'};
const capped=(text:string,extra:Partial<ZoeJob>={})=>job(text,{healthAnswers:true,directAnswers:true,
 conversation:{enabled:true,doctorName:'Dr Anna Hakobyan',answeredThroughSeq:0,memberSpentTodayUsd:3,injectionsLast24h:0,locale:'en'},
 intake:{enabled:true,registered:[],active:null,doctorName:null,latestReading:null,redFlagsAfterSeq:0},...extra});
const run=(j:ZoeJob,reserveCode?:string)=>runPipeline(j,{directAnswers:true,env,reserveCode});
const english="I've reached my limit for today, so I can't reply properly right now. I'll be back tomorrow. To reach your doctor now, use Message your care team.";
const plain=(r:PipelineRun,language:string)=>{
 assert.equal(r.reason,'member_spend_cap_reached');
 assert.equal(r.providerCalls.length,0);assert.equal(r.judgeCalls.length,0);
 assert.equal(r.finish?.receipt?.language,language);assert.ok(r.finish?.receipt?.text);
 assert.doesNotMatch(r.finish.receipt.text,/103|careful|զգույշ|осторож/u);
 assert.equal(r.finish.health?.urgency,'none');assert.equal(r.finish.health?.forward,'none');
 assert.equal(r.finish.health?.forwardReason,'none');assert.equal(r.finish.summary,null);
};
for(const [text,language] of [['hello','en'],['what can you do?','en'],['Բարև','hy'],['Привет','ru']] as const){
 const r=await run(capped(text));plain(r,language);
 if(language==='en')assert.equal(r.finish?.receipt?.text,english);
 if(language==='hy')assert.match(r.finish?.receipt?.text??'',/^Այսօրվա.*«Գրել խնամքի թիմին»։$/u);
 if(language==='ru')assert.match(r.finish?.receipt?.text??'',/^Я достигла.*«Написать медицинской команде»\.$/u);
 assert.equal(r.reserved,null,'context cap stops before reservation');
}
// Spend can reach the cap after the job context was read; the locked reservation then refuses.
for(const text of ['hello','What is my BP target?']){
 const j=capped(text);j.conversation!.memberSpentTodayUsd=2.99;
 const r=await run(j,'member_spend_cap_reached');plain(r,'en');
 assert.ok(r.reserved);assert.equal(r.finish?.receipt?.text,english);
}
// Safety checks and explicit handoffs must win before the cap line.
assert.equal((await run(capped('My BP is 190/120.'))).reason,'bp_remeasure','A capped member still gets the one BP check');
for(const [reserve,text] of [[false,'My potassium is 6.3.'],[true,'My potassium is 6.3.']] as const){
 const j=capped(text);if(reserve)j.conversation!.memberSpentTodayUsd=2.99;
 const r=await run(j,reserve?'member_spend_cap_reached':undefined);
 assert.equal(r.finish?.health?.urgency,'same_day');assert.equal(r.finish?.health?.forward,'auto');
 assert.ok(r.finish?.receipt?.text.startsWith(SAME_DAY_LINE.en));assert.equal(r.providerCalls.length,0);
}
const urgent=await run(capped('I have crushing chest pain.'));
assert.match(urgent.reason,/urgent|red_flag/u);assert.match(urgent.finish?.answer??'',/103/u);assert.equal(urgent.providerCalls.length,0);
for(const j of [capped('Send this to my doctor.'),capped('yes',{answers:[{body:'Shall I send this to your doctor?',minutesAgo:2}]})]){
 const r=await run(j);
 assert.ok(['member_request','member_yes'].includes(r.finish?.health?.forward??''));assert.equal(r.providerCalls.length,0);
}
// An answered historical floor cannot turn an availability refusal into a clinical handoff.
const prior=capped('hello');prior.messages.unshift({seq:0,text:'My potassium is 6.3.',minutesAgo:2});prior.conversation!.answeredThroughSeq=0;prior.conversation!.memberSpentTodayUsd=2.99;
const carried=await run(prior,'member_spend_cap_reached');
plain(carried,'en');assert.equal(carried.finish?.receipt?.text,english);
// The same floor still wins when its message has not been answered.
prior.conversation!.answeredThroughSeq=-1;
const unanswered=await run(prior,'member_spend_cap_reached');
assert.equal(unanswered.finish?.health?.urgency,'same_day');assert.ok(unanswered.finish?.receipt?.text.startsWith(SAME_DAY_LINE.en));
console.log('Zoe member spend cap: plain localized replies, reservation refusal, safety floors and doctor requests passed.');
