import assert from "node:assert/strict";
import {zoeRunLabel,zoeRunsSchema,ZOE_RUN_OUTCOMES} from "@/lib/zoe/contracts";

// The doctor's Zoe block (zoe_runs_for_doctor): every outcome a run can hold parses, and an unknown one shows a
// generic label instead of breaking the whole block (19 Oct: 'chatted' runs gave "Zoe's results could not be loaded").
const run=(outcome:string,extra:Record<string,unknown>={})=>({id:crypto.randomUUID(),messageSeq:1,outcome,reason:null,summary:null,guardReasons:[],provider:null,model:null,draftId:null,draftState:null,draftCurrent:null,answer:null,finishedAt:"2026-10-19T00:00:00Z",...extra});
const parsed=zoeRunsSchema.parse({ok:true,runs:[run('chatted'),run('skipped'),run('a_future_outcome'),run('draft_proposed',{draftState:'a_future_state'}),...ZOE_RUN_OUTCOMES.map(o=>run(o))]});
assert.equal(parsed.runs.length,4+ZOE_RUN_OUTCOMES.length,"every run parsed");
assert.equal(zoeRunLabel(parsed.runs[0]!).label,"Zoe chatted with the member (no doctor action)");
assert.equal(zoeRunLabel(parsed.runs[1]!).label,"Zoe did not process this message");
assert.equal(parsed.runs[2]!.outcome,"other");assert.equal(zoeRunLabel(parsed.runs[2]!).label,"Zoe processed this message");
assert.equal(parsed.runs[3]!.draftState,null,"an unknown draft state reads as none");
for(const r of parsed.runs)assert.ok(zoeRunLabel(r)?.label,`no label for ${r.outcome}`);
console.log("Zoe runs contract checks passed.");
