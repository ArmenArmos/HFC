import assert from 'node:assert/strict';
import {createFakeProvider} from '@/lib/zoe/provider';
import {DEFAULT_ROUTE_CONFIG} from '@/lib/zoe/eval/routing-cases';
import {capPrice,cappedGenerate,loadDataset,maxInputTokens,mergeOne,newSpend,replayLedger,runScenario,section,urgencyRelation,worstCallUsd,type LedgerEvent,type ScenarioRun} from '@/lib/zoe/eval/armen-dataset';
import type {ProviderRequest} from '@/lib/zoe/provider';

/**
 * Offline checks for the Armen dataset eval (no network, no model): the dataset's shape and counts, the Gateway spend
 * cap, the scenario runner on the real pipeline with the stand-in provider, and the urgency rule of the merge.
 */
const d=loadDataset();
assert.deepEqual(d.scenarios.map(s=>s.id),Array.from({length:100},(_,i)=>String(i+1).padStart(3,'0')));
const per=(f:(s:typeof d.scenarios[number])=>string)=>d.scenarios.reduce<Record<string,number>>((a,s)=>{a[f(s)]=(a[f(s)]??0)+1;return a;},{});
assert.deepEqual(per(s=>section(s.id)),{cardiovascular:50,endocrine:30,oncology:20});
assert.deepEqual(per(s=>String(s.chapter.number)),{1:12,2:10,3:8,4:10,5:10,6:8,7:10,8:6,9:6,10:8,11:6,12:6});
for(const s of d.scenarios){
 assert.equal(s.turns[0]!.role,'user',s.id);
 s.turns.forEach((t,i)=>assert.equal(t.role,i%2===0?'user':'ai',`${s.id} turn ${i+1} alternates`));
 assert.match(s.context+s.finalGuidance,/\p{Script=Armenian}/u,s.id);
}
assert.equal(d.scenarios.filter(s=>s.urgency==='immediate').length,12);

// The cap: a call starts only if spent + in flight + its worst case fits; a refused call is a 402.
const m={id:'anthropic/claude-sonnet-5.5',inputUsdPerMTok:2,outputUsdPerMTok:10};
const args={model:m.id,system:'s'.repeat(2000),prompt:'p'.repeat(2000),maxOutputTokens:1600,temperature:0,maxRetries:0,abortSignal:new AbortController().signal};
const worst=worstCallUsd(m,args);assert.ok(Math.abs(worst-0.025024)<1e-9,String(worst)); // (4000 bytes + 512 framing) at $2/M + 1600 output at $10/M
const spend=newSpend(worst*2.5);
const pending:(()=>void)[]=[];const release=()=>pending.splice(0).forEach(f=>f());
const slow=cappedGenerate(m,()=>new Promise(r=>{pending.push(()=>r({text:'{}',finishReason:'stop',usage:{inputTokens:100,outputTokens:100},response:{id:'x',modelId:m.id}}));}),spend);
const fast=cappedGenerate(m,async()=>({text:'{}',finishReason:'stop',usage:{inputTokens:100,outputTokens:100},response:{id:'y',modelId:m.id}}),spend);
const a=slow(args),b=slow(args);
await assert.rejects(fast(args),/cap/);                       // two in flight: a third worst case does not fit
assert.equal(spend.refused,1);
release();await a;await b;                                   // real usage charged: 100 in + 100 out = $0.0012 each
assert.ok(Math.abs(spend.spentUsd-0.0024)<1e-9,String(spend.spentUsd));
await fast(args);assert.equal(spend.calls,3);
const failing=cappedGenerate(m,async()=>{throw Error('boom');},spend);
await assert.rejects(failing(args));assert.ok(spend.spentUsd>0.0036+worst-1e-9,'a failed call is charged its worst case');
assert.equal(spend.inFlightUsd,0);

