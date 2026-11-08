import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as React from 'react';
import * as jsx from 'react/jsx-runtime';
import {renderToStaticMarkup} from 'react-dom/server';
import * as contracts from '@/lib/activity-log/contracts';
import * as labels from '@/lib/activity-log/labels';
import * as locale from '@/lib/locale';
import * as time from '@/lib/clinic-portal/display-time';
import {migrationAuditVocabulary,auditSqlVocabulary} from './audit-sql-vocabulary';
// Every display entry has three real translations; product names are transliterated too.
const {actions:actionCopy,...otherCopy}=labels.auditCopy;
const displayEntries=[
 ...Object.entries(otherCopy).flatMap(([group,items])=>Object.entries(items).map(([code,value])=>[`${group}/${code}`,value]as const)),
 ...Object.entries(actionCopy).flatMap(([source,codes])=>Object.entries(codes).map(([code,value])=>[`${source}/${code}`,value]as const)),
];
for(const [code,value] of displayEntries){
 assert.equal(value.length,3,`${code}: en, hy, ru required`);
 for(const [index,language] of ['en','hy','ru'].entries()){
  assert.ok(value[index]?.trim(),`${code}/${language} is empty`);
  if(language!=='en')assert.doesNotMatch(value[index],/[A-Za-z]/,`${code}/${language}`);
 }
}
for(const category of contracts.auditCategories)for(const language of ['en','hy','ru']as const)assert.ok(labels.auditCategoryName(category,language));
for(const role of ['clinic','clinic_admin','clinic_staff','doctor','nurse','admin','noreon','member','staff']){
 for(const language of ['en','hy','ru']as const){
  assert.ok(Object.hasOwn(labels.auditCopy.roles,role));
  if(language!=='en')assert.doesNotMatch(labels.auditRoleName(`${role}, removed`,language),/[A-Za-z]/);
 }
}
function checkSqlVocabulary(vocabulary:ReturnType<typeof auditSqlVocabulary>){
 for(const [source,codes] of vocabulary)for(const code of codes){
  if(source.startsWith('@')){
   const group=source.slice(1)as 'states'|'templates'|'categories'|'sources'|'roles'|'channels';
   assert.ok(Object.hasOwn(labels.auditCopy[group],code),`Missing ${group} translation: ${code}`);continue;
  }
  assert.ok(Object.hasOwn(labels.auditCopy.actions[source]??{},code),`Missing action: ${source}/${code}`);
  for(const language of ['en','hy','ru']as const){
   const value=labels.actionLabel(source,code,language);
   if(language!=='en')assert.doesNotMatch(value,/[A-Za-z]/,`${source}/${code}/${language}`);
  }
 }
}
// Fail closed rather than accepting the literal half of an ambiguous writer.
const fixture=(statements:string,parameters='c uuid')=>`create function public.fixture(${parameters}) returns void
 language plpgsql as $$ declare event text; begin ${statements} end $$;`;
