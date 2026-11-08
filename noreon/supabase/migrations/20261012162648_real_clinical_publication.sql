-- Trusted real review, isolated from fictional workspace state.
alter table public.patient_clinical_cases add column review jsonb, add column draft_review_token text;
alter table public.patient_clinical_case_events drop constraint patient_clinical_case_events_kind_check;
alter table public.patient_clinical_case_events add constraint patient_clinical_case_events_kind_check check(kind in ('enrolled','assigned','draft-saved','review-prepared','report-approved','result-received','consultation-decided','consultation-completed','plan-published'));
alter table public.patient_care_plans add column retired_at timestamptz;
create table public.patient_clinical_publications (
 id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id),
 plan_id uuid not null unique references public.patient_care_plans(id),request_id uuid not null unique,
 actor_id uuid not null references public.workspace_staff(user_id),case_revision bigint not null,
 evidence_token text not null,evidence jsonb not null,review jsonb not null,draft jsonb not null,
 published_at timestamptz not null default now(),unique(user_id,case_revision)
);
alter table public.patient_clinical_publications enable row level security;
revoke all on public.patient_clinical_publications from public,anon,authenticated,service_role;

alter table public.patient_care_medications add column effective_at timestamptz;
create table public.patient_care_plan_medications (
 plan_id uuid not null,medication_id uuid not null,user_id uuid not null,
 primary key(plan_id,medication_id),
 foreign key(plan_id,user_id) references public.patient_care_plans(id,user_id),
 foreign key(medication_id,user_id) references public.patient_care_medications(id,user_id)
);
alter table public.patient_care_plan_medications enable row level security;
revoke all on public.patient_care_plan_medications from public,anon,authenticated,service_role;
grant select on public.patient_care_plan_medications to authenticated;
create policy own_plan_medications on public.patient_care_plan_medications for select to authenticated using(user_id=(select auth.uid()));

