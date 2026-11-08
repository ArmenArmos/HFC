// Replays the go-live environment seed (scripts/seed-environment.sql, then seed-environment-ai.sql)
// on the freshly reset CI database, inside transactions that always roll back, and pins the result:
// every settings row at its day-one value, a second run changes nothing, no STAGING or unsigned
// template can be approved, the test bot and a staging policy id are refused, real AI calls wait
// for the evals, and every settings table in the schema is covered (a new one fails here until
// the seed decides its row).
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';

const container=process.env.NOREON_TEST_DB_CONTAINER;
assert.ok(container?.startsWith('supabase_db_'),'Set NOREON_TEST_DB_CONTAINER to a local Supabase database container');

// The files carry their own begin/commit for the real run; here they run inside a rolled-back
// transaction, so exactly one of each is removed.
const body=(path:string)=>{
 const text=readFileSync(path,'utf8');
 assert.equal(text.match(/^begin;$/gm)?.length,1,`${path}: one begin;`);
 assert.equal(text.match(/^commit;$/gm)?.length,1,`${path}: one commit;`);
 return text.replace(/^begin;$/m,'').replace(/^commit;$/m,'');
};
const seed=body('scripts/seed-environment.sql');
const ai=body('scripts/seed-environment-ai.sql');
const v3=body('scripts/seed-environment-v3.sql');
const vars=(o:Record<string,string>={})=>Object.entries({telegram_account:'noreon_bot',telegram_bot_id:'7000000001',conversation_policy_version:'go-live-1',...o})
 .map(([k,v])=>`\\set ${k} '${v}'`).join('\n');
const psql=(sql:string)=>spawnSync('docker',['exec','-i',container!,'psql','-U','postgres','-X','-q','-t','-A','-v','ON_ERROR_STOP=1'],{input:sql,encoding:'utf8',maxBuffer:8*1024*1024});
const run=(sql:string)=>{const r=psql(`${sql}\nrollback;\n`);assert.equal(r.status,0,`psql failed:\n${r.stderr}`);return r;};
const refused=(sql:string,pattern:RegExp,what:string)=>{
 const r=psql(`${sql}\nrollback;\n`);
 assert.notEqual(r.status,0,`${what}: expected a refusal`);
 assert.match(r.stderr,pattern,`${what}: wrong refusal:\n${r.stderr}`);
};

const tables=['telegram_channel_settings','conversation_policy','clinic_portal_capabilities','zoe_settings','care_alert_settings',
 'staff_message_notice_settings','member_callback_settings','member_safety_settings','clinic_scheduling_capabilities',
 'lab_ai_capabilities','doctor_completion_capabilities','home_visit_settings','member_notice_settings','gp_report_capabilities',
 'programme_settings','bp_week_settings','bp_weekly_summary_settings','member_medicine_settings','admin_oversight_settings','ai_plan_capabilities',
 'nurse_visit_settings','nurse_chat_settings','telegram_nurse_settings','member_first_note_settings','ldl_goal_settings','staff_zoe_settings','multi_medicine_capabilities','doctor_telegram_settings'];
// One JSON line: every settings row without its timestamps, plus the approved template count.
const snapshot=`select 'SNAP '||jsonb_build_object(${tables.map(t=>`'${t}',(select jsonb_agg(to_jsonb(x)-'updated_at') from public.${t} x)`).join(',')},
 'approved_templates',(select count(*) from public.system_message_templates where approved),
 'staff_telegram_policy_rows',(select count(*) from public.staff_telegram_policy))::text;`;
const snaps=(out:string)=>out.split('\n').filter(l=>l.startsWith('SNAP ')).map(l=>JSON.parse(l.slice(5)));

