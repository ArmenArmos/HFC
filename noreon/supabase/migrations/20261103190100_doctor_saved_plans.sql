-- Companion to doctor_ai_inbox: saved clinical work awaiting approval, including
-- manual saves and adopted AI saves. This read never prepares or publishes a plan.
create function public.doctor_saved_plans()returns jsonb
language plpgsql security definer set search_path=''as $$
declare
 who jsonb:=public.real_clinical_staff_identity();me uuid;members uuid[];
 items jsonb:='[]';total integer;item_cap constant integer:=50;
 ai_enabled boolean;
begin
 if who is null or who->>'role'is distinct from 'doctor'then
  raise insufficient_privilege using message='Assigned doctor session required';
 end if;
 me:=(who->>'id')::uuid;
 -- Identical assignment/session/active-care boundary to doctor_ai_inbox.
 select coalesce(array_agg(k.user_id),'{}')into members from public.patient_clinical_cases k
  where k.assigned_doctor_id=me and public.staff_care_access(k.user_id,me,true);
 ai_enabled:=public._ai_plan_enabled();

 with waiting as materialized(
  select k.user_id,k.draft_saved_at
  from public.patient_clinical_cases k
  where k.user_id=any(members)and k.draft is not null and k.draft_saved_at is not null
   and k.draft_saved_by is not null
   -- Publication retains the saved draft. Compare the review at SAVE time, so a
   -- later review edit or plan retirement cannot resurrect that consumed save.
   -- An unchanged resave of published content is also already consumed. Assignment
   -- changes clear the save's tokens and keep its text and time, so with no tokens
   -- a save is consumed if the latest publication has its text and came after it.
   and not exists(
    select 1 from(select p.* from public.patient_clinical_publications p where p.user_id=k.user_id order by p.published_at desc limit 1)p
    where p.draft=k.draft and(k.draft_evidence_token is null and k.draft_saved_at<=p.published_at or(
     p.actor_id=k.draft_saved_by and p.evidence_token=k.draft_evidence_token and md5(p.review::text)=k.draft_review_token)))
   -- Same source predicate as the inbox's plan_draft block, before its lane cap.
   -- Adopted, disabled, or superseded AI work no longer owns that inbox item.
   and not(ai_enabled and exists(
    select 1 from lateral(
     select g.* from public.ai_plan_generations g where g.user_id=k.user_id and g.state='ready'
     order by g.created_at desc limit 1
    )g where g.adopted_at is null
     and not exists(select 1 from public.patient_clinical_publications p
      where p.user_id=g.user_id and p.published_at>g.created_at)))
 ), shown as(
  select w.*,coalesce(pr.display_name,'')member_name from waiting w
  left join public.profiles pr on pr.id=w.user_id
  order by w.draft_saved_at,w.user_id limit item_cap
 )
 select (select count(*)from waiting),
  coalesce(jsonb_agg(jsonb_build_object('memberId',s.user_id,'memberName',s.member_name,'savedAt',s.draft_saved_at)
   order by s.draft_saved_at,s.user_id),'[]')into total,items from shown s;

 -- Audit only the members whose identifying fields are returned, as the inbox does.
 perform public._access_audit_record((x->>'memberId')::uuid,'doctor_saved_plans',null)
  from jsonb_array_elements(items)x;
 return jsonb_build_object('items',items,'total',total,'cap',item_cap);
end$$;

revoke all on function public.doctor_saved_plans()from public,anon,authenticated,service_role;
grant execute on function public.doctor_saved_plans()to authenticated;
comment on function public.doctor_saved_plans()is
 'Assigned active doctor saved plans awaiting approval; excludes consumed saves and current inbox AI plan drafts. Oldest first, capped with total; audits shown members.';