for(const [name,sql] of [
 ['SELECT INTO overwrites a literal',fixture("event := 'audit-log-view'; select 'new-event' into event; insert into public.clinic_portal_audit(clinic_id,kind) values(c,event);")],
 ['CASE concatenated with a suffix',"insert into public.clinic_portal_audit(clinic_id,kind) values(c,case when x then 'a' else 'b' end || event_suffix);"],
 ['PERFORM uses an overwritten variable',fixture("event := 'audit-log-view'; select 'new-event' into event; perform public._clinic_schedule_audit(c,a,event,'{}');")],
 ['each VALUES row is checked',"insert into public.clinic_portal_audit(clinic_id,kind) values(c,'audit-log-view'),(c,case when x then 'a' else 'b' end || event_suffix);"],
 ['both IF branches write the variable',fixture("if x then event := 'audit-log-view'; else event := 'new-event'; end if; perform public._clinic_schedule_audit(c,a,event,'{}');")],
 ['equals assignment overwrites a literal',fixture("event := 'audit-log-view'; event = 'new-event'; perform public._clinic_schedule_audit(c,a,event,'{}');")],
 ['FOR target overwrites a literal',fixture("event := 'audit-log-view'; for event in select kind from events loop perform public._clinic_schedule_audit(c,a,event,'{}'); end loop;")],
 ['FOREACH target overwrites a literal',fixture("event := 'audit-log-view'; foreach event in array events loop perform public._clinic_schedule_audit(c,a,event,'{}'); end loop;")],
 ['a qualified target overwrites a literal',fixture("event := 'audit-log-view'; select 'new-event' into strict scope . event; perform public._clinic_schedule_audit(c,a,event,'{}');")],
 ['a parameter already has an unknown write',fixture("event := 'audit-log-view'; perform public._clinic_schedule_audit(c,a,event,'{}');",'c uuid,event text')],
 ['a literal SELECT INTO is unsupported',fixture("select 'audit-log-view' into event; perform public._clinic_schedule_audit(c,a,event,'{}');")],
 ['an initializer is another write',"create function public.fixture() returns void language plpgsql as $$ declare event text := 'new-event'; begin event := 'audit-log-view'; perform public._clinic_schedule_audit(c,a,event,'{}'); end $$;"],
 ['a typed DEFAULT is another write',"create function public.fixture() returns void language plpgsql as $$ declare event public.event_type default 'new-event'; begin event := 'audit-log-view'; perform public._clinic_schedule_audit(c,a,event,'{}'); end $$;"],
 ['a query equality is not a write',fixture("perform 1 from events where event = 'audit-log-view'; perform public._clinic_schedule_audit(c,a,event,'{}');")],
 ['an alias binds a parameter',"create function public.fixture(text) returns void language plpgsql as $$ declare event alias for $1; begin event := 'audit-log-view'; perform public._clinic_schedule_audit(c,a,event,'{}'); end $$;"],
 ['a shadowed variable is unknown',"create function public.fixture() returns void language plpgsql as $$ declare event text; begin declare event text; begin event := 'audit-log-view'; end; perform public._clinic_schedule_audit(c,a,event,'{}'); end $$;"],
 ['a guarded parameter is still unknown',fixture("if event not in ('audit-log-view') then raise exception 'invalid'; end if; perform public._clinic_schedule_audit(c,a,event,'{}');",'c uuid,event text')],
 ...['format(\'%s\',\'audit-log-view\')',"coalesce('audit-log-view',event)","'audit-log-' || event",'build_event()',"case when x then event else 'audit-log-view' end"].map(value=>[value,`perform public._clinic_schedule_audit(c,a,${value},'{}');`]),
])assert.throws(()=>auditSqlVocabulary(sql),/Unresolved audit SQL/,name);
for(const [sql,want] of [
 [fixture("event := 'audit-log-view'; perform public._clinic_schedule_audit(c,a,event,'{}');"),['audit-log-view']],
 [fixture("event = 'audit-log-view'; insert into public.clinic_portal_audit(clinic_id,kind) values(c,event);"),['audit-log-view']],
 ["create function public.fixture() returns void language plpgsql as $$ declare event text := 'audit-log-view'; begin perform public._clinic_schedule_audit(c,a,event,'{}'); end $$;",['audit-log-view']],
 ["create function public.fixture() returns void language plpgsql as $$ declare event text default 'audit-log-view'; begin perform public._clinic_schedule_audit(c,a,event,'{}'); end $$;",['audit-log-view']],
 ["perform public._clinic_schedule_audit(c,a,case when x then 'a' when y then 'b' else 'c' end,'{}');",['a','b','c']],
 ["insert into public.clinic_portal_audit(clinic_id,kind) values(c,'audit-log-view'),(c,'new-event');",['audit-log-view','new-event']],
]as const)assert.deepEqual([...auditSqlVocabulary(sql).get('clinic')!],want);
assert.throws(()=>auditSqlVocabulary(fixture("if x then event := 'audit-log-view'; else event := 'new-event'; end if; perform public._clinic_schedule_audit(c,a,event,'{}');")),error=>
 error instanceof Error&&/Unresolved audit SQL/.test(error.message)&&error.message.includes("'audit-log-view'")&&error.message.includes("'new-event'"),'Both conflicting writes appear in the diagnostic');
checkSqlVocabulary(migrationAuditVocabulary());
const directMigration=readdirSync('supabase/migrations').find(name=>name.endsWith('_test_signin_provider_independent.sql'));
assert.ok(directMigration,'Provider-independent test sign-in migration exists, including after the integrator stamps it');
assert.throws(()=>auditSqlVocabulary(readFileSync(`supabase/migrations/${directMigration}`,'utf8')
 .replace("then 'wrong_code'end","then 'untranslated-refusal'end")),/Unresolved audit SQL/,'A change to the follow-up test refusal vocabulary invalidates its exact function pin');
