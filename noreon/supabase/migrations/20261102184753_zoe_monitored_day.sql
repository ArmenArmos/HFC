-- The monitored state after a 103 alert lasts 24 hours, so a member's or a doctor's clear works for that whole day
-- (lib/zoe/urgent-window.ts MONITORED_MIN). The acute 120-minute window lives in the worker and is unchanged.
do $migration$
declare definition text; old text; replacement text;
begin
 definition:=pg_get_functiondef('public.zoe_run_finish(uuid,jsonb)'::regprocedure);
 old:=$old$or (ctx->>'sinceMinutes')::integer>120$old$;
 replacement:=$new$or (ctx->>'sinceMinutes')::integer>1440$new$;
 if cardinality(string_to_array(definition,old))<>2 then raise exception 'Unexpected zoe_run_finish clear definition';end if;
 execute replace(definition,old,replacement);
end $migration$;

create or replace function public.doctor_zoe_urgent_window(p_member uuid)returns jsonb
language plpgsql security definer set search_path=''as $$
declare me uuid:=public._zoe_mode_doctor(p_member);c public.conversations;w record;
begin
 select * into c from public.conversations where member_id=p_member;
 if c.id is not null then select * into w from public._zoe_talking_urgent_window(c.id);end if;
 perform public._access_audit_record(p_member,'doctor_zoe_urgent_window','read');
 return jsonb_build_object('ok',true,'open',coalesce(w.started_at>=clock_timestamp()-interval '24 hours',false),
  'since',w.started_at,'openedBy',w.opened_by);
end$$;

-- Under the conversation row lock (zoe_run_finish takes it too), so a clear and an urgent text never interleave.
-- Idempotent: nothing open, nothing written.
create or replace function public.doctor_zoe_clear_urgent(p_member uuid)returns jsonb
language plpgsql security definer set search_path=''as $$
declare me uuid:=public._zoe_mode_doctor(p_member);c public.conversations;w record;kid uuid;
begin
 select * into c from public.conversations where member_id=p_member for update;
 if not found then return jsonb_build_object('ok',true,'replayed',true);end if;
 select * into w from public._zoe_talking_urgent_window(c.id);
 if w.started_at is null or w.started_at<clock_timestamp()-interval '24 hours'then return jsonb_build_object('ok',true,'replayed',true);end if;
 insert into public.zoe_urgent_clears(conversation_id,member_id,cleared_by,opened_by,window_started_at)
 values(c.id,p_member,me,w.opened_by,w.started_at)returning id into kid;
 insert into public.conversation_audit(conversation_id,actor_id,kind,detail)
 values(c.id,me,'zoe.urgent_cleared',jsonb_build_object('clearId',kid,'openedBy',w.opened_by,'windowStartedAt',w.started_at,'version',c.version));
 perform public._access_audit_record(p_member,'doctor_zoe_urgent_window','clear');
 return jsonb_build_object('ok',true,'replayed',false,'openedBy',w.opened_by);
end$$;
