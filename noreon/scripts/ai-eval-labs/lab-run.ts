import {existsSync,mkdirSync,readFileSync,readdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {z} from 'zod';
import {EXTRACTION_PROMPT_VERSION,EXTRACTION_SYSTEM,extractionPrompt,extractionSchema} from '@/lib/lab-ai/extraction';
import {callClaude,gatewayUsd,pool} from './claude-cli';

/**
 * Lab reading eval: runs the production extraction prompt and schema over a synthetic corpus
 * (scripts/ai-eval-labs/make_corpus.py) on several models through headless Claude Code.
 * Spends Claude subscription usage, never Gateway credit. Results are saved per document, so a
 * re-run skips what is done.
 *
 *   node --conditions=noreon-server-test --import ./scripts/register-alias.mjs scripts/ai-eval-labs/lab-run.ts \
 *     --corpus <dir> --out <dir> --label baseline [--models claude-haiku-5-5,claude-sonnet-5-5,claude-opus-5-5] [--ids L01,P03] [--concurrency 6]
 *     [--system-file f] [--prompt-file f]   (try a prompt variant without changing the code)
 */
const args=process.argv.slice(2);
const opt=(n:string)=>{const i=args.indexOf(n);return i>=0?args[i+1]:undefined;};
const corpus=opt('--corpus')??'../output/ai-eval-labs-2026-10-19/corpus',outDir=opt('--out')??'../output/ai-eval-labs-2026-10-19/runs',label=opt('--label')??'baseline';
const models=(opt('--models')??'claude-haiku-5-5,claude-sonnet-5-5,claude-opus-5-5').split(',');
const ids=opt('--ids')?.split(',');
const system=opt('--system-file')?readFileSync(opt('--system-file')!,'utf8'):EXTRACTION_SYSTEM;
const prompt=opt('--prompt-file')?readFileSync(opt('--prompt-file')!,'utf8'):extractionPrompt();
const schema=z.toJSONSchema(extractionSchema,{target:'draft-7'});

const docs=readdirSync(corpus).filter(f=>f.endsWith('.json')).map(f=>JSON.parse(readFileSync(join(corpus,f),'utf8')) as {id:string;file:string;mediaType:'application/pdf'|'image/jpeg'})
 .filter(d=>!ids||ids.includes(d.id)).sort((a,b)=>a.id.localeCompare(b.id));
const jobs=models.flatMap(model=>docs.map(doc=>({model,doc})));
mkdirSync(join(outDir,label),{recursive:true});
writeFileSync(join(outDir,label,'_prompt.json'),JSON.stringify({label,promptVersion:EXTRACTION_PROMPT_VERSION,system,prompt,systemFile:opt('--system-file')??null},null,1));
let done=0;
await pool(jobs,Number(opt('--concurrency')??6),async({model,doc})=>{
 const dir=join(outDir,label,model),file=join(dir,`${doc.id}.json`);
 mkdirSync(dir,{recursive:true});
 if(existsSync(file)&&JSON.parse(readFileSync(file,'utf8')).ok){done++;return;}
 const r=await callClaude({model,system,prompt,file:{data:readFileSync(join(corpus,doc.file)),mediaType:doc.mediaType},schema});
 writeFileSync(file,JSON.stringify({...r,id:doc.id,model,cliModel:r.model,label,gatewayUsd:gatewayUsd(model,r.inputTokens,r.outputTokens)},null,1));
 done++;
 console.log(`${done}/${jobs.length} ${model} ${doc.id} ${r.ok?'ok':`FAIL ${r.error}`} ${r.latencyMs}ms in=${r.inputTokens} out=${r.outputTokens} retries=${r.schemaRetries}`);
});
