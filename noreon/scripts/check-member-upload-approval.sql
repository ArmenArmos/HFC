-- The assigned doctor approves a member upload's AI reading before the member sees it (20261021070050).
-- Fictional fixtures, all rolled back. Approve permission (assigned doctor yes; other doctor, admin, nurse, member,
-- no session, deactivated doctor no), member visibility before and after approval (table rows, reading, results),
-- the fallback switch, corrections and removals following the approval, replay, versions, and the audit trail.
\set ON_ERROR_STOP on
begin;
create function pg_temp.ok(cond boolean,label text) returns void language plpgsql as $$begin
 if cond is distinct from true then raise exception 'TEST %',label;end if;
end$$;
create function pg_temp.raises(statement text,code text default '42501') returns boolean language plpgsql as $$begin
 execute statement;return false;
exception when others then
 if sqlstate=code then return true;end if;
 raise notice 'unexpected % %',sqlstate,sqlerrm;return false;
end$$;
-- a9b: doctor 02 (of member 04), other doctor 03 (of member 05), admin 06, nurse 08 (of 04), members 04 and 05; clinic 07.
insert into auth.users(id,phone,phone_confirmed_at)select ('a9b00000-0000-4000-8000-0000000000'||lpad(n::text,2,'0'))::uuid,case when n in(4,5)then '37400098000'||n end,case when n in(4,5)then now()end from generate_series(2,8)n;
insert into public.workspace_clinics(id,name)values('a9b00000-0000-4000-8000-000000000007','Synthetic approval clinic');
insert into public.workspace_staff(user_id,role,display_name,clinic_id)values
 ('a9b00000-0000-4000-8000-000000000002','doctor','Synthetic Approving Doctor','a9b00000-0000-4000-8000-000000000007'),
 ('a9b00000-0000-4000-8000-000000000003','doctor','Synthetic Other Doctor','a9b00000-0000-4000-8000-000000000007'),
 ('a9b00000-0000-4000-8000-000000000006','admin','Synthetic Approval Admin',null),
 ('a9b00000-0000-4000-8000-000000000008','nurse','Synthetic Approval Nurse','a9b00000-0000-4000-8000-000000000007');
insert into public.patient_clinical_cases(user_id,assigned_doctor_id,assigned_nurse_id)values
 ('a9b00000-0000-4000-8000-000000000004','a9b00000-0000-4000-8000-000000000002','a9b00000-0000-4000-8000-000000000008'),
 ('a9b00000-0000-4000-8000-000000000005','a9b00000-0000-4000-8000-000000000003',null);
update public.profiles set display_name='Synthetic Approval Four',birth_date='1970-01-02'where id='a9b00000-0000-4000-8000-000000000004';
update public.profiles set display_name='Synthetic Approval Five',birth_date='1971-01-02'where id='a9b00000-0000-4000-8000-000000000005';
-- Staff sessions: a real auth session and a password amr, as the managed-session guard requires.
insert into auth.sessions(id,user_id,created_at,updated_at)select ('a9b00000-0000-4000-8000-0000000002'||lpad(n::text,2,'0'))::uuid,('a9b00000-0000-4000-8000-0000000000'||lpad(n::text,2,'0'))::uuid,now()-interval '1 hour',now()
 from generate_series(2,8)n;
update public.lab_ai_capabilities set enabled=true,member_upload_enabled=true where singleton;

create function pg_temp.as_user(n int,session boolean default true) returns void language sql as $$
 select set_config('request.jwt.claims',(jsonb_build_object('sub','a9b00000-0000-4000-8000-0000000000'||lpad(n::text,2,'0'),'role','authenticated',
  'amr',jsonb_build_array(jsonb_build_object('method','password')))||case when session then jsonb_build_object('session_id','a9b00000-0000-4000-8000-0000000002'||lpad(n::text,2,'0'))else '{}'end)::text,true)
$$;
create function pg_temp.as_service() returns void language sql as $$select set_config('request.jwt.claims','{"role":"service_role"}',true)$$;
create function pg_temp.doc(n int,member int,result_date date default null) returns uuid language sql as $$
 insert into public.member_reported_documents(id,user_id,object_path,file_name,mime,size_bytes,sha256,result_date)
 values(('a9b00000-0000-4000-8000-0000000001'||n)::uuid,('a9b00000-0000-4000-8000-0000000000'||lpad(member::text,2,'0'))::uuid,
  'a9b00000-0000-4000-8000-0000000000'||lpad(member::text,2,'0')||'/'||n||'.pdf','PRIVATE-APPROVAL-'||n||'.pdf','application/pdf',1000,lpad(n::text,64,'0'),result_date)returning id
