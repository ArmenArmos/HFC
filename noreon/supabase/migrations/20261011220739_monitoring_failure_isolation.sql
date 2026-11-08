-- Preserve legacy two-argument calls while allowing a run to skip attempted cases.
-- Exclude before LIMIT so persistent failures cannot starve later due work.
drop function public.workspace_due_monitoring_cases(uuid,integer);
create function public.workspace_due_monitoring_cases(p_actor uuid default null,p_limit integer default 100,p_excluded uuid[] default '{}') returns setof uuid
language plpgsql stable security definer set search_path='' as $$
declare role_name text;
begin
 if p_limit is null or p_limit not between 1 and 100 then raise exception 'invalid batch limit';end if;
 if p_excluded is null or cardinality(p_excluded)>1000 or array_position(p_excluded,null) is not null then raise exception 'invalid exclusion';end if;
 if p_actor is not null then
  select role into role_name from public.workspace_staff where user_id=p_actor and active;
  if role_name is null then raise exception 'forbidden';end if;
 end if;
 return query select q.case_id from public.workspace_monitoring_requirements q join public.workspace_cases c on c.id=q.case_id
 where not(q.case_id=any(p_excluded)) and q.status='active' and q.ends_at<=now() and c.expires_at>now()
 and (p_actor is null or role_name='admin' or c.assigned_doctor_id=p_actor)
 and not exists(select 1 from public.workspace_followup_review_links l where l.requirement_id=q.id and l.event='window-ended')
 group by q.case_id order by min(q.ends_at),q.case_id limit p_limit;
end $$;
revoke all on function public.workspace_due_monitoring_cases(uuid,integer,uuid[]) from public,anon,authenticated;
grant execute on function public.workspace_due_monitoring_cases(uuid,integer,uuid[]) to service_role;