// A new event in a new SQL writer must fail until its display copy is added.
for(const sql of [
 "insert into public.clinic_portal_audit(clinic_id,kind)values(c,'new-event');",
 "insert into public.clinic_portal_audit(clinic_id,kind)values(c,'audit-log-view'),(c,'new-event');",
 "select public._clinic_schedule_audit(c,a,'new-event',jsonb_build_object('memberId',m));",
 "insert into public.clinic_portal_audit(clinic_id,kind)select c,case when ok then 'new-event' else 'audit-log-view' end;",
 "insert into public.clinic_portal_audit(clinic_id,kind) select id,'new-event' from public.workspace_clinics;",
 "select public._clinic_schedule_audit (c,a,'new-event','{}');",
 `INSERT INTO "public" . "clinic_portal_audit" ("clinic_id", "kind")
 SELECT id, 'new-event'::text FROM public.workspace_clinics;`,
 `create function public.fixture() returns void language plpgsql as $$ begin
 perform "public" . "_clinic_schedule_audit"\n(c,a,'new-event','{}'); end $$;`,
 "insert /* writer */ into clinic_portal_audit (kind,clinic_id) values ('audit-log-view',c),('new-event',c);",
 "select coalesce(public._clinic_schedule_audit (c,a,'new-event','{}'),null);",
 "insert into public.clinic_portal_audit(clinic_id,kind) select c,case when ok then'new-event'else 'audit-log-view'end from public.workspace_clinics;",
 `create function public.fixture() returns void language plpgsql as $body$ begin
 event := 'new-event'; perform public._clinic_schedule_audit(c,a,event,'{}'); end $body$;`,
 `create function public._clinic_schedule_audit(c uuid,a uuid,d jsonb) returns void language plpgsql as $$
 declare kind text:='new-event'; begin insert into public.clinic_portal_audit(clinic_id,kind) values(c,kind); end $$;`,
])assert.throws(()=>checkSqlVocabulary(auditSqlVocabulary(sql)),/Missing action: clinic\/new-event/);
// Unsupported expressions and dynamic SQL must block the check, even when a
// neighbouring branch or statement has a translated event.
for(const sql of [
 "insert into public.clinic_portal_audit(clinic_id,kind) select id,event_kind from public.workspace_clinics;",
 "insert into public.clinic_portal_audit values(c,'new-event');",
 "perform public._clinic_schedule_audit(c,a,build_event(),'{}');",
 "insert into public.clinic_portal_audit(clinic_id,kind) values(c,case when ok then 'audit-log-view' else unknown_event end);",
 `do $$ begin execute format('insert into public.%I (clinic_id,kind) values ($1,$2)', 'clinic_portal_' || 'audit') using c,'new-event'; end $$;`,
 `do $$ begin execute format('select public.%I ($1,$2,$3,$4)', '_clinic_schedule_' || 'audit') using c,a,'new-event','{}'; end $$;`,
 `do $$ begin execute format ('insert into public.%I (kind) values (%L)', table_name, event_kind); end $$;`,
 "update public.clinic_portal_audit set kind=event_kind;",
 "update only public.clinic_portal_audit set kind=event_kind;",
 "insert into public.clinic_portal_audit(clinic_id,kind) select c,'audit-log-view' union all select c,event_kind;",
 "insert into public.clinic_portal_audit(clinic_id,kind) select id,'audit-log-view' from public.workspace_clinics union all select c,event_kind;",
 "insert into public.clinic_portal_audit(clinic_id,kind) values(c,'audit-log-view') on conflict (clinic_id) do update set kind=event_kind;",
 "insert into only public.clinic_portal_audit values(c,event_kind);",
 "select public._system_message_audit(c,unknown_state);",
 "perform public._test_signin_audit(c,p,'requested',unknown_outcome);",
 "merge into public.clinic_portal_audit using events on false when not matched then insert (kind) values(event_kind);",
 `do $$ begin execute format(E'insert into public.%I (kind) values (%L)', table_name, event_kind); end $$;`,
 `do $$ begin execute format('%s into public.%I (kind) values (%L)', 'insert', table_name, event_kind); end $$;`,
 `do $$ begin execute unknown_sql; end $$;`,
 `create function public._clinic_schedule_audit(c uuid,a uuid,kind text,d jsonb) returns void language plpgsql as $$ begin
 kind:=build_event(); insert into public.clinic_portal_audit(clinic_id,kind) values(c,kind); end $$;`,
 `create function public._clinic_schedule_audit(c uuid,a uuid,kind text,d jsonb) returns void language plpgsql as $$ begin
 kind:='new-event'; insert into public.clinic_portal_audit(clinic_id,kind) values(c,kind); end $$;`,
 `create function public._clinic_schedule_audit(c uuid,a uuid,kind text,d jsonb) returns void language plpgsql as $$ begin
 select 'new-event' into kind; insert into public.clinic_portal_audit(clinic_id,kind) values(c,kind); end $$;`,
 `create function public.fixture(event text) returns void language plpgsql as $$ begin
 if event='audit-log-view' then null; end if;
 perform public._clinic_schedule_audit(c,a,event,'{}'); end $$;`,
])assert.throws(()=>checkSqlVocabulary(auditSqlVocabulary(sql)),/Unresolved audit SQL/);
assert.doesNotThrow(()=>auditSqlVocabulary(`-- insert into public.clinic_portal_audit values(c,unknown);
 select 'insert into public.clinic_portal_audit values(c,unknown)';`));
