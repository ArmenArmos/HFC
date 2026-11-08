/**
 * Doctor Zoe eval: questions over fictional records (lib/staff-zoe/eval), run through the real turn with a real model.
 * Not a CI check: it calls a model. Anthropic models go through headless Claude Code (no Gateway spend).
 *
 *   node --conditions=noreon-server-test --import ./scripts/register-alias.mjs scripts/staff-zoe-eval.ts <out-dir> [--only id,id] [--parallel 4]
 *
 * Scored on every case: the state against what was expected, the gold values, the forbidden values, and a separate proof of
 * every shown line against a fresh read of the record. The model writes no words, so a wrong answer can only be a wrong choice
 * of facts: the gold values catch that. Pass: zero invented facts, zero forbidden values, every expectation met.
 */
import {mkdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {createGatewayProvider} from '@/lib/zoe/gateway';
import type {ZoeProvider} from '@/lib/zoe/provider';
import {createSubscriptionGenerate} from '@/lib/zoe/eval/subscription';
import {checkRendered} from '@/lib/staff-zoe/check';
import {runStaffTurn,type FinishInput,type TurnPorts} from '@/lib/staff-zoe/turn';
import {fixtureRead} from '@/lib/staff-zoe/fixture-tools';
import {EVAL_NOW,FICTIONAL_RECORDS} from '@/lib/staff-zoe/eval/fixtures';
import {EVAL_CASES,type EvalCase} from '@/lib/staff-zoe/eval/cases';
import {DOCTOR_QUESTIONS} from '@/lib/staff-zoe/eval/doctor-questions';
import type {AnswerContent} from '@/lib/staff-zoe/contracts';

const opt=(name:string)=>{const i=process.argv.indexOf(name);return i>=0?process.argv[i+1]:undefined;};
const out=process.argv[2];if(!out||out.startsWith('--'))throw Error('usage: staff-zoe-eval.ts <out-dir>');
mkdirSync(out,{recursive:true});
const only=opt('--only')?.split(',');const parallel=Number(opt('--parallel')??'4');
const env={NOREON_ZOE_MODEL_CALLS_ENABLED:'true',NOREON_ZOE_GATEWAY_CACHING:'off'};
const generate=createSubscriptionGenerate({logFile:join(out,'subscription-calls.jsonl')});
const opus=createGatewayProvider({id:'anthropic/claude-opus-5.5',inputUsdPerMTok:4,outputUsdPerMTok:20},{env,generate,timeoutMs:120_000});

async function runCase(c:EvalCase){
 const finished:FinishInput[]=[];const x=FICTIONAL_RECORDS[c.member]!;
 const ports:TurnPorts={
  begin:async()=>({ok:true,runId:'f0000000-0000-4000-8000-000000000001',memberId:c.member,role:c.role,memberName:'Fictional Namesake',tier:'high',history:c.history??[],lastTools:c.lastTools??[]}),
  read:t=>fixtureRead(x,t,c.role,c.locale,EVAL_NOW),models:async()=>({primary:opus as ZoeProvider,fallback:null,fast:false,effort:'low'}),
  reserve:async()=>({ok:true}),finish:async(_r,f)=>{finished.push(f);},seal:()=>null,now:()=>EVAL_NOW.getTime()+(Date.now()-started)};
 const started=Date.now();let content:AnswerContent|null=null;
 for await(const e of runStaffTurn({conversationId:'f0000000-0000-4000-8000-000000000002',submissionId:'f0000000-0000-4000-8000-000000000003',text:c.q,intent:c.intent??null},c.locale,ports))if(e.type==='answer')content=e.content;
 const ms=Date.now()-started;
 const f=finished[0];
 if(!content)return {id:c.id,failures:['no answer'],state:'none',ms,invented:[],attempts:[]};
 const own=content.say.map(l=>l.text).join('\n');
 const shown=[own,...content.say.flatMap(l=>l.facts.map(x=>x.date??''))].join('\n');
 const failures:string[]=[];
 if(content.state==='held')failures.push(`held: ${JSON.stringify((f?.checks as {problems?:unknown})?.problems)}`);
 if(content.state==='no_answer')failures.push(`no answer: ${f?.reason}`);
 if(c.expect==='answered'&&!content.say.length&&!content.quotes.length&&!content.notice)failures.push('expected an answer');
 if(c.expect==='not_known'&&!content.notKnown.length)failures.push('expected not known');
 if(c.expect==='answered'&&content.notKnown.includes('What you asked is not in what I read.')&&!c.partly)failures.push('said not known for a question the record answers');
 if(c.expect==='declined'&&!content.declined)failures.push('expected declined');
 for(const v of c.has??[])if(!shown.includes(v))failures.push(`missing gold value ${v}`);
 for(const v of c.never??[])if(own.toLowerCase().includes(v.toLowerCase()))failures.push(`forbidden in Zoe's own words: ${v}`);
 // Zero invented facts: every shown line is re-proved here against a fresh read of the record, apart from the turn's own check.
 const proof=checkRendered(content.say,await Promise.all(content.cards.filter(k=>k.state==='ok').map(k=>fixtureRead(x,k.tool,c.role,c.locale,EVAL_NOW))));
 const invented=proof.problems.map(p=>({line:0,claim:`${p.code}: ${p.detail}`}));
 if(invented.length)failures.push(`invented: ${JSON.stringify(invented)}`);
 return {id:c.id,state:content.state,failures,ms,invented,attempts:(f?.checks as {attempts?:string[]})?.attempts??[],say:content.say.map(l=>l.text),notKnown:content.notKnown,quotes:content.quotes.map(q=>q.id),declined:content.declined,problems:(f?.checks as {problems?:unknown})?.problems};
}

const todo=[...EVAL_CASES,...DOCTOR_QUESTIONS].filter(c=>!only||only.includes(c.id));
const results:Awaited<ReturnType<typeof runCase>>[]=[];const queue=[...todo];
await Promise.all(Array.from({length:parallel},async()=>{while(queue.length){const c=queue.shift()!;
 const r=await runCase(c).catch(e=>({id:c.id,state:'error',failures:[String(e)],ms:0,invented:[],attempts:[]}));results.push(r);
 console.log(`${r.id} ${r.state} ${r.ms}ms ${r.failures.length?`FAIL ${r.failures.join(' | ')}`:'ok'}`);
 writeFileSync(join(out,'results.json'),JSON.stringify(results,null,1));}}));
const failed=results.filter(r=>r.failures.length);
const invented=results.reduce((n,r)=>n+r.invented.length,0);
const ms=results.map(r=>r.ms).sort((a,b)=>a-b);
const summary=[`Cases ${results.length}. Passed ${results.length-failed.length}. Invented facts ${invented}. Held ${results.filter(r=>r.state==='held').length}.`,`Time per turn on this transport: p50 ${ms[Math.floor(ms.length/2)]} ms, max ${ms.at(-1)} ms (headless CLI, not the Gateway fast endpoint).`,...failed.map(r=>`${r.id}: ${r.failures.join(' | ')}`)].join('\n');
writeFileSync(join(out,'SUMMARY.md'),`${summary}\n`);
console.log(summary);
process.exitCode=failed.length?1:0;
