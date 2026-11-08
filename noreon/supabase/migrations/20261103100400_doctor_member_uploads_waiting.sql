-- A bounded, separate source for the doctor's member-upload approvals card.
-- Keep doctor_ai_inbox and its existing lane contract unchanged.
create function public.doctor_member_uploads_waiting() returns jsonb
language plpgsql security definer set search_path='' as $$
declare
 who jsonb:=public.real_clinical_staff_identity();
 me uuid;
 members uuid[];
 rows jsonb;
 total bigint;
begin
 if who is null or who->>'role' is distinct from 'doctor' then
  raise insufficient_privilege using message='Assigned doctor session required';
 end if;
 me:=(who->>'id')::uuid;
 select coalesce(array_agg(k.user_id),'{}') into members
 from public.patient_clinical_cases k
 where k.assigned_doctor_id=me and public.staff_care_access(k.user_id,me,true);

 -- Mirror approval readiness: a finished kept file, a member confirmation that
 -- is not "not mine", at least one retained value, and no existing approval.
 -- Match/unknown readings are confirmed automatically; mismatches wait for
 -- the member's answer. A completed but empty reading cannot be approved.
 with waiting as materialized (
  select j.member_id,j.member_document_id,j.id,coalesce(j.finished_at,j.created_at) as at
  from public.lab_ai_jobs j
  join public.member_reported_documents d on d.id=j.member_document_id and d.user_id=j.member_id
  join public.member_upload_ai_confirmations c on c.job_id=j.id
  where public._lab_ai_member_upload_enabled() and public._member_upload_approval_required()
   and j.kind='member_upload' and j.state='done' and j.member_id=any(members)
   and d.deleted_at is null and c.identity_answer is distinct from 'not_mine'
   and exists(select 1 from public.member_upload_ai_values v where v.job_id=j.id and v.member_status<>'rejected')
   and not exists(select 1 from public.member_upload_doctor_approvals a where a.job_id=j.id)
 ), capped as (
  select * from waiting order by at,id limit 60
 )
 select (select count(*) from waiting),
  coalesce((select jsonb_agg(jsonb_build_object(
   'memberId',w.member_id,'memberName',coalesce(p.display_name,''),
   'documentId',w.member_document_id,'jobId',w.id,'at',w.at) order by w.at,w.id)
   from capped w left join public.profiles p on p.id=w.member_id),'[]'::jsonb)
 into total,rows;

 -- The same one-record-per-displayed-member convention as doctor_ai_inbox.
 perform public._access_audit_record(mid,'doctor_inbox',null)
 from(select distinct(x->>'memberId')::uuid mid from jsonb_array_elements(rows)x)q;
 return jsonb_build_object('rows',rows,'total',total);
end$$;

revoke all on function public.doctor_member_uploads_waiting() from public,anon,authenticated,service_role;
grant execute on function public.doctor_member_uploads_waiting() to authenticated;
comment on function public.doctor_member_uploads_waiting() is
 'Assigned doctor only: up to 60 oldest member-upload readings ready for required approval, with uncapped total; audited per displayed member.';