// A historical schema-patch exemption cannot cover SQL appended after its block.
assert.throws(()=>auditSqlVocabulary(readFileSync('supabase/migrations/20261104171500_care_alert_close_needs_a_person.sql','utf8')+'\nexecute unknown_sql;'),/Unresolved audit SQL/);
// Resolve's exact definition patch journals an existing event. Its literal writer
// must stay visible, and neither a changed block nor appended SQL inherits the pin.
const resolvePrefillSql=readFileSync('supabase/migrations/20261104181100_urgent_resolve_prefill.sql','utf8');
assert.deepEqual([...auditSqlVocabulary(resolvePrefillSql).get('care_alert')!],['acknowledged']);
assert.throws(()=>auditSqlVocabulary(resolvePrefillSql.replace("'acknowledged',jsonb_build_object", "'new-event',jsonb_build_object")),/Unresolved audit SQL/);
assert.throws(()=>auditSqlVocabulary(resolvePrefillSql.replace("'via','resolve'", "'via','changed'")),/Unresolved audit SQL/);
assert.throws(()=>auditSqlVocabulary(resolvePrefillSql+'\nexecute unknown_sql;'),/Unresolved audit SQL/);
// Each legacy pin covers one unchanged block, never a similarly named writer
// or a modified version of it. Both literals of a multi-write are still visible.
assert.throws(()=>auditSqlVocabulary(readFileSync('supabase/migrations/20261012162648_real_clinical_publication.sql','utf8')
 .replace("kind:='report-approved'","kind:='new-event'")),/Unresolved audit SQL/);
assert.throws(()=>auditSqlVocabulary(readFileSync('supabase/migrations/20261104175100_clinic_profile_edits_direct.sql','utf8')
 .replace("event:=case when p_backfill", "event:=case when not p_backfill")),/Unresolved audit SQL/);
assert.throws(()=>auditSqlVocabulary(fixture("if event not in ('audit-log-view','new-event') then raise exception 'invalid'; end if; perform public._clinic_schedule_audit(c,a,event,'{}');",'c uuid,event text')
 .replace('public.fixture','public.command_patient_test_request')),/Unresolved audit SQL/);
