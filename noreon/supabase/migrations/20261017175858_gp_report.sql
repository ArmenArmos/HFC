-- GP report (dark): the hypertension report for the member's primary-care doctor,
-- built from template NRN-GP-REP-001 v1.0 (docs/reference/gp-report/).
-- The database only gathers source rows for the assigned doctor and keeps approved
-- versions append-only. The report text is built in the app from these rows and the
-- existing clinical engine; nothing here derives a clinical value.
-- Nothing is sent to an external GP: there is no send path in this migration.

create table public.gp_report_capabilities(
 singleton boolean primary key default true check(singleton),
 enabled boolean not null default false
);
insert into public.gp_report_capabilities(singleton,enabled)values(true,false);
alter table public.gp_report_capabilities enable row level security;
revoke all on public.gp_report_capabilities from public,anon,authenticated,service_role;
create function public._gp_report_enabled()returns boolean language sql stable security definer set search_path=''as $$
 select coalesce((select enabled from public.gp_report_capabilities where singleton),false)
$$;
revoke all on function public._gp_report_enabled() from public,anon,authenticated,service_role;

-- Approved versions are frozen: no update or delete for anyone, a new approval is a new version.
create table public.gp_report_versions(
 id uuid primary key default gen_random_uuid(),
 member_id uuid not null references public.patient_clinical_cases(user_id),
 version integer not null check(version>=1),
 template_version text not null check(length(template_version) between 1 and 80),
 algorithm_version text not null check(length(algorithm_version) between 1 and 80),
 source_token text not null check(source_token ~ '^[0-9a-f]{32}$'),
 content jsonb not null check(jsonb_typeof(content)='object' and octet_length(content::text)<300000),
 content_sha256 text not null check(content_sha256 ~ '^[0-9a-f]{64}$'),
 approved_by uuid not null references auth.users(id),
 approved_by_name text not null check(length(approved_by_name) between 1 and 200),
 approved_at timestamptz not null default now(),
 submission_id uuid not null unique,
 unique(member_id,version)
);
alter table public.gp_report_versions enable row level security;
revoke all on public.gp_report_versions from public,anon,authenticated,service_role;

-- Readers: the assigned doctor (managed session) and active administrators.
-- Administrators see version metadata only; the content column is not granted and
-- is read through doctor_gp_report_version, which admits the assigned doctor only.
create function public._gp_report_reader(p_member uuid)returns boolean language sql stable security definer set search_path=''as $$
 select public._gp_report_enabled() and (
  public.real_clinical_staff_identity()->>'role'='admin'
  or (public.real_clinical_staff_identity()->>'role'='doctor' and public.staff_care_access(p_member,auth.uid(),true)))
$$;
revoke all on function public._gp_report_reader(uuid) from public,anon,authenticated,service_role;
grant execute on function public._gp_report_reader(uuid) to authenticated;
create policy gp_report_versions_staff_read on public.gp_report_versions for select to authenticated using(public._gp_report_reader(member_id));
grant select(id,member_id,version,template_version,algorithm_version,content_sha256,approved_by_name,approved_at) on public.gp_report_versions to authenticated;

create function public._gp_report_assigned_doctor(p_member uuid)returns void language plpgsql stable security definer set search_path=''as $$
begin
 if coalesce(public.real_clinical_staff_identity()->>'role','')<>'doctor' or not public.staff_care_access(p_member,auth.uid(),true) then
  raise insufficient_privilege using message='Assigned doctor access required';
 end if;
end $$;
revoke all on function public._gp_report_assigned_doctor(uuid) from public,anon,authenticated,service_role;

