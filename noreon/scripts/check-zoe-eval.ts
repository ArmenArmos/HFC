import {readFileSync,writeFileSync} from "node:fs";
import {runEvalSet,EVAL_MIN_ROWS,type EvalStatus as Status} from "@/lib/zoe/eval/run";
import {ZOE_CONFIG_VERSION} from "@/lib/zoe/pipeline";

/**
 * EVAL_SET v6, layers 1 and 2, plus the routing rows (R*), against the deterministic fake provider.
 * No model, no network. Fails on any MUST failure. Pending rows are counted and listed, never
 * silently dropped. PLUMBING ACCEPTANCE ONLY: fictional test lexicon, unsigned wording (EVAL_SET).
 * Write the run report with: --report <path>
 */
const summary=await runEvalSet({readSql:file=>readFileSync(file,"utf8")});
const results=summary.results;
const ids=new Set(results.map(r=>r.id));
if(results.length<EVAL_MIN_ROWS)throw Error(`Only ${results.length} eval rows; at least ${EVAL_MIN_ROWS} are required`);
// Every EVAL_SET v6 row must be encoded.
const source=process.env.NOREON_ZOE_EVAL_SET;
if(source){
 const rows=[...readFileSync(source,"utf8").matchAll(/^\| ([A-Z]\d{2}[a-z]?(?:[a-z]–[a-z])?) \|/gm)].map(m=>m[1]!).flatMap(id=>id.includes("–")?["a","b","c","d","e","f"].map(x=>id.slice(0,3)+x):[id]);
 const missing=rows.filter(id=>!ids.has(id));
 if(missing.length)throw Error(`EVAL_SET rows not encoded: ${missing.join(", ")}`);
}
const count=(s:Status,level?:string)=>results.filter(r=>r.status===s&&(!level||r.level===level)).length;
const failedMust=results.filter(r=>r.status==="fail"&&r.level==="MUST");
console.log(`Zoe eval (fake provider, ${ZOE_CONFIG_VERSION}): ${results.length} rows · pass ${count("pass")} · partial ${count("partial")} · pending ${count("pending")} · fail ${count("fail")} (MUST ${failedMust.length})`);
for(const r of results.filter(r=>r.status==="fail"))console.log(`FAIL ${r.id} [${r.level}] ${r.title}: ${r.note}`);
const at=process.argv.indexOf("--report");
if(at>0){
 const path=process.argv[at+1]!;
 const sections=[...new Set(results.map(r=>r.id[0]))];
 writeFileSync(path,[`# Zoe eval run, ${new Date().toISOString().slice(0,10)}, fake provider`,"",
  `Configuration: \`${ZOE_CONFIG_VERSION}\`. Layers 1 and 2 (deterministic, no model, no network). **Plumbing acceptance only**: the urgent list is a fictional test list and no wording is signed. Clinical acceptance is a separate run on signed content (S1, S2, S4, S6).`,"",
  `Totals: ${results.length} rows. pass ${count("pass")}, partial ${count("partial")} (built part passes; the rest is named), pending ${count("pending")}, fail ${count("fail")}. MUST failures: ${failedMust.length}. SHOULD: pass ${count("pass","SHOULD")}, pending ${count("pending","SHOULD")}.`,"",
  "| Section | pass | partial | pending | fail |","| --- | --- | --- | --- | --- |",
  ...sections.map(s=>{const rs=results.filter(r=>r.id[0]===s);const n=(x:Status)=>rs.filter(r=>r.status===x).length;return `| ${s} | ${n("pass")} | ${n("partial")} | ${n("pending")} | ${n("fail")} |`;}),"",
  "| ID | Level | Status | Row | Pending part or note |","| --- | --- | --- | --- | --- |",
  ...results.map(r=>`| ${r.id} | ${r.level} | ${r.status} | ${r.title.replaceAll("|","/").replaceAll("\n"," ").slice(0,120)} | ${r.note.replaceAll("|","/")} |`),""].join("\n"));
 console.log(`Report written to ${path}`);
}
if(failedMust.length)process.exitCode=1;
