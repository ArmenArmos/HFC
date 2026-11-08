-- The nurse's existing publication read also identifies which plan is current.
-- Keep the same care-access guard, redaction and outer access-audit wrapper.
-- Only metadata for publications already in this snapshot is returned; no version change summaries.
create or replace function public.patient_clinical_case_snapshot_unlogged(p_user_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare s jsonb;c public.patient_clinical_cases;e jsonb;
begin
 if public.real_clinical_staff_identity()->>'role'='nurse' then
  if not public.staff_care_access(p_user_id,auth.uid(),true) then raise insufficient_privilege using message='Assigned care access required';end if;
  select * into c from public.patient_clinical_cases where user_id=p_user_id;e:=public.patient_clinical_evidence(p_user_id);
  s:=jsonb_build_object('id',c.user_id,'revision',c.revision,'evidenceToken',e->>'token','evidence',e->'data','draft',null,'draftSavedAt',null,'draftStale',false,'review',null,
   'publications',(select coalesce(jsonb_agg(jsonb_build_object('planId',plan_id,'publishedAt',published_at,'draft',draft) order by published_at desc),'[]') from public.patient_clinical_publications where user_id=p_user_id),
   'planVersions',(select coalesce(jsonb_agg(jsonb_build_object('planId',p.plan_id,'version',v.version,'publishedAt',p.published_at,'current',plan.active,'changeSummary',null) order by p.published_at desc),'[]')
    from public.patient_clinical_publications p
    left join public.patient_care_plan_versions v on v.plan_id=p.plan_id and v.user_id=p.user_id
    left join public.patient_care_plans plan on plan.id=p.plan_id and plan.user_id=p.user_id
    where p.user_id=p_user_id));
 else s:=public.patient_clinical_case_snapshot_doctor(p_user_id);end if;
 return s||jsonb_build_object('careNotes',(select coalesce(jsonb_agg(to_jsonb(n)-'workspace_case_id'-'patient_case_id' order by n.created_at desc),'[]') from public.staff_care_notes n where patient_case_id=p_user_id));
end $$;

revoke all on function public.patient_clinical_case_snapshot_unlogged(uuid) from public,anon,authenticated,service_role;
