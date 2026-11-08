-- Doctor-entered evidence for the results report. All writes append through the
-- assigned-doctor RPC; a null value is a dated clearing entry, never a deletion.
create table public.gp_report_doctor_entries(
 id uuid primary key default gen_random_uuid(),
 member_id uuid not null references public.patient_clinical_cases(user_id),
 field text not null check(field in('score2_percent','potassium','ecg_lvh','ecg_ischaemia','echo_done','ahi')),
 number_value numeric,
 finding text check(finding in('yes','no')),
 observed_on date not null,
 entered_by uuid not null references auth.users(id),
 entered_by_name text not null check(length(entered_by_name) between 1 and 200),
 entered_at timestamptz not null default now(),
 submission_id uuid not null unique,
 check((field in('score2_percent','potassium','ahi')and finding is null)
  or(field in('ecg_lvh','ecg_ischaemia','echo_done')and number_value is null)),
 check(number_value is null or (field='score2_percent'and number_value between 0 and 100)
  or(field='potassium'and number_value between 1 and 12)
  or(field='ahi'and number_value between 0 and 200))
);
alter table public.gp_report_doctor_entries enable row level security;
revoke all on public.gp_report_doctor_entries from public,anon,authenticated,service_role;
create index gp_report_doctor_entries_latest on public.gp_report_doctor_entries(member_id,field,entered_at desc,id desc);

create function public.doctor_result_entry_save(p_user_id uuid,p_field text,p_number numeric,p_finding text,p_observed_on date,p_submission_id uuid)
returns jsonb language plpgsql security definer set search_path=''as $$
declare e public.gp_report_doctor_entries;name text;
begin
 if not public._gp_report_enabled()then raise exception 'GP report is switched off'using errcode='55P03';end if;
 perform public._gp_report_assigned_doctor(p_user_id);
 if p_submission_id is null then raise exception 'Submission is required'using errcode='22023';end if;
 -- Serialize even collisions across members before checking the recorded outcome.
 perform pg_advisory_xact_lock(hashtextextended('result-entry:'||p_submission_id::text,0));
 select * into e from public.gp_report_doctor_entries where submission_id=p_submission_id;
 if found then
  if e.member_id<>p_user_id or e.entered_by<>auth.uid()then
   raise exception 'Submission belongs to another entry'using errcode='22023';
  end if;
 else
  -- Same lock as GP approval: an entry cannot race its source-token check.
  perform 1 from public.patient_clinical_cases where user_id=p_user_id for update;
  perform public._gp_report_assigned_doctor(p_user_id);
  if p_field is null or p_field not in('score2_percent','potassium','ecg_lvh','ecg_ischaemia','echo_done','ahi')
   or p_observed_on is null or not isfinite(p_observed_on) or p_observed_on>(clock_timestamp()at time zone 'Asia/Yerevan')::date
   or (p_finding is not null and p_finding not in('yes','no'))
   or (p_field in('score2_percent','potassium','ahi')and p_finding is not null)
   or (p_field in('ecg_lvh','ecg_ischaemia','echo_done')and p_number is not null)
   or (p_number is not null and not((p_field='score2_percent'and p_number between 0 and 100)
    or(p_field='potassium'and p_number between 1 and 12)or(p_field='ahi'and p_number between 0 and 200)))then
   raise exception 'Invalid result entry'using errcode='22023';
  end if;
  select display_name into name from public.workspace_staff where user_id=auth.uid();
  insert into public.gp_report_doctor_entries(member_id,field,number_value,finding,observed_on,entered_by,entered_by_name,entered_at,submission_id)
   values(p_user_id,p_field,p_number,p_finding,p_observed_on,auth.uid(),name,clock_timestamp(),p_submission_id)returning * into e;
 end if;
 return jsonb_build_object('id',e.id,'field',e.field,'number',e.number_value,'finding',e.finding,
  'observedOn',e.observed_on,'enteredAt',e.entered_at,'enteredByName',e.entered_by_name);
end$$;
revoke all on function public.doctor_result_entry_save(uuid,text,numeric,text,date,uuid)from public,anon,authenticated,service_role;
grant execute on function public.doctor_result_entry_save(uuid,text,numeric,text,date,uuid)to authenticated;