// 1. The day-one values, and a second run changes nothing.
const first=run(`${vars()}\nbegin;\n${seed}\n${snapshot}\n${seed}\n${snapshot}`);
const [a,b]=snaps(first.stdout);
assert.deepEqual(b,a,'A second run of the seed changes nothing');
const row=(t:string)=>{assert.equal(a[t]?.length,1,`${t}: exactly one row`);return a[t][0];};
const expect:Record<string,Record<string,unknown>>={
 telegram_channel_settings:{account:'noreon_bot',bot_id:7000000001,link_token_seconds:600,consent_version:'telegram-replies-draft-1'},
 conversation_policy:{version:'go-live-1',grant_seconds:3600,intent_seconds:600,intake_window_seconds:60,intake_max_messages:50,
  synthetic_engine:false,delivery_enabled:true,app_chat_enabled:false},
 clinic_portal_capabilities:{storage_enabled:true,result_attach_enabled:false,clinic_admin_full_access:false},
 zoe_settings:{consent_collection_enabled:true,consent_wording_version:'zoe-consent-draft-3',consent_wording_also_valid:['zoe-consent-draft-2'],
  daily_spend_cap_usd:10,staging_ai_mode:true,model_calls_allowed:false,direct_answers_enabled:false,
  conversational_replies_enabled:false,symptom_intake_enabled:false,health_answers_enabled:false,coach_enabled:false},
 care_alert_settings:{enabled:false,telegram_delivery:false,sandbox_test_accounts:false},
 staff_message_notice_settings:{enabled:true},
 member_callback_settings:{enabled:false},
 member_safety_settings:{enabled:false},
 clinic_scheduling_capabilities:{enabled:false},
 lab_ai_capabilities:{enabled:false,member_upload_enabled:false,member_upload_doctor_approval:true},
 doctor_completion_capabilities:{enabled:false},
 doctor_telegram_settings:{enabled:false},
 home_visit_settings:{telegram_notice:false,auto_close:false},
 member_notice_settings:{booking:false,reminders:false,results:false,care:false},
 gp_report_capabilities:{enabled:false},
 programme_settings:{enabled:false},
 bp_week_settings:{enabled:false,reminders:false,member_can_start:false},
 bp_weekly_summary_settings:{enabled:false},
 member_medicine_settings:{enabled:false,reminders:false,asks:false},
 admin_oversight_settings:{admin_conversation_read_enabled:false},
 ai_plan_capabilities:{enabled:false},
 nurse_visit_settings:{enabled:false},
 nurse_chat_settings:{enabled:false},
 telegram_nurse_settings:{enabled:false},
 member_first_note_settings:{enabled:false},
 ldl_goal_settings:{ldl_goal_enabled:false,ldl_response_enabled:false,lipid_planner_enabled:false},
 staff_zoe_settings:{staff_zoe_enabled:false},
 multi_medicine_capabilities:{enabled:false},
};
assert.deepEqual(Object.keys(expect).sort(),[...tables].sort(),'Every seeded table has expected values here');
const seedText=readFileSync('scripts/seed-environment.sql','utf8');
for(const t of tables)assert.match(seedText,new RegExp(`^insert into public\\.${t}\\(`,'m'),`The seed writes ${t} itself, not relying on a migration default`);
for(const [t,cols] of Object.entries(expect))for(const [c,v] of Object.entries(cols))
 assert.deepEqual(row(t)[c],v,`${t}.${c}`);
assert.equal(a.approved_templates,0,'No template is approved by the seed (no signed copy yet, never STAGING)');
assert.equal(a.staff_telegram_policy_rows,0,'Staff Telegram second step is left to runbook E5');
assert.match(first.stderr,/stay silent: .*telegram\.share_contact/,'The seed lists the templates that stay silent');

// 2. The consent versions are the ones the app shows (a mismatch makes the consent cards inert).
const constant=(file:string,name:string)=>new RegExp(`export const ${name}\\s*=\\s*['"]([^'"]+)['"]`).exec(readFileSync(file,'utf8'))?.[1];
assert.equal(row('zoe_settings').consent_wording_version,constant('lib/zoe/member.ts','ZOE_CONSENT_VERSION'),'Zoe consent version equals the code');
assert.equal(row('telegram_channel_settings').consent_version,constant('lib/telegram-runtime/member.ts','TELEGRAM_CONSENT_VERSION'),'Telegram consent version equals the code');

// 3. Every settings table in the schema is seeded, except the one runbook E5 inserts
// and test_signin_settings: test sign-in must stay off and its allowlist empty before real members.
const schema=run(`select 'TABLES '||string_agg(table_name,',' order by table_name) from information_schema.columns
 where table_schema='public' and column_name='singleton' and table_name not in('staff_telegram_policy','test_signin_settings');`);
const inSchema=/TABLES (.*)/.exec(schema.stdout)?.[1]?.split(',')??[];
assert.deepEqual(inSchema,[...tables].sort(),'Every public settings singleton is in the go-live seed (or explicitly left out)');

// 4. Refusals: an approved STAGING or unsigned template, the test bot, a staging policy id.
const staging=`insert into public.system_message_templates(template_id,version,locale,body,approved,approval_note)
 values('telegram.ack',100,'en','STAGING. We received your message.',true,'staging only, pending D1');`;
refused(`${vars()}\nbegin;\n${staging}\n${seed}`,/not signed go-live copy.*telegram\.ack v100 en/,'Approved STAGING body');
refused(`${vars()}\nbegin;\ninsert into public.system_message_templates(template_id,version,locale,body,approved,approval_note)
 values('telegram.ack',200,'en','We received your message.',true,'approved in chat');\n${seed}`,/not signed go-live copy/,'Approved without a signer');
refused(`${vars()}\nbegin;\ninsert into public.system_message_templates(template_id,version,locale,body,approved,approval_note)
 values('telegram.ack',200,'en','UNAPPROVED PLACEHOLDER ack',true,'signed by Tester on 2026-10-20');\n${seed}`,/not signed go-live copy/,'Approved placeholder body');
const signed=run(`${vars()}\nbegin;\ninsert into public.system_message_templates(template_id,version,locale,body,approved,approval_note)
 values('telegram.ack',200,'en','We received your message and passed it to your care team.',true,'signed by Tester on 2026-10-20');\n${seed}\n${snapshot}`);
