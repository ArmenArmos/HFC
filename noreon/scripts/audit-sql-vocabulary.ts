import {readFileSync,readdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {legacyAuditWriters,legacyAuditDependencies} from './audit-sql-vocabulary-legacy';

// Only event-bearing columns read by _audit_rows. Admin-only categories are excluded
// by the clinic RPC, but their source labels remain in the shared display map.
const tables:Record<string,[string,string]>={
 access_audit:['access','surface'],clinic_portal_audit:['clinic','kind'],telegram_auth_audit:['telegram_auth','kind'],
 telegram_audit:['telegram','kind'],patient_clinical_case_events:['clinical_case','kind'],
 patient_document_release_events:['document_release','kind'],patient_coordination_events:['coordination','operation'],
 patient_test_request_events:['test_request','operation'],care_alert_audit:['care_alert','kind'],
 system_message_audit:['@states','kind'],conversation_audit:['conversation','kind'],booking_appointment_events:['booking','kind'],real_staff_admin_events:['staff_admin','kind'],
};
// Split SQL arguments without mistaking commas in strings or nested calls for separators.
function readArgs(text:string,select=false){
 const out:string[]=[];let depth=0,quoted=false,start=0;
 for(let i=0;i<text.length;i++){
  const c=text[i];
  if(c==="'"){if(quoted&&text[i+1]==="'"){i++;continue;}quoted=!quoted;}
  if(quoted)continue;
  if(c==='(')depth++;
  if(c===')'){if(!depth){out.push(text.slice(start,i).trim());return {values:out,end:i+1};}depth--;}
  if(!depth&&(c===';'||(select&&/^\s+(?:from|where|union|returning|on\s+conflict)\b/i.test(text.slice(i))))){out.push(text.slice(start,i).trim());return {values:out,end:i};}
  if(c===','&&!depth){out.push(text.slice(start,i).trim());start=i+1;}
 }
 out.push(text.slice(start).trim());return {values:out,end:text.length};
}
const args=(text:string)=>readArgs(text).values;
const strings=(s:string)=>[...s.matchAll(/'((?:''|[^'])*)'/g)].map(m=>m[1].replace(/''/g,"'"));
export function auditSqlVocabulary(sql:string){
 const found=new Map<string,Set<string>>();
 const add=(source:string,code:string)=>{if(!found.has(source))found.set(source,new Set());found.get(source)!.add(code);};
 // Normalise identifiers/comments without rewriting string literals. Keep dollar
 // bodies visible: the audit writers mostly live inside PL/pgSQL functions.
 const s=sql.replace(/'(?:''|[^'])*'|"(?:""|[^"])*"|--[^\n]*|\/\*[\s\S]*?\*\//g,value=>{
  if(value.startsWith("'"))return value;
  if(value.startsWith('"'))return value.slice(1,-1).replaceAll('""','"');
  return ' ';
 }).replace(/'(?:''|[^'])*'|\bpublic\s*\.\s*/gi,value=>value.startsWith("'")?value:'public.');
 const masked=s.replace(/'(?:''|[^'])*'/g,value=>' '.repeat(value.length));
 const unresolved:string[]=[];
 const functions=[...masked.matchAll(/create(?:\s+or\s+replace)?\s+function\s+/gi)].map(m=>{
  const header=masked.slice(m.index!,masked.indexOf(';',m.index!)).match(/\bas\s*(\$(?:[a-z_]\w*)?\$)/i);
  const bodyStart=header?m.index!+header.index!+header[0].length:m.index!;
  const end=header?s.indexOf(header[1],bodyStart):-1;
  return {start:m.index!,end:end<0?bodyStart:end+header![1].length};
 });
 for(const f of functions){
  const body=s.slice(f.start,f.end),name=body.match(/^create(?:\s+or\s+replace)?\s+function\s+(?:public\.)?(\w+)/i)?.[1].toLowerCase();
  const dependency=name&&Object.hasOwn(legacyAuditDependencies,name)?legacyAuditDependencies[name]:undefined;
  if(dependency&&(!dependency.reason||createHash('sha256').update(body).digest('hex')!==dependency.hash))unresolved.push(`legacy vocabulary dependency changed: ${name} (offset ${f.start})`);
 }
 const context=(at:number)=>{
  const owner=functions.find(f=>f.start<=at&&at<f.end);
  return owner?s.slice(owner.start,owner.end):'';
 };
 const parameter=(value:string,body:string)=>{
  const header=body.match(/\bfunction\s+(?:public\.)?\w+\s*\(/i);
  return !!header&&args(body.slice(header.index!+header[0].length)).some(p=>
   new RegExp(`^(?:(?:in|out|inout|variadic)\\s+)?${value}\\s+`,'i').test(p));
 };
 // Count bindings conservatively across the whole function, without control-flow
 // inference. Parameters, query targets and loop targets are unknown writes.
 const writes=(value:string,body:string):(string|null)[]=>{
  const code=body.replace(/'(?:''|[^'])*'/g,v=>' '.repeat(v.length));
  const escaped=value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  const out:(string|null)[]=[];
  if(parameter(value,body))out.push(null);
  for(const m of code.matchAll(new RegExp(`\\b${escaped}\\s*(?::=|=(?!=))([^;]*);`,'gi'))){
   const start=m.index!+m[0].length-m[1].length-1;
   // Equality inside a query/condition is not proof of a literal assignment.
   const statement=/(?:^|;|\b(?:begin|then|else|loop|declare)\b)\s*$/i.test(code.slice(0,m.index));
   out.push(statement?body.slice(start,start+m[1].length).trim():null);
  }
  // Count typed initialisers even when their declaration syntax is unsupported.
  for(const m of code.matchAll(new RegExp(`\\b${escaped}\\s+([a-z_][^;]*?)(?::=|=(?!=)|\\bdefault\\b)([^;]*);`,'gi'))){
   if(!/(?:^|;|\bdeclare\b)\s*$/i.test(code.slice(0,m.index)))continue;
   const start=m.index!+m[0].length-m[2].length-1;
   const declaration=/^(?:constant\s+)?(?:text|varchar)(?:\s*\(\d+\))?\s*(?:not\s+null\s*)?$/i.test(m[1]);
   out.push(declaration?body.slice(start,start+m[2].length).trim():null);
  }
  if([...code.matchAll(new RegExp(`(?:\\bdeclare\\b|;)\\s*${escaped}\\s+[a-z_]`,'gi'))].length>1)out.push(null);
  if(new RegExp(`\\b${escaped}\\s+alias\\s+for\\b`,'i').test(code))out.push(null);
  for(const m of code.matchAll(/\b(?:into\s+(?:strict\s+)?|for(?:each)?\s+)([a-z_]\w*(?:\s*\.\s*[a-z_]\w*)?(?:\s*,\s*[a-z_]\w*(?:\s*\.\s*[a-z_]\w*)?)*)/gi)){
   if(m[1].split(',').some(target=>target.split('.').at(-1)!.trim().toLowerCase()===value.toLowerCase()))out.push(null);
  }
  return out;
 };
 const literal=(value:string):string[]|null=>{
  value=value.trim().replace(/::(?:text|varchar)\s*$/i,'').trim();
  return /^'(?:''|[^'])*'$/.test(value)?strings(value):null;
 };
 // Only complete literals, literal-only CASEs, and a variable with one literal
 // write resolve. Never infer a finite vocabulary from guards or partial values.
 const resolve=(value:string,body:string):string[]|null=>{
  value=value.trim();
  const single=literal(value);if(single)return single;
  const code=value.replace(/'(?:''|[^'])*'/g,v=>' '.repeat(v.length));
  if(/^case\b[\s\S]*\bend$/i.test(code)&&[...code.matchAll(/\b(?:case|end)\b/gi)].length===2){
   const branches=[...code.matchAll(/\b(then|else)([\s\S]*?)(?=\b(?:when|else|end)\b)/gi)];
   if(!branches.length||branches.at(-1)![1].toLowerCase()!=='else')return null;
   const codes=branches.map(m=>literal(value.slice(m.index!+m[0].length-m[2].length,m.index!+m[0].length)));
   return codes.every(v=>v!==null)?codes.flat()as string[]:null;
  }
  if(!/^[a-z_]\w*$/i.test(value))return null;
  const bindings=writes(value,body);
  return bindings.length===1&&bindings[0]!==null?literal(bindings[0]):null;
 };
 const expression=(source:string,value:string='',body='')=>{
  const codes=resolve(value,body);
  if(codes)for(const code of codes)add(source,code);
  return codes!==null;
 };
 const pinned=(source:string,value:string,body:string)=>{
  const entry=legacyAuditWriters[createHash('sha256').update(body).digest('hex')];
  if(!entry?.reason||entry.source!==source||entry.value!==value)return false;
  for(const code of entry.codes)add(source,code);
  return true;
 };
 const forwarding:Record<string,[string,string]>={
  // Only unchanged event arguments are exempt: every caller is scanned below.
  _system_message_audit:['@states','k'],_conversation_audit:['conversation','k'],
  _telegram_audit:['telegram','k'],_telegram_auth_audit:['telegram_auth','k'],
  _clinic_schedule_audit:['clinic','kind'],_access_audit_record:['access','p_surface'],_access_audit_record_as:['access','p_surface'],
  _test_signin_audit:['telegram_auth',"'test_signin.'||p_action||'.'||p_outcome"],
 };
 const write=(source:string,value:string|undefined,at:number)=>{
  const body=context(at),name=body.match(/^create(?:\s+or\s+replace)?\s+function\s+(?:public\.)?(\w+)/i)?.[1];
  const forwarded=name?forwarding[name]:undefined;
  if(forwarded&&source===forwarded[0]&&value===forwarded[1]){
   const parameters=value.replace(/'(?:''|[^'])*'/g,'').match(/\b\w+\b/g)??[];
   if(parameters.every(p=>parameter(p,body)&&writes(p,body).length===1))return;
  }
  if(!value||(!expression(source,value,body)&&!pinned(source,value,body))){
   const bindings=value&&/^[a-z_]\w*$/i.test(value)?` writes=${JSON.stringify(writes(value,body))}`:'';
   unresolved.push(`${source}: ${value??'missing event column'}${bindings} (offset ${at})`);
  }
 };
 for(const m of masked.matchAll(/\binsert\s+into\s+(?:only\s+)?(?:public\.)?(\w+)\b/gi)){
  const table=tables[m[1].toLowerCase()];if(!table)continue;
  const [source,column]=table,tail=s.slice(m.index!+m[0].length).trimStart();
  if(!tail.startsWith('(')){write(source,undefined,m.index!);continue;}
  const columns=readArgs(tail.slice(1)),index=columns.values.map(v=>v.trim().toLowerCase()).indexOf(column);
  let remaining=tail.slice(1+columns.end).trimStart();
  const mode=remaining.match(/^(values\s*\(|select\s+)/i);
  if(index<0||!mode){write(source,undefined,m.index!);continue;}
  remaining=remaining.slice(mode[0].length);
  const query=masked.slice(m.index!,masked.indexOf(';',m.index!)<0?undefined:masked.indexOf(';',m.index!));
  if(/^select/i.test(mode[0])&&/\bunion\b/i.test(query))unresolved.push(`${source}: UNION query (offset ${m.index})`);
  const conflict=query.match(/\bon\s+conflict\b[\s\S]*?\bdo\s+update\s+set\s+([\s\S]+)/i);
  if(conflict&&new RegExp(`\\b${column}\\b`,'i').test(conflict[1]))unresolved.push(`${source}: conflict update (offset ${m.index})`);
  do{
   const parsed=readArgs(remaining,/^select/i.test(mode[0]));write(source,parsed.values[index],m.index!);
   remaining=/^values/i.test(mode[0])?remaining.slice(parsed.end).trimStart():'';
   if(!remaining.startsWith(','))break;
   remaining=remaining.replace(/^,\s*\(/,'');
  }while(remaining);
 }
 const calls=(helper:string)=>[...masked.matchAll(new RegExp(`\\b(?:public\\.)?${helper}\\s*\\(`,'gi'))].filter(m=>{
  const before=masked.slice(masked.lastIndexOf(';',m.index)+1,m.index);
  return !/\bfunction\s*$/i.test(before)&&!/^\s*(?:grant|revoke|alter|drop|comment)\b/i.test(before);
 });
 for(const [helper,source,index] of [['_system_message_audit','@states',1],['_clinic_schedule_audit','clinic',2],['_telegram_auth_audit','telegram_auth',1],['_telegram_audit','telegram',1],['_access_audit_record','access',1],['_access_audit_record_as','access',4],['_conversation_audit','conversation',1]]as const){
  for(const m of calls(helper))write(source,args(s.slice(m.index!+m[0].length))[index],m.index!);
 }
 // Other write shapes have no resolver yet. Refuse them explicitly rather
 // than letting a new event in UPDATE/MERGE/COPY bypass vocabulary coverage.
 for(const m of masked.matchAll(/\b(?:update|merge\s+into|copy)\s+(?:only\s+)?(?:public\.)?(\w+)\b/gi)){
  const table=tables[m[1].toLowerCase()];if(!table)continue;
  // Updating payload/provenance alone does not introduce an event code.
  const statement=masked.slice(m.index!,masked.indexOf(';',m.index!)<0?undefined:masked.indexOf(';',m.index!));
  const setters=statement.match(/\bset\s+([\s\S]*?)(?:\bwhere\b|$)/i)?.[1];
  if(/^update/i.test(m[0])&&setters&&!new RegExp(`\\b${table[1]}\\b`,'i').test(setters))continue;
  unresolved.push(`unsupported ${m[0]} (offset ${m.index})`);
 }
 // Dynamic event SQL is deliberately unsupported, including format() names
 // assembled from fragments. Only DDL and the exact non-audit mode read below
 // are exempt. Legacy function-definition patches are pinned as whole blocks
 // so changing their generated SQL requires reviewing the exemption again.
 const schemaPatches:Record<string,string>={
  'b15b794fe2f07ab3db6b676001538ad3bf1f7ac4ff80748be206cfe0099d7fe7':'Schema-only pg_get_functiondef patch: public.zoe_chat_card_post(uuid,uuid,text,text,bigint,jsonb)',
  'e2f7be5bfa8510d0d52cb22c4fda5864b6029a9ed42158b20068de363c3182ab':'Schema-only pg_get_functiondef patch: public.conversation_member_thread()',
  '97e429bf3036e759bbd2241f682d8372a167ed09c6148b7fadfbf8eab587b2f8':'Schema-only pg_get_functiondef patch: public.zoe_run_finish(uuid,jsonb)',
  '89ad827f53a1cc07d25ea2e3cd4db46c267b69913cd02bbf8a9fe60938839ff9':'Schema-only pg_get_functiondef patch: public.care_alert_resolve(uuid,bigint,text,text)',
  '3731020217f45aa241acb8757d78fe8de0f01a5953c58d9c2ab228705bb3dc69':'Schema-only pg_get_functiondef patch: public.zoe_run_alarm_window(uuid[])',
  '373d2be9643fcdaf5fea66a84b39a71e5bcdca73864cb6a99b4d3dcdebe3f844':'Schema-only pg_get_functiondef patch: public.zoe_run_finish(uuid,jsonb)',
  '8205df4986eb3ab86356a132a9616fa09b3c686666b107e95e22f6ba849587bb':'Schema-only pg_get_functiondef patch: public.zoe_run_finish(uuid,jsonb), public._zoe_run_finish_core(uuid,jsonb)',
  '95cc5bf20763292a9ce9e12466e88c7b6eeaa099ac0cc5d286ae9d1dcc78c433':'Schema-only pg_get_functiondef patch: public.zoe_run_finish(uuid,jsonb)',
  '739c609f82c85c316f47df05ebe1317fb3257c70f85a65ac1581c7983207c1f2':'Schema-only pg_get_functiondef patch: Zoe BP context functions',
  'a4e549c8a62524266ba12cc817297c71ea3c4d8160fe3a095262fc65f09ddcd7':'Schema-only pg_get_functiondef patch: public._care_alert_notify(public.care_alerts)',
  '6bb9084749f41da93a9ec0a398ae7cf6e8c170ec9719713363bdb92aebe62edd':'Schema-only pg_get_functiondef patch: public._care_alert_notify(public.care_alerts)',
  'bf1c6a794247c734aa173bcc8f9756e7ab3330accf13c9212d3ccad3de7b0c12':'Schema-only pg_get_functiondef patch: public._care_alert_json(public.care_alerts)',
  'da455c46a44e5578d84affed5ee87c77f2e4ea5c58448a79f1872f419abf7b17':'Schema-only pg_get_functiondef patch: public.care_alert_resolve(uuid,bigint,text,text)',
  '4af656d23e051d99d13507e360f366bac17604e326ea5ec76f3d6c5f860f982d':'Schema-only pg_get_functiondef patch: public._zoe_bp_reconcile(uuid)',
  '0151e4a27a66fb1a0d991cf0fa752b87d0527dd35e0390710132734ee6f48596':'Schema-only pg_get_functiondef patch: public._record_patient_measurement(uuid,uuid,integer,integer,integer,timestamptz)',
  '8b505d285377017d4d04b9078ba808a0865b63d4fbbb5acf26a37f4d5c6c88b1':'Schema-only pg_get_functiondef patch: public._zoe_bp_entry_source()',
  '5b478cd63b3059a570d22eaca443835ec614413eba0210ccc3ce9777c912acee':'Schema-only pg_get_functiondef patch: public.lab_ai_call_reserve(uuid,uuid,text,text,text,boolean,numeric)',
  'da34117df97426762630ff07641b480c58e6fa68eaf2b783c8af51e045854822':'Schema-only pg_get_functiondef patch: public._rate_limit_policy(text,text)',
  '2c79ce5d8131085e8e30fdfc7b4851a0691a098dcef98bc7d3b735a46006aca2':'Schema-only pg_get_functiondef patch: public._rate_limit_policy(text,text)',
  '908888e148e62d5fd2a3d3d7c272b00336722c49f2b7c81ec0fad1d75a75aec7':'Schema-only pg_get_functiondef patch: Zoe BP context functions',
  'f327774381d1182591cca29aca76a79c303c25bdd897661a116d603ca76088ee':'Schema-only pg_get_functiondef patch: public.care_alert_resolve(uuid,bigint,text,text)',
  '0c56ecf6c9d1e1d3737eed31989807650801e122bb92419a8857cac1b96c1ebd':'Schema-only pg_get_functiondef patch: public._care_alert_json(public.care_alerts)',
  'd39cd6200341bebc6f454f557ef87b736487633cc4490d27cf0638341280b603':'Schema-only pg_get_functiondef patch: public._care_alert_notify(public.care_alerts)',
  'bb32fa244d5282e6404647b9167bb11e6ac2f3213a59019bafe172ff15691ba8':'Schema-only pg_get_functiondef patch: public.care_alert_escalate_due()',
  '016f860a07c68e62deff59b9a08b258a19b00424291607dbabe9bb51c953180a':'Exact care_alert_resolve patch: journals the existing acknowledged event on resolve; the literal INSERT remains vocabulary-scanned',
 };
 for(const m of masked.matchAll(/\bexecute\s+(?!function\b|on\b)([^;]+);/gi)){
  const statement=s.slice(m.index!,m.index!+m[0].length);
  const template=strings(statement)[0];
  if(template&&/^(?:alter|revoke|grant|create trigger)\b/i.test(template)&&!template.includes(';'))continue;
  // This legacy SELECT only reads the Zoe mode; it cannot emit an audit event.
  if(statement==="execute 'select public._zoe_doctor_mode(c.id)from public.conversations c where c.member_id=$1'into t using m;")continue;
  const blockStart=[...masked.slice(0,m.index).matchAll(/\bdo\s+(\$(?:[a-z_]\w*)?\$)/gi)].at(-1);
  if(blockStart){
   const end=s.indexOf(blockStart[1],blockStart.index!+blockStart[0].length);
   const block=s.slice(blockStart.index!,end+blockStart[1].length);
   const digest=createHash('sha256').update(block).digest('hex');
   if(m.index!<end&&Object.hasOwn(schemaPatches,digest))continue;
  }
  unresolved.push(`dynamic SQL (offset ${m.index})`);
 }
 for(const [table,[source,column]] of Object.entries(tables)){
  for(const m of s.matchAll(new RegExp(`(?:create\\s+table\\s+public\\.${table}\\b[^;]+|alter\\s+table\\s+public\\.${table}\\b[^;]+);`,'gi'))){
   for(const check of m[0].matchAll(new RegExp(`\\b${column}\\s+in\\s*\\(([^)]+)\\)`,'gi')))for(const code of strings(check[1]))add(source,code);
  }
 }
 for(const m of calls('_test_signin_audit')){
  const parts=args(s.slice(m.index!+m[0].length)),body=context(m.index!);
  const actions=resolve(parts[2]??'',body),outcomes=resolve(parts[3]??'',body);
  if(!actions||!outcomes){
   if(!pinned('telegram_auth',`test_signin.${parts[2]}.${parts[3]}`,body))unresolved.push(`test sign-in call (offset ${m.index})`);
  }
  else for(const action of actions)for(const outcome of outcomes)add('telegram_auth',`test_signin.${action}.${outcome}`);
 }
 for(const table of ['workspace_staff','clinic_portal_memberships','access_audit']){
  for(const m of s.matchAll(new RegExp(`(?:create\\s+table\\s+public\\.${table}\\b[^;]+|alter\\s+table\\s+public\\.${table}\\b[^;]+);`,'gi'))){
   for(const check of m[0].matchAll(/\b(?:actor_)?role\s+in\s*\(([^)]+)\)/gi))for(const code of strings(check[1]))add('@roles',code);
  }
 }
 for(const m of s.matchAll(/payload->>'action'\s+in\s*\(([^)]+)\)/g))for(const code of strings(m[1]))add('auth',code);
 // Composite outbound actions are translated component by component.
 const outboundTables={telegram_auth_messages:'state',conversation_deliveries:'state',patient_message_attempts:'status',patient_message_delivery_events:'status',telegram_nurse_outbox:'state',member_push_deliveries:'state',system_messages:'state',booking_scheduling_notices:'state'};
 for(const [table,column] of Object.entries(outboundTables)){
  for(const m of s.matchAll(new RegExp(`(?:create\\s+table\\s+public\\.${table}\\b[^;]+|alter\\s+table\\s+public\\.${table}\\b[^;]+);`,'gi'))){
   for(const check of m[0].matchAll(new RegExp(`\\b${column}\\s+in\\s*\\(([^)]+)\\)`,'gi')))for(const code of strings(check[1]))add('@states',code);
   for(const check of m[0].matchAll(/\bchannel\s+in\s*\(([^)]+)\)/gi))for(const code of strings(check[1]))add('@channels',code);
  }
 }
 for(const m of s.matchAll(/(?:template_id|template_key|template_version)\s*=\s*'([^']+)'/g))add('@templates',m[1]);
 for(const m of s.matchAll(/insert\s+into\s+public\.system_message_templates\([^;]+;/gi)){
  for(const row of m[0].matchAll(/\(\s*'([\w.-]+)'\s*,\s*\d+\s*,\s*'(?:en|hy|ru)'/g))add('@templates',row[1]);
  if(m[0].includes("'telegram.nurse.'||replace(k,'-','_')")){
   const kinds=m[0].match(/from unnest\(array\[([^\]]+)\]\)k/);
   if(kinds)for(const kind of strings(kinds[1]))add('@templates',`telegram.nurse.${kind.replaceAll('-','_')}`);
  }
 }
 // The source/category expressions are the third/fourth SELECT columns in _audit_rows.
 for(const m of s.matchAll(/create(?:\s+or\s+replace)?\s+function public\._audit_rows\([\s\S]+?as\s*\$\$([\s\S]+?)\$\$/gi)){
  for(const select of m[1].split(/union all/i)){
   const fields=args(select.replace(/^\s*select\s+/i,''));
   expression('@categories',fields[2]);expression('@sources',fields[3]);
  }
 }
 if(unresolved.length)throw new Error(`Unresolved audit SQL:\n${unresolved.join('\n')}`);
 return found;
}
export function migrationAuditVocabulary(){
 return auditSqlVocabulary(readdirSync('supabase/migrations').filter(f=>f.endsWith('.sql')).sort().map(f=>readFileSync(`supabase/migrations/${f}`,'utf8')).join('\n'));
}
