-- Normal synthetic persistence lifecycle in an owned local database. No provider,
-- session deletion, contention/adversarial harness or production resources.
\set ON_ERROR_STOP on
begin;
create function pg_temp.pdf_assert(ok boolean,label text)returns void language plpgsql as $$begin if ok is distinct from true then raise exception 'TEST %',label;end if;end$$;
create function pg_temp.pdf_reject(q text,expected text)returns void language plpgsql as $$begin
 begin execute q;exception when others then if sqlstate=expected then return;end if;raise;end;
 raise exception 'TEST expected rejection %',expected;
end$$;
create temp table pdf_fixture as select jsonb_build_object('version',1,'parser','qpdf-12.4.2','policy','noreon-pdf-v1',
 'original',jsonb_build_object('checksum',repeat('a',64),'byteLength',100),
 'canonical',jsonb_build_object('checksum',repeat('b',64),'byteLength',200),
 'pageMap',jsonb_build_array(jsonb_build_object('originalPage',1,'canonicalPage',1,'originalObject','3 0 R','canonicalObject','4 0 R')))artifact;
select pg_temp.pdf_assert(public._report_pdf_artifact_valid(artifact,'application/pdf',repeat('a',64),100,1),'Exact artifact accepted')from pdf_fixture;
select pg_temp.pdf_assert(public._report_pdf_artifact_valid(null,'image/png',null,100,null),'Historical/image SQL NULL remains unknown');
select pg_temp.pdf_assert(not public._report_pdf_artifact_valid('null','application/pdf',repeat('a',64),100,1),'JSON null is not absent metadata');
-- Missing and JSON-null keys at every nesting level must fail, never SQL NULL.
do $$declare a jsonb;k text;part text;candidate jsonb;begin
 select artifact into a from pdf_fixture;
 foreach k in array array['version','parser','policy','original','canonical','pageMap']loop
  perform pg_temp.pdf_assert(not public._report_pdf_artifact_valid(a-k,'application/pdf',repeat('a',64),100,1),'Missing top-level '||k);
  perform pg_temp.pdf_assert(not public._report_pdf_artifact_valid(jsonb_set(a,array[k],'null'),'application/pdf',repeat('a',64),100,1),'Null top-level '||k);
 end loop;
 foreach part in array array['original','canonical']loop foreach k in array array['checksum','byteLength']loop
  candidate:=jsonb_set(a,array[part],(a->part)-k);
  perform pg_temp.pdf_assert(not public._report_pdf_artifact_valid(candidate,'application/pdf',repeat('a',64),100,1),'Missing identity '||part||k);
  perform pg_temp.pdf_assert(not public._report_pdf_artifact_valid(jsonb_set(a,array[part,k],'null'),'application/pdf',repeat('a',64),100,1),'Null identity '||part||k);
 end loop;end loop;
 foreach k in array array['originalPage','canonicalPage','originalObject','canonicalObject']loop
  candidate:=jsonb_set(a,'{pageMap,0}',(a#>'{pageMap,0}')-k);
  perform pg_temp.pdf_assert(not public._report_pdf_artifact_valid(candidate,'application/pdf',repeat('a',64),100,1),'Missing map '||k);
  perform pg_temp.pdf_assert(not public._report_pdf_artifact_valid(jsonb_set(a,array['pageMap','0',k],'null'),'application/pdf',repeat('a',64),100,1),'Null map '||k);
 end loop;
 perform pg_temp.pdf_assert(not public._report_pdf_artifact_valid(a||'{"extra":true}','application/pdf',repeat('a',64),100,1),'Extra top key');
 perform pg_temp.pdf_assert(not public._report_pdf_artifact_valid(jsonb_set(a,'{original,extra}','true'),'application/pdf',repeat('a',64),100,1),'Extra identity key');
 perform pg_temp.pdf_assert(not public._report_pdf_artifact_valid(jsonb_set(a,'{pageMap,0,extra}','true'),'application/pdf',repeat('a',64),100,1),'Extra map key');
 perform pg_temp.pdf_assert(not public._report_pdf_artifact_valid(jsonb_set(a,'{original,byteLength}','100.5'),'application/pdf',repeat('a',64),100,1),'Fractional length');
 perform pg_temp.pdf_assert(not public._report_pdf_artifact_valid(jsonb_set(a,'{canonical,byteLength}','12582913'),'application/pdf',repeat('a',64),100,1),'Canonical limit');
 perform pg_temp.pdf_assert(not public._report_pdf_artifact_valid(a,'application/pdf',repeat('c',64),100,1),'Original hash binding');
 perform pg_temp.pdf_assert(not public._report_pdf_artifact_valid(a,'application/pdf',repeat('a',64),101,1),'Original size binding');
 perform pg_temp.pdf_assert(not public._report_pdf_artifact_valid(a,'application/pdf',repeat('a',64),100,2),'Page count binding');
 perform pg_temp.pdf_assert(not public._report_pdf_artifact_valid(a,'image/png',repeat('a',64),100,1),'Image cannot claim PDF artifact');
 perform pg_temp.pdf_assert(not public._report_pdf_artifact_valid(jsonb_set(a,'{pageMap,0,originalPage}','2'),'application/pdf',repeat('a',64),100,1),'Non-contiguous map');
 perform pg_temp.pdf_assert(not public._report_pdf_artifact_valid(jsonb_set(a,'{pageMap,0,canonicalObject}','"0 0 R"'),'application/pdf',repeat('a',64),100,1),'Invalid object reference');
 candidate:=jsonb_set(a,'{pageMap}',(select jsonb_agg(jsonb_build_object('originalPage',i,'canonicalPage',i,'originalObject',format('%s 0 R',i+2),'canonicalObject',format('%s 0 R',i+3))order by i)from generate_series(1,10)i));
 perform pg_temp.pdf_assert(public._report_pdf_artifact_valid(candidate,'application/pdf',repeat('a',64),100,10),'Ten contiguous pages');
 candidate:=jsonb_set(candidate,'{pageMap}',(candidate->'pageMap')||jsonb_build_array(jsonb_build_object('originalPage',11,'canonicalPage',11,'originalObject','13 0 R','canonicalObject','14 0 R')));
 perform pg_temp.pdf_assert(not public._report_pdf_artifact_valid(candidate,'application/pdf',repeat('a',64),100,11),'Eleven pages rejected');
end$$;
insert into auth.users(id,phone,phone_confirmed_at)values('b2200000-0000-4000-8000-000000000001','374000220001',now());
insert into public.patient_reports(id,user_id,object_path,file_name,mime,size_bytes,checksum,page_count,state,extraction,consent_version)
 values('b2200000-0000-4000-8000-000000000010','b2200000-0000-4000-8000-000000000001','synthetic-pdf-artifact/original','Synthetic.pdf','application/pdf',100,repeat('a',64),1,'needs_review','{}','synthetic-only');
select set_config('pdf.before_source',public.patient_clinical_evidence('b2200000-0000-4000-8000-000000000001')->>'token',true);
select set_config('pdf.before_requirements',public.patient_test_context('b2200000-0000-4000-8000-000000000001')->>'requirementsToken',true);
select pg_temp.pdf_assert(not(public.patient_clinical_evidence('b2200000-0000-4000-8000-000000000001')#>'{data,reports,0}'?'pdfArtifact'),'Historical unknown omitted, no invented backfill');
update public.patient_reports set pdf_artifact=(select artifact from pdf_fixture)where id='b2200000-0000-4000-8000-000000000010'and revision=0;
select pg_temp.pdf_assert(public.patient_clinical_evidence('b2200000-0000-4000-8000-000000000001')->>'token'<>current_setting('pdf.before_source'),'Present provenance changes clinical source');
select pg_temp.pdf_assert(public.patient_test_context('b2200000-0000-4000-8000-000000000001')->>'requirementsToken'=current_setting('pdf.before_requirements'),'Requirements lifetime unchanged');
select pg_temp.pdf_assert(public.patient_clinical_evidence('b2200000-0000-4000-8000-000000000001')#>'{data,reports,0,pdfArtifact}'=(select artifact from pdf_fixture),'Source read DTO retains exact metadata');
select pg_temp.pdf_reject($q$update public.patient_reports set pdf_artifact='{}'where id='b2200000-0000-4000-8000-000000000010'$q$,'23514');
select pg_temp.pdf_reject($q$update public.patient_reports set checksum=null where id='b2200000-0000-4000-8000-000000000010'$q$,'23514');
-- A stale CAS writes neither its extraction nor artifact. This is SQL scope,
-- not proof of the actual authenticated extraction entrypoint.
update public.patient_reports set extraction='{"stale":true}',pdf_artifact=jsonb_set(pdf_artifact,'{canonical,checksum}',to_jsonb(repeat('c',64)))where id='b2200000-0000-4000-8000-000000000010'and revision=99;
select pg_temp.pdf_assert((select extraction='{}'and pdf_artifact=(select artifact from pdf_fixture)from public.patient_reports where id='b2200000-0000-4000-8000-000000000010'),'Stale CAS changes neither result nor artifact');
select set_config('request.jwt.claim.sub','b2200000-0000-4000-8000-000000000001',true);
set local role authenticated;
select pg_temp.pdf_reject($q$update public.patient_reports set pdf_artifact=null where id='b2200000-0000-4000-8000-000000000010'$q$,'42501');
reset role;
update public.patient_reports set state='deleted',deleted_at=now(),pdf_artifact=null,checksum=null,extraction=null,reviewed=null,explanation=null where id='b2200000-0000-4000-8000-000000000010';
select pg_temp.pdf_assert(jsonb_array_length(public.patient_clinical_evidence('b2200000-0000-4000-8000-000000000001')#>'{data,reports}')=0,'Removed source is absent');

-- Existing shared RPC preserves metadata and retires associations only when the
-- canonical source identity changes. Trusted local SQL, not an Auth/browser claim.
do $$declare c uuid:='b2200000-0000-4000-8000-000000000004';d uuid:='b2200000-0000-4000-8000-000000000002';cl uuid:='b2200000-0000-4000-8000-000000000003';rid text:='b2200000-0000-4000-8000-000000000005';a jsonb;r jsonb;w jsonb;rev integer;ev bigint;
begin
 select artifact into a from pdf_fixture;
 insert into auth.users(id)values(d);
 insert into public.workspace_clinics(id,name)values(cl,'Synthetic PDF clinic');
 insert into public.workspace_staff(user_id,role,display_name,clinic_id)values(d,'doctor','Synthetic PDF reviewer',cl);
 perform public.workspace_create_case(c,jsonb_build_object('userId',c,'expiresAt',extract(epoch from now()+interval '1 day')*1000,'state',jsonb_build_object('consentAccepted',true,'assessment',jsonb_build_object('completedAt',now(),'urgentRule',null))),d);
 w:=jsonb_build_object('revision',0,'publication',null,'tests',jsonb_build_array(jsonb_build_object('id','lipid-panel','method','lab')),'requirements',jsonb_build_array(jsonb_build_object('requirementId','requirement-1','retiredAtRevision',null,'test',jsonb_build_object('id','lipid-panel','method','lab'))),'receivedTestIds','[]'::jsonb,'receiptHistory','[]'::jsonb);
 perform public.workspace_initialize_workflow(c,0,w);
 r:=jsonb_build_object('id',rid,'user_id',c,'revision',0,'state','confirmed','mime','application/pdf','checksum',repeat('a',64),'size_bytes',100,'page_count',1,'extraction_provenance',jsonb_build_object('status','verified','version',2,'pdf_artifact',a),'extraction',jsonb_build_object('rows',jsonb_build_array(jsonb_build_object('name','Synthetic LDL','literal','3.2'))),'reviewed',jsonb_build_object('rows',jsonb_build_array(jsonb_build_object('name','Synthetic LDL','literal','3.2'))));
 rev:=public.workspace_write_report(c,rid,'insert',null,r);
 perform pg_temp.pdf_assert((select record#>'{extraction_provenance,pdf_artifact}'=a from public.workspace_case_reports where case_id=c and id=rid),'Actual shared RPC preserves exact nested artifact');
 select evidence_revision into ev from public.workspace_cases where id=c;
 rev:=public.workspace_associate_report(c,rid,d,ev,rev,'requirement-1',array[0]);
 select record into r from public.workspace_case_reports where case_id=c and id=rid;
 rev:=public.workspace_write_report(c,rid,'update',rev,r,null,d);
 select record into r from public.workspace_case_reports where case_id=c and id=rid;
 perform pg_temp.pdf_assert(r->>'contentRevision'='0'and jsonb_array_length(r->'associations')=1,'Identical artifact retains content identity and association');
 r:=jsonb_set(r,'{extraction_provenance,pdf_artifact,canonical,checksum}',to_jsonb(repeat('c',64)));
 rev:=public.workspace_write_report(c,rid,'update',rev,r,null,d);
 select record into r from public.workspace_case_reports where case_id=c and id=rid;
 perform pg_temp.pdf_assert(r->>'contentRevision'='1'and jsonb_array_length(r->'associations')=0 and r#>>'{associationHistory,0,reason}'='content-changed','Metadata identity change retires association and advances content revision');
 perform pg_temp.pdf_assert(r#>>'{extraction_provenance,pdf_artifact,canonical,checksum}'=repeat('c',64),'Updated metadata persists');
 begin
  perform public.workspace_write_report(c,rid,'update',rev,jsonb_set(r,'{extraction_provenance,pdf_artifact}','{}'),null,d);
  raise exception 'TEST invalid shared artifact accepted';
 exception when check_violation then null;end;
 perform pg_temp.pdf_assert((select revision=rev from public.workspace_case_reports where case_id=c and id=rid),'Rejected metadata leaves revision intact');
end$$;
rollback;