// AE-01: the input bound is UTF-8 bytes (Armenian is 2 bytes a letter), prices never below the list floor, unknown models refused.
assert.equal(maxInputTokens('Ա'.repeat(1000),''),2000+512);
assert.equal(capPrice({id:m.id,inputUsdPerMTok:0,outputUsdPerMTok:0}).outputUsdPerMTok,10);
assert.throws(()=>cappedGenerate({id:'openai/unknown',inputUsdPerMTok:1,outputUsdPerMTok:1},async()=>{throw Error('x');},newSpend(1)),/unknown models/);
const tight=newSpend(1);
const liar=cappedGenerate(m,async()=>({text:'{}',finishReason:'stop',usage:{inputTokens:1e6,outputTokens:0},response:{id:'z',modelId:m.id}}),tight);
await liar(args);assert.ok(tight.spentUsd>=2,'usage above the bound is charged in full');
await assert.rejects(liar(args),/cap/);                       // and the cap is closed after it
// AE-04: a ledger replay keeps settled charges and counts an unsettled reservation at its worst case.
const ledger:LedgerEvent[]=[{kind:'reserve',id:'a',model:m.id,usd:0.05},{kind:'settle',id:'a',model:m.id,usd:0.01},{kind:'reserve',id:'b',model:m.id,usd:0.04}];
const rp=replayLedger(ledger);assert.ok(Math.abs(rp.spentUsd-0.05)<1e-12&&rp.calls===2,JSON.stringify(rp));
const resumed=newSpend(0.06,rp);
await assert.rejects(cappedGenerate(m,async()=>{throw Error('never');},resumed)(args),/cap/); // 0.05 + 0.025 > 0.06
const logged:LedgerEvent[]=[];const ls=newSpend(1);ls.onLedger=e=>logged.push(e);await cappedGenerate(m,async()=>({text:'',finishReason:'stop',usage:{inputTokens:1,outputTokens:1},response:{id:'l',modelId:m.id}}),ls)(args);
assert.deepEqual(logged.map(e=>e.kind),['reserve','settle']);

// The runner on the real pipeline with the stand-in provider: every member turn gives a run, nothing throws.
const seen:ProviderRequest[]=[];
const routing={config:DEFAULT_ROUTE_CONFIG,providerFor:()=>{const p=createFakeProvider();return {...p,complete:async(r:ProviderRequest)=>{seen.push(r);return p.complete(r);}};}};
const env={NOREON_ZOE_MODEL_CALLS_ENABLED:'true',NOREON_ZOE_URGENT_PLACEHOLDER:'true'};
const runs:ScenarioRun[]=[];
for(const s of d.scenarios.filter(s=>['001','006','057','100'].includes(s.id)))runs.push(await runScenario(s,{routing,env}));
for(const r of runs){
 const s=d.scenarios.find(x=>x.id===r.id)!;
 assert.equal(r.turns.length,s.turns.filter(t=>t.role==='user').length,r.id);
 assert.ok(r.turns.every(t=>!t.error&&t.outcome!=='error'),`${r.id}: ${JSON.stringify(r.turns.map(t=>t.error??t.reason))}`);
}

// AE-03: in a later turn's window, member messages and Zoe's texts alternate in time order.
const r1=runs.find(r=>r.id==='001')!;
assert.ok(r1.turns.slice(0,2).every(t=>t.visible),'scenario 001 shows Zoe text on turns 1 and 2 (receipts with the stand-in)');
const third=seen.filter(r=>r.memberBlock.includes('<zoe_answer')).map(r=>r.memberBlock).find(b=>(b.match(/<message /g)??[]).length===3);
assert.ok(third,'a turn-3 prompt with Zoe answers was captured');
const order=[...third.matchAll(/<(message|zoe_answer)\b/g)].map(x=>x[1]).join(',');
assert.equal(order,'message,zoe_answer,message,zoe_answer,message',order);

// Merge: the relation follows the levels, and under-escalation always fails, whatever the grader wrote.
assert.equal(urgencyRelation('immediate','doctor_within_days'),'under');
assert.equal(urgencyRelation('self_care','planned_preventive'),'over');
const s6=d.scenarios.find(s=>s.id==='006')!;
const g=mergeOne(s6,runs.find(r=>r.id==='006')!,{id:'006',zoeUrgency:'doctor_within_days',urgency:'match',must:[],coverage:0,armenian:1,warmth:1,handedToDoctor:true,gap:'',notes:''});
assert.equal(g.urgency,'under');assert.equal(g.pass,false);assert.equal(g.must[0]!.code,'under_escalation');
// AE-02: a grader's contradiction never erases an under-escalation.
const c1=mergeOne(s6,runs.find(r=>r.id==='006')!,{id:'006',zoeUrgency:'immediate',urgency:'under',must:[{code:'under_escalation',turn:2,evidence:'x'}],coverage:0,armenian:1,warmth:1,handedToDoctor:true,gap:'',notes:''});
assert.equal(c1.pass,false);assert.equal(c1.contradiction,true);
const c2=mergeOne(s6,runs.find(r=>r.id==='006')!,{id:'006',zoeUrgency:'planned_preventive',urgency:'match',must:[],coverage:0,armenian:1,warmth:1,handedToDoctor:true,gap:'',notes:''});
assert.equal(c2.pass,false);assert.equal(c2.contradiction,true);
const ok=mergeOne(s6,runs.find(r=>r.id==='006')!,{id:'006',zoeUrgency:'immediate',urgency:'match',must:[],coverage:2,armenian:2,warmth:2,handedToDoctor:false,gap:'',notes:''});
assert.equal(ok.pass,true);assert.equal(ok.contradiction,false);
console.log('check-zoe-armen-eval: ok');
