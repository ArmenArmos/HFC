-- A published plan version carries a regimen of several medicines (dark: multi_medicine_capabilities and
-- NOREON_MULTI_MEDICINE_ENABLED). Armen's top gap: a plan version held one medicine, so adding a second dropped the first.
--
-- The doctor types and approves every medicine and dose. Nothing here selects, suggests, ranks or titrates a medicine, and
-- no rule looks at what a medicine is: a name is only the identity used to compare two versions.
--
-- Shape. A regimen draft has the key `medicines` and blank legacy medication fields; a draft without the key is the
-- one-medicine shape and still means what it meant. Every publication keeps an immutable regimen row with what changed
-- from the version before; `changes` is written once and never recomputed, so a later change to the comparison cannot
-- rewrite what a member was told. Existing publications are backfilled from their own drafts.
--
-- Approval. A regimen draft publishes only with a hash of that regimen and the plan it replaces, read by the doctor from
-- doctor_regimen_review. A changed draft or a newer published version makes the approval stale.
--
-- Rollback: turn the switch off (and then the environment variable). Published regimens stay readable and dose logging
-- is unchanged; new regimen drafts are refused. While off, a member whose draft or current plan is a regimen cannot get a
-- one-medicine draft saved or published (Astra MM-4): the old form cannot show a regimen, so it would silently empty it.
-- Their next version waits for the switch. Nothing is dropped or rewritten by switching off.
--
-- Unchanged on purpose: publication still refuses a required test that is not a laboratory test (the ECG block is a
-- clinician decision), and orange members stay on hold.

-- 1. The switch ---------------------------------------------------------------------------------------------------
create table public.multi_medicine_capabilities(
 singleton boolean primary key default true check(singleton),
 enabled boolean not null default false,
 updated_at timestamptz not null default clock_timestamp()
);
insert into public.multi_medicine_capabilities(singleton,enabled)values(true,false);
alter table public.multi_medicine_capabilities enable row level security;
revoke all on public.multi_medicine_capabilities from public,anon,authenticated,service_role;
create function public._multi_medicine_enabled()returns boolean language sql stable security definer set search_path=''as $$
 select coalesce((select enabled from public.multi_medicine_capabilities where singleton),false)
$$;

-- 2. Regimens as data ---------------------------------------------------------------------------------------------
-- The identity of a medicine across versions: its name as the doctor typed it, ignoring case and spacing. Not a drug lookup.
create function public._regimen_name_key(p text)returns text language sql immutable set search_path=''as $$
 select lower(regexp_replace(public.workspace_js_trim(p),'\s+',' ','g'))
$$;
-- One canonical list for either draft shape, in the doctor's order, with times sorted and distinct.
create function public._draft_regimen(d jsonb)returns jsonb language sql immutable set search_path=''as $$
 select case
  when d is null then '[]'::jsonb
  when d?'medicines' then coalesce((select jsonb_agg(jsonb_build_object('name',public.workspace_js_trim(m->>'name'),'dose',public.workspace_js_trim(m->>'dose'),
     'instructions',public.workspace_js_trim(m->>'instructions'),
     'times',(select coalesce(jsonb_agg(t order by t),'[]'::jsonb)from(select distinct value t from jsonb_array_elements(m->'times'))q))order by o)
    from jsonb_array_elements(d->'medicines')with ordinality x(m,o)),'[]'::jsonb)
  when public.workspace_js_trim(coalesce(d->>'medicationName',''))<>''then jsonb_build_array(public.workspace_medication_fields(d))
  else '[]'::jsonb end
$$;
-- What changed between two regimens. Facts only: a medicine is started, stopped, or its dose, times or instructions differ.
-- A null previous regimen is a first version, which has nothing to compare with.
create function public._regimen_changes(p_prev jsonb,p_next jsonb)returns jsonb language sql immutable set search_path=''as $$
 with prev as(select m,o,public._regimen_name_key(m->>'name')k from jsonb_array_elements(coalesce(p_prev,'[]'::jsonb))with ordinality x(m,o)),
 nxt as(select m,o,public._regimen_name_key(m->>'name')k from jsonb_array_elements(coalesce(p_next,'[]'::jsonb))with ordinality x(m,o)),
 rows as(
  select n.o pos,1 step,jsonb_build_object('kind','started','name',n.m->>'name','dose',n.m->>'dose','times',n.m->'times','instructions',n.m->>'instructions')c from nxt n where not exists(select 1 from prev p where p.k=n.k)
  union all select n.o,2,jsonb_build_object('kind','dose_changed','name',n.m->>'name','fromDose',p.m->>'dose','toDose',n.m->>'dose')from nxt n join prev p on p.k=n.k
   where public._regimen_name_key(p.m->>'dose')is distinct from public._regimen_name_key(n.m->>'dose')
  union all select n.o,3,jsonb_build_object('kind','schedule_changed','name',n.m->>'name','fromTimes',p.m->'times','toTimes',n.m->'times')from nxt n join prev p on p.k=n.k
   where p.m->'times' is distinct from n.m->'times'
  union all select n.o,4,jsonb_build_object('kind','instructions_changed','name',n.m->>'name','fromInstructions',p.m->>'instructions','toInstructions',n.m->>'instructions')from nxt n join prev p on p.k=n.k
   where p.m->>'instructions' is distinct from n.m->>'instructions'
  union all select 1000+p.o,5,jsonb_build_object('kind','stopped','name',p.m->>'name','dose',p.m->>'dose','times',p.m->'times')from prev p where not exists(select 1 from nxt n where n.k=p.k)
 )
 select case when p_prev is null then '[]'::jsonb else coalesce((select jsonb_agg(c order by pos,step)from rows),'[]'::jsonb)end
$$;
-- What the doctor approves: this exact regimen replacing this exact plan.
create function public._regimen_approval_hash(p_regimen jsonb,p_prior uuid)returns text language sql immutable set search_path=''as $$
 select md5(coalesce(p_prior::text,'first')||':'||p_regimen::text)
$$;

