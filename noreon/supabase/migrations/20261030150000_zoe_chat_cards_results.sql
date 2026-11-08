-- Zoe chat cards: results on Telegram, and more results in chat instead of "more on the results page". The rows are the page's
-- own: the current publication's checked rows, else the doctor-reviewed published results, read by the same rules. The body of
-- the publication read moves into an internal function; the session entry point is unchanged. Dark with zoe_chat_actions_enabled.

create function public._patient_current_published_clinical_review(uid uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 with current_publication as (
  select p.* from public.patient_care_plans plan
  join public.patient_clinical_publications p on p.plan_id=plan.id and p.user_id=plan.user_id
  where plan.user_id=uid and plan.active and plan.published_at<=now() and p.published_at<=now()
   and exists(select 1 from auth.users u where u.id=uid and u.phone is not null and u.phone<>'' and u.phone_confirmed_at is not null)
  limit 1
 ), selected_rows as (
  select receipt->>'reportId' report_id, row_number::integer row_index, report->'reviewed' reviewed,
   (report#>'{reviewed,rows}')->(row_number::integer) source, receipt->>'note' note
  from current_publication c
  cross join lateral jsonb_each(coalesce(c.review->'receipts','{}'::jsonb)) r(receipt_key,receipt)
  cross join lateral jsonb_array_elements_text(receipt->'rows') n(row_number)
  cross join lateral jsonb_array_elements(coalesce(c.evidence->'reports','[]'::jsonb)) reports(report)
  where report->>'id'=receipt->>'reportId'
 ), released_rows as (
  select report_id,row_index,source,reviewed->'laboratory' laboratory,reviewed->'reportDate' report_date,
   jsonb_agg(distinct note order by note) notes
  from selected_rows where source is not null
  group by report_id,row_index,source,reviewed->'laboratory',reviewed->'reportDate'
 )
 select jsonb_build_object('planId',c.plan_id,'publishedAt',c.published_at,'draft',c.draft,
  'sourceRows',coalesce((select jsonb_agg(jsonb_build_object('reportId',report_id,'rowIndex',row_index,'source',source,'laboratory',laboratory,'reportDate',report_date,'notes',notes) order by report_id,row_index) from released_rows),'[]'::jsonb))
 from current_publication c
$$;
create or replace function public.patient_current_published_clinical_review() returns jsonb
language sql stable security definer set search_path='' as $$
 select public._patient_current_published_clinical_review(auth.uid())
$$;

-- Service role only, for a member a channel adapter verified. The results row filter is own_published_care_results.
create function public.member_results_read_for(p_member uuid)returns jsonb
language plpgsql stable security definer set search_path=''as $$
begin
 if auth.role()is distinct from 'service_role'then raise insufficient_privilege;end if;
 if p_member is null or not public._telegram_member_eligible(p_member)then return null;end if;
 return jsonb_build_object('publication',public._patient_current_published_clinical_review(p_member),
  'results',coalesce((select jsonb_agg(jsonb_build_object('marker',r.marker,'value',r.value,'unit',r.unit,'referenceText',r.reference_text,'collectedAt',r.collected_at)order by r.collected_at desc,r.id desc)
   from public.patient_care_results r where r.user_id=p_member and r.reviewed_at is not null and r.reviewed_by is not null
    and exists(select 1 from public.patient_care_plans p where p.id=r.publication_plan_id and p.user_id=r.user_id and p.published_at<=clock_timestamp())),'[]'::jsonb));
end$$;

revoke all on function public._patient_current_published_clinical_review(uuid)from public,anon,authenticated,service_role;
revoke all on function public.member_results_read_for(uuid)from public,anon,authenticated;
grant execute on function public.member_results_read_for(uuid)to service_role;
