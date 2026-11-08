-- B5 part B (dark): numbered care-plan versions and a doctor-written "what
-- changed" note. Publications already stay immutable and the published plan
-- does not change while the doctor edits a new draft; this adds the numbering and
-- the note. Every publication gets a version row, whichever publish path ran.

create table public.patient_care_plan_versions(
 plan_id uuid primary key references public.patient_clinical_publications(plan_id),
 user_id uuid not null references auth.users(id),
 version integer not null check(version>0),
 previous_plan_id uuid references public.patient_clinical_publications(plan_id),
 change_summary text check(change_summary is null or length(btrim(change_summary))between 1 and 1000),
 created_at timestamptz not null default clock_timestamp(),
 unique(user_id,version)
);
alter table public.patient_care_plan_versions enable row level security;
revoke all on public.patient_care_plan_versions from public,anon,authenticated,service_role;
create trigger patient_care_plan_versions_immutable before update or delete on public.patient_care_plan_versions
 for each row execute function public._patient_visit_immutable();

insert into public.patient_care_plan_versions(plan_id,user_id,version,previous_plan_id,created_at)
select plan_id,user_id,row_number()over w,lag(plan_id)over w,published_at from public.patient_clinical_publications
window w as(partition by user_id order by published_at,plan_id);

-- The note travels from the wrapper below in a transaction-local setting and is
-- cleared once used, so it can never attach to a later publication.
create function public._patient_care_plan_version()returns trigger
language plpgsql security definer set search_path=''as $$
declare prior uuid;n integer;note text:=nullif(btrim(coalesce(current_setting('noreon.plan_change_summary',true),'')),'');
begin
 perform set_config('noreon.plan_change_summary','',true);
 perform pg_advisory_xact_lock(hashtextextended('plan-version:'||new.user_id::text,0));
 select v.plan_id,v.version into prior,n from public.patient_care_plan_versions v where v.user_id=new.user_id order by v.version desc limit 1;
 insert into public.patient_care_plan_versions(plan_id,user_id,version,previous_plan_id,change_summary,created_at)
 values(new.plan_id,new.user_id,coalesce(n,0)+1,prior,case when prior is null then null else note end,new.published_at);
 return new;
end$$;
create trigger patient_care_plan_version after insert on public.patient_clinical_publications
 for each row execute function public._patient_care_plan_version();

-- Publish with a note. When the switch is on, a plan that replaces an earlier one
-- needs a note. A resend of the same request returns the recorded plan unchanged.
create function public.publish_patient_clinical_plan_with_summary(p_user_id uuid,p_actor uuid,p_expected_revision bigint,p_evidence_token text,p_engine jsonb,p_request_id uuid,p_change_summary text)returns uuid
language plpgsql security definer set search_path=''as $$
declare note text:=nullif(btrim(coalesce(p_change_summary,'')),'');
begin
 if exists(select 1 from public.patient_clinical_publications where request_id=p_request_id)then
  return public.publish_patient_clinical_plan(p_user_id,p_actor,p_expected_revision,p_evidence_token,p_engine,p_request_id);
 end if;
 if note is not null and length(note)>1000 then raise exception using errcode='22023',message='Keep the change note within 1000 characters';end if;
 if public._doctor_completion_enabled()and note is null and exists(select 1 from public.patient_clinical_publications where user_id=p_user_id)then
  raise exception using errcode='22023',message='Describe what changed since the previous plan';
 end if;
 perform set_config('noreon.plan_change_summary',coalesce(note,''),true);
 return public.publish_patient_clinical_plan(p_user_id,p_actor,p_expected_revision,p_evidence_token,p_engine,p_request_id);
end$$;

-- Member: own version list, newest first. No staff identifiers.
create function public.patient_care_plan_versions()returns jsonb
language sql stable security definer set search_path=''as $$
 select jsonb_build_object('version','plan-versions-v1','versions',case when not public._doctor_completion_enabled()
  or not exists(select 1 from auth.users u where u.id=auth.uid() and u.phone_confirmed_at is not null)then '[]'::jsonb else
  coalesce((select jsonb_agg(jsonb_build_object('planId',v.plan_id,'version',v.version,'publishedAt',p.published_at,'changeSummary',v.change_summary,'current',coalesce(c.active,false))order by v.version desc)
   from public.patient_care_plan_versions v join public.patient_clinical_publications p on p.plan_id=v.plan_id join public.patient_care_plans c on c.id=v.plan_id
   where v.user_id=auth.uid()),'[]')end)
$$;

-- Assigned doctor: the same list for the member's case history.
create function public.doctor_member_plan_versions(p_user_id uuid)returns jsonb
language plpgsql stable security definer set search_path=''as $$
begin
 perform public._assigned_active_doctor(p_user_id);
 return jsonb_build_object('version','plan-versions-v1','versions',case when not public._doctor_completion_enabled()then '[]'::jsonb else
  coalesce((select jsonb_agg(jsonb_build_object('planId',v.plan_id,'version',v.version,'publishedAt',p.published_at,'changeSummary',v.change_summary,'current',coalesce(c.active,false))order by v.version desc)
   from public.patient_care_plan_versions v join public.patient_clinical_publications p on p.plan_id=v.plan_id join public.patient_care_plans c on c.id=v.plan_id
   where v.user_id=p_user_id),'[]')end);
end$$;

revoke all on function public._patient_care_plan_version(),public.publish_patient_clinical_plan_with_summary(uuid,uuid,bigint,text,jsonb,uuid,text),
 public.patient_care_plan_versions(),public.doctor_member_plan_versions(uuid)from public,anon,authenticated,service_role;
grant execute on function public.publish_patient_clinical_plan_with_summary(uuid,uuid,bigint,text,jsonb,uuid,text)to service_role;
grant execute on function public.patient_care_plan_versions(),public.doctor_member_plan_versions(uuid)to authenticated;
