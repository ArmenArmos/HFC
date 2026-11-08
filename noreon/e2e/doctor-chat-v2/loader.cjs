// Test-only long page state. Production always starts empty.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const ts=require('typescript');
module.exports=function(source){
 // LabAiCheck imports only this style constant. Next splits server actions;
 // the standalone fixture instead excludes the unused server staff shell.
 if(this.resourcePath.endsWith('/components/staff/shell.tsx')){
  const style=source.match(/export const buttonClass\s*=\s*"[^"]*";/);
  if(!style)throw Error('Staff button style export changed');
  source=style[0];
 }

 if(this.resourcePath.endsWith('/components/doctor-chat-v2/doctor-chat.tsx')){
  const initial='useState<Message[]>([])';
  if(!source.includes(initial))throw Error('Doctor chat fixture could not seed the real page state');
  source=source.replace(initial,'useState<Message[]>(window.fixture.history)');
 }
 return ts.transpileModule(source,{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022},fileName:this.resourcePath}).outputText;
};
