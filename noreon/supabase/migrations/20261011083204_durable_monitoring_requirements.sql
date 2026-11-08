-- Shared-demo monitoring. Counts evidence receipt; never interprets BP values.
create extension if not exists btree_gist with schema extensions;

create table public.workspace_accepted_readings (
 id uuid primary key default gen_random_uuid(),
 case_id uuid not null references public.workspace_cases(id) on delete cascade,
 submission_id uuid not null,
 measured_at timestamptz not null,
 accepted_at timestamptz not null default clock_timestamp(),
 systolic integer not null check(systolic between 60 and 300),
 diastolic integer not null check(diastolic between 30 and 200 and diastolic<systolic),
 pulse integer check(pulse between 20 and 250),
 unique(case_id,submission_id),unique(case_id,id)
);
create table public.workspace_monitoring_requirements (
 id uuid primary key default gen_random_uuid(),
 case_id uuid not null references public.workspace_cases(id) on delete cascade,
 created_at timestamptz not null default clock_timestamp(),
 starts_at timestamptz not null,ends_at timestamptz not null,
 required_count integer not null check(required_count between 1 and 1000),
 instructions text not null check(length(btrim(instructions)) between 1 and 1500),
 status text not null default 'active' check(status in ('active','cancelled','superseded')),
 actor_id uuid references public.workspace_staff(user_id) on delete set null,
 actor_label text not null,
 source_publication integer not null, current_publication integer not null,
 source_snapshot jsonb not null,
 acknowledged_at timestamptz,
 revision integer not null default 0,
 check(starts_at>=created_at and ends_at>starts_at),
 unique(case_id,id),
 exclude using gist(case_id with =,tstzrange(starts_at,ends_at,'[)') with &&) where(status='active')
);
create table public.workspace_monitoring_evidence (
 case_id uuid not null,
 requirement_id uuid not null,
 reading_id uuid not null,
 late boolean not null,
 primary key(requirement_id,reading_id),
 foreign key(case_id,requirement_id) references public.workspace_monitoring_requirements(case_id,id) on delete cascade,
 foreign key(case_id,reading_id) references public.workspace_accepted_readings(case_id,id) on delete cascade
);
create table public.workspace_followup_work (
 requirement_id uuid primary key,
 case_id uuid not null,
 status text not null default 'open' check(status in ('open','fulfilled','cancelled','superseded')),
 due_at timestamptz not null,resolved_at timestamptz,
 foreign key(case_id,requirement_id) references public.workspace_monitoring_requirements(case_id,id) on delete cascade
);
create table public.workspace_followup_events (
 id bigint generated always as identity primary key,
 requirement_id uuid not null references public.workspace_monitoring_requirements(id) on delete cascade,
 kind text not null,
 actor_id uuid references public.workspace_staff(user_id) on delete set null,
 actor_label text not null,
 note text check(length(note)<=1500),
 created_at timestamptz not null default clock_timestamp()
);
create unique index workspace_review_task_case_identity on public.workspace_review_tasks(case_id,id);
create table public.workspace_followup_review_links (
 case_id uuid not null,requirement_id uuid not null,review_task_id uuid not null,
 event text not null check(event in ('window-ended','referred')),
 created_at timestamptz not null default clock_timestamp(),
 primary key(requirement_id,event),
 foreign key(case_id,requirement_id) references public.workspace_monitoring_requirements(case_id,id) on delete cascade,
 foreign key(case_id,review_task_id) references public.workspace_review_tasks(case_id,id) on delete cascade
);
create table public.workspace_monitoring_decisions (
 requirement_id uuid primary key references public.workspace_monitoring_requirements(id) on delete cascade,
 decision text not null check(decision in ('retain','supersede')),
 evidence_revision bigint not null,publication_version integer not null,draft jsonb not null,
 actor_id uuid references public.workspace_staff(user_id) on delete set null,
 created_at timestamptz not null default clock_timestamp()
);
create index workspace_monitoring_due on public.workspace_monitoring_requirements(ends_at,case_id) where status='active';
create index workspace_readings_window on public.workspace_accepted_readings(case_id,measured_at);
do $$ declare t text;begin
 foreach t in array array['workspace_accepted_readings','workspace_monitoring_requirements','workspace_monitoring_evidence','workspace_followup_work','workspace_followup_events','workspace_followup_review_links','workspace_monitoring_decisions'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on table public.%I from anon,authenticated,service_role',t);
  execute format('grant select on table public.%I to service_role',t);
 end loop;
end $$;

-- Protect durable acceptance from the generic whole-state persistence path.
alter function public.workspace_save_case(uuid,integer,jsonb,text) rename to workspace_save_case_before_monitoring;
revoke all on function public.workspace_save_case_before_monitoring(uuid,integer,jsonb,text) from public,anon,authenticated,service_role;
create function public.workspace_save_case(p_id uuid,p_expected_revision integer,p_state jsonb,p_publication_key text default null)
returns integer language plpgsql security definer set search_path='' as $$
declare c public.workspace_cases;k text;
begin
 select * into c from public.workspace_cases where id=p_id and expires_at>now() for update;
 if not found or c.revision<>p_expected_revision then raise exception 'workspace case conflict';end if;
 foreach k in array array['measurements','acceptedReadingRevision','monitoringEvidenceRevision'] loop
  if p_state->k is distinct from c.state->k then raise exception 'Measurements and monitoring require an explicit command.';end if;
 end loop;
 return public.workspace_save_case_before_monitoring(p_id,p_expected_revision,p_state,p_publication_key);
end $$;
revoke all on function public.workspace_save_case(uuid,integer,jsonb,text) from public,anon,authenticated;
grant execute on function public.workspace_save_case(uuid,integer,jsonb,text) to service_role;

-- A newly signed-in member has an explicit JSON null profile.
create or replace function public.workspace_evidence_projection(s jsonb) returns jsonb
language sql immutable set search_path='' as $$
 select jsonb_build_object(
 'assessment',s#>'{state,assessment}', 'measurements',jsonb_build_object('readings',s->'measurements','accepted',coalesce(s->'acceptedReadingRevision','0'::jsonb)),
 'monitoring',coalesce(s->'monitoringEvidenceRevision','0'::jsonb),
 'profile',case when jsonb_typeof(s#>'{state,profile}')='object' then (s#>'{state,profile}')-'locale' else 'null'::jsonb end, 'consent',s#>'{state,consentAccepted}',
 'tests',coalesce((select jsonb_agg(t-'title' order by t->>'id') from jsonb_array_elements(coalesce(s#>'{workflow,tests}','[]')) t),'[]'),
 'received',coalesce((select jsonb_agg(t order by t) from (select distinct value t from jsonb_array_elements(coalesce(s#>'{workflow,receivedTestIds}','[]'))) r),'[]'),
 'allResultsAt',s#>'{workflow,allResultsAt}',
 'pending',coalesce(s#>'{workflow,recommendationsPending}','false'),
 'requirements',case when s#>>'{workflow,recommendationsPending}'='true' then '[]'::jsonb else coalesce((select jsonb_agg(jsonb_build_object('id',r->>'requirementId','testId',r#>>'{test,id}','method',r#>>'{test,method}') order by r->>'requirementId') from jsonb_array_elements(coalesce(s#>'{workflow,requirements}','[]')) r where r->>'retiredAtRevision' is null),'[]') end,
 'receipts',case when s#>>'{workflow,recommendationsPending}'='true' then '[]'::jsonb else coalesce((select jsonb_agg(jsonb_build_object('requirementId',r->>'requirementId','receivedAt',r->'receivedAt') order by r->>'requirementId') from jsonb_array_elements(coalesce(s#>'{workflow,receiptHistory}','[]')) r where exists(select 1 from jsonb_array_elements(coalesce(s#>'{workflow,requirements}','[]')) q where q->>'requirementId'=r->>'requirementId' and q->>'retiredAtRevision' is null)),'[]') end)
$$;

-- Date of birth and biological sex affect clinical context; name-only edits do not.
-- Routine readings and identity edits advance an existing review, without
-- creating recurring clinical work. Follow-up scheduling owns routine reviews.
create or replace function public.workspace_dispatch_case_review() returns trigger
language plpgsql security definer set search_path='' as $$
declare a jsonb;b jsonb;k text;opens boolean:=false;eligible boolean;reason text:='evidence';
begin
 if old.state is not distinct from new.state or old.evidence_revision=new.evidence_revision then return new;end if;
 a:=public.workspace_evidence_projection(old.state);b:=public.workspace_evidence_projection(new.state);
 for k in select jsonb_object_keys(b) order by 1 loop
  if (a->k is distinct from b->k and k not in ('measurements','profile','monitoring'))
   or (k='profile' and (a#>'{profile,birthDate}' is distinct from b#>'{profile,birthDate}'
    or a#>'{profile,biologicalSex}' is distinct from b#>'{profile,biologicalSex}')) then
   opens:=true;reason:='evidence.'||k;
  end if;
 end loop;
 -- Keep previously published cases visible even while reassessment is incomplete.
 eligible:=new.state#>>'{state,assessment,completedAt}' is not null
  or new.state#>>'{workflow,publication,at}' is not null;
 perform public.workspace_reconcile_review_task(new.id,opens and eligible,reason);
 return new;
end $$;
revoke all on function public.workspace_dispatch_case_review() from public,anon,authenticated,service_role;


-- Internal callers hold the case lock before touching requirement rows.
create function public.workspace_reconcile_monitoring(p_id uuid) returns integer
language plpgsql security definer set search_path='' as $$
declare c public.workspace_cases;r public.workspace_monitoring_requirements;task uuid;n integer:=0;received integer;stamp timestamptz;
begin
 select * into c from public.workspace_cases where id=p_id and expires_at>now() for update;
 if not found then return 0;end if;
 stamp:=clock_timestamp();
 for r in select * from public.workspace_monitoring_requirements where case_id=p_id and status='active' order by id for update loop
  insert into public.workspace_monitoring_evidence(case_id,requirement_id,reading_id,late)
   select p_id,r.id,m.id,m.accepted_at>=r.ends_at from public.workspace_accepted_readings m
   where m.case_id=p_id and m.measured_at>=r.starts_at and m.measured_at<r.ends_at and m.accepted_at>=r.created_at
   on conflict do nothing;
  select count(*) into received from public.workspace_monitoring_evidence where requirement_id=r.id;
  if r.ends_at<=stamp and not exists(select 1 from public.workspace_followup_review_links where requirement_id=r.id and event='window-ended') then
   task:=public.workspace_reconcile_review_task(p_id,true,'monitoring.window-ended');
   insert into public.workspace_followup_review_links(case_id,requirement_id,review_task_id,event) values(p_id,r.id,task,'window-ended');
   if received<r.required_count then insert into public.workspace_followup_work(requirement_id,case_id,due_at) values(r.id,p_id,r.ends_at) on conflict do nothing;end if;
   insert into public.workspace_followup_events(requirement_id,kind,actor_label) values(r.id,'window-ended','System');
   update public.workspace_cases set revision=revision+1 where id=p_id;
   n:=n+1;
  end if;
  if received>=r.required_count then
   update public.workspace_followup_work set status='fulfilled',resolved_at=stamp where requirement_id=r.id and status='open';
   if found then insert into public.workspace_followup_events(requirement_id,kind,actor_label) values(r.id,'evidence-received','System');end if;
  end if;
 end loop;
 return n;
end $$;
revoke all on function public.workspace_reconcile_monitoring(uuid) from public,anon,authenticated;
grant execute on function public.workspace_reconcile_monitoring(uuid) to service_role;

create function public.workspace_accept_reading(p_id uuid,p_submission uuid,p_measured_at timestamptz,p_systolic integer,p_diastolic integer,p_pulse integer default null) returns uuid
language plpgsql security definer set search_path='' as $$
declare c public.workspace_cases;m public.workspace_accepted_readings;stamp timestamptz;display jsonb;entry jsonb;
begin
 select * into c from public.workspace_cases where id=p_id and expires_at>now() for update;
 if not found or c.state#>>'{state,consentAccepted}' is distinct from 'true' or c.state#>>'{state,profile,userId}' is distinct from p_id::text then raise exception 'unauthorized';end if;
 select * into m from public.workspace_accepted_readings where case_id=p_id and submission_id=p_submission;
 if found then
  if m.measured_at is distinct from p_measured_at or m.systolic is distinct from p_systolic or m.diastolic is distinct from p_diastolic or m.pulse is distinct from p_pulse then raise exception 'measurement conflict';end if;
  return m.id;
 end if;
 stamp:=clock_timestamp();
 if p_submission is null or p_measured_at is null or not isfinite(p_measured_at) or p_measured_at>stamp+interval '5 minutes'
  or p_systolic is null or p_diastolic is null or p_systolic not between 60 and 300 or p_diastolic not between 30 and 200 or p_systolic<=p_diastolic or (p_pulse is not null and p_pulse not between 20 and 250) then raise exception 'invalid measurement';end if;
 -- Legacy submissions remain context; a retry cannot invent an acceptance time.
 if exists(select 1 from jsonb_array_elements(coalesce(c.state->'measurements','[]')) old where old->>'submissionId'=p_submission::text) then
  select old into entry from jsonb_array_elements(c.state->'measurements') old where old->>'submissionId'=p_submission::text limit 1;
  if (entry->>'measuredAt')::timestamptz is distinct from p_measured_at or (entry->>'systolic')::integer is distinct from p_systolic or (entry->>'diastolic')::integer is distinct from p_diastolic or (entry->>'pulse')::integer is distinct from p_pulse then raise exception 'measurement conflict';end if;
  return (entry->>'id')::uuid;
 end if;
 insert into public.workspace_accepted_readings(case_id,submission_id,measured_at,accepted_at,systolic,diastolic,pulse)
 values(p_id,p_submission,p_measured_at,stamp,p_systolic,p_diastolic,p_pulse) returning * into m;
 entry:=jsonb_strip_nulls(jsonb_build_object('id',m.id,'submissionId',p_submission,'source','manual','measuredAt',p_measured_at,'acceptedAt',stamp,'systolic',p_systolic,'diastolic',p_diastolic,'pulse',p_pulse));
 select jsonb_agg(v order by (v->>'measuredAt')::timestamptz desc,v->>'id') into display from
 (select value v from jsonb_array_elements(jsonb_build_array(entry)||coalesce(c.state->'measurements','[]')) order by (value->>'measuredAt')::timestamptz desc,value->>'id' limit 20) x;
 perform public.workspace_set_actor(null,p_id);
 update public.workspace_cases set state=state||jsonb_build_object('measurements',display,'acceptedReadingRevision',coalesce((state->>'acceptedReadingRevision')::bigint,0)+1),revision=revision+1 where id=p_id;
 perform public.workspace_reconcile_monitoring(p_id);
 return m.id;
end $$;
revoke all on function public.workspace_accept_reading(uuid,uuid,timestamptz,integer,integer,integer) from public,anon,authenticated;
grant execute on function public.workspace_accept_reading(uuid,uuid,timestamptz,integer,integer,integer) to service_role;

create function public.workspace_create_monitoring(p_id uuid,p_actor uuid,p_expected_revision integer,p_expected_evidence bigint,p_request_id uuid,p_start timestamptz,p_end timestamptz,p_count integer,p_instructions text) returns uuid
language plpgsql security definer set search_path='' as $$
declare c public.workspace_cases;r public.workspace_monitoring_requirements;label text;stamp timestamptz;v integer;
begin
 select * into c from public.workspace_cases where id=p_id and expires_at>now() for update;
 if not found then raise exception 'not_found';end if;
 label:=public.workspace_review_doctor(p_id,p_actor);
 select * into r from public.workspace_monitoring_requirements where id=p_request_id;
 if found then
  if r.case_id=p_id and r.actor_id=p_actor and r.starts_at=p_start and r.ends_at=p_end and r.required_count=p_count and r.instructions=btrim(p_instructions) then return r.id;end if;
  raise exception 'monitoring request conflict';
 end if;
 if c.revision is distinct from p_expected_revision or c.evidence_revision is distinct from p_expected_evidence then raise exception 'workspace case conflict';end if;
 if c.state#>>'{workflow,publication,version}' is null or c.state#>>'{state,consentAccepted}' is distinct from 'true' or c.state#>>'{state,assessment,urgentRule}' is not null then raise exception 'A current approved plan is required before monitoring.';end if;
 stamp:=clock_timestamp();
 if p_request_id is null or p_start is null or p_end is null or not isfinite(p_start) or not isfinite(p_end) or p_start<stamp or p_end<=p_start or p_end>c.expires_at or p_count is null or p_count not between 1 and 1000 or p_instructions is null or length(btrim(p_instructions)) not between 1 and 1500 then raise exception 'Enter a future window within the demo lifetime, a count from 1 to 1000 and instructions.';end if;
 v:=(c.state#>>'{workflow,publication,version}')::integer;
 insert into public.workspace_monitoring_requirements(id,case_id,created_at,starts_at,ends_at,required_count,instructions,actor_id,actor_label,source_publication,current_publication,source_snapshot)
 values(p_request_id,p_id,stamp,p_start,p_end,p_count,btrim(p_instructions),p_actor,label,v,v,c.state#>'{workflow,publication}');
 insert into public.workspace_followup_events(requirement_id,kind,actor_id,actor_label) values(p_request_id,'created',p_actor,label);
 perform public.workspace_set_actor(p_actor,p_id);
 update public.workspace_cases set state=state||jsonb_build_object('monitoringEvidenceRevision',coalesce((state->>'monitoringEvidenceRevision')::bigint,0)+1),revision=revision+1 where id=p_id returning revision into v;
 perform public.workspace_record_event(p_id,'monitoring.created',v);
 return p_request_id;
end $$;
revoke all on function public.workspace_create_monitoring(uuid,uuid,integer,bigint,uuid,timestamptz,timestamptz,integer,text) from public,anon,authenticated;
grant execute on function public.workspace_create_monitoring(uuid,uuid,integer,bigint,uuid,timestamptz,timestamptz,integer,text) to service_role;

create function public.workspace_cancel_monitoring(p_id uuid,p_actor uuid,p_expected_revision integer,p_requirement uuid,p_note text) returns integer
language plpgsql security definer set search_path='' as $$
declare c public.workspace_cases;label text;
begin
 select * into c from public.workspace_cases where id=p_id and expires_at>now() for update;
 if not found or c.revision is distinct from p_expected_revision then raise exception 'workspace case conflict';end if;
 label:=public.workspace_review_doctor(p_id,p_actor);
 if p_note is null or length(btrim(p_note)) not between 1 and 1500 then raise exception 'Enter a cancellation reason.';end if;
 update public.workspace_monitoring_requirements set status='cancelled',revision=revision+1 where case_id=p_id and id=p_requirement and status='active';
 if not found then raise exception 'This monitoring requirement is no longer active.';end if;
 update public.workspace_followup_work set status='cancelled',resolved_at=clock_timestamp() where requirement_id=p_requirement and status='open';
 delete from public.workspace_monitoring_decisions where requirement_id=p_requirement;
 insert into public.workspace_followup_events(requirement_id,kind,actor_id,actor_label,note) values(p_requirement,'cancelled',p_actor,label,btrim(p_note));
 perform public.workspace_set_actor(p_actor,p_id);
 update public.workspace_cases set state=state||jsonb_build_object('monitoringEvidenceRevision',coalesce((state->>'monitoringEvidenceRevision')::bigint,0)+1),revision=revision+1 where id=p_id returning revision into c.revision;
 perform public.workspace_record_event(p_id,'monitoring.cancelled',c.revision);
 return c.revision;
end $$;
revoke all on function public.workspace_cancel_monitoring(uuid,uuid,integer,uuid,text) from public,anon,authenticated;
grant execute on function public.workspace_cancel_monitoring(uuid,uuid,integer,uuid,text) to service_role;

create function public.workspace_acknowledge_monitoring(p_id uuid,p_requirement uuid) returns void
language plpgsql security definer set search_path='' as $$
declare c public.workspace_cases;
begin
 select * into c from public.workspace_cases where id=p_id and expires_at>now() for update;
 if not found or c.state#>>'{state,consentAccepted}' is distinct from 'true' then raise exception 'unauthorized';end if;
 update public.workspace_monitoring_requirements set acknowledged_at=clock_timestamp(),revision=revision+1 where case_id=p_id and id=p_requirement and status='active' and acknowledged_at is null;
 if found then
  insert into public.workspace_followup_events(requirement_id,kind,actor_label) values(p_requirement,'acknowledged','Member');
  update public.workspace_cases set revision=revision+1 where id=p_id;
 elsif not exists(select 1 from public.workspace_monitoring_requirements where case_id=p_id and id=p_requirement and status='active') then raise exception 'not_found';end if;
end $$;
revoke all on function public.workspace_acknowledge_monitoring(uuid,uuid) from public,anon,authenticated;
grant execute on function public.workspace_acknowledge_monitoring(uuid,uuid) to service_role;

create function public.workspace_followup_contact(p_id uuid,p_actor uuid,p_expected_revision integer,p_requirement uuid,p_outcome text,p_note text) returns integer
language plpgsql security definer set search_path='' as $$
declare c public.workspace_cases;s public.workspace_staff;task uuid;
begin
 select * into c from public.workspace_cases where id=p_id and expires_at>now() for update;
 if not found or c.revision is distinct from p_expected_revision then raise exception 'workspace case conflict';end if;
 select * into s from public.workspace_staff where user_id=p_actor and active for share;
 if not found or s.role not in ('admin','doctor') then raise exception 'forbidden';end if;
 if s.role='doctor' then perform public.workspace_review_doctor(p_id,p_actor);end if;
 if p_outcome is null or p_outcome not in ('attempted','reached','unreachable','referred') or p_note is null or length(btrim(p_note)) not between 1 and 1500 then raise exception 'Enter a contact outcome and note.';end if;
 perform public.workspace_reconcile_monitoring(p_id);
 if not exists(select 1 from public.workspace_followup_work w join public.workspace_monitoring_requirements r on r.id=w.requirement_id where w.case_id=p_id and w.requirement_id=p_requirement and w.status='open' and r.status='active') then raise exception 'This follow-up is no longer open.';end if;
 if p_outcome='referred' then
  if exists(select 1 from public.workspace_followup_review_links where requirement_id=p_requirement and event='referred') then return (select revision from public.workspace_cases where id=p_id);end if;
  task:=public.workspace_reconcile_review_task(p_id,true,'monitoring.referred');
  insert into public.workspace_followup_review_links(case_id,requirement_id,review_task_id,event) values(p_id,p_requirement,task,'referred');
 end if;
 insert into public.workspace_followup_events(requirement_id,kind,actor_id,actor_label,note) values(p_requirement,p_outcome,p_actor,s.display_name,btrim(p_note));
 perform public.workspace_set_actor(p_actor,p_id);
 update public.workspace_cases set revision=revision+1 where id=p_id returning revision into c.revision;
 return c.revision;
end $$;
revoke all on function public.workspace_followup_contact(uuid,uuid,integer,uuid,text,text) from public,anon,authenticated;
grant execute on function public.workspace_followup_contact(uuid,uuid,integer,uuid,text,text) to service_role;
