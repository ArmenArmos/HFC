/** Load the real shared chat hook and notices, isolating only the caller's existing IO boundaries. */
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

export function runChatView(path:string,context:Record<string,unknown>&{exports:Record<string,unknown>;require:(name:string)=>unknown}) {
 const cache=new Map<string,Record<string,unknown>>();
 const files:Record<string,string>={
  '@/components/patient/use-zoe-thread':'components/patient/use-zoe-thread.ts',
  './use-zoe-thread':'components/patient/use-zoe-thread.ts',
  '@/components/patient/zoe-notice':'components/patient/zoe-notice.tsx',
  './zoe-notice':'components/patient/zoe-notice.tsx',
  './use-hydrated':'components/patient/use-hydrated.tsx',
  '@/components/patient/use-hydrated':'components/patient/use-hydrated.tsx',
  '@/lib/zoe-chat-actions/thread-events':'lib/zoe-chat-actions/thread-events.ts',
 };
 const run=(file:string,exports:Record<string,unknown>)=>{
  cache.set(file,exports);
  const code=ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText;
  new vm.Script(code,{filename:file}).runInNewContext({...context,exports,require(name:string){
   const source=files[name];
   if(!source)return context.require(name.startsWith('./') ? '@/components/patient/'+name.slice(2) : name);
   if(!cache.has(source))run(source,{});
   return cache.get(source);
  }});
 };
 run(path,context.exports);
}