for(const [file,before,after] of [
 ['20261016000442_booking_email_appointments.sql',"p_outcome not in('accepted','failed','unknown')","p_outcome not in('accepted','failed','unknown','new-event')"],
 ['20261016054000_clinic_portal_persistence.sql',"'reserve-upload'then keys:=","'new-event'then keys:="],
 ['20261016061000_clinic_admin_memberships.sql',"'revoke'then keys:=","'new-event'then keys:="],
])assert.throws(()=>auditSqlVocabulary(readFileSync(`supabase/migrations/${file}`,'utf8').replace(before,after)),/legacy vocabulary dependency changed/);
assert.equal(labels.actionLabel('clinic','change_requests_listed','ru'),'Открыт список запросов изменений');
for(const [language,other] of [['en','Other action'],['hy','Այլ գործողություն'],['ru','Другое действие']]as const){
 assert.equal(labels.actionLabel('clinic','future.code',language),`${other} (future.code)`);
 assert.equal(labels.actionLabel('future_source','Raw English sentence',language),other);
 assert.equal(labels.actionLabel('clinic','constructor',language),`${other} (constructor)`);
 if(language!=='en'){assert.doesNotMatch(labels.auditRoleName('unknown_role',language),/[A-Za-z]/);assert.doesNotMatch(labels.sourceLabel('unknown_source',language),/[A-Za-z]/);}
 assert.equal(labels.actionLabel('system_message','telegram:unknown.template:sent',language),`${other} (telegram:unknown.template:sent)`);
}
const id='ac000000-0000-4000-8000-000000000001',clinic='ac000000-0000-4000-8000-000000000002';
const row={key:'access:1',at:'2026-11-05T10:00:00Z',category:'record_access',source:'access',action:'clinic_member_reveal',actorId:id,actorName:'Clinic admin',actorRole:'clinic_admin',memberId:id,memberName:'Member fixture',ref:'object-id'} satisfies contracts.AuditRow;
for(const [language,want] of [['en',"Opened the member's record"],['hy','Բացել է անդամի քարտը'],['ru','Открыта карта участника']]as const){
 for(const source of ['access','document_open'])assert.equal(labels.actionLabel(source,'member_record',language),want);
}
assert.equal(labels.actionLabel('access','future_code'),'Other action (future_code)','Unknown codes use neutral copy');
assert.equal(labels.actionLabel('clinic','member-file-opened'),'Opened the member file','Clinic portal labels stay specific');
const profileChange={name:{before:'Previous fictional name',after:'Corrected fictional name'},birthDate:{beforeYear:1975,afterYear:1975}};
const fullProfileChange={...profileChange,birthDate:{...profileChange.birthDate,before:'1975-04-05',after:'1975-06-07'}};
const profileRow={...row,category:'care_change' as const,source:'clinic',action:'profile_updated',profileChange};
assert.equal(contracts.auditRowSchema.safeParse(profileRow).success,true);
assert.equal(contracts.clinicAuditPageSchema.safeParse({ok:true,rows:[profileRow],next:null}).success,true);
assert.equal(contracts.clinicAuditPageSchema.safeParse({ok:true,rows:[{...profileRow,profileChange:fullProfileChange}],next:null}).success,false,'Full historical DOB cannot cross the clinic audit boundary');
assert.equal(contracts.auditRowSchema.safeParse({...profileRow,profileChange:fullProfileChange}).success,true);
for(const language of ['en','hy','ru']as const){
 assert.equal(labels.profileChangeLines(profileChange,language).length,2);
 assert.ok(labels.profileChangeLines(fullProfileChange,language).join(' ').includes('1975-04-05'));
 assert.notEqual(labels.actionLabel('clinic','profile_updated',language),'profile updated');
}
const noreonRow={...row,action:'member_record',actorId:null,actorName:'Noreon',actorRole:'noreon'};
assert.equal(contracts.activityPageSchema.parse({ok:true,rows:[noreonRow],next:null}).rows[0].actorRole,'noreon','Deployed string contract accepts masked actors');
const maskedPage=contracts.clinicAuditPageSchema.parse({ok:true,rows:[noreonRow],next:null});
assert.ok('rows'in maskedPage);
assert.equal(maskedPage.rows[0].actorId,null,'Clinic contract accepts masked actor IDs');
// A missing new category must fail both the incoming contract and the outgoing filter.
for(const category of ['sign_in','record_access','alert_change','outbound_message','permission_change','care_change','admin_change','export']){
 assert.equal(contracts.auditPageSchema.parse({ok:true,rows:[{...row,category}],next:null}).rows[0].category,category);
 assert.equal(contracts.parseFilters({category}).category,category);
}
assert.equal(contracts.activityPageSchema.safeParse({ok:true,rows:[{...row,category:'alert_change'}],next:null}).success,false,'old contract stays on five categories');
assert.equal(contracts.clinicAuditPageSchema.safeParse({ok:true,rows:[{...row,category:'admin_change'}],next:null}).success,false);
assert.deepEqual(contracts.clinicAuditPageSchema.parse({status:'disabled'}),{status:'disabled'});
assert.equal(contracts.auditPageSchema.safeParse({ok:true,rows:[{...row,message:'secret'}],next:null}).success,false,'unexpected content is refused');
const csv=contracts.toCsv([{...row,category:'outbound_message',actorName:'=FORMULA("x")',memberName:'Name "Quoted"',ref:'@formula',action:'telegram:care_alert.staff_notice:sent'} as contracts.AuditRow]);
assert.ok(csv.includes('"outbound_message"')&&csv.includes('"telegram:care_alert.staff_notice:sent"'));
assert.ok(csv.includes('"\'=FORMULA(""x"")"')&&csv.includes('"Name ""Quoted"""')&&csv.includes('"\'@formula"'));
assert.ok(csv.endsWith('\r\n'));
assert.equal(csv.split('\r\n')[0],'time_utc,category,source,action,actor_id,actor_name,actor_role,member_id,member_name,reference,profile_change');
assert.ok(contracts.toCsv([{...profileRow,profileChange:fullProfileChange}]).includes('1975-04-05'),'Audit export retains scoped old/new values');

