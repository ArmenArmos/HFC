-- Operational lab stages for samples a nurse recorded as collected. These are
-- logistics facts (where the sample is), never results or clinical meaning.
-- Stage order: collected (the visit entry itself) -> at-lab -> results-received.
create table public.patient_care_lab_stages(
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references public.patient_clinical_cases(user_id),
 collection_entry_id uuid not null references public.patient_care_visit_entries(id),
 stage text not null check(stage in('at-lab','results-received')),
 submission_id uuid not null,
 occurred_at timestamptz not null,
 recorded_at timestamptz not null default clock_timestamp(),
 actor_id uuid not null references auth.users(id),actor_name text not null,
 actor_role text not null check(actor_role in('nurse','doctor')),clinic_id uuid not null,
 unique(collection_entry_id,stage),unique(user_id,submission_id)
);
create index patient_care_lab_stages_member on public.patient_care_lab_stages(user_id,collection_entry_id);
alter table public.patient_care_lab_stages enable row level security;
revoke all on public.patient_care_lab_stages from public,anon,authenticated,service_role;
create trigger patient_care_lab_stages_immutable before update or delete on public.patient_care_lab_stages
 for each row execute function public._patient_visit_immutable();

-- The current sample per visit and test. Before any stage, the latest
-- collection outcome is the fact: a later "not collected" corrects an earlier
-- "collected", and a duplicate "collected" replaces it, ordered by
-- (recorded_at, position). Once a sample has a stage it has left the visit, so
-- later entries for that test can no longer hide it.
create function public._patient_lab_current_collection(p_entry public.patient_care_visit_entries)returns boolean
language sql stable security definer set search_path=''as $$
 select p_entry.payload->>'kind'='collection' and p_entry.payload->>'outcome'='collected' and(
  exists(select 1 from public.patient_care_lab_stages s where s.collection_entry_id=p_entry.id)
  or not exists(
   select 1 from public.patient_care_visit_entries other where other.user_id=p_entry.user_id and other.visit_id=p_entry.visit_id
    and other.payload->>'kind'='collection' and other.payload->>'testId'=p_entry.payload->>'testId' and other.id<>p_entry.id
    and((other.recorded_at,other.position)>(p_entry.recorded_at,p_entry.position)
     or exists(select 1 from public.patient_care_lab_stages s where s.collection_entry_id=other.id))))
$$;

-- One row per current collected sample with its recorded stages, oldest first.
-- Members see only samples collected after their latest published plan, so a
-- finished cycle never keeps "results will appear after approval" on Home.
create function public._patient_lab_samples(p_member uuid,p_staff boolean)returns jsonb
language sql stable security definer set search_path=''as $$
 select coalesce(jsonb_agg(jsonb_build_object(
  'entryId',e.id,'visitId',e.visit_id,'testId',e.payload->>'testId',
  'title',(select t->>'title' from jsonb_array_elements(v.booking_context->'tests')t where t->>'id'=e.payload->>'testId' limit 1),
  'collectedAt',e.observed_instant,
  'stages',coalesce((select jsonb_agg(jsonb_build_object('stage',s.stage,'occurredAt',s.occurred_at)
   ||case when p_staff then jsonb_build_object('id',s.id,'recordedAt',s.recorded_at,'actor',jsonb_build_object('name',s.actor_name,'role',s.actor_role))else '{}'::jsonb end
   order by case s.stage when 'at-lab' then 1 else 2 end)
   from public.patient_care_lab_stages s where s.collection_entry_id=e.id),'[]'))
  order by e.observed_instant,e.id),'[]')
 from public.patient_care_visit_entries e join public.patient_care_visits v on v.id=e.visit_id and v.user_id=e.user_id
 where e.user_id=p_member and public._patient_lab_current_collection(e)
  and(p_staff or e.observed_instant>coalesce((select max(published_at)from public.patient_clinical_publications where user_id=p_member),'-infinity'::timestamptz))
$$;

create function public.patient_staff_lab_stages(p_member uuid)returns jsonb
language plpgsql security definer set search_path=''as $$
begin
 perform set_config('lock_timeout','1500ms',true);
 perform public._patient_visit_authorize(p_member,false,false);
 return jsonb_build_object('version','lab-stage-v1','memberId',p_member,
  'revision',(select revision from public.patient_clinical_cases where user_id=p_member),'samples',public._patient_lab_samples(p_member,true));
end$$;

-- The member reads only their own samples, without staff identities.
create function public.patient_member_lab_stages()returns jsonb
language plpgsql stable security definer set search_path=''as $$
declare m uuid:=auth.uid();
begin
 if auth.role()is distinct from 'authenticated'or m is null then raise insufficient_privilege;end if;
 return jsonb_build_object('version','lab-stage-v1','samples',public._patient_lab_samples(m,false));
end$$;

