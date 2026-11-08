import assert from'node:assert/strict';import{readFileSync,writeFileSync,mkdirSync}from'node:fs';import{riskSessions}from'./fixtures/booking-email-risk-sessions.mjs';
const container=process.env.NOREON_TEST_DB_CONTAINER;assert.equal(container,'supabase_db_noreon-clinic-settings-qa');
const dir=process.env.NOREON_OPERATIONS_RACE_EVIDENCE_DIR??'/tmp/noreon-booking-operations-races';mkdirSync(dir,{recursive:true});
const parts=readFileSync('scripts/check-booking-email.sql','utf8').split('-- A partial recipient receipt');assert.equal(parts.length,2);const fixture=parts[0],h=riskSessions(container);
const notice='b2000000-0000-4000-8000-000000000024';const attempt='b2000000-0000-4000-8000-000000000054';
const command='b2000000-0000-4000-8000-000000000080';
const operation=(kind,ctx,key=command)=>`select public.${kind==='retry'?'retry':'reconcile'}_booking_notice('${ctx.m2}','${ctx.nurse}','${notice}',0,'${notice}','${key}','synthetic-engine-v1','noreon@example.invalid','synthetic-approved-v1');`;
const failed=ctx=>ctx.sql(ctx.claims(ctx.nurse)+h.selectSecond(ctx.nurse)+`;select set_config('ops.claim',public.claim_booking_notice('${notice}','${attempt}',1,now()+interval '5 minutes','synthetic-engine-v1','noreon@example.invalid','synthetic-approved-v1')::text,false);select public.record_booking_notice_receipt('${notice}','${attempt}',1,current_setting('ops.claim')::jsonb->>'envelopeHash','failed');select public.apply_booking_notice_receipt('${notice}','${attempt}','synthetic-engine-v1','noreon@example.invalid','synthetic-approved-v1');`);
const cleanup=ctx=>ctx.sql("delete from public.booking_notice_retry_commands where member_id::text like 'b2000000-%';");
for(const kind of ['retry','recovery']){
 await h.withFixture(fixture,h.secondMember({nurseActor:true}),async ctx=>{
  try{
   if(kind==='retry')failed(ctx);else ctx.sql(ctx.claims(ctx.nurse)+h.selectSecond(ctx.nurse));
   ctx.sql(ctx.claims(ctx.nurse)+operation(kind,ctx));
   const prefix=kind==='retry'?'booking-notice-retry:':'booking-notice-recovery:';
   const key=ctx.sql(`select hashtextextended('${prefix}${command}',0)`);const holder=await ctx.hold(key);
   const name='ops_'+kind+'_replay';const replay=ctx.run(ctx.claims(ctx.nurse)+operation(kind,ctx),name);let failure;
   try{await ctx.waitAdvisory(name);ctx.sql(`update public.patient_clinical_cases set assigned_nurse_id=null where user_id='${ctx.m2}';`);}catch(error){failure=error;}
   finally{holder.child.stdin.end('commit;\n');await holder.done;}
   const result=await replay;if(failure)throw failure;
   writeFileSync(dir+'/'+kind+'-revoked-replay.json',JSON.stringify(result,null,2));assert.notEqual(result.code,0);assert.match(result.err,/42501/,'Revoked nurse cannot read an operation receipt after waiting');
  }finally{cleanup(ctx);}
 });console.log(kind+' real command-lock replay/unassignment PASS');
}
await h.withFixture(fixture,h.secondMember({nurseActor:true}),async ctx=>{
 try{
  failed(ctx);
  const results=await Promise.allSettled(['b2000000-0000-4000-8000-000000000081','b2000000-0000-4000-8000-000000000082'].map((key,i)=>ctx.run(ctx.claims(ctx.nurse)+operation('retry',ctx,key),'ops_distinct_'+i)));
  for(const result of results)assert.equal(result.status,'fulfilled');
  const values=results.map(r=>r.value);writeFileSync(dir+'/distinct-retry-commands.json',JSON.stringify(values.map(v=>({code:v.code,err:v.err})),null,2));
  assert.equal(values.filter(r=>r.code===0).length,1,'Only one distinct retry command can claim a failed notice');
  for(const result of values.filter(r=>r.code!==0))assert.match(result.err,/40001|55P03/);
  assert.equal(ctx.sql(`select count(*)from public.booking_notice_attempts where notice_id='${notice}'`),'2','Initial failed attempt plus exactly one retry');
  assert.equal(ctx.sql(`select count(*)from public.booking_notice_retry_commands where notice_id='${notice}'`),'1');
 }finally{cleanup(ctx);}
});console.log('Distinct retry commands: one claim/one conflict, exactly two total attempts PASS');
