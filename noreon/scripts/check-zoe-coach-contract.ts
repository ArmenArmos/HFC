import assert from "node:assert/strict";
import {readFileSync,readdirSync} from "node:fs";
import {COACH_BLOCK_REASONS,coachPorts,zoeCoachJobSchema} from "@/lib/zoe/coach";
import {zoeJobSchema} from "@/lib/zoe/pipeline";

/**
 * Zoe coach C0 contract (lib/zoe/coach.ts; 20261020103406). No database, model or network. A coach job never enters the
 * inbound pipeline, the worker reads the claim's output as the database writes it, and the TypeScript reasons equal the
 * database's. The database behaviour is in check-zoe-coach-foundation.sql and scripts/zoe-coach-races.ts.
 */
const job={runId:crypto.randomUUID(),eventId:crypto.randomUUID(),memberId:crypto.randomUUID(),kind:"checkin",isoWeek:"2026-W43",displayName:"Anna",locale:"hy"};
assert.equal(zoeCoachJobSchema.parse(job).packet,null,"a claimed job parses; the packet comes with C4");
assert.ok(!zoeJobSchema.safeParse(job).success,"a coach job is not an inbound job (no member message)");
assert.ok(!zoeJobSchema.safeParse({...job,messageSeq:1,messages:[],replies:[]}).success,"not even with an empty message list");
assert.ok(!zoeCoachJobSchema.safeParse({...job,messages:[{seq:1,text:"hi",minutesAgo:1}]}).success,"a coach job carries no member message");
assert.ok(!zoeCoachJobSchema.safeParse({...job,kind:"urgent"}).success,"only check-ins and nudges");

// The claim: malformed jobs are skipped, redeliveries passed through; a refused finish is reported as refused.
{const calls:string[]=[];
 const ports=coachPorts(async(name,args)=>{calls.push(name);
  if(name==="zoe_coach_claim")return {jobs:[job,{...job,runId:"not-a-uuid"}],redeliver:[{eventId:job.eventId,memberId:job.memberId,kind:"checkin"}]};
  if(name==="zoe_coach_finish")return (args.p_result as {outcome:string}).outcome==="publish"?{ok:true,outcome:"discarded",reason:"coach_publication_refused_member_message_since_claim"}:{ok:false,code:"run_not_finishable"};
  if(name==="zoe_coach_reserve")return {ok:false,code:"coach_blocked",reason:"doctor_takeover"};
  return {ok:true};});
 const c=await ports.claim();
 assert.equal(c.jobs.length,1,"one valid job");assert.equal(c.redeliver.length,1,"redelivery passed through");
 const base={provider:"vercel.ai_gateway",model:"anthropic/claude-sonnet-5.5",configVersion:"x",costUsd:0,usage:null,latencyMs:null,sealedIo:null,events:[]};
 const f=await ports.finish(job.runId,{outcome:"publish",body:"Synthetic check-in.",language:"en",...base});
 assert.equal(f.outcome,"discarded","a refused publication is not reported as published");
 assert.deepEqual(await ports.finish(job.runId,{outcome:"no_output",reason:"judge_failed",...base}),{ok:false,outcome:"finish_refused"});
 assert.equal((await ports.reserve(job.runId,0.01,false,[],{tier:"medium",model:"anthropic/claude-sonnet-5.5"})).ok,false,"a blocked reserve");
 assert.deepEqual(calls,["zoe_coach_claim","zoe_coach_finish","zoe_coach_finish","zoe_coach_reserve"],"only the coach functions, never the inbound ones");}

// The reasons the database can return are the TypeScript list.
const file=readdirSync("supabase/migrations").find(f=>f.endsWith("_zoe_coach_foundation.sql"))!;
const src=readFileSync(`supabase/migrations/${file}`,"utf8");
const body=src.slice(src.indexOf("create function public._zoe_coach_block_reason"),src.indexOf("create function public.zoe_coach_blocked"));
const codes=new Set([...body.matchAll(/return '([a-z_]+)'/g),...body.matchAll(/then '(no_[a-z_]+)'else '(no_[a-z_]+)'end/g)].flatMap(m=>m.slice(1)));
assert.deepEqual([...codes].sort(),[...COACH_BLOCK_REASONS].sort(),"COACH_BLOCK_REASONS equals the database's codes");
console.log("Zoe coach contract checks passed.");
