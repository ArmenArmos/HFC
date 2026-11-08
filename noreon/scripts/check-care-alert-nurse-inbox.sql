-- Owned synthetic database/CI only. No fixture or read survives this transaction.
-- The assigned nurse reads the live urgent alerts of her own members, open first, and nothing else: not another nurse's members,
-- not resolved alerts. Full staff fields support her follow-up actions. Doctors, admins and signed-out callers are refused here (they have care_alert_inbox).
-- Every member returned is audited, and an audit failure would refuse the read.
\set ON_ERROR_STOP on
begin;
create function pg_temp.na_actor(id uuid) returns void language plpgsql as $$begin
 perform set_config('request.jwt.claim.sub',id::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',id,'role','authenticated','session_id',id,'amr',jsonb_build_array(jsonb_build_object('method','password')))::text,true);
end$$;
do $$declare clinic uuid:=gen_random_uuid();a uuid:=gen_random_uuid();d uuid:=gen_random_uuid();n uuid:=gen_random_uuid();n2 uuid:=gen_random_uuid();u uuid;
 m1 uuid:='e9000000-0000-4000-8000-000000000001';m2 uuid:='e9000000-0000-4000-8000-000000000002';m3 uuid:='e9000000-0000-4000-8000-000000000003';m4 uuid:='e9000000-0000-4000-8000-000000000004';m5 uuid:='e9000000-0000-4000-8000-000000000005';begin
 perform set_config('test.na_admin',a::text,true);perform set_config('test.na_doctor',d::text,true);perform set_config('test.na_nurse',n::text,true);perform set_config('test.na_nurse2',n2::text,true);
 insert into public.workspace_clinics(id,name)values(clinic,'Synthetic nurse alerts clinic');
 foreach u in array array[a,d,n,n2]loop
  insert into auth.users(id,email)values(u,u||'@example.invalid');
  insert into auth.sessions(id,user_id,created_at,updated_at)values(u,u,clock_timestamp(),clock_timestamp());
 end loop;
 insert into public.workspace_staff(user_id,role,display_name,clinic_id)values(a,'admin','Alerts admin',null),(d,'doctor','Alerts doctor',clinic),(n,'nurse','Alerts nurse',clinic),(n2,'nurse','Other alerts nurse',clinic);
 -- m1 (acknowledged), m2 (open), m3 (resolved) belong to nurse n; m4 belongs to nurse n2; m5 has no nurse.
 foreach u in array array[m1,m2,m3,m4,m5]loop
  insert into auth.users(id,email)values(u,u||'@example.invalid');
  insert into public.profiles(id,display_name)values(u,'Alert member '||right(u::text,1))on conflict(id)do update set display_name=excluded.display_name;
 end loop;
 insert into public.patient_clinical_cases(user_id,assigned_doctor_id,assigned_nurse_id,created_at)values(m1,d,n,'2026-01-01T00:00:00Z'),(m2,d,n,'2026-01-02T00:00:00Z'),(m3,d,n,'2026-01-03T00:00:00Z'),(m4,d,n2,'2026-01-04T00:00:00Z'),(m5,d,null,'2026-01-05T00:00:00Z');
 insert into public.care_alerts(member_id,source,reason_code,rule_id,rule_version,source_ref,doctor_id,state,acknowledged_by,acknowledged_at,resolved_by,resolved_at,resolution,resolution_note,created_at,last_seen_at)values
  (m1,'zoe','zoe_urgent_route','zoe.urgent','1','turn-1',d,'acknowledged',d,clock_timestamp(),null,null,null,null,'2026-02-01T08:00:00Z','2026-02-01T08:00:00Z'),
  (m2,'zoe','zoe_self_harm','zoe.self_harm','1','turn-2',d,'open',null,null,null,null,null,null,'2026-02-02T08:00:00Z','2026-02-02T08:00:00Z'),
  (m3,'zoe','zoe_refused_103','zoe.refused','1','turn-3',d,'resolved',d,clock_timestamp(),d,clock_timestamp(),'member_contacted','secret staff note','2026-02-03T08:00:00Z','2026-02-03T08:00:00Z'),
  (m2,'questionnaire','questionnaire_red_flag','rule.q','1','assess-2',d,'open',null,null,null,null,null,null,'2026-02-06T08:00:00Z','2026-02-06T08:00:00Z'),
  (m4,'zoe','zoe_self_harm','zoe.self_harm','1','turn-4',d,'open',null,null,null,null,null,null,'2026-02-04T08:00:00Z','2026-02-04T08:00:00Z'),
  (m5,'zoe','zoe_self_harm','zoe.self_harm','1','turn-5',d,'open',null,null,null,null,null,null,'2026-02-05T08:00:00Z','2026-02-05T08:00:00Z');
end$$;
create function pg_temp.na_audits() returns table(member_id uuid) language sql security definer set search_path='' as $$
 select a.member_id from public.access_audit a where a.actor_id=auth.uid() and a.surface='care_alert_inbox' order by a.member_id
$$;
set local role authenticated;
do $$declare r jsonb;ids text[];ex text;begin
 perform pg_temp.na_actor(current_setting('test.na_nurse')::uuid);
 r:=public.care_alert_nurse_inbox();
 if r->>'ok'<>'true'then raise exception 'The nurse read must succeed: %',r;end if;
 select array_agg(x->>'memberId' order by ord)into ids from jsonb_array_elements(r->'alerts')with ordinality t(x,ord);
 -- Open first (m2), then the acknowledged one (m1). Resolved (m3), another nurse's (m4) and unassigned (m5) members never appear.
 if ids is distinct from array['e9000000-0000-4000-8000-000000000002','e9000000-0000-4000-8000-000000000002','e9000000-0000-4000-8000-000000000001']then raise exception 'Expected only own live alerts, open first, got %',ids;end if;
 if r#>>'{alerts,0,source}'<>'zoe' or r#>>'{alerts,1,source}'<>'questionnaire' then raise exception 'Zoe and member-word alerts come before questionnaire alerts even when the questionnaire one is newer: %',r;end if;
 if (r->>'total')::int<>3 then raise exception 'Total counts only own live alerts, got %',r->>'total';end if;
 if r#>>'{alerts,0,reason}'<>'zoe_self_harm' or r#>>'{alerts,0,state}'<>'open' or r#>>'{alerts,0,memberName}'<>'Alert member 2' then raise exception 'Alert fields are not the open self-harm alert: %',r->'alerts'->0;end if;
 -- The assigned nurse receives the full staff card for her own live alerts; resolved rows remain absent.
 if r::text like '%secret staff note%' then raise exception 'A resolved alert appeared in the live nurse inbox';end if;
 if not((r#>'{alerts,0}') ?& array['ownerName','ownerRole','primaryOwnerName','primaryOwnerRole','nextAction','nextActionAt','resolutionNote','telegram'])
  or r#>>'{alerts,0,ownerName}'<>'Alerts nurse' or r#>>'{alerts,0,ownerRole}'<>'nurse'then raise exception 'Expected full assigned-nurse card fields: %',r;end if;
 -- Both returned members are audited, and nobody else is.
 if (select array_agg(member_id::text order by member_id) from pg_temp.na_audits()) is distinct from array['e9000000-0000-4000-8000-000000000001','e9000000-0000-4000-8000-000000000002']then raise exception 'Expected one audit row for each returned member';end if;

 -- The other nurse sees only hers.
 perform pg_temp.na_actor(current_setting('test.na_nurse2')::uuid);
 r:=public.care_alert_nurse_inbox();
 if jsonb_array_length(r->'alerts')<>1 or r#>>'{alerts,0,memberId}'<>'e9000000-0000-4000-8000-000000000004'then raise exception 'The other nurse must see only her own member: %',r;end if;

 -- A limit below the number of alerts still reports the full total.
 perform pg_temp.na_actor(current_setting('test.na_nurse')::uuid);
 r:=public.care_alert_nurse_inbox(1);
 if jsonb_array_length(r->'alerts')<>1 or (r->>'total')::int<>3 or r#>>'{alerts,0,source}'<>'zoe' then raise exception 'Limit 1 returns the first alert in order, with total 3: %',r;end if;

 -- Two reads so far by this nurse: the full one (m1 and m2) and the limited one (m2 only). m1 was audited once, m2 twice.
 if (select count(*)from pg_temp.na_audits()where member_id='e9000000-0000-4000-8000-000000000001')<>1 or (select count(*)from pg_temp.na_audits()where member_id='e9000000-0000-4000-8000-000000000002')<>2 then
  raise exception 'A limited read must audit only the members it returned';end if;

 -- A full card enables actions only on her assigned members.
 perform pg_temp.na_actor(current_setting('test.na_nurse2')::uuid);
 if public.care_alert_acknowledge((r#>>'{alerts,0,id}')::uuid,(r#>>'{alerts,0,stateSeq}')::bigint)->>'code'<>'not_found'then raise exception 'Other nurse acknowledged an unrelated member';end if;
 perform pg_temp.na_actor(current_setting('test.na_nurse')::uuid);
 if public.care_alert_acknowledge((r#>>'{alerts,0,id}')::uuid,(r#>>'{alerts,0,stateSeq}')::bigint)#>>'{alert,state}'<>'acknowledged'then raise exception 'Assigned nurse must be able to acknowledge her own alert';end if;

 -- Doctors and admins use care_alert_inbox; this read is refused for them.
 foreach ex in array array[current_setting('test.na_doctor'),current_setting('test.na_admin')]loop
  perform pg_temp.na_actor(ex::uuid);
  begin perform public.care_alert_nurse_inbox();raise exception 'Refusal expected for a non-nurse';
  exception when insufficient_privilege then null;end;
 end loop;
 -- Signed out.
 perform set_config('request.jwt.claims','',true);perform set_config('request.jwt.claim.sub','',true);
 begin perform public.care_alert_nurse_inbox();raise exception 'Refusal expected without a session';
 exception when insufficient_privilege then null;end;
end$$;
-- Revocation: what she may read follows the current assignment, doctor, clinic and her own account, within the one statement.
create function pg_temp.na_total() returns text language plpgsql as $$begin
 perform pg_temp.na_actor(current_setting('test.na_nurse')::uuid);
 return (public.care_alert_nurse_inbox()->>'total');
end$$;
reset role;
update public.workspace_staff set active=false where user_id=current_setting('test.na_doctor')::uuid;
set local role authenticated;
do $$begin if pg_temp.na_total()<>'0' then raise exception 'An inactive assigned doctor leaves her with no alerts';end if;end$$;
reset role;
update public.workspace_staff set active=true where user_id=current_setting('test.na_doctor')::uuid;
insert into public.workspace_clinics(id,name)values('e9ffffff-0000-4000-8000-000000000001','Another synthetic nurse alerts clinic');
update public.workspace_staff set clinic_id='e9ffffff-0000-4000-8000-000000000001' where user_id=current_setting('test.na_nurse')::uuid;
set local role authenticated;
do $$begin if pg_temp.na_total()<>'0' then raise exception 'A nurse in another clinic than the doctor reads nothing';end if;end$$;
reset role;
update public.workspace_staff set clinic_id=(select clinic_id from public.workspace_staff where user_id=current_setting('test.na_doctor')::uuid) where user_id=current_setting('test.na_nurse')::uuid;
update public.patient_clinical_cases set assigned_nurse_id=current_setting('test.na_nurse2')::uuid where user_id='e9000000-0000-4000-8000-000000000002';
set local role authenticated;
do $$declare r jsonb;begin
 perform pg_temp.na_actor(current_setting('test.na_nurse')::uuid);r:=public.care_alert_nurse_inbox();
 if (r->>'total')<>'1' or r#>>'{alerts,0,memberId}'<>'e9000000-0000-4000-8000-000000000001' then raise exception 'A reassigned member leaves her list at once: %',r;end if;
end$$;
reset role;
update public.workspace_staff set active=false where user_id=current_setting('test.na_nurse')::uuid;
set local role authenticated;
do $$begin
 perform pg_temp.na_actor(current_setting('test.na_nurse')::uuid);
 begin perform public.care_alert_nurse_inbox();raise exception 'Refusal expected for a deactivated nurse';
 exception when insufficient_privilege then null;end;
end$$;
-- The anonymous role cannot execute it at all.
reset role;
do $$begin
 if has_function_privilege('anon','public.care_alert_nurse_inbox(integer)','execute')then raise exception 'anon must not execute care_alert_nurse_inbox';end if;
 if not has_function_privilege('authenticated','public.care_alert_nurse_inbox(integer)','execute')then raise exception 'authenticated must execute care_alert_nurse_inbox';end if;
end$$;
rollback;
select 'care alert nurse inbox ok';
