// CommonJS loader API required by webpack.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const ts = require('typescript');
module.exports = function(source) {
  // Count actual list function executions, without adding test telemetry to production.
  if (this.resourcePath.endsWith('/components/chat-v2/member-chat.tsx')) {
    source = source.replace('return entries.map(entry => {', 'window.__chatListRenders = (window.__chatListRenders || 0) + 1; return entries.map(entry => {');
  }
  return ts.transpileModule(source, { compilerOptions: {
    jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022,
  }, fileName: this.resourcePath }).outputText;
};
