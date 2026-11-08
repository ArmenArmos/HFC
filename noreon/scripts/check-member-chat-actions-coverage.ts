/** Source-only SQL coverage check. Does not import app modules or connect to a database. */
import {readFileSync,readdirSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {existsSync} from 'node:fs';
import assert from 'node:assert/strict';
import ts from 'typescript';
import {dependencyRegions,excludedChatRegions,forwardingCalls,tableOperations,type TableOperation} from './member-chat-actions-manifest';

type Operation={kind:'rpc'|'table';name:string;operation?:TableOperation;file:string;line:number};
const operationKey=(op:Operation)=>`${op.kind}:${op.name}${op.kind==='table'?`:${op.operation}`:''}`;
const missingCoverage=(ops:readonly Operation[],covered:ReadonlySet<string>)=>ops.filter(op=>!covered.has(operationKey(op)));
const root=process.cwd();
const operations:Operation[]=[];
const issues:string[]=[];
const read=(file:string)=>readFileSync(resolve(root,file),'utf8');
const files=(dir:string):string[]=>readdirSync(resolve(root,dir),{withFileTypes:true}).flatMap(e=>e.isDirectory()?files(`${dir}/${e.name}`):/\.[cm]?[jt]sx?$/.test(e.name)?[`${dir}/${e.name}`]:[]);
function topName(n:ts.Node):string|undefined{
 if(ts.isFunctionDeclaration(n))return n.name?.text;
 if(ts.isVariableStatement(n))return n.declarationList.declarations.map(d=>ts.isIdentifier(d.name)?d.name.text:'').join(',');
 return undefined;
}
function scan(file:string,selections:readonly string[]|null=null,text=read(file)){
 const source=ts.createSourceFile(file,text,ts.ScriptTarget.Latest,true,file.endsWith('tsx')?ts.ScriptKind.TSX:ts.ScriptKind.TS);
 const found=new Set<string>();
 const used=new Set<string>();
 function unwrap(node:ts.Node):ts.Node{
  while(ts.isAsExpression(node)||ts.isTypeAssertionExpression(node)||ts.isParenthesizedExpression(node)||ts.isNonNullExpression(node)||ts.isSatisfiesExpression(node))node=node.expression;
  return node;
 }
 function namesFor(value:ts.Node|undefined,seen=new Set<ts.Node>()):string[]|null{
  if(!value)return null;
  const n=unwrap(value);
  if(seen.has(n))return null;
  const next=new Set(seen).add(n);
  if(ts.isStringLiteral(n)||ts.isNoSubstitutionTemplateLiteral(n))return [n.text];
  if(ts.isConditionalExpression(n)){
   const yes=namesFor(n.whenTrue,next),no=namesFor(n.whenFalse,next);
   return yes&&no?[...yes,...no]:null;
  }
  if(ts.isIdentifier(n)){
   let scope:ts.Node|undefined=n.parent;
   while(scope){
    if(ts.isBlock(scope)||ts.isSourceFile(scope))for(const statement of scope.statements){
     if(!ts.isVariableStatement(statement))continue;
     const declaration=statement.declarationList.declarations.find(d=>ts.isIdentifier(d.name)&&d.name.text===n.text);
     if(declaration)return (statement.declarationList.flags&ts.NodeFlags.Const)!==0?namesFor(declaration.initializer,next):null;
    }
    if(ts.isFunctionDeclaration(scope)||ts.isFunctionExpression(scope)||ts.isArrowFunction(scope)||ts.isMethodDeclaration(scope)){
     const parameter=scope.parameters.find(p=>ts.isIdentifier(p.name)&&p.name.text===n.text);
     if(parameter){
      const type=parameter.type;
      const types=type&&ts.isUnionTypeNode(type)?type.types:type?[type]:[];
      return types.length&&types.every(t=>ts.isLiteralTypeNode(t)&&ts.isStringLiteral(t.literal))?types.map(t=>(t as ts.LiteralTypeNode).literal as ts.StringLiteral).map(t=>t.text):null;
     }
    }
    scope=scope.parent;
   }
  }
  if(ts.isTemplateExpression(n)){
   let values=[n.head.text];
   for(const span of n.templateSpans){
    const names=namesFor(span.expression,next);
    if(!names)return null;
    values=values.flatMap(prefix=>names.map(name=>prefix+name+span.literal.text));
   }
   return values;
  }
  return null;
 }
 function enclosing(node:ts.Node):string{
  let parent:ts.Node|undefined=node.parent;
  while(parent){
   if((ts.isFunctionDeclaration(parent)||ts.isFunctionExpression(parent)||ts.isMethodDeclaration(parent))&&parent.name)return parent.name.getText(source);
   if(ts.isVariableDeclaration(parent)&&ts.isIdentifier(parent.name)&&parent.initializer&&(ts.isArrowFunction(unwrap(parent.initializer))||ts.isFunctionExpression(unwrap(parent.initializer))))return parent.name.text;
   parent=parent.parent;
  }
  return '<module>';
 }
 function visit(node:ts.Node){
  if(ts.isIdentifier(node))used.add(node.text);
  if(ts.isCallExpression(node)){
   const expr=unwrap(node.expression);
   const property=ts.isElementAccessExpression(expr)?namesFor(expr.argumentExpression):null;
   const method=ts.isPropertyAccessExpression(expr)?expr.name.text:ts.isIdentifier(expr)?expr.text:property?.length===1?property[0]:'';
   const args=node.arguments;
   const add=(kind:Operation['kind'],name:string,operation?:TableOperation)=>operations.push({kind,name,operation,file,line:source.getLineAndCharacterOfPosition(node.getStart(source)).line+1});
   function capture(kind:Operation['kind'],argument:ts.Node|undefined,operation?:TableOperation){
    const names=namesFor(argument);
    if(names&&names.length&&names.every(name=>/^[a-z][a-z0-9_]+$/.test(name))){for(const name of names)add(kind,name,operation);return;}
    const expression=argument?.getText(source)??'<missing>';
    const owner=enclosing(node);
    if(forwardingCalls.some(f=>f.file===file&&f.function===owner&&f.method===method&&f.argument===expression))return;
    issues.push(`Unresolved ${kind} name ${expression} (${file}:${source.getLineAndCharacterOfPosition(node.getStart(source)).line+1}, ${owner}); resolve its finite names or document this exact forwarding call`);
   }
   if(['rpc','call','askCall'].includes(method)){
    // call(client, name, args) and call(name, args) are both used by feature adapters.
    const clientFirst=method==='call'&&args.length>=3;
    capture('rpc',args[clientFirst?1:0]);
   }
   if(method==='from'&&(ts.isPropertyAccessExpression(expr)||ts.isElementAccessExpression(expr))){
    const receiver=expr.expression.getText(source);
    // Array/Buffer conversions and storage buckets are not public tables.
    if(!/^(Array|Buffer|Uint8Array)$/.test(receiver)&&!receiver.includes('.storage')){
     // The first operation owns the chain: insert(...).select(...) requests
     // RETURNING rows; it is still an INSERT, not a separate table SELECT.
     let chain:ts.Node=node;
     let operation:TableOperation|undefined;
     while(chain.parent){
      const parent=chain.parent;
      if(unwrap(parent)===unwrap(chain)){chain=parent;continue;}
      if(!(ts.isPropertyAccessExpression(parent)||ts.isElementAccessExpression(parent))||parent.expression!==chain||!ts.isCallExpression(parent.parent)||parent.parent.expression!==parent)break;
      const names=ts.isPropertyAccessExpression(parent)?[parent.name.text]:namesFor(parent.argumentExpression);
      operation=tableOperations.find(op=>names?.length===1&&names[0]===op);
      if(operation)break;
      chain=parent.parent;
     }
     if(operation)capture('table',args[0],operation);
     else issues.push(`Unresolved table operation (${file}:${source.getLineAndCharacterOfPosition(node.getStart(source)).line+1}); use an explicit select/insert/update/upsert/delete chain`);
    }
   }
   if(method==='read'&&args.length>=3)capture('rpc',args[1]);
  }
  ts.forEachChild(node,visit);
 }
 for(const node of source.statements){
  if(selections&&ts.isClassDeclaration(node)&&node.name){
   for(const member of node.members){
    const name=member.name&&ts.isIdentifier(member.name)?`${node.name.text}.${member.name.text}`:'';
    if(selections.includes(name)){found.add(name);visit(member);}
   }
   continue;
  }
  const names=topName(node)?.split(',')??[];
  if(selections){for(const name of names)if(selections.includes(name))found.add(name);if(!names.some(n=>selections.includes(n)))continue;}
  const excluded=excludedChatRegions[file];
  if(excluded&&names.some(n=>n in excluded))continue;
  visit(node);
 }
 for(const name of selections??[])if(!found.has(name))issues.push(`Stale dependency selection ${file}#${name}`);
 // A newly imported action or database adapter cannot disappear behind the shared
 // selections. Review its member exports here before accepting the SQL coverage.
 if(!file.startsWith('coverage-'))for(const node of source.statements){
  if(!ts.isImportDeclaration(node)||!ts.isStringLiteral(node.moduleSpecifier)||!node.importClause||node.importClause.isTypeOnly)continue;
  const spec=node.moduleSpecifier.text;
  const base=spec.startsWith('@/')?spec.slice(2):spec.startsWith('.')?resolve(dirname(file),spec).slice(root.length+1):null;
  if(!base)continue;
  const target=[base,base+'.ts',base+'.tsx'].find(p=>existsSync(resolve(root,p))&&/\.tsx?$/.test(p));
  if(!target||target.startsWith('lib/zoe-chat-actions/'))continue;
  const content=read(target);
  if(!(target in dependencyRegions)&&!/^\s*['"]use server['"]/m.test(content)&&!(/\.rpc\s*[( !]|(?<!Array)(?<!Buffer)(?<!Uint8Array)\.from\s*\(|\[\s*['"](?:rpc|from|call)['"]\s*\]\s*\(/.test(content)))continue;
  const bindings=node.importClause.namedBindings;
  if(!bindings||!ts.isNamedImports(bindings))continue;
  for(const item of bindings.elements){
   if(item.isTypeOnly||!used.has(item.name.text))continue;
   const name=(item.propertyName??item.name).text;
   const declared=dependencyRegions[target];
   if(!(target in dependencyRegions)||declared&&!declared.some(n=>n===name||n.startsWith(name+'.')))issues.push(`Unscanned member dependency ${target}#${name} (${file}); add its member selections and a case to scripts/check-member-chat-actions-db.sql`);
  }
 }

}
// Parser regression checks use only strings, never application imports or source edits.
scan('coverage-parser-self-test.ts',null,`client.rpc('literal_rpc', {}); ports.rpc!('non_null_rpc', {}); call('wrapper_rpc', {}); askCall('ask_rpc', {}); call(client, 'client_wrapper_rpc', {}); client.rpc(flag ? 'first_rpc' : 'second_rpc', {}); client.from('member_table').select('*'); Array.from('not_a_table');`);
assert.deepEqual(operations.map(operationKey),['rpc:literal_rpc','rpc:non_null_rpc','rpc:wrapper_rpc','rpc:ask_rpc','rpc:client_wrapper_rpc','rpc:first_rpc','rpc:second_rpc','table:member_table:select']);
operations.length=0;
scan('coverage-operation-self-test.ts',null,`client.from('profiles').select('*'); client.from('profiles').insert({}).select('*'); (client['from']('profiles') as Builder)['update']({}).eq('id',id); client.from('profiles').upsert({}); client.from('profiles').delete().eq('id',id);`);
assert.deepEqual(operations.map(operationKey),tableOperations.map(op=>`table:profiles:${op}`));
operations.length=0;
scan('coverage-selection-self-test.ts',['Repo.receive'],`class Repo { receive(){ this.call('member_rpc', {}); } staff(){ this.call('staff_rpc', {}); } }`);
assert.deepEqual(operations.map(o=>o.name),['member_rpc']);
operations.length=0;
scan('coverage-name-self-test.ts',null,`const RPC = 'constant_rpc' as const; const TABLE = 'constant_table'; client['rpc']('cast_rpc' as never, {}); client.rpc(RPC, {}); client['from'](TABLE).select('*'); function dispatch(operation: 'add'|'remove'){ client.rpc(\`member_push_\${operation}\`, {}); }`);
assert.deepEqual(operations.map(o=>o.name),['cast_rpc','constant_rpc','constant_table','member_push_add','member_push_remove']);
operations.length=0;
const issuesBefore=issues.length;
scan('coverage-unresolved-self-test.ts',null,`client.rpc(dynamicName, {}); client.from(dynamicTable).select('*'); client['call'](dynamicCall, {}); client.from('profiles');`);
assert.equal(issues.length-issuesBefore,4,'Unresolved RPC/table names, computed calls and table operations must fail closed');
issues.splice(issuesBefore);
for(const file of files('lib/zoe-chat-actions'))scan(file);
for(const file of files('components/chat-v2'))if(!file.endsWith('/staff-menu.tsx'))scan(file);
for(const [file,names] of Object.entries(dependencyRegions))scan(file,names);

const sql=read('scripts/check-member-chat-actions-db.sql');
function sqlEvidence(text:string,onInvalid:(message:string)=>void):Set<string>{
 const lines=text.split('\n');
 const result=new Set<string>();
 for(let i=0;i<lines.length;i++){
  const marker=/^\s*--\s*covers:\s*(rpc|table):([a-z][a-z0-9_]*)(?::(select|insert|update|upsert|delete))?\s*$/.exec(lines[i]);
  if(!marker){if(/^\s*--\s*covers:/.test(lines[i]))onInvalid(`Invalid SQL coverage marker at line ${i+1}`);continue;}
  const [,kind,name,operation]=marker;
  if((kind==='table')!==Boolean(operation)){onInvalid(`SQL marker at line ${i+1} requires rpc:name or table:name:operation`);continue;}
  const key=`${kind}:${name}${operation?`:${operation}`:''}`;
  // Consecutive markers share one following action block. A bare marker cannot
  // borrow an invocation elsewhere in the file.
  let start=i+1;
  while(start<lines.length&&/^\s*--/.test(lines[start]))start++;
  let end=start;
  while(end<lines.length&&!/^\s*--\s*(?:covers:|card-kind:)/.test(lines[end]))end++;
  const block=lines.slice(start,end).filter(l=>!/^\s*--/.test(l)).join('\n');
  // Match DELETE FROM as a unit so its FROM cannot masquerade as SELECT.
  const tableEvidence=[...block.matchAll(/\b(insert\s+into|delete\s+from|update|from|join)\s+public\.([a-z][a-z0-9_]*)\b/gi)].some(match=>{
   const verb=match[1].toLowerCase().replace(/\s+/g,' ');
   const actual=verb==='insert into'?(/\bon\s+conflict\b/i.test(block.slice(match.index).split(';')[0])?'upsert':'insert'):verb==='delete from'?'delete':verb==='update'?'update':'select';
   return match[2].toLowerCase()===name&&actual===operation;
  });
  const evidence=kind==='rpc'?new RegExp(`\\bpublic\\.${name}\\s*\\(`).test(block):tableEvidence;
  if(!evidence)onInvalid(`SQL marker ${key} at line ${i+1} has no matching public ${kind} invocation in its action block`);
  else result.add(key);
 }
 return result;
}
const invalidEvidence:string[]=[];
assert.equal(sqlEvidence('-- covers: rpc:new_action\nselect public.other_action();',m=>invalidEvidence.push(m)).size,0);
assert.equal(invalidEvidence.length,1,'A marker alone or unrelated call must fail');
assert.ok(sqlEvidence('-- covers: rpc:new_action\nselect public.new_action();',m=>{throw Error(m);}).has('rpc:new_action'));
for(const [operation,command]of Object.entries({select:'select * from public.profiles',insert:'insert into public.profiles(id) values(null)',update:'update public.profiles set display_name=null',upsert:'insert into public.profiles(id) values(null) on conflict(id) do update set display_name=null',delete:'delete from public.profiles'})){
 for(const marker of tableOperations){
  const errors:string[]=[];
  const evidence=sqlEvidence(`-- covers: table:profiles:${marker}\n${command};`,m=>errors.push(m));
  assert.equal(evidence.has(`table:profiles:${marker}`),marker===operation,`${operation} SQL must only satisfy its own marker`);
  assert.equal(errors.length,marker===operation?0:1);
 }
}
const covered=sqlEvidence(sql,m=>issues.push(m));
// Mutate the real scanned source in memory: a profile SELECT must never cover a
// newly added direct UPDATE, even though an RPC elsewhere writes that table.
const mutationStart=operations.length;
scan('coverage-mutation-self-test.ts',null,read('lib/patient/database-store.ts')+`\nclient.from('profiles').update({display_name:'Fictional member'}).eq('id',memberId);`);
const mutated=operations.splice(mutationStart);
assert.deepEqual(missingCoverage(mutated,covered).map(operationKey),['table:profiles:update'],
 'Adding profiles.update must fail coverage until matching UPDATE evidence exists');
const selectOnly=sqlEvidence('-- covers: table:profiles:select\nselect * from public.profiles;',m=>{throw Error(m);});
const mutationUpdate=mutated.filter(op=>operationKey(op)==='table:profiles:update');
assert.equal(missingCoverage(mutationUpdate,selectOnly).length,1,'SELECT evidence cannot cover UPDATE');
const withUpdate=sqlEvidence(sql+'\n-- covers: table:profiles:update\nupdate public.profiles set display_name=null;',m=>{throw Error(m);});
assert.deepEqual(missingCoverage(mutated,withUpdate),[],'Matching UPDATE evidence covers the in-memory mutation');
const registry=ts.createSourceFile('registry.ts',read('lib/zoe-chat-actions/registry.ts'),ts.ScriptTarget.Latest,true);
let kinds:string[]=[];
function findKinds(n:ts.Node){if(ts.isVariableDeclaration(n)&&ts.isIdentifier(n.name)&&n.name.text==='CARD_KINDS'&&n.initializer){let init=n.initializer;while(ts.isAsExpression(init)||ts.isParenthesizedExpression(init))init=init.expression;if(ts.isArrayLiteralExpression(init))kinds=init.elements.filter(ts.isStringLiteral).map(x=>x.text);}ts.forEachChild(n,findKinds);}
findKinds(registry);
if(!kinds.length)issues.push('Could not derive CARD_KINDS');
for(const kind of kinds){
 const marker=new RegExp(`^\\s*--\\s*card-kind:\\s*${kind}\\s*$`,'m');
 if(!marker.test(sql))issues.push(`Missing SQL card-kind: ${kind}`);
 // Require a literal kind in a VALUES row or JSON card construction as well as the marker.
 const withoutComments=sql.replace(/^\s*--.*$/gm,'');
 if(!new RegExp(`['"]${kind}['"]`).test(withoutComments))issues.push(`SQL does not construct literal card kind ${kind}`);
}
const unique=new Map<string,Operation>();
for(const op of operations)if(!unique.has(operationKey(op)))unique.set(operationKey(op),op);
for(const op of missingCoverage([...unique.values()],covered))issues.push(`Missing SQL coverage ${operationKey(op)} (${op.file}:${op.line}); add a case to scripts/check-member-chat-actions-db.sql`);
if(issues.length){console.error(issues.join('\n'));process.exitCode=1;}
else console.log(`Member chat SQL coverage: ${unique.size} database operations and ${kinds.length} card kinds covered.`);
