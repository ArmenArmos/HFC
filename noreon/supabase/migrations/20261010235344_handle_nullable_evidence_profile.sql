-- A newly signed-in member has an explicit JSON null profile.
create or replace function public.workspace_evidence_projection(s jsonb) returns jsonb
language sql immutable set search_path='' as $$
 select jsonb_build_object(
 'assessment',s#>'{state,assessment}', 'measurements',s->'measurements',
 'profile',case when jsonb_typeof(s#>'{state,profile}')='object' then (s#>'{state,profile}')-'locale' else 'null'::jsonb end, 'consent',s#>'{state,consentAccepted}',
 'tests',coalesce((select jsonb_agg(t-'title' order by t->>'id') from jsonb_array_elements(coalesce(s#>'{workflow,tests}','[]')) t),'[]'),
 'received',coalesce((select jsonb_agg(t order by t) from (select distinct value t from jsonb_array_elements(coalesce(s#>'{workflow,receivedTestIds}','[]'))) r),'[]'),
 'allResultsAt',s#>'{workflow,allResultsAt}',
 'pending',coalesce(s#>'{workflow,recommendationsPending}','false'),
 'requirements',case when s#>>'{workflow,recommendationsPending}'='true' then '[]'::jsonb else coalesce((select jsonb_agg(jsonb_build_object('id',r->>'requirementId','testId',r#>>'{test,id}','method',r#>>'{test,method}') order by r->>'requirementId') from jsonb_array_elements(coalesce(s#>'{workflow,requirements}','[]')) r where r->>'retiredAtRevision' is null),'[]') end,
 'receipts',case when s#>>'{workflow,recommendationsPending}'='true' then '[]'::jsonb else coalesce((select jsonb_agg(jsonb_build_object('requirementId',r->>'requirementId','receivedAt',r->'receivedAt') order by r->>'requirementId') from jsonb_array_elements(coalesce(s#>'{workflow,receiptHistory}','[]')) r where exists(select 1 from jsonb_array_elements(coalesce(s#>'{workflow,requirements}','[]')) q where q->>'requirementId'=r->>'requirementId' and q->>'retiredAtRevision' is null)),'[]') end)
$$;