-- A short publication/review transaction freezes source writes, including inserts.
-- NOWAIT is deliberate: source RPCs can have already locked rows before their
-- writes. Never wait for such transactions while holding a source table lock.
-- This is a conservative low-volume implementation, not a per-member throughput design.
create function public.lock_patient_clinical_sources(p_user_id uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
 perform 1 from auth.users where id=p_user_id and phone is not null and phone_confirmed_at is not null for share nowait;
 if not found then raise insufficient_privilege using message='Verified member required';end if;
 perform 1 from public.patient_message_preferences where user_id=p_user_id for share nowait;
 lock table public.profiles,public.patient_consents,public.patient_assessments,public.patient_measurements,public.patient_reports,public.workspace_staff,public.workspace_clinics in share mode nowait;
end $$;
create function public.lock_assigned_clinical_case(p_user_id uuid,p_actor uuid,p_revision bigint,p_token text) returns public.patient_clinical_cases
language plpgsql security definer set search_path='' as $$
declare c public.patient_clinical_cases;e jsonb;
begin
 perform public.lock_patient_clinical_sources(p_user_id);
 select * into c from public.patient_clinical_cases where user_id=p_user_id for update nowait;
 if not found or c.assigned_doctor_id is distinct from p_actor or not exists(select 1 from public.workspace_staff s join public.workspace_clinics k on k.id=s.clinic_id where s.user_id=p_actor and s.role='doctor' and s.active and k.active) then raise insufficient_privilege using message='Assigned active doctor required';end if;
 if c.revision is distinct from p_revision then raise serialization_failure using message='Case changed. Reload and review';end if;
 e:=public.patient_clinical_evidence(p_user_id);
 if e->>'token' is distinct from p_token then raise serialization_failure using message='Evidence changed. Reload and review';end if;
 if e#>>'{data,assessment,completed_at}' is null or e#>>'{data,assessment,urgent_rule}' is not null or e#>'{data,consent}'='null'::jsonb then raise exception 'Complete questionnaire and resolve urgent guidance';end if;
 return c;
end $$;
create function public.prepare_patient_clinical_review(p_user_id uuid,p_actor uuid,p_expected_revision bigint,p_evidence_token text,p_engine jsonb) returns bigint
language plpgsql security definer set search_path='' as $$
declare c public.patient_clinical_cases;n bigint;
begin
 c:=public.lock_assigned_clinical_case(p_user_id,p_actor,p_expected_revision,p_evidence_token);
 if jsonb_typeof(p_engine)<>'object' or nullif(p_engine->>'version','') is null or coalesce(p_engine->>'urgency','') not in ('green','yellow','orange') or jsonb_typeof(p_engine->'tests') is distinct from 'array' or jsonb_array_length(p_engine->'tests')>50 then raise exception 'Trusted clinical recommendations unavailable';end if;
 if exists(select 1 from jsonb_array_elements(p_engine->'tests') t where nullif(t->>'id','') is null or nullif(t->>'title','') is null or t->>'method' not in ('lab','clinic','home-log')) or (select count(*)<>count(distinct t->>'id') from jsonb_array_elements(p_engine->'tests') t) then raise exception 'Invalid trusted requirements';end if;
 if c.review->>'evidenceToken'=p_evidence_token and c.review->'engine'=p_engine and c.review->>'doctorId'=p_actor::text then return c.revision;end if;
 update public.patient_clinical_cases set review=jsonb_build_object('evidenceToken',p_evidence_token,'doctorId',p_actor,'preparedAt',now(),'engine',p_engine,'approvals','{}'::jsonb,'receipts','{}'::jsonb,'consultation',jsonb_build_object('decision','undecided')),revision=revision+1,updated_at=now() where user_id=p_user_id returning revision into n;
 insert into public.patient_clinical_case_events(user_id,revision,kind,actor_id,detail) values(p_user_id,n,'review-prepared',p_actor,jsonb_build_object('evidenceToken',p_evidence_token,'engineVersion',p_engine->>'version'));
 return n;
end $$;
create function public.command_patient_clinical_review(p_user_id uuid,p_expected_revision bigint,p_evidence_token text,p_operation text,p_input jsonb) returns bigint
language plpgsql security definer set search_path='' as $$
declare c public.patient_clinical_cases;r public.patient_reports;v jsonb;n bigint;test jsonb;indices jsonb;stamp timestamptz;kind text;
begin
 c:=public.lock_assigned_clinical_case(p_user_id,auth.uid(),p_expected_revision,p_evidence_token);v:=c.review;
 if v is null or v->>'evidenceToken' is distinct from p_evidence_token or v->>'doctorId' is distinct from auth.uid()::text then raise exception 'Refresh clinical recommendations before review';end if;
 if p_operation in ('approve-report','receive-result') then
  select * into r from public.patient_reports where id=(p_input->>'reportId')::uuid and user_id=p_user_id and deleted_at is null;
  if not found or r.state<>'confirmed' or r.confirmed_at is null or r.reviewed is null or r.revision is distinct from (p_input->>'reportRevision')::integer then raise exception 'Confirm and review the current source report';end if;
  if p_input->>'sourceChecked' is distinct from 'true' then raise exception 'Check the original source document';end if;
  if p_operation='approve-report' then
   v:=jsonb_set(v,array['approvals',r.id::text],jsonb_build_object('revision',r.revision,'actorId',auth.uid(),'at',now()));kind:='report-approved';
  else
   select t into test from jsonb_array_elements(v#>'{engine,tests}') t where t->>'id'=p_input->>'testId';
   if test is null or test->>'method'<>'lab' then raise exception 'This required test needs a supported native evidence pathway';end if;
   if v#>>array['approvals',r.id::text,'revision'] is distinct from r.revision::text then raise exception 'Approve this source revision first';end if;
   indices:=p_input->'rows';
   if jsonb_typeof(indices) is distinct from 'array' or jsonb_array_length(indices) not between 1 and 100 or nullif(btrim(p_input->>'note'),'') is null or length(p_input->>'note')>2000 then raise exception 'Select source rows and describe their relevance';end if;
   if r.reviewed->>'reportDate' is null or (r.reviewed->>'reportDate')::date>current_date then raise exception 'A valid past collection date is required';end if;
   if exists(select 1 from jsonb_array_elements(indices) i where jsonb_typeof(i)<>'number' or i::text !~ '^[0-9]+$' or (i::text)::int>=jsonb_array_length(r.reviewed->'rows') or r.reviewed#>>array['rows',i::text,'uncertain'] is distinct from 'false' or nullif(btrim(r.reviewed#>>array['rows',i::text,'literal']),'') is null) then raise exception 'Every selected source row must be readable and confirmed';end if;
   v:=jsonb_set(v,array['receipts',test->>'id'],jsonb_build_object('reportId',r.id,'reportRevision',r.revision,'rows',indices,'note',btrim(p_input->>'note'),'actorId',auth.uid(),'at',now()));kind:='result-received';
  end if;
 elsif p_operation='consultation-decision' then
  if coalesce(p_input->>'decision','') not in ('required','not-required') or nullif(btrim(p_input->>'note'),'') is null or length(p_input->>'note')>2000 then raise exception 'Record an explicit consultation decision and reason';end if;
  v:=jsonb_set(v,'{consultation}',jsonb_build_object('decision',p_input->>'decision','note',btrim(p_input->>'note'),'actorId',auth.uid(),'at',now()));kind:='consultation-decided';
 elsif p_operation='complete-consultation' then
  stamp:=(p_input->>'completedAt')::timestamptz;
  if v#>>'{consultation,decision}' is distinct from 'required' or stamp is null or stamp>now() or stamp<(v->>'preparedAt')::timestamptz or nullif(btrim(p_input->>'note'),'') is null or length(p_input->>'note')>2000 or coalesce(p_input->>'mode','') not in ('phone','video','in-person') then raise exception 'Record the actual completed consultation and time';end if;
  v:=jsonb_set(v,'{consultation}',v->'consultation'||jsonb_build_object('completedAt',stamp,'completedBy',auth.uid(),'completionNote',btrim(p_input->>'note'),'mode',p_input->>'mode','evidenceToken',p_evidence_token));kind:='consultation-completed';
 else raise exception 'Unsupported clinical command';end if;
 update public.patient_clinical_cases set review=v,revision=revision+1,updated_at=now() where user_id=p_user_id returning revision into n;
 insert into public.patient_clinical_case_events(user_id,revision,kind,actor_id,detail) values(p_user_id,n,kind,auth.uid(),jsonb_build_object('evidenceToken',p_evidence_token));return n;
end $$;
-- Preserve the existing validated draft command and bind it to reviewed sources/gates too.
alter function public.save_patient_clinical_draft(uuid,bigint,text,jsonb) rename to save_patient_clinical_draft_before_review;
revoke all on function public.save_patient_clinical_draft_before_review(uuid,bigint,text,jsonb) from public,anon,authenticated,service_role;
create function public.save_patient_clinical_draft(p_user_id uuid,p_expected_revision bigint,p_evidence_token text,p_draft jsonb) returns bigint
language plpgsql security definer set search_path='' as $$
declare n bigint;
begin
 perform public.lock_assigned_clinical_case(p_user_id,auth.uid(),p_expected_revision,p_evidence_token);
 n:=public.save_patient_clinical_draft_before_review(p_user_id,p_expected_revision,p_evidence_token,p_draft);
 update public.patient_clinical_cases set draft_review_token=md5(review::text) where user_id=p_user_id;return n;
end $$;
alter function public.patient_clinical_case_snapshot(uuid) rename to patient_clinical_case_snapshot_before_review;
revoke all on function public.patient_clinical_case_snapshot_before_review(uuid) from public,anon,authenticated,service_role;
create function public.patient_clinical_case_snapshot(p_user_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare s jsonb;c public.patient_clinical_cases;
begin
 s:=public.patient_clinical_case_snapshot_before_review(p_user_id);
 select * into c from public.patient_clinical_cases where user_id=p_user_id;
 return s||jsonb_build_object('review',c.review,'draftStale',(s->>'draftStale')::boolean or (c.draft is not null and c.draft_review_token is distinct from md5(c.review::text)),'publications',(select coalesce(jsonb_agg(jsonb_build_object('planId',plan_id,'publishedAt',published_at,'draft',draft) order by published_at desc),'[]') from public.patient_clinical_publications where user_id=p_user_id));
end $$;
create function public.publish_patient_clinical_plan(p_user_id uuid,p_actor uuid,p_expected_revision bigint,p_evidence_token text,p_engine jsonb,p_request_id uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare c public.patient_clinical_cases;e jsonb;v jsonb;pub public.patient_clinical_publications;pid uuid;stamp timestamptz;label text;n bigint;test jsonb;receipt jsonb;r public.patient_reports;tid uuid;mid uuid;prior_plan uuid;row_index jsonb;source_row jsonb;
begin
 -- No auto-retry: a lock conflict rolls the entire command back for explicit reload.
 perform public.lock_patient_clinical_sources(p_user_id);
 select * into c from public.patient_clinical_cases where user_id=p_user_id for update nowait;
 if c.assigned_doctor_id is distinct from p_actor or not exists(select 1 from public.workspace_staff s join public.workspace_clinics k on k.id=s.clinic_id where s.user_id=p_actor and s.role='doctor' and s.active and k.active) then raise insufficient_privilege using message='Assigned active doctor required';end if;
 select * into pub from public.patient_clinical_publications where request_id=p_request_id;
 if found then
  if pub.user_id<>p_user_id or pub.actor_id<>p_actor or pub.evidence_token<>p_evidence_token or pub.review->'engine' is distinct from p_engine then raise exception 'Publication request conflict';end if;
  return pub.plan_id;
 end if;
 c:=public.lock_assigned_clinical_case(p_user_id,p_actor,p_expected_revision,p_evidence_token);
 v:=c.review;e:=public.patient_clinical_evidence(p_user_id);
 if v is null or v->>'evidenceToken' is distinct from p_evidence_token or v->>'doctorId' is distinct from p_actor::text or v->'engine' is distinct from p_engine or coalesce(p_engine->>'urgency','') not in ('green','yellow','orange') then raise exception 'Refresh current clinical recommendations';end if;
 if c.draft_saved_by is distinct from p_actor or c.draft_evidence_token is distinct from p_evidence_token or c.draft_review_token is distinct from md5(v::text) or not public.workspace_valid_review_draft(c.draft) then raise exception 'Save a valid draft after reviewing the current evidence and gates';end if;
 if exists(select 1 from public.patient_reports src where src.user_id=p_user_id and src.deleted_at is null and (src.state<>'confirmed' or src.reviewed is null or v#>>array['approvals',src.id::text,'revision'] is distinct from src.revision::text)) then raise exception 'Approve every current imported source report';end if;
 for test in select * from jsonb_array_elements(v#>'{engine,tests}') loop
  receipt:=v#>array['receipts',test->>'id'];
  if test->>'method'<>'lab' then raise exception 'A required clinic or home-log test has no supported native receipt pathway';end if;
  if receipt is null then raise exception 'Receive every required laboratory result';end if;
  select * into r from public.patient_reports where id=(receipt->>'reportId')::uuid and user_id=p_user_id and deleted_at is null;
  if not found or r.state<>'confirmed' or r.revision::text is distinct from receipt->>'reportRevision' or v#>>array['approvals',r.id::text,'revision'] is distinct from r.revision::text then raise exception 'Required source receipt is stale';end if;
 end loop;
 if v#>>'{consultation,decision}' not in ('required','not-required') or v#>>'{consultation,decision}' is null then raise exception 'Record an explicit consultation decision';end if;
 if v#>>'{consultation,decision}'='required' and (v#>>'{consultation,completedAt}' is null or (v#>>'{consultation,completedAt}')::timestamptz>now() or v#>>'{consultation,evidenceToken}' is distinct from p_evidence_token) then raise exception 'Complete the consultation for the current evidence';end if;
 -- Never lock medication rows after plans: dose commands lock medication then plan.
 select id into prior_plan from public.patient_care_plans where user_id=p_user_id and active for update nowait;
 stamp:=now();select display_name into label from public.workspace_staff where user_id=p_actor;
 update public.patient_care_plans set active=false,retired_at=stamp where user_id=p_user_id and active;
 insert into public.patient_care_plans(user_id,clinician,published_at,instructions) values(p_user_id,label,stamp,concat_ws(E'\n\n',c.draft->>'explanation',c.draft->>'instructions',nullif(c.draft->>'followUp',''))) returning id into pid;
 if nullif(btrim(c.draft->>'medicationName'),'') is not null then
  select m.id into mid from public.patient_care_medications m join public.patient_care_plan_medications link on link.medication_id=m.id and link.plan_id=prior_plan
  where m.user_id=p_user_id and m.name=c.draft->>'medicationName' and m.dose=c.draft->>'medicationDose' and m.instructions=c.draft->>'medicationInstructions'
  and array(select distinct t from unnest(m.times) t order by t)=array(select distinct value::time from jsonb_array_elements_text(c.draft->'medicationTimes') order by value::time);
  if mid is null then
   insert into public.patient_care_medications(user_id,plan_id,name,dose,instructions,times,start_date,effective_at) values(p_user_id,pid,c.draft->>'medicationName',c.draft->>'medicationDose',c.draft->>'medicationInstructions',array(select value::time from jsonb_array_elements_text(c.draft->'medicationTimes')),timezone('Asia/Yerevan',stamp)::date,stamp) returning id into mid;
  end if;
  insert into public.patient_care_plan_medications(plan_id,medication_id,user_id) values(pid,mid,p_user_id);
 end if;
 -- Copy only doctor-received, actual source data. Non-numeric printed rows remain
 -- verbatim in the immutable publication, without a fabricated numeric conversion.
 for test in select * from jsonb_array_elements(v#>'{engine,tests}') loop
  receipt:=v#>array['receipts',test->>'id'];
  select * into r from public.patient_reports where id=(receipt->>'reportId')::uuid and user_id=p_user_id;
  insert into public.patient_care_tests(user_id,title,preparation,status,ordered_by,ordered_at,source,source_label)
  values(p_user_id,test->>'title',test->>'preparation','collected',label,(v->>'preparedAt')::timestamptz,'laboratory',coalesce(nullif(r.reviewed->>'laboratory',''),'Source report')) returning id into tid;
  for row_index in select * from jsonb_array_elements(receipt->'rows') loop
   source_row:=r.reviewed#>array['rows',row_index::text];
   if length(source_row->>'literal')<=30 and source_row->>'literal' ~ '^-?[0-9]+([.,][0-9]+)?$' and nullif(btrim(source_row->>'unit'),'') is not null then
    insert into public.patient_care_results(user_id,test_id,marker,value,unit,collected_at,received_at,source,source_label,reviewed_at,reviewed_by,explanation)
    values(p_user_id,tid,source_row->>'name',replace(source_row->>'literal',',','.')::double precision,source_row->>'unit',((r.reviewed->>'reportDate')||'T00:00:00+04:00')::timestamptz,(receipt->>'at')::timestamptz,'laboratory',coalesce(nullif(r.reviewed->>'laboratory',''),'Source report'),stamp,label,receipt->>'note');
   end if;
  end loop;
 end loop;
 update public.patient_clinical_cases set revision=revision+1,updated_at=stamp where user_id=p_user_id returning revision into n;
 insert into public.patient_clinical_publications(user_id,plan_id,request_id,actor_id,case_revision,evidence_token,evidence,review,draft,published_at) values(p_user_id,pid,p_request_id,p_actor,n,p_evidence_token,e->'data',v,c.draft,stamp);
 insert into public.patient_clinical_case_events(user_id,revision,kind,actor_id,detail) values(p_user_id,n,'plan-published',p_actor,jsonb_build_object('planId',pid));
 -- Native enqueue only qualifies explicit current channel consent; never fabricates it.
 perform public.enqueue_patient_plan_message(pid);
 return pid;
end $$;
create function public.patient_published_clinical_reviews() returns jsonb
language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('planId',plan_id,'publishedAt',published_at,'draft',draft,'receipts',review->'receipts','reports',evidence->'reports') order by published_at desc),'[]') from public.patient_clinical_publications where user_id=auth.uid()
$$;
-- Clinical publication/order content is immutable; plan acknowledgement and retirement
-- remain mutable through their existing narrow commands.
create function public.preserve_real_clinical_history() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if tg_table_name='patient_care_plans' and not exists(select 1 from public.patient_clinical_publications where plan_id=old.id) then if tg_op='DELETE' then return old;else return new;end if;end if;
 if tg_table_name='patient_care_medications' and not exists(select 1 from public.patient_clinical_publications where plan_id=(to_jsonb(old)->>'plan_id')::uuid) then if tg_op='DELETE' then return old;else return new;end if;end if;
 if tg_table_name='patient_care_plans' and tg_op='UPDATE' then
  if (to_jsonb(new)-array['active','acknowledged_at','retired_at']) is not distinct from (to_jsonb(old)-array['active','acknowledged_at','retired_at']) then return new;end if;
 end if;
 raise exception 'Published clinical history is immutable';
end $$;
create trigger preserve_real_publication before update or delete on public.patient_clinical_publications for each row execute function public.preserve_real_clinical_history();
create trigger preserve_real_plan before update or delete on public.patient_care_plans for each row execute function public.preserve_real_clinical_history();
create trigger preserve_real_medication before update or delete on public.patient_care_medications for each row execute function public.preserve_real_clinical_history();
revoke all on function public.lock_patient_clinical_sources(uuid),public.lock_assigned_clinical_case(uuid,uuid,bigint,text),public.prepare_patient_clinical_review(uuid,uuid,bigint,text,jsonb),public.command_patient_clinical_review(uuid,bigint,text,text,jsonb),public.save_patient_clinical_draft(uuid,bigint,text,jsonb),public.patient_clinical_case_snapshot(uuid),public.publish_patient_clinical_plan(uuid,uuid,bigint,text,jsonb,uuid),public.patient_published_clinical_reviews(),public.preserve_real_clinical_history() from public,anon,authenticated,service_role;
grant execute on function public.prepare_patient_clinical_review(uuid,uuid,bigint,text,jsonb),public.publish_patient_clinical_plan(uuid,uuid,bigint,text,jsonb,uuid) to service_role;
grant execute on function public.command_patient_clinical_review(uuid,bigint,text,text,jsonb),public.save_patient_clinical_draft(uuid,bigint,text,jsonb),public.patient_clinical_case_snapshot(uuid),public.patient_published_clinical_reviews() to authenticated;

create trigger preserve_real_plan_medications before update or delete on public.patient_care_plan_medications for each row execute function public.preserve_real_clinical_history();
-- Preserve unchanged medication identity across plans, and allow an existing report
-- to be corrected within the original same-day/midnight window after replacement.
-- Never create a new historical event for a retired medication order.
create or replace function public.report_patient_dose_unversioned(p_medication_id uuid,p_due_at timestamptz,p_status text)
returns void language plpgsql security definer set search_path='' as $$
declare m public.patient_care_medications;plan public.patient_care_plans;local_due timestamp;today date;crosses_midnight boolean;
begin
 if auth.uid() is null or p_status is null or p_status not in ('taken','skipped') then raise exception 'invalid dose report';end if;
 select * into m from public.patient_care_medications where id=p_medication_id and user_id=auth.uid() for share;
 if not found or not m.active then raise exception 'medication unavailable';end if;
 select p.* into plan from public.patient_care_plans p where p.user_id=auth.uid() and (p.id=m.plan_id or exists(select 1 from public.patient_care_plan_medications link where link.plan_id=p.id and link.medication_id=m.id)) order by p.published_at desc,p.id limit 1 for share of p;
 if not found or plan.published_at>now() then raise exception 'plan unavailable';end if;
 if not plan.active and (plan.retired_at is null or p_due_at>=plan.retired_at or not exists(select 1 from public.patient_dose_events where user_id=auth.uid() and medication_id=m.id and due_at=p_due_at)) then raise exception 'plan unavailable';end if;
 local_due:=timezone('Asia/Yerevan',p_due_at);today:=timezone('Asia/Yerevan',now())::date;
 crosses_midnight:=(local_due+interval '15 minutes')::date=today and exists(select 1 from public.patient_reminder_preferences where user_id=auth.uid() and preferences->>'medicationOffsetMinutes'='15');
 if p_due_at is null or p_due_at>now() or p_due_at<coalesce(m.effective_at,plan.published_at) or (local_due::date<>today and not crosses_midnight) or local_due::date<m.start_date or (m.end_date is not null and local_due::date>m.end_date) or not(local_due::time=any(m.times)) then raise exception 'dose outside schedule';end if;
 insert into public.patient_dose_events(user_id,medication_id,due_at,status) values(auth.uid(),m.id,p_due_at,p_status) on conflict(user_id,medication_id,due_at) do update set status=excluded.status,recorded_at=now();
end $$;
revoke all on function public.report_patient_dose_unversioned(uuid,timestamptz,text) from public,anon,authenticated,service_role;
