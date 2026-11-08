\set ON_ERROR_STOP on
begin;
do $$begin if to_regprocedure('public.patient_current_published_clinical_review()') is null then raise exception 'TEST bounded current publication owner read is missing';end if;end$$;
insert into auth.users(id,phone,phone_confirmed_at) values('72000000-0000-4000-8000-000000000001','37499000201',now()),('72000000-0000-4000-8000-000000000002','37499000202',now()),('72000000-0000-4000-8000-000000000003',null,null);
insert into public.workspace_staff(user_id,role,display_name) values('72000000-0000-4000-8000-000000000003','admin','Current publication fixture');
insert into public.patient_care_plans(id,user_id,clinician,instructions,active,published_at) values('72000000-0000-4000-8000-000000000011','72000000-0000-4000-8000-000000000001','Recorded doctor','Old plan',false,now()-interval '1 day'),('72000000-0000-4000-8000-000000000012','72000000-0000-4000-8000-000000000001','Recorded doctor','Current plan',true,now());
insert into public.patient_clinical_publications(user_id,plan_id,request_id,actor_id,case_revision,evidence_token,evidence,review,draft)
select '72000000-0000-4000-8000-000000000001',plan,gen_random_uuid(),'72000000-0000-4000-8000-000000000003',n,'fixture-token',
'{"reports":[{"id":"72000000-0000-4000-8000-000000000021","reviewed":{"laboratory":"Recorded source","reportDate":"2026-10-12","personName":"PRIVATE UNSELECTED REPORT METADATA","rows":[{"name":"Urine protein","literal":"Trace","unit":null,"reference":"Negative","page":1,"snippet":"Trace","uncertain":false},{"name":"UNSELECTED ROW","literal":"Not released"}]}},{"id":"72000000-0000-4000-8000-000000000022","reviewed":{"rows":[{"name":"UNSELECTED REPORT"}]}}]}',
'{"consultation":{"note":"PRIVATE CONSULTATION"},"receipts":{"first":{"reportId":"72000000-0000-4000-8000-000000000021","rows":[0],"note":"Member note"},"second":{"reportId":"72000000-0000-4000-8000-000000000021","rows":[0],"note":"Also relevant"}}}',
jsonb_build_object('explanation',case when n=1 then 'Old explanation' else 'Current explanation' end,'instructions','Recorded instructions','followUp','Recorded follow-up','medicationName','','medicationDose','','medicationInstructions','','medicationTimes','[]'::jsonb)
from(values('72000000-0000-4000-8000-000000000011'::uuid,1),('72000000-0000-4000-8000-000000000012'::uuid,2))p(plan,n);
select set_config('request.jwt.claim.sub','72000000-0000-4000-8000-000000000001',true);
set local role authenticated;
do $$declare p jsonb;begin
 p:=public.patient_current_published_clinical_review();
 if p->>'planId'<>'72000000-0000-4000-8000-000000000012' or p#>>'{draft,explanation}'<>'Current explanation' then raise exception 'TEST wrong active immutable publication';end if;
 if jsonb_array_length(p->'sourceRows')<>1 or p#>>'{sourceRows,0,source,literal}'<>'Trace' or p#>'{sourceRows,0,source,unit}'<>'null'::jsonb then raise exception 'TEST literal selected source not preserved/deduplicated';end if;
 if jsonb_array_length(p#>'{sourceRows,0,notes}')<>2 then raise exception 'TEST member receipt notes lost';end if;
 if p::text like '%PRIVATE%' or p::text like '%UNSELECTED%' or p::text like '%Old explanation%' or p ? 'reports' or p ? 'review' or p ? 'evidence' then raise exception 'TEST unrelated historical/private payload leaked';end if;
end$$;
reset role;
select set_config('request.jwt.claim.sub','72000000-0000-4000-8000-000000000002',true);
set local role authenticated;
do $$begin if public.patient_current_published_clinical_review() is not null then raise exception 'TEST other owner sees publication';end if;end$$;
reset role;
select set_config('request.jwt.claim.sub','72000000-0000-4000-8000-000000000001',true);
update auth.users set phone_confirmed_at=null where id='72000000-0000-4000-8000-000000000001';
set local role authenticated;
do $$begin if public.patient_current_published_clinical_review() is not null then raise exception 'TEST unconfirmed identity sees publication';end if;end$$;
reset role;
update auth.users set phone_confirmed_at=now() where id='72000000-0000-4000-8000-000000000001';
update public.patient_care_plans set active=false where id='72000000-0000-4000-8000-000000000012';
set local role authenticated;
do $$begin if public.patient_current_published_clinical_review() is not null then raise exception 'TEST retired publication returned';end if;end$$;
reset role;
do $$begin if has_function_privilege('anon','public.patient_current_published_clinical_review()','execute') or has_function_privilege('service_role','public.patient_current_published_clinical_review()','execute') then raise exception 'TEST excess RPC grant';end if;end$$;
rollback;
\echo Current publication owner read: active immutable plan only, selected literal rows, notes, isolation and no unrelated/private payload pass.