assert.equal(snaps(signed.stdout)[0].approved_templates,1,'Signed go-live copy passes');
refused(`${vars({telegram_account:'noreon_testbot'})}\nbegin;\n${seed}`,/test bot/,'Test bot account');
refused(`${vars({conversation_policy_version:'staging-1'})}\nbegin;\n${seed}`,/conversation_policy_version/,'Staging policy id');
refused(`${vars({conversation_policy_version:''})}\nbegin;\n${seed}`,/conversation_policy_version/,'Empty policy id');
refused(`${vars({conversation_policy_version:'draft 1'})}\nbegin;\n${seed}`,/conversation_policy_version/,'Malformed policy id');

// 5. AI: refused without fresh model-mode evals; with them, calls go on and a seed re-run keeps them on.
refused(`${vars()}\nbegin;\n${seed}\n${ai}`,/passing model-mode eval/,'Real calls before the evals');
refused(`begin;\n${ai}`,/seed-environment\.sql first/,'AI seed before the main seed');
const evals=`insert into auth.users(id)values('5eed0000-0000-4000-8000-000000000001');
insert into public.zoe_eval_runs(tier,model_id,fallback_model_id,mode,harness_version,total_rows,must_failures,failures,requested_by)
 select tier,model_id,fallback_model_id,'model','go-live-seed-check',300,0,0,'5eed0000-0000-4000-8000-000000000001' from public.zoe_tier_config;`;
const on=run(`${vars()}\nbegin;\n${seed}\n${evals}\n${ai}\n${snapshot}\n${seed}\n${snapshot}\n${ai}\n${snapshot}`);
const [c,d,e]=snaps(on.stdout);
assert.equal(c.zoe_settings[0].model_calls_allowed,true,'Real calls on after the evals');
assert.equal(c.lab_ai_capabilities[0].enabled,true,'Lab AI on with the AI step');
assert.equal(c.lab_ai_capabilities[0].auto_accept_enabled,true,'Default AI confirmation survives the pre-launch reset');
assert.deepEqual(d,c,'Re-running the main seed keeps real calls and lab AI on and changes nothing');
assert.deepEqual(e,c,'Re-running the AI seed changes nothing');
for(const k of ['direct_answers_enabled','conversational_replies_enabled','symptom_intake_enabled','health_answers_enabled','coach_enabled'])
 assert.equal(c.zoe_settings[0][k],false,`${k} stays off until its clinical sign-off`);

// 5b. V3: the new chat's database switches. Off after the main seed, on after the V3 seed, and a re-run of either keeps them on.
assert.equal(row('conversation_policy').zoe_chat_actions_enabled,false,'V3 chat actions are off after the main seed');
refused(`begin;\n${v3}`,/seed-environment\.sql first/,'V3 seed before the main seed');
const v3on=run(`${vars()}\nbegin;\n${seed}\n${snapshot}\n${v3}\n${snapshot}\n${seed}\n${snapshot}\n${v3}\n${snapshot}`);
const [before,withV3,afterSeed,afterV3]=snaps(v3on.stdout);
assert.equal(before.conversation_policy[0].app_chat_enabled,false,'App chat is off before the V3 seed');
assert.equal(before.care_alert_settings[0].enabled,false,'Care alerts are off before the V3 seed');
assert.equal(withV3.conversation_policy[0].app_chat_enabled,true,'App chat is on after the V3 seed');
assert.equal(withV3.conversation_policy[0].zoe_chat_actions_enabled,true,'Chat actions are on after the V3 seed');
assert.equal(withV3.care_alert_settings[0].enabled,true,'Care alerts are on after the V3 seed');
assert.deepEqual(afterSeed,withV3,'Re-running the main seed keeps the V3 switches on and changes nothing');
assert.deepEqual(afterV3,withV3,'Re-running the V3 seed changes nothing');

// 6. The reset never runs a seed (the go-live seed needs psql variables and settings start at defaults).
assert.match(readFileSync('supabase/config.toml','utf8'),/\[db\.seed\]\n(#[^\n]*\n)*enabled = false\nsql_paths = \[\]/,'config.toml: reset seed off');

// 7. The env checklist lists every name the app reads (names only, never values).
const listed=new Set([...readFileSync('docs/operations/go-live-environment.md','utf8').matchAll(/`([A-Z][A-Z0-9_]+)`/g)].map(m=>m[1]));
const grep=spawnSync('git',['grep','-hoE','(NOREON|NEXT_PUBLIC|SUPABASE|AXIOM|SENTRY|CRON|AI_GATEWAY|OPENAI)_[A-Z0-9_]*[A-Z0-9]','--','app','lib','components','proxy.ts','next.config.ts','instrumentation.ts','instrumentation-client.ts','sentry.server.config.ts','sentry.edge.config.ts'],{encoding:'utf8'});
assert.equal(grep.status,0,grep.stderr);
const notEnv=new Set(['NOREON_MEMBER','NOREON_STAFF','NOREON_TEXT_SIZES']);// code constants, not variables
const unlisted=[...new Set(grep.stdout.split('\n').filter(Boolean))].filter(n=>!notEnv.has(n)&&!listed.has(n)).sort();
assert.deepEqual(unlisted,[],'docs/operations/go-live-environment.md lists every env name the app reads');

console.log('Go-live environment seed: replay, values, idempotency, refusals and coverage pass.');