-- Command: {version:'lab-stage-v1',id,submissionId,entryId,stage,occurredAt}.
-- The assigned nurse records at-lab; the assigned nurse or doctor records
-- results-received. Each stage is recorded once per sample; a lost response is
-- recovered by resending the same command, which replays the stored outcome.
create function public.patient_staff_lab_stage_command(p_command jsonb)returns jsonb
language plpgsql security definer set search_path=''as $$
declare m uuid;sub uuid;entry uuid;st text;occurred timestamptz;s public.workspace_staff;existing public.patient_care_lab_stages;
 collected timestamptz;atlab timestamptz;r bigint;sid uuid;
 bad constant jsonb:=jsonb_build_object('status','invalid','issues',jsonb_build_array(jsonb_build_object('path','','message','Check the lab stage details')));
begin
 perform set_config('lock_timeout','1500ms',true);
 if jsonb_typeof(p_command)is distinct from 'object'or p_command-array['version','id','submissionId','entryId','stage','occurredAt']<>'{}'
  or not(p_command?&array['version','id','submissionId','entryId','stage','occurredAt'])or p_command->>'version'is distinct from 'lab-stage-v1'
  or coalesce(p_command->>'stage','')not in('at-lab','results-received')or jsonb_typeof(p_command->'occurredAt')is distinct from 'string'
  or p_command->>'occurredAt'!~'^\d{4}-\d{2}-\d{2}T([01][0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9](\.\d+)?)?(Z|[+-]\d{2}:\d{2})$'then return bad;end if;
 begin
  m:=(p_command->>'id')::uuid;sub:=(p_command->>'submissionId')::uuid;entry:=(p_command->>'entryId')::uuid;
  occurred:=public._patient_visit_instant(p_command->>'occurredAt');
 exception when invalid_text_representation or datetime_field_overflow or invalid_datetime_format then return bad;end;
 st:=p_command->>'stage';
 if not isfinite(occurred)or occurred>clock_timestamp()+interval '5 minutes'then return bad;end if;
 perform pg_advisory_xact_lock(hashtextextended('patient-lab-stage:'||m::text||':'||entry::text,0));
 s:=public._patient_visit_authorize(m,false,true);
 if st='at-lab'and s.role is distinct from 'nurse'then raise insufficient_privilege;end if;
 select * into existing from public.patient_care_lab_stages where user_id=m and submission_id=sub;
 if found then
  if existing.collection_entry_id<>entry or existing.stage<>st or existing.occurred_at<>occurred or existing.actor_id<>s.user_id then return jsonb_build_object('status','stale');end if;
  return jsonb_build_object('status','saved','submissionId',sub,'stageId',existing.id,'revision',(select revision from public.patient_clinical_cases where user_id=m),'replayed',true);
 end if;
 select e.observed_instant into collected from public.patient_care_visit_entries e
  where e.id=entry and e.user_id=m and public._patient_lab_current_collection(e);
 if not found then return bad;end if;
 if exists(select 1 from public.patient_care_lab_stages where collection_entry_id=entry and stage=st)then return jsonb_build_object('status','stale');end if;
 if st='results-received'then
  select occurred_at into atlab from public.patient_care_lab_stages where collection_entry_id=entry and stage='at-lab';
  if not found or occurred<atlab then return bad;end if;
 elsif occurred<collected then return bad;
 end if;
 insert into public.patient_care_lab_stages(user_id,collection_entry_id,stage,submission_id,occurred_at,actor_id,actor_name,actor_role,clinic_id)
  values(m,entry,st,sub,occurred,s.user_id,s.display_name,s.role,s.clinic_id)returning id into sid;
 update public.patient_clinical_cases set revision=revision+1,updated_at=clock_timestamp()where user_id=m returning revision into r;
 insert into public.patient_clinical_case_events(user_id,revision,kind,actor_id,detail)
  values(m,r,'care-evidence',s.user_id,jsonb_build_object('labStageId',sid,'entryId',entry,'stage',st,'submissionId',sub));
 return jsonb_build_object('status','saved','submissionId',sub,'stageId',sid,'revision',r,'replayed',false);
exception when insufficient_privilege then return jsonb_build_object('status','access');
 when lock_not_available or query_canceled or deadlock_detected then return jsonb_build_object('status','unavailable');
 when unique_violation then return jsonb_build_object('status','stale');
end$$;

revoke all on function public._patient_lab_current_collection(public.patient_care_visit_entries),public._patient_lab_samples(uuid,boolean),public.patient_staff_lab_stages(uuid),public.patient_member_lab_stages(),
 public.patient_staff_lab_stage_command(jsonb)from public,anon,authenticated,service_role;
grant execute on function public.patient_staff_lab_stages(uuid),public.patient_member_lab_stages(),public.patient_staff_lab_stage_command(jsonb)to authenticated;