-- Every source row the report may cite, with its own dates. Order is fixed so the
-- token (md5 of this body) changes only when the evidence changes.
create function public._gp_report_source_body(p_member uuid)returns jsonb language sql stable security definer set search_path=''as $$
 select jsonb_build_object(
 'profile',(select jsonb_build_object('name',p.display_name,'birthDate',p.birth_date,'biologicalSex',p.biological_sex)from public.profiles p where p.id=p_member),
 'assessment',(select jsonb_build_object('answers',a.answers,'assessmentDate',a.assessment_date,'algorithmVersion',a.algorithm_version,'completedAt',a.completed_at,'urgentRule',a.urgent_rule,'updatedAt',a.updated_at)
  from public.patient_assessments a where a.user_id=p_member),
 'homeReadings',coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'systolic',m.systolic,'diastolic',m.diastolic,'pulse',m.pulse,'measuredAt',m.measured_at,'recordedAt',m.created_at)order by m.measured_at,m.id)
  from public.patient_measurements m where m.user_id=p_member
  and not exists(select 1 from public.patient_care_visit_entries e where e.measurement_id=m.id)),'[]'),
 'deviceReadings',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'systolic',r.systolic,'diastolic',r.diastolic,'pulse',r.pulse,'measuredAt',r.measured_at,'receivedAt',r.received_at,'transport',r.transport)order by r.measured_at,r.id)
  from public.bp_device_readings r where r.member_id=p_member and r.state='attached'),'[]'),
 'visitObservations',coalesce((select jsonb_agg(jsonb_build_object('id',e.id,'visitId',e.visit_id,'field',e.payload->>'field','state',e.payload->>'state','value',e.payload->'value','unit',e.payload->>'unit',
   'observedAt',e.observed_instant,'recordedAt',e.recorded_at,'actorName',e.actor_name,'clinic',k.name)order by e.observed_instant,e.position,e.id)
  from public.patient_care_visit_entries e left join public.workspace_clinics k on k.id=e.clinic_id
  where e.user_id=p_member and e.payload->>'kind'='observation'),'[]'),
 'labResults',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'marker',r.marker,'value',r.value,'unit',r.unit,'referenceLow',r.reference_low,'referenceHigh',r.reference_high,'referenceText',r.reference_text,
   'collectedAt',r.collected_at,'receivedAt',r.received_at,'source',r.source,'sourceLabel',r.source_label,'reviewedAt',r.reviewed_at,'reviewedBy',r.reviewed_by,'sourceReportId',r.source_report_id)order by r.collected_at,r.id)
  from public.patient_care_results r where r.user_id=p_member),'[]'),
 'sourceReports',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'state',r.state,'uploadedAt',r.created_at,'confirmedAt',r.confirmed_at,'reportDate',r.reviewed->>'reportDate','laboratory',r.reviewed->>'laboratory')order by r.created_at,r.id)
  from public.patient_reports r where r.user_id=p_member and r.deleted_at is null and r.state<>'deleted'),'[]'),
 'clinicDocuments',coalesce((select jsonb_agg(jsonb_build_object('id',t.id,'attachedAt',t.created_at,'clinic',k.name)order by t.created_at,t.id)
  from public.clinic_result_attachments t left join public.workspace_clinics k on k.id=t.clinic_id
  where t.user_id=p_member
  and not exists(select 1 from public.clinic_result_detachments d where d.attachment_id=t.id)
  and not exists(select 1 from public.clinic_result_attachments n where n.previous_id=t.id)),'[]'),
 'tests',coalesce((select jsonb_agg(jsonb_build_object('id',t.id,'title',t.title,'status',t.status,'orderedAt',t.ordered_at,'dueAt',t.due_at,'source',t.source)order by t.ordered_at,t.id)
  from public.patient_care_tests t where t.user_id=p_member),'[]'),
 'plans',coalesce((select jsonb_agg(jsonb_build_object('planId',p.id,'version',v.version,'clinician',p.clinician,'publishedAt',p.published_at,'instructions',p.instructions,'active',p.active,'retiredAt',p.retired_at,'changeSummary',v.change_summary)order by p.published_at,p.id)
  from public.patient_care_plans p left join public.patient_care_plan_versions v on v.plan_id=p.id where p.user_id=p_member),'[]'),
 'medications',coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'planId',m.plan_id,'name',m.name,'dose',m.dose,'instructions',m.instructions,'times',to_jsonb(m.times),'startDate',m.start_date,'endDate',m.end_date,'active',m.active,'effectiveAt',m.effective_at)order by m.start_date,m.id)
  from public.patient_care_medications m where m.user_id=p_member),'[]'),
 'alerts',coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'source',a.source,'reasonCode',a.reason_code,'redFlags',to_jsonb(a.red_flags),'ruleId',a.rule_id,'ruleVersion',a.rule_version,'state',a.state,
   'createdAt',a.created_at,'lastSeenAt',a.last_seen_at,'acknowledgedAt',a.acknowledged_at,'resolvedAt',a.resolved_at,'resolution',a.resolution)order by a.created_at,a.id)
  from public.care_alerts a where a.member_id=p_member),'[]'),
 'consultation',(select jsonb_build_object('decision',c.review#>>'{consultation,decision}','completedAt',c.review#>>'{consultation,completedAt}',
   'arrangement',(select jsonb_build_object('holdSince',x.hold_since,'scheduledAt',x.scheduled_at,'channel',x.channel)from public.patient_consultation_arrangements x where x.user_id=p_member order by x.created_at desc,x.id limit 1))
  from public.patient_clinical_cases c where c.user_id=p_member)
 )
