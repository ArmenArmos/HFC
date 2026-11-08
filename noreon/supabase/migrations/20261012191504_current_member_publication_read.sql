-- Current native care reads must not load the complete publication/evidence history.
-- Keep owner authorization and return only immutable released clinical text/selected rows.
create function public.patient_current_published_clinical_review() returns jsonb
language sql stable security definer set search_path='' as $$
 with current_publication as (
  select p.* from public.patient_care_plans plan
  join public.patient_clinical_publications p on p.plan_id=plan.id and p.user_id=plan.user_id
  where plan.user_id=auth.uid() and plan.active and plan.published_at<=now() and p.published_at<=now()
   and exists(select 1 from auth.users u where u.id=auth.uid() and u.phone is not null and u.phone<>'' and u.phone_confirmed_at is not null)
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
revoke all on function public.patient_current_published_clinical_review() from public,anon,service_role;
grant execute on function public.patient_current_published_clinical_review() to authenticated;
