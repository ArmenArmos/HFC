import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {extractEstimate,createLabGatewayProvider,type LabMediaType} from '@/lib/lab-ai/provider';
import {costUsd} from '@/lib/zoe/provider';
import {gatewayConfigured} from '@/lib/zoe/gateway';

/**
 * Fidelity check: the same corpus documents through the PRODUCTION Gateway adapter
 * (createLabGatewayProvider: AI SDK generateText, Output.object, temperature 0, one request), so
 * lab-score.ts can compare it with the subscription path. Spends real Gateway credit: a hard
 * budget stops it before an upper-bound estimate would cross the cap. Needs AI_GATEWAY_API_KEY in
 * the environment (never printed).
 *
 *   NOREON_ZOE_MODEL_CALLS_ENABLED=true node --conditions=noreon-server-test --import ./scripts/register-alias.mjs \
 *     scripts/ai-eval-labs/gateway-fidelity.ts --label gw --plan haiku:L01,L08,P11 --budget 0.45
 */
const args=process.argv.slice(2);
const opt=(n:string)=>{const i=args.indexOf(n);return i>=0?args[i+1]:undefined;};
if(process.env.NOREON_ZOE_MODEL_CALLS_ENABLED!=='true')throw Error('Set NOREON_ZOE_MODEL_CALLS_ENABLED=true for this run: it makes real model calls.');
if(!gatewayConfigured())throw Error('No AI Gateway credential in the environment.');
const corpus=opt('--corpus')??'../output/ai-eval-labs-2026-10-19/corpus',outDir=opt('--out')??'../output/ai-eval-labs-2026-10-19/runs',label=opt('--label')??'gateway';
const budget=Number(opt('--budget')??0.45);
const CATALOG:Record<string,{gw:string;cli:string;input:number;output:number}>={
 haiku:{gw:'anthropic/claude-haiku-5.5',cli:'claude-haiku-5-5',input:0.10,output:0.50},
 sonnet:{gw:'anthropic/claude-sonnet-5.5',cli:'claude-sonnet-5-5',input:2,output:10},
 opus:{gw:'anthropic/claude-opus-5.5',cli:'claude-opus-5-5',input:4,output:20},
};
// --plan haiku:L01,L08;sonnet:L01
const plan=(opt('--plan')??'haiku:L01').split(';').flatMap(p=>{const [m,ids]=p.split(':');return ids!.split(',').map(id=>({m:CATALOG[m!]!,id}));});
let spent=0;
for(const {m,id} of plan){
 const t=JSON.parse(readFileSync(join(corpus,`${id}.json`),'utf8')) as {file:string;mediaType:LabMediaType;pages:number};
 const provider=createLabGatewayProvider({id:m.gw,inputUsdPerMTok:m.input,outputUsdPerMTok:m.output});
 const est=extractEstimate(provider.pricing,t.pages);
 if(spent+est>budget){console.log(`stop before ${m.cli} ${id}: spent $${spent.toFixed(4)} + estimate $${est.toFixed(4)} > $${budget}`);break;}
 const started=Date.now();
 const r=await provider.extract({pdf:new Uint8Array(readFileSync(join(corpus,t.file))),pageCount:t.pages,mediaType:t.mediaType});
 const usage=r.kind==='error'?null:r.usage,usd=usage?costUsd(provider.pricing,usage):est;
 spent+=usd;
 mkdirSync(join(outDir,label,m.cli),{recursive:true});
 writeFileSync(join(outDir,label,m.cli,`${id}.json`),JSON.stringify({id,model:m.cli,label,ok:r.kind==='ok',object:r.kind==='ok'?r.object:null,error:r.kind==='ok'?null:r.kind==='error'?r.errorClass:'refusal',
  inputTokens:usage?.inputTokens??0,outputTokens:usage?.outputTokens??0,thinkingTokens:0,schemaRetries:0,latencyMs:Date.now()-started,gatewayUsd:usage?usd:null},null,1));
 console.log(`${m.cli} ${id} ${r.kind}${r.kind==='error'?` ${r.errorClass}`:''} $${usd.toFixed(4)} (total $${spent.toFixed(4)})`);
}
console.log(`Gateway spend this run: $${spent.toFixed(4)}`);