let response:unknown={ok:true,rows:[row],next:null},people:unknown={ok:true,people:[{id,name:'Clinic admin',role:'clinic_admin'}]},capability='clinic_admin',rpcError=false;
const calls:{name:string;args?:Record<string,unknown>}[]=[];
const rpc={rpc:async(name:string,args?:Record<string,unknown>)=>{calls.push({name,args});return{data:name.endsWith('people')?people:response,error:rpcError?{code:'unavailable'}:null};}};
const modules:Record<string,unknown>={
 '@/lib/clinic-portal/locale-actions':{setClinicLocale:async()=>{}},
 'react/jsx-runtime':jsx,'next/link':{default:({children,...props}:Record<string,unknown>)=>React.createElement('a',props,children as React.ReactNode)},
 'next/navigation':{redirect:()=>{throw Error('redirect');},unstable_rethrow:()=>{}},
 '@/lib/clinic-portal/locale':{clinicLocale:async(value:unknown)=>locale.parseLocale(value,'en')},
 '@/lib/locale':locale,'@/lib/activity-log/contracts':contracts,'@/lib/activity-log/labels':labels,'@/lib/clinic-portal/display-time':time,
 '@/lib/clinic-portal/identity':{requireClinicPortal:async()=>({rpc,identity:{clinicId:clinic,capability}})},
 '@/components/clinic-portal/shell':{ClinicShell:({children}:React.PropsWithChildren)=>React.createElement('main',null,children)},
 '@/lib/observability/with-logging':{withRouteLogging:(fn:unknown)=>fn},
};
function load(file:string){
 const exports:Record<string, (...args:never[])=>unknown>={};
 const compiled=ts.transpileModule(readFileSync(file,'utf8'),{fileName:file,reportDiagnostics:true,compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}});
 const syntaxErrors=compiled.diagnostics?.filter(d=>d.category===ts.DiagnosticCategory.Error)??[];
 assert.equal(syntaxErrors.length,0,`Invalid syntax in ${file}: ${syntaxErrors.map(d=>ts.flattenDiagnosticMessageText(d.messageText,' ')).join('; ')}`);
 const code=compiled.outputText;
 vm.runInNewContext(code,{exports,URL,Response,Date,require:(name:string)=>{assert.ok(name in modules,`Unknown dependency ${name}`);return modules[name];}});
 return exports;
}
const page=load('app/clinic/real/audit/page.tsx').default as unknown as (props:{searchParams:Promise<Record<string,string>>})=>Promise<React.ReactElement>;
const render=async(query:Record<string,string>={})=>renderToStaticMarkup(await page({searchParams:Promise.resolve(query)}));
let html=await render({clinic,category:'record_access'});
assert.ok(html.includes('Member fixture')&&html.includes('Clinic admin')&&html.includes('object-id')&&html.includes('Revealed member contact details'));
assert.ok(html.includes('Only this person')&&html.includes(`actor=${id}`));
assert.ok(html.includes('/clinic/real/audit/export?')&&html.includes(`clinic=${clinic}`)&&html.includes('locale=en'));
assert.ok(!html.includes('<option value="admin_change"'));
assert.ok(calls.some(c=>c.name==='clinic_audit_log'&&c.args?.p_clinic===clinic&&c.args?.p_category==='record_access'&&c.args?.p_from&&c.args?.p_profile_values===true));
// Full identifiers remain in attributes and exports, never in visible row text.
for(const language of ['en','hy','ru']){
 const reference='bb4e6995-bc2a-45a7-836d-ad4ee0f67226';
 const unnamed={...row,memberName:null,ref:reference};
 response={ok:true,rows:[unnamed],next:null};
 html=await render({locale:language});
 const visible=html.replace(/<[^>]*>/g,'');
 assert.ok(visible.includes('bb4e6995')&&visible.includes(id.slice(0,8)),'Short references are visible');
 assert.doesNotMatch(visible,/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i,'No full UUID in visible audit rows');
 assert.ok(html.includes(`title="${reference}"`)&&html.includes(`title="${id}"`),'Full IDs remain in titles');
 assert.ok(contracts.toCsv([unnamed]).includes(reference),'CSV retains the full reference');
}
response={ok:true,rows:[profileRow],next:null};
for(const language of ['en','hy','ru']){
 html=await render({locale:language});
 assert.ok(html.includes('Previous fictional name')&&html.includes('Corrected fictional name')&&html.includes('1975'));
 assert.ok(!html.includes('1975-04-05'));
}
response={ok:true,rows:[noreonRow],next:null};html=await render();
assert.ok(html.includes('Noreon')&&html.includes('Opened the member&#x27;s record'));
assert.ok(!html.includes('Only this person')&&!html.includes(`actor=${id}`),'Masked actor has no person filter link');
response={ok:true,rows:[],next:null};html=await render();assert.ok(html.includes('Nothing recorded for these filters.'));
response={status:'disabled'};people={status:'disabled'};html=await render();assert.ok(html.includes('The audit log is not switched on yet.')&&!html.includes('/audit/export?'));
response={status:'refused'};people={status:'refused'};html=await render();assert.ok(html.includes('The audit log could not load. Try again.'));
response={ok:true,rows:[{...row,category:'admin_change'}],next:null};people={ok:true,people:[]};html=await render();assert.ok(html.includes('The audit log could not load. Try again.'));
rpcError=true;html=await render();assert.ok(html.includes('The audit log could not load. Try again.'));rpcError=false;
response={ok:true,rows:[row],next:null};html=await render({locale:'hy'});assert.ok(html.includes('Գործողությունների մատյան')&&html.includes('Բացել է անդամի կոնտակտային տվյալները'));html=await render({locale:'ru'});assert.ok(html.includes('Журнал действий')&&html.includes('Открыты контактные данные участника'));
for(const source of ['telegram_auth_message','conversation_delivery','patient_message_attempt','patient_message_delivery','telegram_nurse_outbox','member_push_delivery','system_message','zoe_chat_card_send','system_message_audit','booking_notice']){
 assert.ok(!labels.actionLabel(source,'telegram:care_alert.staff_notice:sent','ru').includes(source));
 assert.ok(labels.actionLabel(source,'telegram:care_alert.staff_notice:sent','ru').includes('отправлено'));
 assert.ok(labels.actionLabel(source,'telegram:care_alert.staff_notice:sent','hy').includes('ուղարկված'));
}
// Render the actual page component with every known action and role. Names are
// fixture data in the selected language, so English prose cannot hide in rows.
const displayRows=Object.entries(labels.auditCopy.actions).flatMap(([source,actions])=>Object.keys(actions).map(action=>({...row,key:`${source}:${action}`,category:'care_change',source,action,ref:null})));
for(const language of ['hy','ru']as const){
 const name=language==='hy'?'Աննա':'Анна';
 response={ok:true,rows:displayRows.map((r,i)=>({...r,actorName:name,memberName:name,actorRole:Object.keys(labels.auditCopy.roles)[i%Object.keys(labels.auditCopy.roles).length]})),next:null};
 people={ok:true,people:Object.keys(labels.auditCopy.roles).flatMap(role=>[role,`${role}, removed`]).map((role,i)=>({id:`role-${i}`,name,role}))};
 html=await render({locale:language});
 for(const match of html.matchAll(/<(li|option)\b[^>]*>([\s\S]*?)<\/\1>/g)){
  const visible=match[2].replace(/<[^>]*>/g,'').replace(/&#[^;]+;|&[a-z]+;/g,'');
  assert.doesNotMatch(visible,/[A-Za-z]/,`${language} row/filter leaked English: ${visible}`);
 }
 for(const category of contracts.clinicAuditCategories)assert.ok(html.includes(labels.auditCategoryName(category,language)));
 assert.ok(html.includes(labels.auditRoleName('clinic_admin',language))&&html.includes(labels.auditRoleName('nurse, removed',language)));
 response={ok:true,rows:[],next:null};html=await render({locale:language});assert.ok(html.includes(language==='hy'?'Այս զտիչներով գրառումներ չկան։':'Для этих фильтров записей нет.'));
 response={status:'disabled'};html=await render({locale:language});assert.ok(html.includes(language==='hy'?'Գործողությունների մատյանը դեռ միացված չէ։':'Журнал действий пока не включён.'));
 response={status:'refused'};html=await render({locale:language});assert.ok(html.includes(language==='hy'?'Գործողությունների մատյանը չհաջողվեց բեռնել։':'Не удалось загрузить журнал действий.'));
}
for(const source of ['telegram_auth_message','conversation_delivery','patient_message_attempt','patient_message_delivery','telegram_nurse_outbox','member_push_delivery','system_message','zoe_chat_card_send','system_message_audit','booking_notice']){
 for(const template of Object.keys(labels.auditCopy.templates))for(const state of Object.keys(labels.auditCopy.states)){
  const action=`telegram:${template}:${state}`;
  for(const language of ['hy','ru']as const)assert.doesNotMatch(labels.actionLabel(source,action,language),/[A-Za-z]/,`${source}/${action}/${language}`);
 }
}
capability='clinic_staff';await assert.rejects(()=>render(),/redirect/);capability='clinic_admin';
const get=load('app/clinic/real/audit/export/route.ts').GET as unknown as (request:Request)=>Promise<Response>;
response={ok:true,rows:[row],next:null};let result=await get(new Request(`http://local/clinic/real/audit/export?clinic=${clinic}`));
assert.equal(await result.clone().text(),contracts.toCsv([row]));
for(const language of ['hy','ru']){const localized=await get(new Request(`http://local/clinic/real/audit/export?clinic=${clinic}&locale=${language}`));assert.equal(await localized.text(),contracts.toCsv([row]),'CSV is locale-independent');}
const fullRefRow={...row,ref:'bb4e6995-bc2a-45a7-836d-ad4ee0f67226'};
response={ok:true,rows:[fullRefRow],next:null};
assert.equal(await (await get(new Request(`http://local/clinic/real/audit/export?clinic=${clinic}`))).text(),contracts.toCsv([fullRefRow]),'CSV route retains the full UUID');
assert.equal(result.status,200);assert.match(result.headers.get('Content-Type')??'',/text\/csv/);assert.ok((await result.text()).includes('object-id'));assert.equal(calls.at(-1)?.name,'clinic_audit_log_export');assert.equal(calls.at(-1)?.args?.p_profile_values,true);
response={ok:true,rows:[noreonRow],next:null};result=await get(new Request(`http://local/clinic/real/audit/export?clinic=${clinic}`));
assert.equal(result.status,200);const maskedCsv=await result.text();
assert.ok(maskedCsv.includes('"Noreon","noreon"')&&maskedCsv.includes('"member_record"'));
assert.ok(maskedCsv.includes('"member_record","","Noreon","noreon"'),'Masked actor_id is empty in CSV');
response={status:'refused'};result=await get(new Request(`http://local/clinic/real/audit/export?clinic=${clinic}&actor=${id}`));assert.equal(result.status,403);
response={ok:true,rows:[row],next:'2026-11-05T10:00:00Z|access:1'};result=await get(new Request(`http://local/clinic/real/audit/export?clinic=${clinic}`));assert.equal(result.status,400);assert.match(await result.text(),/narrow|shorter/i);
response={status:'disabled'};result=await get(new Request(`http://local/clinic/real/audit/export?clinic=${clinic}`));assert.equal(result.status,403);
capability='clinic_staff';const before=calls.length;result=await get(new Request(`http://local/clinic/real/audit/export?clinic=${clinic}`));assert.equal(result.status,403);assert.equal(calls.length,before);capability='clinic_admin';

// Render the actual navigation. Removing its audit mapping breaks the admin link.
modules['next/navigation']={usePathname:()=>'/clinic/real/audit'};
modules['lucide-react']=await import('lucide-react');
modules['@/components/app-shell/sidebar-nav']={SidebarNav:({links}: {links:{label:string;href:string}[]})=>React.createElement('nav',null,links.map(l=>React.createElement('a',{href:l.href,key:l.href},l.label)))};
const nav=load('components/clinic-portal/navigation.tsx').ClinicNavigation as unknown as React.ComponentType<{items:string[];clinicId:string;locale:string}>;
html=renderToStaticMarkup(React.createElement(nav,{items:['audit'],clinicId:clinic,locale:'en'}));assert.ok(html.includes('Audit log')&&html.includes('/clinic/real/audit?'));
console.log('Audit log contracts, clinic page branches, export boundaries and navigation: ok (RPC IO mocked).');