$$;
create function pg_temp.job(n int) returns public.lab_ai_jobs language sql security definer as $$select * from public.lab_ai_jobs where member_document_id=('a9b00000-0000-4000-8000-0000000001'||n)::uuid$$;
create function pg_temp.vid(n int,q int) returns uuid language sql security definer as $$
 select v.id from public.member_upload_ai_values v where v.document_id=('a9b00000-0000-4000-8000-0000000001'||n)::uuid and v.seq=q
$$;
create function pg_temp.value(analyte text,v numeric,unit text,lo numeric,hi numeric,measure text,munit text) returns jsonb language sql as $$
 select jsonb_build_object('testName',analyte,'catalogueRef',case when measure is not null then analyte end,'valueText',v::text,'value',v,'unit',unit,'refLow',lo,'refHigh',hi,
  'refText',lo||' - '||hi,'labFlag',case when v>hi then 'high'else 'normal'end,'collectedOn','2026-09-01','labName','Synthetic lab','page',1,'snippet',analyte||' '||v,'checks','[]'::jsonb,
  'attention',case when v>hi then 'needs_doctor'end,'measure',measure,'measureUnit',munit)
$$;
-- Claims the queued member jobs and finishes document n's reading with these values, as the worker would.
create function pg_temp.read(n int,vals jsonb,status text default 'match') returns jsonb language plpgsql security definer as $$
declare j public.lab_ai_jobs;
begin
 perform set_config('request.jwt.claims','{"role":"service_role"}',true);
 perform public.lab_ai_job_claim(5);
 j:=pg_temp.job(n);
 return public.lab_ai_job_finish(j.id,j.lease_token,jsonb_build_object('disposition','done','outcome','extracted','pageCount',1,
  'sourceSha256',(select sha256 from public.member_reported_documents where id=j.member_document_id),'identityStatus',status,
  'identity',jsonb_build_object('nameOnSheet','Synthetic Approval','sampleDate','2026-09-01'),'values',vals,'summary',null,'provider','noreon.fake','model','noreon-fake-lab-1'));
end$$;
create function pg_temp.cmd(member int,n int,sub int,vals jsonb,based int default null,extra jsonb default '{}') returns jsonb language sql as $$
 select jsonb_build_object('version','member-upload-approve-v1','submissionId','a9b00000-0000-4000-8000-0000000009'||lpad(sub::text,2,'0'),
  'memberId','a9b00000-0000-4000-8000-0000000000'||lpad(member::text,2,'0'),'jobId',(pg_temp.job(n)).id,'basedOn',based,'values',vals,
  'interpretationHy','Ձեր արդյունքների մեծ մասը միջակայքում է։','interpretationEn','Most of your results are inside the lab range.','interpretationEdited',true)||extra
$$;
create function pg_temp.approve(member int,n int,sub int,vals jsonb,based int default null,extra jsonb default '{}') returns jsonb language sql as $$
 select public.doctor_member_upload_approve(pg_temp.cmd(member,n,sub,vals,based,extra))
$$;
create function pg_temp.act(n int,q int,action text,v numeric default null) returns jsonb language sql as $$
 select jsonb_build_object('valueId',pg_temp.vid(n,q),'action',action)||case when v is null then '{}'else jsonb_build_object('value',v)end
$$;
-- What the signed-in member sees of their own charted values read from files (RLS-served).
create function pg_temp.member_rows() returns table(measure text,value numeric,source text) language sql as $$
 select measure,value,source from public.member_reported_values where ai_value_id is not null order by measure
$$;
grant execute on function pg_temp.ok(boolean,text),pg_temp.raises(text,text),pg_temp.as_user(int,boolean),pg_temp.as_service(),pg_temp.doc(int,int,date),pg_temp.job(int),pg_temp.vid(int,int),
 pg_temp.value(text,numeric,text,numeric,numeric,text,text),pg_temp.read(int,jsonb,text),pg_temp.cmd(int,int,int,jsonb,int,jsonb),pg_temp.approve(int,int,int,jsonb,int,jsonb),
 pg_temp.act(int,int,text,numeric),pg_temp.member_rows() to authenticated,service_role;

