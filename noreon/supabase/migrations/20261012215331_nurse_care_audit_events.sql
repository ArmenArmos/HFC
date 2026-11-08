-- Extend the native audit vocabulary for attributed operational work.
alter table public.patient_clinical_case_events drop constraint patient_clinical_case_events_kind_check;
alter table public.patient_clinical_case_events add constraint patient_clinical_case_events_kind_check check(kind in (
'enrolled','assigned','draft-saved','review-prepared','report-approved','result-received','consultation-decided','consultation-completed','plan-published',
'nurse-assigned','care-measurement','care-evidence','care-contact-attempted','care-reached','care-unreachable','care-refer-doctor'));

-- Approved published care is visible; unpublished drafts remain absent.
create or replace function public.patient_clinical_case_snapshot(p_user_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare s jsonb;c public.patient_clinical_cases;e jsonb;
begin
 if public.real_clinical_staff_identity()->>'role'='nurse' then
  if not public.staff_care_access(p_user_id,auth.uid(),true) then raise insufficient_privilege using message='Assigned care access required';end if;
  select * into c from public.patient_clinical_cases where user_id=p_user_id;e:=public.patient_clinical_evidence(p_user_id);
  s:=jsonb_build_object('id',c.user_id,'revision',c.revision,'evidenceToken',e->>'token','evidence',e->'data','draft',null,'draftSavedAt',null,'draftStale',false,'review',null,'publications',(select coalesce(jsonb_agg(jsonb_build_object('planId',plan_id,'publishedAt',published_at,'draft',draft) order by published_at desc),'[]') from public.patient_clinical_publications where user_id=p_user_id));
 else s:=public.patient_clinical_case_snapshot_doctor(p_user_id);end if;
 return s||jsonb_build_object('careNotes',(select coalesce(jsonb_agg(to_jsonb(n)-'workspace_case_id'-'patient_case_id' order by n.created_at desc),'[]') from public.staff_care_notes n where patient_case_id=p_user_id));
end $$;

create or replace function public.workspace_followup_contact(p_id uuid,p_actor uuid,p_expected_revision integer,p_requirement uuid,p_outcome text,p_note text) returns integer
language plpgsql security definer set search_path='' as $$
declare c public.workspace_cases;s public.workspace_staff;task uuid;
begin
 select * into c from public.workspace_cases where id=p_id and expires_at>now() for update;
 if not found or c.revision is distinct from p_expected_revision then raise exception 'workspace case conflict';end if;
 select * into s from public.workspace_staff where user_id=p_actor and active for share;
 if not found or s.role not in ('admin','doctor','nurse') then raise exception 'forbidden';end if;
 if s.role='doctor' then perform public.workspace_review_doctor(p_id,p_actor);end if;
 if s.role='nurse' then
  perform 1 from public.workspace_staff d join public.workspace_clinics k on k.id=d.clinic_id where d.user_id=c.assigned_doctor_id for share of d,k;
 end if;
 if s.role='nurse' and not public.staff_care_access(p_id,p_actor,false) then raise insufficient_privilege using message='Assigned care access required';end if;
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