-- 3. Draft validity: the one-medicine rules unchanged, plus an optional checked `medicines` list --------------------
create or replace function public.workspace_valid_review_draft(d jsonb)returns boolean
language plpgsql immutable set search_path=''as $$
declare k text;t jsonb;m jsonb;regimen boolean;
begin
 if jsonb_typeof(d) is distinct from 'object' then return false; end if;
 regimen:=d?'medicines';
 if (select count(*) from jsonb_object_keys(d))<>(case when regimen then 8 else 7 end) then return false; end if;
 foreach k in array array['explanation','instructions','followUp','medicationName','medicationDose','medicationInstructions'] loop
  if jsonb_typeof(d->k) is distinct from 'string' then return false; end if;
  d:=jsonb_set(d,array[k],to_jsonb(btrim(d->>k,E' \t\n\r\v\f'||U&'\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF')));
 end loop;
 if public.workspace_text_units(btrim(d->>'explanation')) not between 1 and 1500 or public.workspace_text_units(btrim(d->>'instructions')) not between 1 and 1500
 or btrim(d->>'instructions')='Add the approved care instructions.'
 or public.workspace_text_units(btrim(d->>'followUp'))>500 or public.workspace_text_units(btrim(d->>'medicationInstructions'))>500
 or public.workspace_text_units(btrim(d->>'medicationName'))>120 or public.workspace_text_units(btrim(d->>'medicationDose'))>120
 or jsonb_typeof(d->'medicationTimes') is distinct from 'array' then return false; end if;
 if jsonb_array_length(d->'medicationTimes')>4 then return false; end if;
 for t in select value from jsonb_array_elements(d->'medicationTimes') loop
  if jsonb_typeof(t)<>'string' or (t#>>'{}') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then return false; end if;
 end loop;
 if not regimen then return btrim(d->>'medicationName')='' or (btrim(d->>'medicationDose')<>'' and jsonb_array_length(d->'medicationTimes')>0);end if;
 -- A regimen carries its medicines in the list only, so one medicine can never be read from two places.
 if btrim(d->>'medicationName')<>'' or btrim(d->>'medicationDose')<>'' or btrim(d->>'medicationInstructions')<>'' or jsonb_array_length(d->'medicationTimes')<>0 then return false;end if;
 if jsonb_typeof(d->'medicines') is distinct from 'array' or jsonb_array_length(d->'medicines')>8 then return false;end if;
 for m in select value from jsonb_array_elements(d->'medicines') loop
  if jsonb_typeof(m) is distinct from 'object' or (select count(*) from jsonb_object_keys(m))<>4 then return false;end if;
  foreach k in array array['name','dose','instructions'] loop
   if jsonb_typeof(m->k) is distinct from 'string' then return false;end if;
  end loop;
  if public.workspace_text_units(public.workspace_js_trim(m->>'name')) not between 1 and 120 or public.workspace_text_units(public.workspace_js_trim(m->>'dose')) not between 1 and 120
   or public.workspace_text_units(public.workspace_js_trim(m->>'instructions'))>500 then return false;end if;
  if jsonb_typeof(m->'times') is distinct from 'array' or jsonb_array_length(m->'times') not between 1 and 4 then return false;end if;
  for t in select value from jsonb_array_elements(m->'times') loop
   if jsonb_typeof(t)<>'string' or (t#>>'{}') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then return false;end if;
  end loop;
 end loop;
 -- Versions compare medicines by name, so a name appears once. A second line for the same name is refused, not merged.
 return (select count(*)=count(distinct public._regimen_name_key(value->>'name'))from jsonb_array_elements(d->'medicines'));
end $$;

-- 4. Saving: a regimen draft needs the switch; the AI path goes through this function too --------------------------
create or replace function public.save_patient_clinical_draft(p_user_id uuid,p_expected_revision bigint,p_evidence_token text,p_draft jsonb)returns bigint
language plpgsql security definer set search_path=''as $$
declare n bigint;c public.patient_clinical_cases;
begin
 if not public._real_staff_managed_session_allowed(auth.uid()) then raise insufficient_privilege using message='Current doctor session required';end if;
 if jsonb_typeof(p_draft)='object' and p_draft?'medicines' and not public._multi_medicine_enabled() then raise exception 'Several-medicine plans are switched off';end if;
 c:=public.lock_assigned_clinical_case(p_user_id,auth.uid(),p_expected_revision,p_evidence_token);
 -- A form that cannot show a regimen must not overwrite one.
 if jsonb_typeof(c.draft)='object' and c.draft?'medicines' and not(jsonb_typeof(p_draft)='object' and p_draft?'medicines') then raise exception 'This draft would drop medicines from the current plan';end if;
 n:=public.save_patient_clinical_draft_before_review(p_user_id,p_expected_revision,p_evidence_token,p_draft);
 update public.patient_clinical_cases set draft_review_token=md5(review::text) where user_id=p_user_id;return n;
end $$;

-- 5. Immutable regimen of each published version -----------------------------------------------------------------
create table public.patient_care_plan_regimens(
 plan_id uuid primary key references public.patient_clinical_publications(plan_id),
 user_id uuid not null references auth.users(id),
 previous_plan_id uuid references public.patient_clinical_publications(plan_id),
 medicines jsonb not null check(jsonb_typeof(medicines)='array'),
 changes jsonb not null check(jsonb_typeof(changes)='array'),
 created_at timestamptz not null default clock_timestamp()
);
create index patient_care_plan_regimens_member on public.patient_care_plan_regimens(user_id);
alter table public.patient_care_plan_regimens enable row level security;
revoke all on public.patient_care_plan_regimens from public,anon,authenticated,service_role;

-- Existing publications, oldest first, each compared with the one before it.
insert into public.patient_care_plan_regimens(plan_id,user_id,previous_plan_id,medicines,changes,created_at)
select x.plan_id,x.user_id,x.previous_plan_id,x.regimen,public._regimen_changes(lag(x.regimen)over(partition by x.user_id order by x.version),x.regimen),x.published_at
from(select p.plan_id,p.user_id,v.previous_plan_id,v.version,p.published_at,public._draft_regimen(p.draft)regimen
 from public.patient_clinical_publications p join public.patient_care_plan_versions v on v.plan_id=p.plan_id)x;
create trigger patient_care_plan_regimens_immutable before update or delete on public.patient_care_plan_regimens
 for each row execute function public._patient_visit_immutable();

-- Runs after patient_care_plan_version (triggers fire in name order), which records the plan this one replaced.
create function public._patient_care_plan_regimen()returns trigger
language plpgsql security definer set search_path=''as $$
declare prior uuid;before_this jsonb;now_this jsonb:=public._draft_regimen(new.draft);
begin
 select v.previous_plan_id into prior from public.patient_care_plan_versions v where v.plan_id=new.plan_id;
 select r.medicines into before_this from public.patient_care_plan_regimens r where r.plan_id=prior;
 insert into public.patient_care_plan_regimens(plan_id,user_id,previous_plan_id,medicines,changes,created_at)
 values(new.plan_id,new.user_id,prior,now_this,public._regimen_changes(before_this,now_this),new.published_at);
 return new;
end$$;
create trigger patient_care_plan_version_regimen after insert on public.patient_clinical_publications
 for each row execute function public._patient_care_plan_regimen();

-- 6. Publication: the 20261029211406 definition, with the regimen checks and one order per regimen medicine -----------
create or replace function public.publish_patient_clinical_plan(p_user_id uuid,p_actor uuid,p_expected_revision bigint,p_evidence_token text,p_engine jsonb,p_request_id uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare c public.patient_clinical_cases;e jsonb;v jsonb;pub public.patient_clinical_publications;pid uuid;stamp timestamptz;label text;n bigint;test jsonb;receipt jsonb;r public.patient_reports;tid uuid;mid uuid;prior_plan uuid;row_index jsonb;source_row jsonb;lab_row jsonb;
 regimen jsonb;med jsonb;approval text:=nullif(coalesce(current_setting('noreon.plan_regimen_hash',true),''),'');
begin
 perform set_config('noreon.plan_regimen_hash','',true);
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
 -- Fresh request IDs cannot manufacture an identical plan version or notification.
 -- Assignment and evidence CAS above are checked before this semantic guard.
 if exists(select 1 from public.patient_clinical_publications prior join public.patient_care_plans active_plan on active_plan.id=prior.plan_id and active_plan.user_id=prior.user_id and active_plan.active
  where prior.user_id=p_user_id and prior.actor_id=p_actor and prior.evidence_token=p_evidence_token and prior.review=c.review and prior.draft=c.draft) then raise exception 'Unchanged plan already published. Review and save a changed clinical draft before publishing a new version.';end if;
 v:=c.review;e:=public.patient_clinical_evidence(p_user_id);
 if v is null or v->>'evidenceToken' is distinct from p_evidence_token or v->>'doctorId' is distinct from p_actor::text or v->'engine' is distinct from p_engine or coalesce(p_engine->>'urgency','') not in ('green','yellow','orange') then raise exception 'Refresh current clinical recommendations';end if;
 if c.draft_saved_by is distinct from p_actor or c.draft_evidence_token is distinct from p_evidence_token or c.draft_review_token is distinct from md5(v::text) or not public.workspace_valid_review_draft(c.draft) then raise exception 'Save a valid draft after reviewing the current evidence and gates';end if;
 if exists(select 1 from public.patient_reports src where src.user_id=p_user_id and src.deleted_at is null and (src.state<>'confirmed' or src.reviewed is null or v#>>array['approvals',src.id::text,'revision'] is distinct from src.revision::text)) then raise exception 'Approve every current imported source report';end if;
 for test in select * from jsonb_array_elements(v#>'{engine,tests}') loop
  receipt:=v#>array['receipts',test->>'id'];
  if test->>'method'<>'lab' then raise exception 'A required clinic or home-log test has no supported native receipt pathway';end if;
  if receipt is null then raise exception 'Receive every required laboratory result';end if;
  -- Clinic lab: the values must still be exactly what was received (no later correction, detach or move).
  if receipt->>'source'='clinic-lab' then
   if public._clinic_lab_receipt_values(p_user_id,(receipt->>'attachmentId')::uuid,(select jsonb_agg(x->'id')from jsonb_array_elements(receipt->'values')x)) is distinct from receipt->'values' then raise exception 'Required source receipt is stale';end if;
   continue;
  end if;
  select * into r from public.patient_reports where id=(receipt->>'reportId')::uuid and user_id=p_user_id and deleted_at is null;
  if not found or r.state<>'confirmed' or r.revision::text is distinct from receipt->>'reportRevision' or v#>>array['approvals',r.id::text,'revision'] is distinct from r.revision::text then raise exception 'Required source receipt is stale';end if;
 end loop;
 if v#>>'{consultation,decision}' not in ('required','not-required') or v#>>'{consultation,decision}' is null then raise exception 'Record an explicit consultation decision';end if;
 if v#>>'{consultation,decision}'='required' and (v#>>'{consultation,completedAt}' is null or (v#>>'{consultation,completedAt}')::timestamptz>now() or v#>>'{consultation,evidenceToken}' is distinct from p_evidence_token) then raise exception 'Complete the consultation for the current evidence';end if;
 -- Never lock medication rows after plans: dose commands lock medication then plan.
 select id into prior_plan from public.patient_care_plans where user_id=p_user_id and active for update nowait;
 regimen:=public._draft_regimen(c.draft);
 if c.draft?'medicines' and not public._multi_medicine_enabled() then raise exception 'Several-medicine plans are switched off';end if;
 -- A one-medicine draft cannot express a regimen, even of one: refuse rather than drop what the current plan holds.
 if not c.draft?'medicines' and ((select count(*) from public.patient_care_plan_medications l where l.plan_id=prior_plan)>1
  or exists(select 1 from public.patient_clinical_publications src join public.patient_care_plan_regimens held on held.plan_id=src.plan_id where src.plan_id=prior_plan and src.draft?'medicines' and jsonb_array_length(held.medicines)>0))
  then raise exception 'This draft would drop medicines from the current plan';end if;
 -- Checked once the plan row is locked, so no other version can slip in between this check and the new plan.
 if (c.draft?'medicines' or approval is not null) and approval is distinct from public._regimen_approval_hash(regimen,prior_plan) then raise exception 'Approve the current regimen before publishing';end if;
 stamp:=now();select display_name into label from public.workspace_staff where user_id=p_actor;
 update public.patient_care_plans set active=false,retired_at=stamp where user_id=p_user_id and active;
 insert into public.patient_care_plans(user_id,clinician,published_at,instructions) values(p_user_id,label,stamp,concat_ws(E'\n\n',c.draft->>'explanation',c.draft->>'instructions',nullif(c.draft->>'followUp',''))) returning id into pid;
 -- An unchanged medicine keeps its order, so its dose log continues. Anything else is a new order from this version on.
 for med in select value from jsonb_array_elements(regimen) loop
  mid:=null;
  select m.id into mid from public.patient_care_medications m join public.patient_care_plan_medications link on link.medication_id=m.id and link.plan_id=prior_plan
  where m.user_id=p_user_id and m.name=med->>'name' and m.dose=med->>'dose' and m.instructions=med->>'instructions'
  and array(select distinct t from unnest(m.times) t order by t)=array(select value::time from jsonb_array_elements_text(med->'times') order by value::time);
  if mid is null then
   insert into public.patient_care_medications(user_id,plan_id,name,dose,instructions,times,start_date,effective_at) values(p_user_id,pid,med->>'name',med->>'dose',med->>'instructions',array(select value::time from jsonb_array_elements_text(med->'times')),timezone('Asia/Yerevan',stamp)::date,stamp) returning id into mid;
  end if;
  insert into public.patient_care_plan_medications(plan_id,medication_id,user_id) values(pid,mid,p_user_id);
 end loop;
 -- Copy only doctor-received, actual source data. Non-numeric printed rows remain
 -- verbatim in the immutable publication, without a fabricated numeric conversion.
 for test in select * from jsonb_array_elements(v#>'{engine,tests}') loop
  receipt:=v#>array['receipts',test->>'id'];
  if receipt->>'source'='clinic-lab' then
   select id into tid from public.patient_care_tests where user_id=p_user_id and source_lab_attachment_id=(receipt->>'attachmentId')::uuid and source_requirement_id=test->>'id';
   if tid is null then
    insert into public.patient_care_tests(user_id,title,preparation,status,ordered_by,ordered_at,source,source_label,source_lab_attachment_id,source_requirement_id)
    values(p_user_id,test->>'title',test->>'preparation','collected',label,(v->>'preparedAt')::timestamptz,'laboratory',
     coalesce((select nullif(x->>'laboratory','')from jsonb_array_elements(receipt->'values')x where nullif(x->>'laboratory','')is not null limit 1),'Clinic laboratory'),
     (receipt->>'attachmentId')::uuid,test->>'id') returning id into tid;
   end if;
   for lab_row in select * from jsonb_array_elements(receipt->'values') loop
    if jsonb_typeof(lab_row->'value')='number' and nullif(btrim(lab_row->>'unit'),'') is not null then
     insert into public.patient_care_results(user_id,test_id,marker,value,unit,collected_at,received_at,source,source_label,reviewed_at,reviewed_by,explanation,reference_text,source_lab_value_id,source_lab_reviewed_at,publication_plan_id)
     values(p_user_id,tid,lab_row->>'name',(lab_row->>'value')::double precision,lab_row->>'unit',((lab_row->>'collectedOn')||'T00:00:00+04:00')::timestamptz,(receipt->>'at')::timestamptz,'laboratory',
      coalesce(nullif(lab_row->>'laboratory',''),'Clinic laboratory'),stamp,label,receipt->>'note',left(lab_row->>'reference',160),(lab_row->>'id')::uuid,(lab_row->>'reviewedAt')::timestamptz,pid)
     on conflict on constraint care_result_lab_source_identity do nothing;
    end if;
   end loop;
   continue;
  end if;
  select * into r from public.patient_reports where id=(receipt->>'reportId')::uuid and user_id=p_user_id;
  select id into tid from public.patient_care_tests where user_id=p_user_id and source_report_id=r.id and source_requirement_id=test->>'id';
  if tid is null then
   insert into public.patient_care_tests(user_id,title,preparation,status,ordered_by,ordered_at,source,source_label,source_report_id,source_requirement_id)
   values(p_user_id,test->>'title',test->>'preparation','collected',label,(v->>'preparedAt')::timestamptz,'laboratory',coalesce(nullif(r.reviewed->>'laboratory',''),'Source report'),r.id,test->>'id') returning id into tid;
  end if;
  for row_index in select * from jsonb_array_elements(receipt->'rows') loop
   source_row:=r.reviewed#>array['rows',row_index::text];
   if length(source_row->>'literal')<=30 and source_row->>'literal' ~ '^-?[0-9]+([.,][0-9]+)?$' and nullif(btrim(source_row->>'unit'),'') is not null then
    insert into public.patient_care_results(user_id,test_id,marker,value,unit,collected_at,received_at,source,source_label,reviewed_at,reviewed_by,explanation,reference_text,source_report_id,source_revision,source_row,publication_plan_id)
    values(p_user_id,tid,source_row->>'name',replace(source_row->>'literal',',','.')::double precision,source_row->>'unit',((r.reviewed->>'reportDate')||'T00:00:00+04:00')::timestamptz,(receipt->>'at')::timestamptz,'laboratory',coalesce(nullif(r.reviewed->>'laboratory',''),'Source report'),stamp,label,receipt->>'note',source_row->>'reference',r.id,r.revision,(row_index::text)::integer,pid) on conflict on constraint care_result_source_identity do nothing;
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

-- Publish with the doctor's approval of the regimen. A resend of the same request returns the recorded plan unchanged.
create function public.publish_patient_clinical_regimen(p_user_id uuid,p_actor uuid,p_expected_revision bigint,p_evidence_token text,p_engine jsonb,p_request_id uuid,p_change_summary text,p_regimen_hash text)returns uuid
language plpgsql security definer set search_path=''as $$
begin
 if p_regimen_hash is null or p_regimen_hash!~'^[a-f0-9]{32}$' then raise exception using errcode='22023',message='Regimen approval is missing';end if;
 perform set_config('noreon.plan_regimen_hash',p_regimen_hash,true);
 return public.publish_patient_clinical_plan_with_summary(p_user_id,p_actor,p_expected_revision,p_evidence_token,p_engine,p_request_id,p_change_summary);
end$$;

-- 7. Reads ------------------------------------------------------------------------------------------------------
create function public._plan_regimen_versions(p_user uuid)returns jsonb language sql stable security definer set search_path=''as $$
 select coalesce(jsonb_agg(jsonb_build_object('planId',x.plan_id,'version',x.version,'publishedAt',x.published_at,'changeSummary',x.change_summary,'current',x.current,'medicines',x.medicines,'changes',x.changes)order by x.version desc),'[]'::jsonb)
 from(select v.plan_id,v.version,p.published_at,v.change_summary,coalesce(c.active,false)current,r.medicines,r.changes
  from public.patient_care_plan_regimens r join public.patient_care_plan_versions v on v.plan_id=r.plan_id
  join public.patient_clinical_publications p on p.plan_id=r.plan_id join public.patient_care_plans c on c.id=r.plan_id
  where r.user_id=p_user and p.published_at<=clock_timestamp()order by v.version desc limit 50)x
$$;
-- Member: own versions, newest first. No staff identifiers.
create function public.patient_care_plan_regimens()returns jsonb
language plpgsql stable security definer set search_path=''as $$
declare ok boolean:=public._multi_medicine_enabled()and exists(select 1 from auth.users u where u.id=auth.uid() and u.phone_confirmed_at is not null);
begin
 return jsonb_build_object('version','plan-regimens-v1','enabled',ok,'versions',case when ok then public._plan_regimen_versions(auth.uid()) else '[]'::jsonb end);
end$$;
-- Assigned doctor: the versions, and the saved draft as it would publish now: the medicines, what changes, and the
-- hash publication requires. Draft content is the doctor's own and never reaches a member read.
create function public.doctor_regimen_review(p_user_id uuid)returns jsonb
language plpgsql stable security definer set search_path=''as $$
declare c public.patient_clinical_cases;prior uuid;last_plan uuid;regimen jsonb;before_this jsonb;
begin
 perform public._assigned_active_doctor(p_user_id);
 if not public._multi_medicine_enabled() then return jsonb_build_object('version','regimen-review-v1','enabled',false,'versions','[]'::jsonb,'draft',null);end if;
 select * into c from public.patient_clinical_cases where user_id=p_user_id;
 select id into prior from public.patient_care_plans where user_id=p_user_id and active;
 select v.plan_id into last_plan from public.patient_care_plan_versions v where v.user_id=p_user_id order by v.version desc limit 1;
 select r.medicines into before_this from public.patient_care_plan_regimens r where r.plan_id=last_plan;
 regimen:=public._draft_regimen(c.draft);
 return jsonb_build_object('version','regimen-review-v1','enabled',true,'versions',public._plan_regimen_versions(p_user_id),
  'draft',case when c.draft is null then null else jsonb_build_object('medicines',regimen,'changes',public._regimen_changes(before_this,regimen),'approvalHash',public._regimen_approval_hash(regimen,prior))end);
end$$;

-- 8. Zoe keeps her existing plan fields (lib/zoe parses them strictly). A regimen fills them with every medicine as the
-- doctor wrote it. Whole entries only: when a list does not fit, it says how many more there are, never a cut-off line.
create function public._fit_regimen_lines(p_lines text[],p_max integer)returns text language plpgsql immutable set search_path=''as $$
declare out_ text:='';i integer;tail text;
begin
 for i in 1..coalesce(cardinality(p_lines),0) loop
  tail:=case when i<cardinality(p_lines) then format('; and %s more in the published plan',cardinality(p_lines)-i) else '' end;
  if length(concat_ws('; ',nullif(out_,''),p_lines[i]))+length(tail)>p_max then
   return case when out_='' then format('%s medicines in the published plan',cardinality(p_lines)) else format('%s; and %s more in the published plan',out_,cardinality(p_lines)-i+1) end;
  end if;
  out_:=concat_ws('; ',nullif(out_,''),p_lines[i]);
 end loop;
 return out_;
end$$;
create function public._zoe_plan_medicines(d jsonb)returns jsonb language plpgsql immutable set search_path=''as $$
declare r jsonb;
begin
 if d is null or not d?'medicines' then
  return jsonb_build_object('medicationName',coalesce(d->>'medicationName',''),'medicationDose',coalesce(d->>'medicationDose',''),'medicationInstructions',coalesce(d->>'medicationInstructions',''),
   'medicationTimes',case when jsonb_typeof(d->'medicationTimes')='array' then d->'medicationTimes' else '[]'::jsonb end);
 end if;
 r:=public._draft_regimen(d);
 if jsonb_array_length(r)=0 then return jsonb_build_object('medicationName','','medicationDose','','medicationInstructions','','medicationTimes','[]'::jsonb);end if;
 if jsonb_array_length(r)=1 then return jsonb_build_object('medicationName',r#>>'{0,name}','medicationDose',r#>>'{0,dose}','medicationInstructions',r#>>'{0,instructions}','medicationTimes',r#>'{0,times}');end if;
 return jsonb_build_object(
  'medicationName',public._fit_regimen_lines(array(select (m->>'name')||' '||(m->>'dose') from jsonb_array_elements(r)with ordinality x(m,o) order by o),200),
  'medicationDose','',
  'medicationInstructions',public._fit_regimen_lines(array(select concat_ws(', ',(m->>'name')||' at '||(select string_agg(t,', ' order by t)from jsonb_array_elements_text(m->'times')t),nullif(m->>'instructions',''))
    from jsonb_array_elements(r)with ordinality x(m,o) order by o),500),
  'medicationTimes','[]'::jsonb);
end$$;

CREATE OR REPLACE FUNCTION public.zoe_run_health_context(p_runs uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare on_ boolean:=coalesce((select health_answers_enabled from public.zoe_settings where singleton),false);
begin
 if auth.role()is distinct from 'service_role'then raise insufficient_privilege;end if;
 if p_runs is null or cardinality(p_runs)>50 then return '[]'::jsonb;end if;
 return coalesce((select jsonb_agg(jsonb_build_object('runId',r.id,'enabled',on_,'data',case when on_ then jsonb_build_object(
   'bpWeek',(select case when count(*)>0 then jsonb_build_object('count',count(*),'avgSystolic',round(avg(pm.systolic))::integer,'avgDiastolic',round(avg(pm.diastolic))::integer,
     'latest',(select jsonb_build_object('systolic',l.systolic,'diastolic',l.diastolic,'daysAgo',floor(extract(epoch from clock_timestamp()-l.measured_at)/86400)::integer)
       from public.patient_measurements l where l.user_id=r.member_id and l.measured_at<=clock_timestamp()order by l.measured_at desc limit 1))end
     from public.patient_measurements pm where pm.user_id=r.member_id and pm.measured_at<=clock_timestamp()and pm.measured_at>clock_timestamp()-interval '7 days'),
   -- Recent results with their review state: a dangerous value is acted on before the doctor's review (dataset S020, S026).
   'labs',coalesce((select jsonb_agg(x.o order by x.at desc)from(select jsonb_build_object('marker',left(cr.marker,80),'value',cr.value,'unit',left(cr.unit,20),
     'low',cr.reference_low,'high',cr.reference_high,'daysAgo',greatest(0,floor(extract(epoch from clock_timestamp()-cr.collected_at)/86400))::integer,'reviewed',cr.reviewed_at is not null)o,cr.collected_at at
     from public.patient_care_results cr where cr.user_id=r.member_id and cr.collected_at<=clock_timestamp()and cr.collected_at>clock_timestamp()-interval '2 years'
     order by cr.collected_at desc limit 16)x),'[]'::jsonb),
   -- The published plan's member-facing fields, as zoe_run_plan (20261018213357) reads them: never a draft.
   'plan',(select jsonb_build_object('explanation',left(coalesce(p.draft->>'explanation',''),1500),'instructions',left(coalesce(p.draft->>'instructions',''),1500),
     'followUp',left(coalesce(p.draft->>'followUp',''),500),'medicationName',left(public._zoe_plan_medicines(p.draft)->>'medicationName',200),'medicationDose',left(public._zoe_plan_medicines(p.draft)->>'medicationDose',200),
     'medicationInstructions',left(public._zoe_plan_medicines(p.draft)->>'medicationInstructions',500),
     'medicationTimes',coalesce((select jsonb_agg(t)from(select t from jsonb_array_elements_text(public._zoe_plan_medicines(p.draft)->'medicationTimes')t
       where t ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' limit 4)q),'[]'::jsonb),
     'publishedDaysAgo',greatest(0,floor(extract(epoch from clock_timestamp()-p.published_at)/86400))::integer)
    from public.patient_care_plans plan join public.patient_clinical_publications p on p.plan_id=plan.id and p.user_id=plan.user_id
    where plan.user_id=r.member_id and plan.active and plan.published_at<=now()and p.published_at<=now()
    order by p.published_at desc limit 1))end))
  from public.zoe_runs r where r.id=any(p_runs)and r.state='started'),'[]'::jsonb);
end$function$
;
CREATE OR REPLACE FUNCTION public.zoe_run_plan(p_runs uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare on_ boolean:=coalesce((select structured_drafts_enabled from public.zoe_settings where singleton),false);
begin
 if auth.role()is distinct from 'service_role'then raise insufficient_privilege;end if;
 if p_runs is null or cardinality(p_runs)>50 then return '[]'::jsonb;end if;
 return coalesce((select jsonb_agg(jsonb_build_object('runId',r.id,'enabled',on_,'plan',case when on_ then(
   select jsonb_build_object('planId',p.plan_id,'publishedAt',p.published_at,
    'explanation',coalesce(p.draft->>'explanation',''),'instructions',coalesce(p.draft->>'instructions',''),'followUp',coalesce(p.draft->>'followUp',''),
    'medicationName',public._zoe_plan_medicines(p.draft)->>'medicationName','medicationDose',public._zoe_plan_medicines(p.draft)->>'medicationDose',
    'medicationInstructions',public._zoe_plan_medicines(p.draft)->>'medicationInstructions','medicationTimes',public._zoe_plan_medicines(p.draft)->'medicationTimes')
   from public.patient_care_plans plan join public.patient_clinical_publications p on p.plan_id=plan.id and p.user_id=plan.user_id
   where plan.user_id=r.member_id and plan.active and plan.published_at<=now()and p.published_at<=now()
   order by p.published_at desc limit 1)end))
  from public.zoe_runs r where r.id=any(p_runs)and r.state='started'),'[]'::jsonb);
end$function$
;
CREATE OR REPLACE FUNCTION public.zoe_run_record_reply_draft(p_run uuid, p_record jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare r public.zoe_runs;pub record;item jsonb;txt text;med text;ok boolean;cr bigint;src text;z jsonb;
begin
 if auth.role()is distinct from 'service_role'then raise insufficient_privilege;end if;
 if not coalesce((select structured_drafts_enabled from public.zoe_settings where singleton),false)then return jsonb_build_object('ok',false,'code','structured_drafts_off');end if;
 select * into r from public.zoe_runs where id=p_run for update;
 if not found or r.state<>'started'then return jsonb_build_object('ok',false,'code','run_not_started');end if;
 -- Codex RD-03: the publication, the case revision and the evidence token are read after locking the member's case row,
 -- so a publication (which updates the case) cannot land between those reads; anything after is caught by the bind trigger.
 select revision into cr from public.patient_clinical_cases where user_id=r.member_id for update;
 if jsonb_typeof(p_record)<>'object'or jsonb_typeof(p_record->'quoted')<>'array'or jsonb_array_length(p_record->'quoted')>4
  or jsonb_typeof(coalesce(p_record->'doctorDecides','[]'))<>'array'or jsonb_typeof(coalesce(p_record->'judgementReasons','[]'))<>'array'then
  return jsonb_build_object('ok',false,'code','record_invalid');end if;
 select p.plan_id,p.published_at,p.draft into pub
  from public.patient_care_plans plan join public.patient_clinical_publications p on p.plan_id=plan.id and p.user_id=plan.user_id
  where plan.user_id=r.member_id and plan.active and plan.published_at<=now()and p.published_at<=now()order by p.published_at desc limit 1;
 if(p_record->>'planId')is distinct from(pub.plan_id::text)then return jsonb_build_object('ok',false,'code','plan_changed');end if;
 if pub.plan_id is null and jsonb_array_length(p_record->'quoted')>0 then return jsonb_build_object('ok',false,'code','quote_without_plan');end if;
 z:=public._zoe_plan_medicines(pub.draft);
 med:=concat_ws(', ',nullif(btrim(btrim(z->>'medicationName')||' '||btrim(z->>'medicationDose')),''),
  nullif((select string_agg(t,', 'order by o)from jsonb_array_elements_text(z->'medicationTimes')with ordinality x(t,o)),''),
  nullif(btrim(z->>'medicationInstructions'),''));
 for item in select value from jsonb_array_elements(p_record->'quoted')loop
  txt:=item->>'text';
  if txt is null or length(txt)not between 2 and 400 or coalesce(item->>'id','')not similar to '[A-Z][0-9]{1,2}'then return jsonb_build_object('ok',false,'code','quote_invalid');end if;
  ok:=(item->>'kind'='instruction'and strpos(coalesce(pub.draft->>'instructions',''),txt)>0)
   or(item->>'kind'='explanation'and strpos(coalesce(pub.draft->>'explanation',''),txt)>0)
   or(item->>'kind'='next_step'and strpos(coalesce(pub.draft->>'followUp',''),txt)>0)
   or(item->>'kind'='medicine'and nullif(btrim(z->>'medicationName'),'')is not null and med=txt);
  if not coalesce(ok,false)then return jsonb_build_object('ok',false,'code','quote_not_in_plan');end if;
 end loop;
 src:=public.patient_clinical_evidence(r.member_id)->>'token';
 if cr is null or src is null then return jsonb_build_object('ok',false,'code','no_clinical_context');end if;
 insert into public.zoe_reply_drafts(run_id,member_id,clinical_revision,source_token,version,plan_id,plan_published_at,asked,acknowledgement_id,acknowledgement,quoted,doctor_decides,outside_plan,needs_judgement,judgement_reasons)
 values(r.id,r.member_id,cr,src,p_record->>'version',pub.plan_id,pub.published_at,p_record->>'asked',p_record->>'acknowledgementId',p_record->>'acknowledgement',p_record->'quoted',
  array(select jsonb_array_elements_text(coalesce(p_record->'doctorDecides','[]'))),(p_record->>'outsidePlan')::boolean,(p_record->>'needsJudgement')::boolean,
  array(select jsonb_array_elements_text(coalesce(p_record->'judgementReasons','[]'))))
 on conflict(run_id)do nothing;
 if not found then return jsonb_build_object('ok',false,'code','already_recorded');end if;
 return jsonb_build_object('ok',true);
exception when check_violation or not_null_violation or invalid_text_representation then return jsonb_build_object('ok',false,'code','record_invalid');
end$function$
;

-- 9. The clinic admin's record lists the whole current plan, including medicines carried over from an earlier version.
CREATE OR REPLACE FUNCTION public.clinic_admin_patient_record(p_clinic uuid, p_member uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare m public.clinic_portal_memberships;p public.profiles;k public.patient_clinical_cases;doctor_clinic uuid;
begin
 perform set_config('lock_timeout','1500ms',true);
 m:=public._clinic_admin_member(p_clinic);
 if not public._clinic_admin_full_access_enabled()then return jsonb_build_object('version','clinic-admin-record-v1','enabled',false);end if;
 if not public._clinic_admin_patient(p_clinic,p_member)then
  perform public._clinic_schedule_audit(p_clinic,m.user_id,'admin-record-refused',jsonb_build_object('memberId',p_member,'membershipId',m.id));
  return jsonb_build_object('version','clinic-admin-record-v1','enabled',true,'status','refused');
 end if;
 select * into p from public.profiles where id=p_member;
 select * into k from public.patient_clinical_cases where user_id=p_member;
 select clinic_id into doctor_clinic from public.workspace_staff where user_id=k.assigned_doctor_id;
 perform public._clinic_schedule_audit(p_clinic,m.user_id,'admin-record-opened',jsonb_build_object('memberId',p_member,'membershipId',m.id));
 perform public._access_audit_record(p_member,'clinic_admin_record',p_clinic::text);
 return jsonb_build_object('version','clinic-admin-record-v1','enabled',true,'status','ok',
  'member',jsonb_build_object('memberId',p.id,'name',coalesce(nullif(btrim(p.display_name),''),''),'phone',public._clinic_member_phone(p.id),'birthDate',p.birth_date,
   'sex',p.biological_sex,'locale',p.locale,'joinedAt',p.created_at,'updatedAt',p.updated_at),
  'consents',(select coalesce(jsonb_agg(jsonb_build_object('version',c.version,'acceptedAt',c.accepted_at)order by c.accepted_at desc),'[]'::jsonb)from public.patient_consents c where c.user_id=p_member),
  'careTeam',jsonb_build_object('enrolled',k.user_id is not null,'revision',k.revision,'enrolledAt',k.created_at,
   'doctor',case when k.assigned_doctor_id is not null then public._clinic_admin_staff_json(k.assigned_doctor_id)end,
   'nurse',case when k.assigned_nurse_id is not null then public._clinic_admin_staff_json(k.assigned_nurse_id)end,
   'editable',k.user_id is not null and(k.assigned_doctor_id is null or doctor_clinic=p_clinic),
   'doctors',(select coalesce(jsonb_agg(jsonb_build_object('id',s.user_id,'name',s.display_name)order by s.display_name,s.user_id),'[]'::jsonb)
    from public.workspace_staff s where s.clinic_id=p_clinic and s.role='doctor'and s.active and s.removed_at is null),
   'nurses',(select coalesce(jsonb_agg(jsonb_build_object('id',s.user_id,'name',s.display_name)order by s.display_name,s.user_id),'[]'::jsonb)
    from public.workspace_staff s where s.clinic_id=p_clinic and s.role='nurse'and s.active and s.removed_at is null)),
  'assessment',(select jsonb_build_object('completedAt',a.completed_at,'assessmentDate',a.assessment_date,'algorithmVersion',a.algorithm_version,'urgentRule',a.urgent_rule,'answers',a.answers,'updatedAt',a.updated_at)
   from public.patient_assessments a where a.user_id=p_member),
  'measurements',(select coalesce(jsonb_agg(jsonb_build_object('measuredAt',x.measured_at,'systolic',x.systolic,'diastolic',x.diastolic,'pulse',x.pulse,'source',x.source)order by x.measured_at desc,x.id),'[]'::jsonb)
   from(select * from public.patient_measurements where user_id=p_member order by measured_at desc,id limit 60)x),
  'bookings',(select coalesce(jsonb_agg(r order by r->>'startsAt' desc,r->>'appointmentId'),'[]'::jsonb)from public.booking_appointments a cross join lateral public._clinic_schedule_row(p_clinic,a)r
   where a.member_id=p_member and r is not null and exists(select 1 from public.booking_scheduling_notices n where n.appointment_id=a.id and n.clinic_id=p_clinic)),
  'visits',(select coalesce(jsonb_agg(jsonb_build_object('visitId',v.id,'visitedAt',v.created_at,'clinicName',c.name,'thisClinic',v.clinic_id=p_clinic,'recordedBy',v.actor_name,'role',v.actor_role,
    'entries',(select coalesce(jsonb_agg(jsonb_build_object('observedAt',e.observed_at,'recordedBy',e.actor_name,'payload',e.payload)order by e.position,e.id),'[]'::jsonb)
     from public.patient_care_visit_entries e where e.visit_id=v.id and e.user_id=p_member))order by v.created_at desc,v.id),'[]'::jsonb)
   from(select * from public.patient_care_visits where user_id=p_member order by created_at desc,id limit 100)v left join public.workspace_clinics c on c.id=v.clinic_id),
  'tests',(select coalesce(jsonb_agg(jsonb_build_object('title',t.title,'status',t.status,'orderedAt',t.ordered_at,'dueAt',t.due_at,'location',t.location,'source',t.source_label)order by t.ordered_at desc,t.id),'[]'::jsonb)
   from(select * from public.patient_care_tests where user_id=p_member order by ordered_at desc,id limit 200)t),
  'results',(select coalesce(jsonb_agg(jsonb_build_object('marker',r.marker,'value',r.value,'unit',r.unit,'referenceLow',r.reference_low,'referenceHigh',r.reference_high,'referenceText',r.reference_text,
    'collectedAt',r.collected_at,'receivedAt',r.received_at,'source',r.source_label)order by r.collected_at desc,r.marker,r.id),'[]'::jsonb)
   from(select * from public.patient_care_results where user_id=p_member order by collected_at desc,id limit 300)r),
  'plan',(select jsonb_build_object('clinician',pl.clinician,'instructions',pl.instructions,'publishedAt',pl.published_at,'acknowledgedAt',pl.acknowledged_at,
    'medicines',(select coalesce(jsonb_agg(jsonb_build_object('name',md.name,'dose',md.dose,'times',to_jsonb(md.times),'instructions',md.instructions,'startDate',md.start_date,'endDate',md.end_date)order by md.name,md.id),'[]'::jsonb)
     from public.patient_care_medications md where(md.plan_id=pl.id or exists(select 1 from public.patient_care_plan_medications l where l.plan_id=pl.id and l.medication_id=md.id))and md.user_id=p_member and md.active))
   from public.patient_care_plans pl where pl.user_id=p_member and pl.active and pl.retired_at is null order by pl.published_at desc limit 1),
  'files',public._clinic_member_files(p_clinic,p_member),
  'memberDocuments',(select coalesce(jsonb_agg(jsonb_build_object('name',d.file_name,'resultDate',d.result_date,'uploadedAt',d.created_at)order by d.created_at desc,d.id),'[]'::jsonb)
   from(select * from public.member_reported_documents where user_id=p_member and deleted_at is null order by created_at desc,id limit 100)d),
  'reports',(select coalesce(jsonb_agg(jsonb_build_object('name',r.file_name,'state',r.state,'uploadedAt',r.created_at)order by r.created_at desc,r.id),'[]'::jsonb)
   from(select * from public.patient_reports where user_id=p_member and deleted_at is null order by created_at desc,id limit 100)r),
  'profileChanges',(select coalesce(jsonb_agg(jsonb_build_object('at',h.created_at,'by',(select display_name from public.clinic_portal_memberships where id=h.membership_id),'before',h.before,'after',h.after)order by h.created_at desc,h.id),'[]'::jsonb)
   from(select * from public.clinic_member_profile_changes where member_id=p_member and clinic_id=p_clinic order by created_at desc,id limit 20)h));
end$function$
;

-- 10. Access -----------------------------------------------------------------------------------------------------
revoke all on function public._multi_medicine_enabled(),public._regimen_name_key(text),public._draft_regimen(jsonb),public._regimen_changes(jsonb,jsonb),public._regimen_approval_hash(jsonb,uuid),
 public._patient_care_plan_regimen(),public.publish_patient_clinical_regimen(uuid,uuid,bigint,text,jsonb,uuid,text,text),public._plan_regimen_versions(uuid),public.patient_care_plan_regimens(),
 public.doctor_regimen_review(uuid),public._fit_regimen_lines(text[],integer),public._zoe_plan_medicines(jsonb) from public,anon,authenticated,service_role;
grant execute on function public.publish_patient_clinical_regimen(uuid,uuid,bigint,text,jsonb,uuid,text,text) to service_role;
grant execute on function public.patient_care_plan_regimens(),public.doctor_regimen_review(uuid) to authenticated;
