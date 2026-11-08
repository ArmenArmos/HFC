import {spawn} from 'node:child_process';

/**
 * One model call through headless Claude Code (`claude -p`), paid by the developer's Claude
 * subscription instead of AI Gateway credit. The production system prompt REPLACES Claude Code's,
 * no tools, no MCP servers, no settings, no session saved; the file goes in as a document or image
 * block before the text, as in the production adapter. Structured output goes through --json-schema.
 *
 * Fidelity limits (see REPORT.md): Claude Code may still think briefly before answering, and it
 * retries a structured output that fails its schema check, where production sends one request with
 * constrained JSON. The Gateway fidelity check measures the difference on a sample.
 */
export type CliFile={data:Buffer;mediaType:'application/pdf'|'image/jpeg'|'image/png'};
export type CliResult={ok:boolean;object:unknown;error:string|null;model:string|null;inputTokens:number;outputTokens:number;thinkingTokens:number;
 schemaRetries:number;latencyMs:number;listCostUsd:number|null};

export async function callClaude(a:{model:string;system:string;prompt:string;file:CliFile|null;schema:object;timeoutMs?:number}):Promise<CliResult>{
 const content=[...(a.file?[a.file.mediaType==='application/pdf'
  ?{type:'document',source:{type:'base64',media_type:a.file.mediaType,data:a.file.data.toString('base64')}}
  :{type:'image',source:{type:'base64',media_type:a.file.mediaType,data:a.file.data.toString('base64')}}]:[]),{type:'text',text:a.prompt}];
 const args=['-p','--model',a.model,'--system-prompt',a.system,'--tools','','--strict-mcp-config','--setting-sources','','--no-session-persistence',
  '--input-format','stream-json','--output-format','stream-json','--verbose','--json-schema',JSON.stringify(a.schema)];
 const started=Date.now();
 return await new Promise<CliResult>(resolve=>{
  // Run outside the repository so no project CLAUDE.md or hooks are picked up.
  const child=spawn('claude',args,{cwd:process.env.TMPDIR??'/tmp',stdio:['pipe','pipe','pipe']});
  let out='',err='';
  const timer=setTimeout(()=>child.kill('SIGTERM'),a.timeoutMs??240_000);
  child.stdout.on('data',d=>{out+=d;});child.stderr.on('data',d=>{err+=d;});
  child.on('close',()=>{
   clearTimeout(timer);
   let result:Record<string,unknown>|null=null,model:string|null=null,retries=0;
   for(const line of out.split('\n')){
    if(!line.trim())continue;
    let o:Record<string,unknown>;try{o=JSON.parse(line);}catch{continue;}
    if(o.type==='system'&&o.subtype==='init')model=String(o.model??'');
    if(o.type==='result')result=o;
    if(o.type==='user'){const c=(o.message as {content?:unknown})?.content;
     if(Array.isArray(c))for(const b of c)if(b?.type==='tool_result'&&(b.is_error||/InputValidationError|validation|does not match|schema/i.test(JSON.stringify(b.content??''))))retries++;}
   }
   const u=(result?.usage??{}) as Record<string,number&Record<string,number>>;
   const inputTokens=(u.input_tokens??0)+(u.cache_creation_input_tokens??0)+(u.cache_read_input_tokens??0);
   resolve({ok:!!result&&!result.is_error&&result.structured_output!==undefined,object:result?.structured_output??null,
    error:result?(result.is_error?String(result.result??result.subtype).slice(0,200):result.structured_output===undefined?'no_structured_output':null):`no_result:${err.slice(0,200)}`,
    model,inputTokens,outputTokens:u.output_tokens??0,thinkingTokens:(u.output_tokens_details as unknown as {thinking_tokens?:number})?.thinking_tokens??0,
    schemaRetries:retries,latencyMs:Date.now()-started,listCostUsd:typeof result?.total_cost_usd==='number'?result.total_cost_usd as number:null});
  });
  child.stdin.end(JSON.stringify({type:'user',message:{role:'user',content}})+'\n');
 });
}

/** Gateway list prices (zoe_model_catalog, 17 Oct 2026), USD per million tokens, no caching. */
export const GATEWAY_PRICE:Record<string,{input:number;output:number}>={
 'claude-haiku-5-5':{input:0.10,output:0.50},'claude-sonnet-5-5':{input:2,output:10},'claude-opus-5-5':{input:4,output:20},
};
export const gatewayUsd=(model:string,inputTokens:number,outputTokens:number)=>{
 const p=GATEWAY_PRICE[model];return p?(inputTokens*p.input+outputTokens*p.output)/1e6:null;
};

/** Run tasks with at most n in flight. */
export async function pool<T,R>(items:T[],n:number,fn:(x:T,i:number)=>Promise<R>):Promise<R[]>{
 const out:R[]=new Array(items.length);let next=0;
 await Promise.all(Array.from({length:Math.min(n,items.length)},async()=>{for(;;){const i=next++;if(i>=items.length)return;out[i]=await fn(items[i]!,i);}}));
 return out;
}