-- 1. The switch is on by default.
select pg_temp.ok((select member_upload_doctor_approval from public.lab_ai_capabilities)=true
 and(select column_default from information_schema.columns where table_name='lab_ai_capabilities'and column_name='member_upload_doctor_approval')='true','approval required by default');

-- 2. A reading of the member's own sheet is saved as before (chart rows ai_read), and hidden from the member.
select pg_temp.doc(21,4);select pg_temp.doc(22,4);select pg_temp.doc(23,5);select pg_temp.doc(24,4,'2026-08-01');
select pg_temp.ok(pg_temp.read(21,jsonb_build_array(pg_temp.value('ldl_c',3.4,'mmol/L',0,3.0,'ldl_c','mmol/L'),pg_temp.value('hba1c',5.6,'%',4,6,'hba1c','%'),
 pg_temp.value('Sodium',140,'mmol/L',136,145,null,null)))->>'state'='done','reading 21 done');
select pg_temp.ok(pg_temp.read(22,jsonb_build_array(pg_temp.value('ldl_c',2.1,'mmol/L',0,3.0,'ldl_c','mmol/L')),'mismatch')->>'state'='done','reading 22 done (mismatch)');
select pg_temp.ok(pg_temp.read(23,jsonb_build_array(pg_temp.value('hba1c',6.1,'%',4,6,'hba1c','%')))->>'state'='done','reading 23 done');
select pg_temp.ok(pg_temp.read(24,jsonb_build_array(pg_temp.value('total_cholesterol',5.0,'mmol/L',0,5.2,'total_cholesterol','mmol/L')))->>'state'='done','reading 24 done');
reset role;
select pg_temp.ok((select count(*)from public.member_reported_values where user_id='a9b00000-0000-4000-8000-000000000004'and source='ai_read')=3,'autosave still writes chart rows');

