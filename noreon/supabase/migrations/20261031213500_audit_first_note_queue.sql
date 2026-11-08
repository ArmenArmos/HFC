-- DH-02: audit first-note queue details atomically and keep unchanged polls free of audit writes.
create or replace function public.doctor_first_note_queue()returns jsonb
language plpgsql security definer set search_path=''as $$
declare h int;result jsonb;
begin
 if auth.uid()is null or not exists(select 1 from public.workspace_staff s join public.workspace_clinics k on k.id=s.clinic_id where s.user_id=auth.uid()and s.role='doctor'and s.active and k.active)
  or not public._real_staff_managed_session_allowed(auth.uid())then
  raise insufficient_privilege using message='Active doctor required';end if;
 if not public._first_note_enabled()then return jsonb_build_object('version','first-note-queue-v1','enabled',false,'items','[]'::jsonb);end if;
 select due_hours into h from public.member_first_note_settings where singleton;
 select jsonb_build_object('version','first-note-queue-v1','enabled',true,'items',coalesce((select jsonb_agg(jsonb_build_object('memberId',c.user_id,
   'memberName',(select p.display_name from public.profiles p where p.id=c.user_id),'completedAt',a.completed_at,'dueAt',a.completed_at+make_interval(hours=>h))order by a.completed_at)
  from public.patient_clinical_cases c join public.patient_assessments a on a.user_id=c.user_id
  where c.assigned_doctor_id=auth.uid()and a.completed_at is not null and a.urgent_rule is null
   and not exists(select 1 from public.member_first_notes n where n.user_id=c.user_id)
   and not exists(select 1 from public.patient_care_plans p where p.user_id=c.user_id and p.active)),'[]')) into result;
 perform public._access_audit_record((x->>'memberId')::uuid,'doctor_inbox','first_notes')
  from jsonb_array_elements(result->'items')x;
 return result;
end$$;

-- Polling returns no member details and writes no access records. Detail reads above audit
-- every returned member in the same transaction; any audit error aborts the entire read.
create function public.doctor_first_note_queue_count()returns jsonb
language plpgsql stable security definer set search_path=''as $$
begin
 if auth.uid()is null or not exists(select 1 from public.workspace_staff s join public.workspace_clinics k on k.id=s.clinic_id where s.user_id=auth.uid()and s.role='doctor'and s.active and k.active)
  or not public._real_staff_managed_session_allowed(auth.uid())then
  raise insufficient_privilege using message='Active doctor required';end if;
 if not public._first_note_enabled()then return jsonb_build_object('version','first-note-queue-count-v1','enabled',false,'count',0);end if;
 return jsonb_build_object('version','first-note-queue-count-v1','enabled',true,'count',(
  select count(*) from public.patient_clinical_cases c join public.patient_assessments a on a.user_id=c.user_id
  where c.assigned_doctor_id=auth.uid()and a.completed_at is not null and a.urgent_rule is null
   and not exists(select 1 from public.member_first_notes n where n.user_id=c.user_id)
   and not exists(select 1 from public.patient_care_plans p where p.user_id=c.user_id and p.active)));
end$$;
revoke all on function public.doctor_first_note_queue_count()from public,anon,authenticated,service_role;
grant execute on function public.doctor_first_note_queue_count()to authenticated;
