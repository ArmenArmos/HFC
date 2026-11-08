/* eslint-disable @typescript-eslint/no-explicit-any -- eval data and transcripts, not product code */
// The Zoe conversation suite: fixed scripts, simulated patients and the replay of the founder's chat, through the real pipeline with real models.
// Eval only. Fictional members, no database, real models on the subscription (a logged-in `claude`): 37 conversations, about 18 minutes.
//   pnpm zoe:conversations [--only id,id] [--style coach-first|coach] [--baseline <file>] [--no-baseline] [--limit 40] [--parallel 4] [--out <dir>]
//   pnpm zoe:conversations rescore <run-dir>             re-applies the rules to a saved run, no model calls
//   pnpm zoe:conversations baseline <run-dir> <date>     writes that run as the stored baseline
// Exit 2: a missed emergency, under-triage or a new false 103. Exit 1: worse than the baseline. Exit 0: pass. Without a baseline, any failed conversation is exit 1.
import {AsyncLocalStorage} from 'node:async_hooks';
import {existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {join,resolve} from 'node:path';
import {execSync} from 'node:child_process';
import {runZoeJob} from '@/lib/zoe/pipeline';
import {criticalMs,evalRouting,newSpend} from '@/lib/zoe/eval/armen-dataset';
import {createSubscriptionGenerate} from '@/lib/zoe/eval/subscription';
import {DEFAULT_ROUTE_CONFIG} from '@/lib/zoe/eval/routing-cases';
import {freeSpeed} from '@/lib/zoe/free-mode-speed';
import {SHEETS} from '@/lib/zoe/symptoms/sheets';
import {FIXED} from '@/lib/zoe/eval/conversation-scripts';
import {FAMILIES} from '@/lib/zoe/eval/conversation-families';
import {FAMILIES_BMI_BP} from '@/lib/zoe/eval/conversation-families-bmi-bp';
import {FAMILIES_ROO631} from '@/lib/zoe/eval/conversation-families-roo631';
import {ARMEN_QA_SEQUENCE} from '@/lib/zoe/eval/conversation-families-armen-qa';
import {FAMILIES_ROO631_MULTI} from '@/lib/zoe/eval/conversation-families-roo631-multi';
import {PERSONAS} from '@/lib/zoe/eval/conversation-personas';
import {FAMILIES_LANG} from '@/lib/zoe/eval/conversation-families-lang';
import {FOUNDER} from '@/lib/zoe/eval/conversation-founder';
import {ConversationState} from '@/lib/zoe/eval/conversation-state';
import {questionnaireProfile,replayMemberRecord,saveAnamnesisTurn} from '@/lib/zoe/eval/conversation-questionnaire';
import {gate,judge,suiteStats,toBaseline,verdictOf,type Baseline,type Finding} from '@/lib/zoe/eval/conversation-rules';

const args=process.argv.slice(2);
const SCENARIOS=[...FOUNDER,...FIXED,...FAMILIES,...FAMILIES_BMI_BP,...PERSONAS,...FAMILIES_LANG,...FAMILIES_ROO631_MULTI,...FAMILIES_ROO631,...ARMEN_QA_SEQUENCE] as any[];
const BASELINE='docs/reference/zoe-eval/conversation-baseline.json';
const transcripts=(d:{head:string;style:string;results:any[]})=>`# Transcripts, head ${d.head}, style ${d.style}\n\n${d.results.map(r=>[`## ${r.id} (${r.lang}, ${r.cat}, ${r.kind}): ${verdictOf(r).trim()}`,...r.findings.map((f:Finding)=>`- ${f.severity} turn ${f.turn}: ${f.rule}`),'',...r.turns.flatMap((t:any)=>[...(t.appQuestion?[`**App questionnaire:** ${t.appQuestion}`,'']:[]),`**Member ${t.n}:** ${t.member}`,'',`**Zoe** _(${t.reason}, ${t.tier}, ${t.urgency??'-'}, fwd ${t.forward??'-'}${t.topic?.safetyCarry?', carry':''}, ${(t.criticalMs/1000).toFixed(1)} s, $${t.costUsd.toFixed(3)})_: ${t.visible??(t.flags?.anamnesis?'(questionnaire saved, no Zoe run)':'(nothing)')}`,''])].join('\n')).join('\n\n')}\n`;
const lineOf=(r:any)=>{const fs=r.findings.filter((f:Finding)=>f.severity!=='warn'),ws=r.findings.filter((f:Finding)=>f.severity==='warn');
 const by=new Map<string,number>();for(const f of fs)by.set(f.rule,(by.get(f.rule)??0)+1);
 return `${verdictOf(r)} ${r.id.padEnd(26)} ${String(r.turns.length).padStart(2)} turns  ${[...by.entries()].map(([k,n])=>n>1?`${k} x${n}`:k).join('; ')||'ok'}${ws.length?`  [note: ${ws.map((w:Finding)=>w.rule).join('; ')}]`:''}`;};
if(args[0]==='rescore'||args[0]==='baseline'){
 const dir=resolve(args[1]!),f=join(dir,'results.json'),d=JSON.parse(readFileSync(f,'utf8'));
 const byId=new Map(SCENARIOS.map(s=>[s.id,s])),order=[...byId.keys()];d.results.sort((a:any,b:any)=>order.indexOf(a.id)-order.indexOf(b.id));
 for(const r of d.results)r.findings=judge(byId.get(r.id),r.turns);
 d.lines=d.results.map(lineOf);d.stats={...d.stats,...suiteStats(d.results)};
 writeFileSync(f,JSON.stringify(d,null,1));writeFileSync(join(dir,'summary.txt'),`${d.lines.join('\n')}\n`);writeFileSync(join(dir,'transcripts.md'),transcripts(d));
 console.log(d.lines.join('\n'));console.log(`Passed ${d.stats.passed}/${d.results.length}`);
 if(args[0]==='baseline'){writeFileSync(BASELINE,`${JSON.stringify(toBaseline(d,args[2]??new Date().toISOString().slice(0,10),d.results),null,1)}\n`);console.log(`Baseline written: ${BASELINE}`);}
 process.exit(0);
}
const opt=(n:string)=>{const i=args.indexOf(n);return i>=0?args[i+1]:undefined;};
const out=resolve(opt('--out')??join('.zoe-conversation-runs',new Date().toISOString().replace(/[:.]/gu,'-')));mkdirSync(out,{recursive:true});
const limit=Number(opt('--limit')??'40'),parallel=Number(opt('--parallel')??'4'),carry=Number(opt('--carry')??'0');
const style=opt('--style')??'coach-first';
const only=opt('--only')?.split(',');
const baseline=args.includes('--no-baseline')?undefined:opt('--baseline')??BASELINE;
const SIM_MODEL='anthropic/claude-sonnet-5.5',SIM_IN=2/1e6,SIM_OUT=10/1e6;
let total=carry,zoeCost=0,simCost=0,stopped=false;
const started=Date.now();
const head=(()=>{try{return execSync('git rev-parse --short HEAD',{encoding:'utf8'}).trim();}catch{return 'unknown';}})();
const env:Record<string,string|undefined>={...process.env,NOREON_ZOE_MODEL_CALLS_ENABLED:'true',NOREON_ZOE_URGENT_PLACEHOLDER:'true',NOREON_ZOE_TEST_LEXICON:undefined,NOREON_ZOE_MEMBER_CLEAR:'true',NOREON_NURSE_CHAT:'true',NOREON_NURSE_CHAT_V2:'true'};
const spend=newSpend(0);
// Replay gate for the Decisions switches (decisions.ts): ZOE_DECISIONS_STUB=high|low runs every conversation with a stand-in Decisions API that always says
// route high / hy-Latn / same matter (the most it can change) or low / en / new (nothing it may change). No network; the real models still answer.
if(process.env.ZOE_DECISIONS_STUB){
 const stub=process.env.ZOE_DECISIONS_STUB==='high'?{route:'high',language:'hy-Latn',topic:'same'}:{route:'low',language:'en',topic:'new'};
 env.NOREON_ZOE_DECISIONS='language route topic';env.OPENAI_API_KEY2='stand-in';env.NOREON_ZOE_DPA_CONFIRMED='true';
 const realFetch=globalThis.fetch;
 globalThis.fetch=(async(u:any,init?:any)=>{
  if(String(u)!=='https://api.openai.com/v1/decisions')return realFetch(u,init);
  const asked=JSON.parse(String(init?.body)).questions as {name:'route'|'language'|'topic';choices:{value:string}[]}[];
  const answers=asked.map(q=>({name:q.name,type:'choice',choice:stub[q.name],confidence:0.95,probabilities:q.choices.map(c=>({value:c.value,probability:c.value===stub[q.name]?0.9:0.1/(q.choices.length-1)}))}));
  return new Response(JSON.stringify({answers}),{status:200});
 })as typeof fetch;
}
type Call={kind:string;model:string;ms:number;inputTokens:number;outputTokens:number;text:string;prompt?:string};
const als=new AsyncLocalStorage<{calls:Call[]}>();
const sub0=createSubscriptionGenerate({});
const kindOf=(s:string)=>s.startsWith('You check')?'judge':s.startsWith('You sort messages')?'topic':s.startsWith('You write the doctor')?'summary':s.startsWith('You are Zoe')?'reply':'other';
const subscription=async(a:any)=>{const r=await sub0(a);als.getStore()?.calls.push({kind:kindOf(a.system),model:a.model,ms:r.apiMs??0,inputTokens:r.usage.inputTokens??0,outputTokens:r.usage.outputTokens??0,text:r.text,...(kindOf(a.system)==='reply'?{prompt:a.prompt}:{})});return r;};
const routing=evalRouting(DEFAULT_ROUTE_CONFIG,{transport:'subscription',spend,env,subscription});
const speed=freeSpeed(env);
// Each call here starts a claude CLI (2 to 5 s) and has no fast endpoint, so the run's 38 s budget would cut regenerates that production makes (seq 45: regenerated in production, skipped here on the wall clock). The pipeline's clock runs at 0.55 speed to give that time back.
const clock=()=>Date.now()*0.55;
const registered=SHEETS.map((s:any)=>({id:s.id,version:s.version}));

/** The simulated patient: next member message from the persona, the stage direction and everything Zoe has really said. */
const SIM_SYSTEM=`You play a real person texting Zoe, a health coach bot in a phone app. You are not an assistant. Stay in character. Write like someone typing on a phone: short, usually 1 to 12 words, no greetings every time, no perfect grammar. React to what Zoe actually wrote in her last message: if she repeats herself or lectures you, show it; if she gets a fact about you wrong, correct her; if she nags, push back; ignore what you do not care about. Fictional person, fictional data. Return one JSON object and nothing else: {"message":"...","act":"chat|question|reading|thanks|complaint|correction|pushback|change_subject|end"}. Use "complaint" when you tell her to stop or say she repeats; "correction" when you correct a fact; "thanks" for a thanks, ok or goodbye with nothing else in it.`;
async function simTurn(s:any,i:number,history:{who:string;text:string}[]){
 const beat=s.beats[i];if(beat===undefined)return null;
 const dir=typeof beat==='string'?beat:beat.say;const flags=typeof beat==='string'?{}:Object.fromEntries(Object.entries(beat).filter(([k])=>k!=='say'));
 const prompt=[`Your character: ${s.persona}`,`Write in: ${s.speak}.`,history.length?`The chat so far:\n${history.map(h=>`${h.who==='member'?'You':'Zoe'}: ${h.text}`).join('\n')}`:'The chat has not started.',`What you do next: ${dir}.`,`Write your next message now, as JSON.`].join('\n\n');
 const r=await sub0({model:SIM_MODEL,system:SIM_SYSTEM,prompt,maxOutputTokens:300} as any);
 const c=(r.usage.inputTokens??0)*SIM_IN+(r.usage.outputTokens??0)*SIM_OUT;simCost+=c;total+=c;
 let j:any=null;try{j=JSON.parse(r.text.slice(r.text.indexOf('{'),r.text.lastIndexOf('}')+1));}catch{}
 const text=String(j?.message??r.text).trim().slice(0,400);const act=j?.act??'chat';
 return {text,act,...flags,...(act==='thanks'?{closing:true}:{}),...(act==='complaint'?{complaint:true}:{}),...(act==='correction'?{correctionDone:true}:{})};
}

async function runOne(s:any){
 const memberId=randomUUID();let t0=0;
 const msgs:{seq:number;text:string;at:number}[]=[];const answers:{body:string;at:number}[]=[];const breaks:number[]=[];const recs:any[]=[];const hist:{who:string;text:string}[]=[];
 let active:any=null,redFlagsAfterSeq=0,answeredThroughSeq=0,startSeq:number|null=null,spentToday=0;
 for(const m of s.seed??[]){msgs.push({seq:m.seq,text:m.text,at:m.at});t0=m.at;}
 const seq0=s.seq0??0;
 const assessment=s.questionnaire?questionnaireProfile():null;let questionnaireTurns=0;
 let state:ConversationState|null=null;
 for(let i=0;;i++){
  if(stopped)break;
  const tn=s.persona?await simTurn(s,i,hist):s.turns[i];
  if(!tn)break;
  t0=tn.at??t0+(tn.gap??2);
  if(tn.anamnesis){
   if(!assessment)throw Error('Anamnesis replay needs an assessment');
   saveAnamnesisTurn(assessment,tn.anamnesis);questionnaireTurns++;
   recs.push({n:i+1,seq:0,at:t0,member:tn.text,appQuestion:tn.appQuestion,flags:{anamnesis:true},visible:null,outcome:'questionnaire_saved',reason:'anamnesis_saved_no_zoe_run',tier:'none',urgency:'none',forward:'none',costUsd:0,criticalMs:0,calls:[]});
   continue;
  }
  const seq=tn.seq??seq0+i+1-questionnaireTurns;
  if(tn.divider)breaks.push(msgs.at(-1)?.seq??0);
  msgs.push({seq,text:tn.text,at:t0});hist.push({who:'member',text:tn.text});
  const now=t0,ago=(a:number)=>Math.max(0,Math.floor(now-a));
  const health=s.health??null;const doctorName=s.doctorName??'Test Doctor';
  state??=new ConversationState(health?.bpWeek?{systolic:health.bpWeek.latest.systolic,diastolic:health.bpWeek.latest.diastolic,minutesAgo:s.readingMinutesAgo??60}:null,now);
  const latestReading=state.latestReading(now);
  const job={runId:randomUUID(),memberId,messageSeq:seq,displayName:s.displayName??'Anna',messages:msgs.slice(-20).map(m=>({seq:m.seq,text:m.text,minutesAgo:ago(m.at)})),replies:[],answers:answers.slice(-10).map(a=>({body:a.body,minutesAgo:ago(a.at)})),directAnswers:true,
   intake:{enabled:true,registered,active,doctorName,latestReading,redFlagsAfterSeq,resumable:null},
   conversation:{enabled:true,doctorName,answeredThroughSeq,memberSpentTodayUsd:spentToday,injectionsLast24h:0,locale:s.locale??'hy'},
   healthAnswers:true,health,memberRecord:assessment?replayMemberRecord(assessment):{chatCards:true,ageYears:null,doses:null,ldl:null,...s.record},topic:{breakAfterSeq:breaks.filter(b=>b<seq).at(-1)??null,startSeq,zoeOwns:true,profile:s.profile??null},...state.context(now)};
  let f:any=null,error:string|undefined;const calls:Call[]=[];const early:any[]=[];const wall=Date.now();
  try{await als.run({calls},()=>runZoeJob(job as any,{provider:null,routing,directAnswers:true,env:s.env?{...env,...s.env}:env,seal:()=>null,now:clock,freeSpeed:speed,freeStyle:style as any,
    ports:{...(process.env.ZOE_DECISIONS_STUB?{authorizeClassifier:async()=>({ok:true})}:{}),reserve:async(_i:string,_e:unknown,_l:unknown,ev:any[])=>{early.push(...(ev??[]));return {ok:true};},finish:async(_i:string,x:any)=>{f=x;return {ok:true,outcome:x.outcome};},recordWhy:async()=>({ok:true})}} as any));}
  catch(e){error=(e as Error).message.slice(0,300);}
  const ev=[...early,...(f?.events??[])];const topicEv=ev.find((e:any)=>e.name==='zoe.topic');
  const visible=f?.answer??f?.receipt?.text??null;const cost=f?.costUsd??0;
  const {text:_t,seq:_s,at:_a,zoe:_z,zoeAt:_za,style:_st,...flags}=tn as any;
  const rec={n:i+1,seq,at:t0,member:tn.text,flags,visible,visibleKind:f?.answer?'answer':f?.receipt?f.receipt.kind:'none',outcome:f?.outcome??'error',reason:f?.reason??'pipeline_threw',tier:f?.tier??'none',tierReason:f?.tierReason??'',model:f?.model??'none',
   guardReasons:f?.guardReasons??[],urgency:f?.health?.urgency??null,modelUrgency:f?.health?.modelUrgency??null,forward:f?.health?.forward??null,forwardReason:f?.health?.forwardReason??null,
   topic:topicEv?{reason:topicEv.reason,safetyCarry:topicEv.attributes?.['noreon.zoe.topic.safety_carry']}:null,replyCheck:ev.filter((e:any)=>e.name==='zoe.guard.reply_check').map((e:any)=>e.reason),
   costUsd:cost,criticalMs:criticalMs(calls.map(c=>({kind:(['reply','judge','summary','topic'].includes(c.kind)?c.kind:'other') as any,ms:c.ms}))),wallMs:Date.now()-wall,
   calls:calls.map(c=>({kind:c.kind,model:c.model,ms:c.ms,in:c.inputTokens,out:c.outputTokens,text:c.kind==='reply'||c.kind==='judge'?c.text.slice(0,2600):undefined})),...(error?{error}:{})};
  recs.push(rec);spentToday+=cost;zoeCost+=cost;total+=cost;
  console.log(`  ${s.id} t${i+1} ${rec.reason} ${rec.tier} ${rec.urgency??'-'} fwd=${rec.forward??'-'} $${cost.toFixed(3)} ${(rec.criticalMs/1000).toFixed(1)}s | meter $${total.toFixed(2)}`);
  if(total>=limit&&!stopped){stopped=true;console.log(`STOP: the meter reached $${total.toFixed(2)} (limit $${limit})`);}
  if(visible){answers.push({body:visible,at:tn.zoeAt??now});hist.push({who:'zoe',text:visible});if(tn.at===undefined)t0+=1;}
  if(f?.answer||f?.receipt)answeredThroughSeq=seq;
  if(f?.topic?.startSeq!=null)startSeq=f.topic.startSeq;
  if(f)state.finish(seq,now,tn.zoeAt??now,f);
  const ik=f?.intake;active=ik&&ik.state==='active'?{id:ik.id??randomUUID(),sheetId:ik.sheetId,sheetVersion:ik.sheetVersion,startedSeq:ik.startedSeq,language:ik.language,record:ik.record}:null;
  if(f?.outcome==='intake_escalated'||/urgent|red_flag/.test(f?.reason??''))redFlagsAfterSeq=seq;
 }
 const findings=judge(s,recs);
 return {id:s.id,lang:s.lang,cat:s.cat,kind:s.persona?'simulated':s.cat==='real case replay'?'replay':'fixed',turns:recs,findings};
}
const all=SCENARIOS.filter((s:any)=>!only||only.includes(s.id));
console.log(`Zoe conversation suite: ${all.length} conversations, head ${head}, style ${style}, limit $${limit}, carry $${carry.toFixed(2)}, parallel ${parallel}`);
let next=0;const results:any[]=[];
await Promise.all(Array.from({length:parallel},async()=>{while(next<all.length&&!stopped){const s=all[next++]!;const r=await runOne(s);results.push(r);writeFileSync(join(out,'results.json'),JSON.stringify({head,style,results},null,1));}}));
const seconds=(Date.now()-started)/1000;
// One line per conversation.
const order=new Map(all.map((s:any,i:number)=>[s.id,i]));results.sort((a,b)=>order.get(a.id)!-order.get(b.id)!);
const verdict=verdictOf;
console.log('\n=== Result per conversation ===');
const lines:string[]=[];
for(const r of results){const line=lineOf(r);console.log(line);lines.push(line);}
const turns=results.flatMap(r=>r.turns.map((t:any)=>({...t,conv:r})));
const pct=(a:number,b:number)=>`${a}/${b} (${b?(100*a/b).toFixed(1):'0'}%)`;
const q=(xs:number[],p:number)=>{const a=[...xs].sort((x,y)=>x-y);return a.length?a[Math.min(a.length-1,Math.floor(p*a.length))]!:0;};
const crit=turns.filter(t=>t.criticalMs>0).map(t=>t.criticalMs/1000);
const stats={...suiteStats(results),seconds,zoeCost,simCost,medianS:q(crit,.5),p90S:q(crit,.9)};
console.log(`\nEmergencies caught ${stats.emergenciesCaught}/${stats.emergencies}. False 103 ${stats.false103}. Under-triage ${stats.underTriage}. Careful line ${pct(stats.careful,stats.turns)}. Forwarded ${pct(stats.forwarded,stats.turns)}. High tier ${pct(stats.tierHigh,stats.turns)}.`);
console.log(`Passed ${stats.passed}/${stats.conversations}. Zoe model time median ${stats.medianS.toFixed(1)} s, p90 ${stats.p90S.toFixed(1)} s.`);
console.log(`Run time ${(seconds/60).toFixed(1)} min. Cost at production list prices $${(zoeCost+simCost).toFixed(2)} (Zoe $${zoeCost.toFixed(2)}, simulated patient $${simCost.toFixed(2)}); actual Gateway spend $${spend.spentUsd.toFixed(2)} (subscription transport).`);
writeFileSync(join(out,'results.json'),JSON.stringify({head,style,stats,lines,results},null,1));
writeFileSync(join(out,'summary.txt'),lines.join('\n')+'\n');
writeFileSync(join(out,'transcripts.md'),transcripts({head,style,results}));
let exit:number=results.some(r=>verdict(r)==='FAIL!')?2:results.some(r=>verdict(r)!=='PASS ')?1:0;
if(baseline&&existsSync(baseline)){const g=gate(results,JSON.parse(readFileSync(baseline,'utf8')) as Baseline);console.log(g.lines.join('\n'));exit=g.exit;}
console.log(`Verdict: ${exit===2?'FAIL (emergency, under-triage or false 103)':exit===1?'FAIL (conversations below the bar)':'PASS'}. Files in ${out}`);
process.exit(exit);
