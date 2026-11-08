-- Astra on #522. The 24 hours after the self-harm "today" reply must not depend on job.answers, which holds only the newest ten. This is
-- the time of the last such reply for the conversation, read from the database through the run context the worker already loads.
create function public._zoe_self_harm_today_minutes(p_conversation uuid)returns integer
language sql stable security definer set search_path=''as $$
 select floor(extract(epoch from clock_timestamp()-max(a.created_at))/60)::integer
 from public.zoe_member_answers a join public.zoe_runs z on z.id=a.run_id
 where a.conversation_id=p_conversation and z.reason_code='same_day_floor_self_harm'and a.created_at<=clock_timestamp()
$$;
revoke all on function public._zoe_self_harm_today_minutes(uuid)from public,anon,authenticated,service_role;

do $migration$
declare fn text;definition text;old text:=$old$jsonb_agg(jsonb_build_object('runId',r.id,$old$;
begin
 foreach fn in array array['public.zoe_run_urgent_window(uuid[])','public.zoe_run_alarm_window(uuid[])']loop
  definition:=pg_get_functiondef(fn::regprocedure);
  if cardinality(string_to_array(definition,old))<>2 then raise exception 'Unexpected % definition',fn;end if;
  execute replace(definition,old,old||$new$
   'selfHarmTodayMinutes',public._zoe_self_harm_today_minutes(r.conversation_id),$new$);
 end loop;
end $migration$;
