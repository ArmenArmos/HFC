-- GP report (#224) reads doctor-confirmed clinic lab PDF values (#225) (QA N-01, 18 Oct 2026).
-- Before this, the report read only patient_care_results, so values the doctor had just confirmed
-- from the clinic PDF were reported as "no result received". The report now cites confirmed and
-- corrected values with unit, date and source; values still awaiting the doctor's check are named
-- without any value. Unconfirmed AI readings never reach the report. The source token covers the new
-- rows, so a confirmation made after the doctor opened the report makes an approval on the old view stale.
-- Only _gp_report_source_body changes; access stays with doctor_gp_report_source (assigned doctor).

create or replace function public._gp_report_source_body(p_member uuid)returns jsonb language sql stable security definer set search_path=''as $$
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
