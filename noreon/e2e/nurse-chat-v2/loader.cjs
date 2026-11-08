// Test-only long page state. Production always starts empty.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const ts=require('typescript');
module.exports=function(source){
 if(this.resourcePath.endsWith('/components/nurse-chat-v2/nurse-chat.tsx'))source=source.replace('useState<ThreadMessage[]>([])','useState<ThreadMessage[]>(window.fixture.history)');
 return ts.transpileModule(source,{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022},fileName:this.resourcePath}).outputText;
};