$$;
revoke all on function public._gp_report_source_body(uuid) from public,anon,authenticated,service_role;

create function public.doctor_gp_report_source(p_user_id uuid)returns jsonb language plpgsql stable security definer set search_path=''as $$
declare body jsonb;
begin
 if not public._gp_report_enabled() then return jsonb_build_object('enabled',false);end if;
 perform public._gp_report_assigned_doctor(p_user_id);
 body:=public._gp_report_source_body(p_user_id);
 return jsonb_build_object('enabled',true,'memberId',p_user_id,'token',md5(body::text),'readAt',now(),'source',body,
  'doctorName',(select display_name from public.workspace_staff where user_id=auth.uid()),
  'versions',coalesce((select jsonb_agg(jsonb_build_object('version',v.version,'approvedAt',v.approved_at,'approvedByName',v.approved_by_name,'contentSha256',v.content_sha256,'sourceToken',v.source_token)order by v.version desc)
   from public.gp_report_versions v where v.member_id=p_user_id),'[]'));
end $$;

-- Approval binds to the evidence the doctor saw: a changed source token is refused.
-- A repeated submission returns its recorded outcome.
create function public.doctor_gp_report_approve(p_user_id uuid,p_source_token text,p_content jsonb,p_submission_id uuid)returns jsonb language plpgsql security definer set search_path=''as $$
declare v public.gp_report_versions;n integer;name text;
begin
 if not public._gp_report_enabled() then raise exception 'GP report is switched off' using errcode='55P03';end if;
 perform public._gp_report_assigned_doctor(p_user_id);
 select * into v from public.gp_report_versions where submission_id=p_submission_id;
 if found then
  if v.member_id<>p_user_id or v.approved_by<>auth.uid() then raise exception 'Submission belongs to another approval' using errcode='22023';end if;
  return jsonb_build_object('version',v.version,'approvedAt',v.approved_at,'approvedByName',v.approved_by_name,'contentSha256',v.content_sha256);
 end if;
 perform 1 from public.patient_clinical_cases where user_id=p_user_id for update;
 if p_source_token is distinct from md5(public._gp_report_source_body(p_user_id)::text) then
  raise exception 'The member''s records changed. Reload the report before approving.' using errcode='40001';
 end if;
 if p_content is null or jsonb_typeof(p_content)<>'object' or p_content->>'kind' is distinct from 'noreon-gp-report' or p_content->>'memberId' is distinct from p_user_id::text
  or p_content->>'sourceToken' is distinct from p_source_token or nullif(p_content->>'templateVersion','') is null or nullif(p_content->>'algorithmVersion','') is null then
  raise exception 'Report content does not match this member and source' using errcode='22023';
 end if;
 select display_name into name from public.workspace_staff where user_id=auth.uid();
 select coalesce(max(version),0)+1 into n from public.gp_report_versions where member_id=p_user_id;
 insert into public.gp_report_versions(member_id,version,template_version,algorithm_version,source_token,content,content_sha256,approved_by,approved_by_name,submission_id)
 values(p_user_id,n,p_content->>'templateVersion',p_content->>'algorithmVersion',p_source_token,p_content,encode(extensions.digest(convert_to(p_content::text,'UTF8'),'sha256'),'hex'),auth.uid(),name,p_submission_id)
 returning * into v;
 return jsonb_build_object('version',v.version,'approvedAt',v.approved_at,'approvedByName',v.approved_by_name,'contentSha256',v.content_sha256);
end $$;

create function public.doctor_gp_report_version(p_user_id uuid,p_version integer)returns jsonb language plpgsql stable security definer set search_path=''as $$
declare v public.gp_report_versions;
begin
 if not public._gp_report_enabled() then return null;end if;
 perform public._gp_report_assigned_doctor(p_user_id);
 select * into v from public.gp_report_versions where member_id=p_user_id and version=p_version;
 if not found then return null;end if;
 return jsonb_build_object('version',v.version,'approvedAt',v.approved_at,'approvedByName',v.approved_by_name,'contentSha256',v.content_sha256,'content',v.content);
end $$;

revoke all on function public.doctor_gp_report_source(uuid),public.doctor_gp_report_approve(uuid,text,jsonb,uuid),public.doctor_gp_report_version(uuid,integer) from public,anon,authenticated,service_role;
grant execute on function public.doctor_gp_report_source(uuid),public.doctor_gp_report_approve(uuid,text,jsonb,uuid),public.doctor_gp_report_version(uuid,integer) to authenticated;