-- Preserve every previous source key byte for byte, adding only resultEntries.
create or replace function public._gp_report_source_body(p_member uuid)returns jsonb language sql stable security definer set search_path=''as $$
 select jsonb_build_object(
 'resultEntries',coalesce((select jsonb_agg(jsonb_build_object('field',e.field,'number',e.number_value,'finding',e.finding,
   'observedOn',e.observed_on,'enteredAt',e.entered_at,'enteredByName',e.entered_by_name)order by e.field)
  from (select distinct on(field) field,number_value,finding,observed_on,entered_at,entered_by_name
   from public.gp_report_doctor_entries where member_id=p_member order by field,entered_at desc,id desc)e
  where e.number_value is not null or e.finding is not null),'[]'),
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
 -- Clinic lab PDF values read by AI (#225). A value enters the report only after the assigned
 -- doctor confirmed or corrected it; an unchecked value is listed by test name only, with no value.
 -- Rejected values and files that are detached, moved to another member or replaced are left out.
 'clinicLabValues',coalesce((select jsonb_agg(jsonb_build_object('id',v.id,'fileId',v.file_id,
   'status',case when v.status in('verified','corrected')and v.reviewed_by is not null then v.status else 'unverified'end,
   'testName',v.test_name,'catalogueRef',v.catalogue_ref,
   'value',case when v.status='corrected'then v.corrected_value when v.status='verified'then v.value end,
   'valueText',case when v.status='verified'then v.value_text end,
   'unit',case when v.status='corrected'then coalesce(v.corrected_unit,v.unit)when v.status='verified'then v.unit end,
   -- The sheet's reference range is shown only when the value kept the sheet's unit.
   'referenceLow',case when v.status='verified'or(v.status='corrected'and v.corrected_unit is not distinct from v.unit)then v.ref_low end,
   'referenceHigh',case when v.status='verified'or(v.status='corrected'and v.corrected_unit is not distinct from v.unit)then v.ref_high end,
   'referenceText',case when v.status='verified'or(v.status='corrected'and v.corrected_unit is not distinct from v.unit)then v.ref_text end,
   'collectedOn',v.collected_on,'attachedAt',a.created_at,'clinic',k.name,
   'reviewedAt',case when v.status in('verified','corrected')then v.reviewed_at end,
   'reviewedBy',case when v.status in('verified','corrected')then(select s.display_name from public.workspace_staff s where s.user_id=v.reviewed_by)end)
   order by a.created_at,v.file_id,v.seq)
  from public.lab_ai_values v join public.clinic_result_attachments a on a.id=v.attachment_id and a.user_id=v.user_id
  left join public.workspace_clinics k on k.id=a.clinic_id
  where v.user_id=p_member and v.status<>'rejected'and public._lab_ai_current(v.attachment_id)),'[]'),
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
 'medications',coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'planId',m.plan_id,'name',m.name,'dose',m.dose,'instructions',m.instructions,'times',to_jsonb(m.times),'startDate',m.start_date,'endDate',m.end_date,
   -- B2-1: current means on today's plan (carry-overs included) and within its dates, the same rule as the medicines list.
   'active',exists(select 1 from public._member_plan_medicines(p_member,(clock_timestamp()at time zone 'Asia/Yerevan')::date)x where x.id=m.id),'effectiveAt',m.effective_at)order by m.start_date,m.id)
  from public.patient_care_medications m where m.user_id=p_member),'[]'),
 'alerts',coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'source',a.source,'reasonCode',a.reason_code,'redFlags',to_jsonb(a.red_flags),'ruleId',a.rule_id,'ruleVersion',a.rule_version,'state',a.state,
   'createdAt',a.created_at,'lastSeenAt',a.last_seen_at,'acknowledgedAt',a.acknowledged_at,'resolvedAt',a.resolved_at,'resolution',a.resolution)order by a.created_at,a.id)
  from public.care_alerts a where a.member_id=p_member),'[]'),
 'consultation',(select jsonb_build_object('decision',c.review#>>'{consultation,decision}','completedAt',c.review#>>'{consultation,completedAt}',
   'arrangement',(select jsonb_build_object('holdSince',x.hold_since,'scheduledAt',x.scheduled_at,'channel',x.channel)from public.patient_consultation_arrangements x where x.user_id=p_member order by x.created_at desc,x.id limit 1))
  from public.patient_clinical_cases c where c.user_id=p_member)
 )
$$;
