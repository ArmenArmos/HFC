import {spawn,type ChildProcessWithoutNullStreams} from 'node:child_process';
import {appendFileSync,mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import type {GatewayGenerate} from '../gateway';
import {GATEWAY_TIMEOUT_MS} from '../gateway';

/**
 * EVAL ONLY, never production: a GatewayGenerate that runs the model under test through headless
 * Claude Code (`claude -p`) on the operator's Claude subscription instead of the Vercel AI Gateway,
 * so heavy local eval runs spend no Gateway credit. Plugged into the real Gateway adapter
 * (createGatewayProvider's `generate`), so the request text, unfence, guards, red flags and the
 * judge code are exactly production's; only the transport differs.
 *
 * Fidelity (measured in output/ai-eval-zoe-2026-10-19/REPORT.md):
 *  - Zoe's system prompt replaces Claude Code's (--system-prompt); no tools, no MCP, no settings,
 *    no session files, thinking off, run from an empty directory.
 *  - Claude Code still attaches one short account-context reminder (about 80 words) to the user turn.
 *  - Temperature cannot be set (the Gateway adapter uses 0); max output tokens is passed through.
 *  - Timeout: the Gateway's 20 s applies to the API time Claude Code reports, not to CLI start-up.
 * Token usage is the CLI's real usage, so cost estimates use the tier's Gateway list prices.
 *
 * Refuses to run on Vercel. Imported only by scripts/zoe-model-eval.ts and the local QA harness.
 */
type Env=Record<string,string|undefined>;

/** Gateway model id ("anthropic/claude-opus-5.5") to Claude Code model id ("claude-opus-5-5"). */
export const subscriptionModelId=(gatewayId:string)=>{
 // A fast endpoint is the same model (gateway.ts FAST_MODELS); the subscription runs it at standard speed.
 const m=/^anthropic\/(claude-[a-z]+-\d+(?:\.\d+)?)(?:-fast)?$/.exec(gatewayId);
 if(!m)throw Error(`Subscription eval runs Anthropic models only, not ${gatewayId}`);
 return m[1]!.replaceAll('.','-');
};

export type SubscriptionOptions={claudeBin?:string;env?:Env;
 /** JSONL file: one line per call with the request and the raw response (synthetic eval data only). */
 logFile?:string;
 /** Gateway timeout to emulate on the API time (default the adapter's 20 s). */
 timeoutMs?:number};

export function createSubscriptionGenerate(options:SubscriptionOptions={}):GatewayGenerate{
 const env=options.env??process.env;
 if(env.VERCEL==='1'||env.VERCEL_ENV)throw Error('The subscription eval provider never runs on Vercel.');
 const cwd=mkdtempSync(join(tmpdir(),'zoe-sub-eval-'));
 const bin=options.claudeBin??env.CLAUDE_BIN??'claude';
 const timeoutMs=options.timeoutMs??GATEWAY_TIMEOUT_MS;
 return async args=>{
  const model=subscriptionModelId(args.model);
  const argv=['-p','--model',model,...(args.reasoning?['--effort',args.reasoning==='none'?'low':args.reasoning]:[]),'--system-prompt',args.system,'--tools','','--setting-sources','','--strict-mcp-config','--mcp-config','{"mcpServers":{}}',
   '--no-session-persistence','--settings','{"alwaysThinkingEnabled":false}','--output-format','stream-json','--verbose'];
  const started=Date.now();
  const run=await new Promise<{out:string;err:string;code:number|null;signal:NodeJS.Signals|null}>((resolve,reject)=>{
   const child:ChildProcessWithoutNullStreams=spawn(bin,argv,{cwd,env:{...process.env,...env,CLAUDE_CODE_MAX_OUTPUT_TOKENS:String(args.maxOutputTokens)} as NodeJS.ProcessEnv,stdio:'pipe'});
   let so='',se='';
   child.stdout.on('data',d=>{so+=d;});child.stderr.on('data',d=>{se+=d;});
   // A hung CLI is a timeout; the generous wall limit covers CLI start-up on top of the API time.
   const wall=setTimeout(()=>{child.kill('SIGTERM');},timeoutMs*4+30_000);
   child.on('error',reject);
   child.on('close',(code:number|null,signal:NodeJS.Signals|null)=>{clearTimeout(wall);resolve({out:so,err:se,code,signal});});
   child.stdin.end(args.prompt);
  });
  // Only a finished call counts (Codex R1, #311): a killed CLI is a timeout, and a call with no final result event, or a
  // non-zero exit that the result does not explain, is a provider error, never a reply, whatever text came before it.
  if(run.signal)throw Object.assign(Error(`claude killed (${run.signal})`),{name:'TimeoutError'});
  type Result={result?:string;is_error?:boolean;api_error_status?:number|null;duration_api_ms?:number;session_id?:string;stop_reason?:string;
   usage?:{input_tokens?:number;cache_creation_input_tokens?:number;cache_read_input_tokens?:number;output_tokens?:number};modelUsage?:Record<string,unknown>};
  let j:Result;
  // stream-json: the final "result" event carries usage, but its result text is only the LAST text block; with interleaved
  // thinking (text, thinking, text) that cut the start off a reply (Haiku, about 1% of calls). The reply is every text block
  // of the assistant events, in order, which is what the Gateway returns.
  let reply='';
  try{
   const events=run.out.trim().split('\n').filter(Boolean).map(l=>JSON.parse(l) as {type?:string;message?:{content?:{type:string;text?:string}[]}});
   const last=events.findLast(e=>e.type==='result') as Result|undefined;
   if(!last)throw Object.assign(Error(`claude gave no final result (exit ${run.code}): ${run.err.slice(0,200)}`),{status:503});
   j=last;
   reply=events.filter(e=>e.type==='assistant').flatMap(e=>(e.message?.content??[]).filter(c=>c.type==='text').map(c=>c.text??'')).join('');
  }catch(e){throw (e as {status?:number}).status?e:Object.assign(Error('claude returned no JSON'),{status:502});}
  if(run.code!==0&&!j.is_error)throw Object.assign(Error(`claude exited ${run.code} without an error result: ${run.err.slice(0,200)}`),{status:503});
  const log=(extra:Record<string,unknown>)=>{if(options.logFile)appendFileSync(options.logFile,JSON.stringify({at:new Date().toISOString(),model,system:args.system,prompt:args.prompt,
   maxOutputTokens:args.maxOutputTokens,wallMs:Date.now()-started,apiMs:j.duration_api_ms??null,usage:j.usage??null,...extra})+'\n');};
  // The Gateway returns a cut-off text at the token limit; the CLI returns an error and no text. Both end as an
  // unparseable output in the guard, so the cut-off is reported as a length stop with an empty text.
  if(j.is_error&&/exceeded the \d+ output token maximum/.test(j.result??'')){log({error:'max_output_tokens'});
   return {text:'',finishReason:'length',usage:{inputTokens:(j.usage?.input_tokens??0)+(j.usage?.cache_creation_input_tokens??0)+(j.usage?.cache_read_input_tokens??0),outputTokens:args.maxOutputTokens},
    response:{id:`claude-code-${j.session_id??'unknown'}`,modelId:`claude-code/${model}`}};}
  if(j.is_error){log({error:j.result??'error',status:j.api_error_status});throw Object.assign(Error(`claude error: ${(j.result??'').slice(0,200)}`),{status:j.api_error_status??503});}
  if((j.duration_api_ms??0)>(args.timeoutMs??timeoutMs)){log({timeout:true,text:j.result});throw Object.assign(Error('API time over the Gateway timeout'),{name:'TimeoutError'});}
  const u=j.usage??{};
  const text=reply||(j.result??'');
  log({text,stop:j.stop_reason});
  return {text,finishReason:j.stop_reason==='max_tokens'?'length':j.stop_reason==='refusal'?'content-filter':'stop',
   usage:{inputTokens:(u.input_tokens??0)+(u.cache_creation_input_tokens??0)+(u.cache_read_input_tokens??0),outputTokens:u.output_tokens??0},
   response:{id:`claude-code-${j.session_id??'unknown'}`,modelId:`claude-code/${Object.keys(j.modelUsage??{})[0]??model}`},...(j.duration_api_ms?{apiMs:j.duration_api_ms}:{})};
 };
}