select pg_temp.as_user(4);
set local role authenticated;
select pg_temp.ok((select count(*)from pg_temp.member_rows())=0,'member sees no file values before approval');
select pg_temp.ok(public.member_upload_ai_read('a9b00000-0000-4000-8000-000000000121')->'values'='[]'::jsonb
 and public.member_upload_ai_read('a9b00000-0000-4000-8000-000000000121')#>>'{job,review,state}'='waiting','reading says waiting, no values');
select pg_temp.ok((select x->>'state'from jsonb_array_elements(public.member_upload_results()->'documents')x where x->>'documentId'='a9b00000-0000-4000-8000-000000000121')='waiting'
 and public.member_upload_results()->'values'='[]'::jsonb,'results: waiting, no values');
select pg_temp.ok((select jsonb_agg(x#>'{job,review}')from jsonb_array_elements(public.member_upload_ai_overview()->'documents')x where x->>'documentId'='a9b00000-0000-4000-8000-000000000121')->0->>'state'='waiting','overview says waiting');
select pg_temp.ok(public.member_upload_ai_edit(jsonb_build_object('version','member-upload-edit-v1','submissionId','a9b00000-0000-4000-8000-000000000801','jobId',(pg_temp.job(21)).id,
 'edits',jsonb_build_array(jsonb_build_object('valueId',pg_temp.vid(21,1),'action','correct','value',1.0))))->>'status'='disabled','member corrections closed while approval is required');
select pg_temp.ok(pg_temp.raises($$select * from public.member_upload_doctor_approvals$$)and pg_temp.raises($$select * from public.member_upload_approved_values$$),'no direct table access');
-- 3. Approve permission: the member, a nurse, another doctor, an admin and the doctor without a session are refused.
select pg_temp.ok(pg_temp.raises($$select pg_temp.approve(4,21,1,jsonb_build_array(pg_temp.act(21,1,'keep'),pg_temp.act(21,2,'keep'),pg_temp.act(21,3,'keep')))$$),'member cannot approve');
reset role;select pg_temp.as_user(8);set local role authenticated;
select pg_temp.ok(pg_temp.raises($$select pg_temp.approve(4,21,1,jsonb_build_array(pg_temp.act(21,1,'keep'),pg_temp.act(21,2,'keep'),pg_temp.act(21,3,'keep')))$$),'nurse cannot approve');
reset role;select pg_temp.as_user(3);set local role authenticated;
select pg_temp.ok(pg_temp.raises($$select pg_temp.approve(4,21,1,jsonb_build_array(pg_temp.act(21,1,'keep'),pg_temp.act(21,2,'keep'),pg_temp.act(21,3,'keep')))$$),'other doctor cannot approve');
select pg_temp.ok(pg_temp.raises($$select public.staff_member_upload_approvals('a9b00000-0000-4000-8000-000000000004')$$),'other doctor cannot read approvals');
reset role;select pg_temp.as_user(6);set local role authenticated;
select pg_temp.ok(pg_temp.raises($$select pg_temp.approve(4,21,1,jsonb_build_array(pg_temp.act(21,1,'keep'),pg_temp.act(21,2,'keep'),pg_temp.act(21,3,'keep')))$$),'admin cannot approve');
select pg_temp.ok((public.staff_member_upload_approvals('a9b00000-0000-4000-8000-000000000004')->>'canApprove')::boolean=false,'admin reads, cannot approve');
select pg_temp.ok((select count(*)from jsonb_array_elements(public.staff_member_history('a9b00000-0000-4000-8000-000000000004')->'values')x where x->>'source'='ai_read')=3,'admin still reads the unapproved rows (audited staff read)');
select pg_temp.ok((select count(*)from public.member_reported_values where user_id='a9b00000-0000-4000-8000-000000000004')=0,'staff never read the table directly');
reset role;select pg_temp.as_user(2,false);set local role authenticated;
select pg_temp.ok(pg_temp.raises($$select pg_temp.approve(4,21,1,jsonb_build_array(pg_temp.act(21,1,'keep'),pg_temp.act(21,2,'keep'),pg_temp.act(21,3,'keep')))$$),'doctor without a session cannot approve');
reset role;select pg_temp.as_user(2);set local role authenticated;
select pg_temp.ok((select count(*)from jsonb_array_elements(public.staff_member_history('a9b00000-0000-4000-8000-000000000004')->'values')x where x->>'source'='ai_read')=3,'assigned doctor reads the unapproved rows (audited staff read)');
select pg_temp.ok((public.staff_member_upload_approvals('a9b00000-0000-4000-8000-000000000004')->>'canApprove')::boolean and(public.staff_member_upload_approvals('a9b00000-0000-4000-8000-000000000004')->>'required')::boolean,'assigned doctor can approve');
select pg_temp.ok(pg_temp.raises($$select pg_temp.approve(5,23,2,jsonb_build_array(pg_temp.act(23,1,'keep')))$$),'doctor cannot approve another doctor''s member');

-- 4. Invalid, stale and not-ready commands.
select pg_temp.ok(pg_temp.approve(4,21,3,jsonb_build_array(pg_temp.act(21,1,'keep'),pg_temp.act(21,2,'keep')))->>'status'='invalid','every value must be listed');
select pg_temp.ok(pg_temp.approve(4,21,3,jsonb_build_array(pg_temp.act(21,1,'keep'),pg_temp.act(21,1,'keep'),pg_temp.act(21,3,'keep')))->>'status'='invalid','each value once');
select pg_temp.ok(pg_temp.approve(4,21,3,jsonb_build_array(pg_temp.act(21,1,'correct'),pg_temp.act(21,2,'keep'),pg_temp.act(21,3,'keep')))->>'status'='invalid','a correction has a value');
select pg_temp.ok(pg_temp.approve(4,21,3,jsonb_build_array(pg_temp.act(21,1,'keep'),pg_temp.act(21,2,'keep'),pg_temp.act(21,3,'keep')),null,'{"interpretationHy":"  "}')->>'status'='invalid','an interpretation is required');
select pg_temp.ok(pg_temp.approve(4,21,3,jsonb_build_array(pg_temp.act(21,1,'keep'),pg_temp.act(21,2,'keep'),pg_temp.act(21,3,'keep')),1)->>'status'='stale','basedOn must match the current version');
select pg_temp.ok(pg_temp.approve(4,22,3,jsonb_build_array(pg_temp.act(22,1,'keep')))->>'status'='not-ready','a mismatch waits for the member''s answer');
reset role;
select pg_temp.ok(not exists(select 1 from public.member_upload_doctor_approvals where member_id='a9b00000-0000-4000-8000-000000000004'),'nothing recorded by refused commands');

-- 5. The assigned doctor approves: LDL corrected, HbA1c kept, sodium removed.
select pg_temp.as_user(2);set local role authenticated;
select pg_temp.ok(pg_temp.approve(4,21,4,jsonb_build_array(pg_temp.act(21,1,'correct',3.2),pg_temp.act(21,2,'keep'),pg_temp.act(21,3,'remove')))->>'status'='approved','assigned doctor approves');
-- Astra N1-3: only the identical command replays; an edited retry cannot overwrite the approval.
select pg_temp.ok((pg_temp.approve(4,21,4,jsonb_build_array(pg_temp.act(21,1,'correct',3.2),pg_temp.act(21,2,'keep'),pg_temp.act(21,3,'remove'))))->>'replayed'='true','resend returns the recorded outcome');
select pg_temp.ok(pg_temp.approve(4,21,4,jsonb_build_array(pg_temp.act(21,1,'correct',3.1),pg_temp.act(21,2,'keep'),pg_temp.act(21,3,'remove')))->>'status'='stale','edited retry is stale');
select pg_temp.ok(pg_temp.approve(4,24,4,jsonb_build_array(pg_temp.act(24,1,'keep')))->>'status'='stale','a submission id is not reused for another reading');
reset role;
select pg_temp.ok((select count(*)=1 and bool_and(value=3.2)from public.member_upload_approved_values where value_id=pg_temp.vid(21,1)),'edited retry keeps the original approved value');
-- Astra PR390-R1: an approval saved before 20261022072437 has no hash; any retry of it is stale, never a replayed success.
alter table public.member_upload_doctor_approvals disable trigger member_upload_doctor_approvals_immutable;
update public.member_upload_doctor_approvals set command_hash=null where job_id=(select job_id from public.member_upload_ai_values where id=pg_temp.vid(21,1));
alter table public.member_upload_doctor_approvals enable trigger member_upload_doctor_approvals_immutable;
select pg_temp.as_user(2);set local role authenticated;
select pg_temp.ok(pg_temp.approve(4,21,4,jsonb_build_array(pg_temp.act(21,1,'correct',3.1),pg_temp.act(21,2,'keep'),pg_temp.act(21,3,'remove')))->>'status'='stale','a legacy approval: edited retry is stale');
reset role;
select pg_temp.ok((select count(*)=1 and bool_and(value=3.2)from public.member_upload_approved_values where value_id=pg_temp.vid(21,1)),'a legacy approval keeps its value');
-- Audit: who, when, what changed; the open is recorded; rows are append-only.
select pg_temp.ok((select doctor_id='a9b00000-0000-4000-8000-000000000002'and version=1 and interpretation_edited and created_at is not null
 and jsonb_array_length(changes->'values')=2 and changes->'values' @> jsonb_build_array(jsonb_build_object('action','correct','ai','3.4','after',3.2))
 and changes->'values' @> jsonb_build_array(jsonb_build_object('action','remove','ai','140'))
 from public.member_upload_doctor_approvals where job_id=(pg_temp.job(21)).id),'approval records who, when and what changed');
select pg_temp.ok((select array_agg(action order by action)from public.member_upload_approved_values where job_id=(pg_temp.job(21)).id)='{corrected,kept,removed}','each value recorded');
select pg_temp.ok(exists(select 1 from public.access_audit where actor_id='a9b00000-0000-4000-8000-000000000002'and member_id='a9b00000-0000-4000-8000-000000000004'and surface='member_upload_approve'),'approval in the access audit');
select pg_temp.ok(pg_temp.raises($$update public.member_upload_doctor_approvals set interpretation_en='x'$$,'55000')and pg_temp.raises($$delete from public.member_upload_approved_values$$,'55000'),'approvals are append-only');
select pg_temp.ok((select value=3.2 and source='doctor_approved'from public.member_reported_values where ai_value_id=pg_temp.vid(21,1)),'chart takes the doctor''s value');

-- 6. The member now sees the approved values, the doctor's name and interpretation; not the removed one.
select pg_temp.as_user(4);set local role authenticated;
select pg_temp.ok((select array_agg(measure||'='||value||'/'||source order by measure)from pg_temp.member_rows())='{hba1c=5.60/doctor_approved,ldl_c=3.20/doctor_approved}','member sees approved chart rows only');
select pg_temp.ok((select x->>'state'='approved'and x#>>'{interpretation,en}'='Most of your results are inside the lab range.'and x->>'doctorName'='Synthetic Approving Doctor'
 from jsonb_array_elements(public.member_upload_results()->'documents')x where x->>'documentId'='a9b00000-0000-4000-8000-000000000121'),'results: approved, interpretation, doctor');
select pg_temp.ok((select count(*)from jsonb_array_elements(public.member_upload_results()->'values')x)=2
 and(select x->>'value'='3.2'and(x->>'doctorEdited')::boolean and(x->>'checked')::boolean and x->>'date'='2026-09-01'and not(x ? 'labFlag')and not(x ? 'attention')
  from jsonb_array_elements(public.member_upload_results()->'values')x where x->>'valueId'=pg_temp.vid(21,1)::text),'results: approved values, no flags or attention marks');
select pg_temp.ok(jsonb_array_length(public.member_upload_ai_read('a9b00000-0000-4000-8000-000000000121')->'values')=2,'reading returns the approved values');
select pg_temp.ok(not exists(select 1 from jsonb_array_elements(public.member_upload_results()->'documents')x where x->>'documentId'='a9b00000-0000-4000-8000-000000000123'),'never another member''s file');
select pg_temp.ok((select count(*)from public.member_reported_values where ai_value_id=pg_temp.vid(24,1))=0,'another reading of theirs stays hidden');
reset role;

-- 7. Approving again makes version 2 on the version the doctor saw: sodium restored, LDL kept at the doctor's value.
select pg_temp.as_user(2);set local role authenticated;
select pg_temp.ok(pg_temp.approve(4,21,5,jsonb_build_array(pg_temp.act(21,1,'keep'),pg_temp.act(21,2,'keep'),pg_temp.act(21,3,'keep')))->>'status'='stale','a second approval names the version it saw');
select pg_temp.ok(pg_temp.approve(4,21,5,jsonb_build_array(pg_temp.act(21,1,'keep'),pg_temp.act(21,2,'keep'),pg_temp.act(21,3,'keep')),1,'{"interpretationEn":"Updated."}')->>'version'='2','version 2');
select pg_temp.ok((select jsonb_array_length(a#>'{approval,values}')=3 and a#>>'{approval,version}'='2'and(a#>>'{approval,byYou}')::boolean and jsonb_array_length(a->'ranges')=3
 from jsonb_array_elements(public.staff_member_upload_approvals('a9b00000-0000-4000-8000-000000000004')->'readings')a where a->>'documentId'='a9b00000-0000-4000-8000-000000000121')
 and(select a->'approval'='null'::jsonb from jsonb_array_elements(public.staff_member_upload_approvals('a9b00000-0000-4000-8000-000000000004')->'readings')a where a->>'documentId'='a9b00000-0000-4000-8000-000000000124'),'staff read shows the current version, and none for an unapproved reading');
reset role;
select pg_temp.ok((select changes->'interpretationChanged'='true'and changes->'values' @> '[{"action":"keep","beforeRemoved":true}]'from public.member_upload_doctor_approvals where job_id=(pg_temp.job(21)).id and version=2),'version 2 records the restored value and the new text');
select pg_temp.ok((select action='corrected'and value=3.2 from public.member_upload_approved_values a join public.member_upload_doctor_approvals p on p.id=a.approval_id where p.version=2 and a.value_id=pg_temp.vid(21,1)),'kept correction stays the doctor''s value');
select pg_temp.as_user(4);set local role authenticated;
select pg_temp.ok((select count(*)from jsonb_array_elements(public.member_upload_results()->'values')x where x->>'documentId'='a9b00000-0000-4000-8000-000000000121')=3,'member sees the restored value');
reset role;

-- 8. A deactivated doctor cannot approve.
update public.workspace_staff set active=false where user_id='a9b00000-0000-4000-8000-000000000002';
select pg_temp.as_user(2);set local role authenticated;
select pg_temp.ok(pg_temp.raises($$select pg_temp.approve(4,24,6,jsonb_build_array(pg_temp.act(24,1,'keep')))$$),'deactivated doctor cannot approve');
reset role;
update public.workspace_staff set active=true where user_id='a9b00000-0000-4000-8000-000000000002';

-- 9. Fallback: with approval switched off, saved values show at once (as before), marked not checked.
update public.lab_ai_capabilities set member_upload_doctor_approval=false where singleton;
select pg_temp.as_user(4);set local role authenticated;
select pg_temp.ok((select count(*)from public.member_reported_values where ai_value_id=pg_temp.vid(24,1))=1,'fallback: unapproved values show');
select pg_temp.ok((select x->>'state'from jsonb_array_elements(public.member_upload_results()->'documents')x where x->>'documentId'='a9b00000-0000-4000-8000-000000000124')='not_checked'
 and(select not(x->>'checked')::boolean from jsonb_array_elements(public.member_upload_results()->'values')x where x->>'valueId'=pg_temp.vid(24,1)::text),'fallback: marked not checked');
-- Astra R-01: approvals stay in force with the switch off. The member cannot change an approved reading; an
-- unapproved one is corrected as before, and is hidden again (pending approval) once the switch is back on.
select pg_temp.ok(public.member_upload_ai_edit(jsonb_build_object('version','member-upload-edit-v1','submissionId','a9b00000-0000-4000-8000-000000000802','jobId',(pg_temp.job(21)).id,
 'edits',jsonb_build_array(jsonb_build_object('valueId',pg_temp.vid(21,1),'action','correct','value',4.8))))->>'status'='disabled','fallback: an approved reading stays the doctor''s');
select pg_temp.ok((select value=3.2 from public.member_reported_values where ai_value_id=pg_temp.vid(21,1)),'fallback: member sees the approved value');
select pg_temp.ok((select x->>'value'='3.2'from jsonb_array_elements(public.member_upload_results()->'values')x where x->>'valueId'=pg_temp.vid(21,1)::text),'fallback: results agree with the chart');
select pg_temp.ok((select x#>>'{job,review,state}'from jsonb_array_elements(public.member_upload_ai_overview()->'documents')x where x->>'documentId'='a9b00000-0000-4000-8000-000000000121')='approved'
 and(select x#>>'{job,review,state}'from jsonb_array_elements(public.member_upload_ai_overview()->'documents')x where x->>'documentId'='a9b00000-0000-4000-8000-000000000124')='not_required','fallback: review states');
select pg_temp.ok(public.member_upload_ai_edit(jsonb_build_object('version','member-upload-edit-v1','submissionId','a9b00000-0000-4000-8000-000000000803','jobId',(pg_temp.job(24)).id,
 'edits',jsonb_build_array(jsonb_build_object('valueId',pg_temp.vid(24,1),'action','correct','value',4.9))))->>'status'='saved','fallback: an unapproved reading is corrected as before');
reset role;
update public.lab_ai_capabilities set member_upload_doctor_approval=true where singleton;
select pg_temp.as_user(4);set local role authenticated;
select pg_temp.ok((select count(*)from public.member_reported_values where ai_value_id=pg_temp.vid(24,1))=0,'switch back on: the member''s own correction waits for the doctor');
select pg_temp.ok((select array_agg(measure||'='||value||'/'||source order by measure)from pg_temp.member_rows())='{hba1c=5.60/doctor_approved,ldl_c=3.20/doctor_approved}','switch back on: only approved rows');
select pg_temp.ok((select x->>'state'from jsonb_array_elements(public.member_upload_results()->'documents')x where x->>'documentId'='a9b00000-0000-4000-8000-000000000124')='waiting','switch back on: waiting');
reset role;

-- Astra R-03: a correction beyond the chart's precision is approved and kept, not charted, and the reply is definite.
select pg_temp.as_user(2);set local role authenticated;
select pg_temp.ok(pg_temp.approve(4,24,7,jsonb_build_array(pg_temp.act(24,1,'correct',10000)))->>'status'='approved','overflowing correction approved');
reset role;
select pg_temp.ok((select count(*)from public.member_reported_values where ai_value_id=pg_temp.vid(24,1))=0
 and(select action='corrected'and value=10000 from public.member_upload_approved_values where value_id=pg_temp.vid(24,1)),'kept in the approval, not charted');

select 'member upload approval checks passed';
rollback;
