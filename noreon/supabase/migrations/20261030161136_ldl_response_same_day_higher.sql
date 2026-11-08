-- A higher LDL value reviewed later on the same day reaches the response check (test gap 5, 30 Oct 2026).
-- Eligibility needed a date strictly newer than the newest recorded response, so once a lower value from a day had a
-- response, a higher one from that day never reached the doctor. lib/ldl/status.ts already takes the higher of two
-- values on a day (the conservative default until the clinicians say otherwise), so this adds no clinical rule: the day
-- itself stays eligible, and lib/ldl/response.ts decides. A value that is not higher is recorded as skipped, as an
-- unusable one is, so it does not hold the member in the list.

create or replace function public.ldl_response_candidates(p_limit integer default 50)returns jsonb
language plpgsql stable security definer set search_path=''as $$
declare out jsonb;
begin
 if auth.role()is distinct from 'service_role'then raise insufficient_privilege;end if;
 if not public._ldl_response_enabled()then return jsonb_build_object('version','ldl-response-v1','enabled',false);end if;
 if p_limit is null or p_limit not between 1 and 200 then raise invalid_parameter_value;end if;
 select coalesce(jsonb_agg(x order by x->>'memberId'),'[]')into out from(
  select jsonb_build_object('memberId',k.user_id,'floorOn',f.floor_on,'observations',o.obs,
   'goal',(select public._ldl_goal_json(g,false)from public.ldl_goals g where g.member_id=k.user_id order by g.version desc limit 1),
   'checked',coalesce((select jsonb_agg(x.observation_key)from public.ldl_responses x where x.member_id=k.user_id),'[]'::jsonb),
   'retestId',(select r.id from public.ldl_retests r where r.member_id=k.user_id and r.state in('scheduled','requested','fenced')),
   'alt',public._ldl_alt_observations(k.user_id),
   'medicines',public._ldl_medicine_facts(k.user_id,28))x
  from public.patient_clinical_cases k
  cross join lateral(select public._ldl_response_floor(k.user_id)floor_on)f
  cross join lateral(select public._ldl_response_observations(k.user_id)obs)o
  where k.assigned_doctor_id is not null and f.floor_on is not null
   -- Only a value newer than the floor and not older than the newest recorded response: an older one never becomes due
   -- again. A value on that same day comes back to the app, which responds to a higher one and skips the rest.
   and exists(select 1 from jsonb_array_elements(o.obs)e where(e->>'on')::date>f.floor_on
    and(e->>'on')::date>=coalesce((select max(x.observed_on)from public.ldl_responses x where x.member_id=k.user_id),(e->>'on')::date)
    and not exists(select 1 from public.ldl_responses x where x.member_id=k.user_id and x.observation_key=e->>'id')
    and not exists(select 1 from public.ldl_response_skips x where x.member_id=k.user_id and x.observation_key=e->>'id'))
  order by k.user_id limit p_limit)q;
 return jsonb_build_object('version','ldl-response-v1','enabled',true,'today',public._ldl_today(),'members',out);
end$$;
