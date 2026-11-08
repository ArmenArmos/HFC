-- Local-only transaction: fixtures and role settings are rolled back.
begin;
insert into auth.users(id) values
 ('00000000-0000-4000-8000-000000000091'),
 ('00000000-0000-4000-8000-000000000092');
insert into public.patient_care_plans(id,user_id,clinician,published_at,instructions,active) values
 ('00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-000000000091','Fixture clinician',now()-interval '1 day','Published',true),
 ('00000000-0000-4000-8000-000000000102','00000000-0000-4000-8000-000000000091','Fixture clinician',now()+interval '1 day','Future',false),
 ('00000000-0000-4000-8000-000000000103','00000000-0000-4000-8000-000000000091','Fixture clinician',now()-interval '2 days','Historical',false),
 ('00000000-0000-4000-8000-000000000104','00000000-0000-4000-8000-000000000092','Other clinician',now()-interval '1 day','Other owner',true);
insert into public.patient_care_results(user_id,marker,value,unit,collected_at,received_at,source,source_label,reviewed_at,reviewed_by,publication_plan_id)
select '00000000-0000-4000-8000-000000000091',marker,1,'fixture',now(),now(),'laboratory','Fixture',reviewed,'Fixture clinician',plan::uuid
from (values
 ('reviewed-unpublished', now(), null),
 ('published', now(), '00000000-0000-4000-8000-000000000101'),
 ('future-publication', now(), '00000000-0000-4000-8000-000000000102'),
 ('historical-publication', now(), '00000000-0000-4000-8000-000000000103')
) fixtures(marker,reviewed,plan);
insert into public.patient_care_results(user_id,marker,value,unit,collected_at,received_at,source,source_label,publication_plan_id) values
 ('00000000-0000-4000-8000-000000000091','unreviewed',1,'fixture',now(),now(),'laboratory','Fixture',null),
 ('00000000-0000-4000-8000-000000000091','unreviewed-linked',1,'fixture',now(),now(),'laboratory','Fixture','00000000-0000-4000-8000-000000000101');
-- A trusted writer cannot link a result to somebody else's publication.
do $$ begin
  begin
    update public.patient_care_results set publication_plan_id='00000000-0000-4000-8000-000000000104' where marker='reviewed-unpublished' and user_id='00000000-0000-4000-8000-000000000091';
    raise exception 'Cross-owner publication was accepted';
  exception when foreign_key_violation then null;
  end;
end $$;
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000091',true);
do $$ begin
  if (select array_agg(marker order by marker) from public.patient_care_results) is distinct from array['historical-publication','published'] then
    raise exception 'Owner publication visibility boundary failed';
  end if;
  begin
    update public.patient_care_results set reviewed_by='self-approved';
    raise exception 'Member write permission was granted';
  exception when insufficient_privilege then null;
  end;
end $$;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000092',true);
do $$ begin
  if exists(select 1 from public.patient_care_results) then raise exception 'Another member can read owner results'; end if;
end $$;
reset role;
rollback;
select 'Result publication RLS checks passed' as result;
