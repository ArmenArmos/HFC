-- Armen's audit, 4 Nov, S0-3: an urgent alert never ends by itself. Only a named staff member closes it, with an
-- outcome and a written reason, and that is recorded.
--
-- Audit of every way a care alert can leave the open state (supabase/migrations, scripts, lib):
--   * the only writers of state='resolved' are care_alert_resolve (this file tightens it);
--   * no sweep, cron, expiry or timeout touches care_alerts: the "2 hours" in the conversation page is Zoe's 103
--     repeat window (doctor_zoe_urgent_window), not the alert; doctor_zoe_clear_urgent leaves the alert open;
--   * the 'duplicate' outcome let a person close an alert as a repeat. A repeat is linked, never closed (S0-2):
--     it stays selectable in history only, so new rows can no longer take it.
-- The pinned check scripts/check-care-alerts.sql fails if any other function ever writes state='resolved'.

do $migration$
declare definition text;old text;replacement text;
begin
 -- Patch the current definition (handback guard, then stuck states) rather than copy it, so neither is lost.
 definition:=pg_get_functiondef('public.care_alert_resolve(uuid,bigint,text,text)'::regprocedure);
 old:=$old$if p_resolution is null or p_resolution not in('member_contacted','emergency_care_advised','no_action_needed','duplicate','other')
  or length(note)>1000 or(p_resolution='other'and note is null)then return jsonb_build_object('ok',false,'code','invalid');end if;$old$;
 replacement:=$new$-- Closing is a named person's act: the actor check at the top (an active admin or doctor session), one of the
 -- staff outcomes, and a written reason. A repeat is linked to the open alert, never closed as a duplicate.
 if p_resolution is null or p_resolution not in('member_contacted','emergency_care_advised','no_action_needed','other')
  or note is null or length(note)>1000 then return jsonb_build_object('ok',false,'code','invalid');end if;$new$;
 if cardinality(string_to_array(definition,old))<>2 then raise exception 'Unexpected care_alert_resolve validation definition';end if;
 definition:=replace(definition,old,replacement);

 -- A written reason is more than spaces: btrim alone leaves tabs, line breaks and vertical tabs (E'' has no \v), so a blank note could pass.
 old:=$old$note text:=nullif(btrim(p_note),'')$old$;
 replacement:=$new$note text:=nullif(btrim(p_note,E' \t\r\n\f'||chr(11)),'')$new$;
 if cardinality(string_to_array(definition,old))<>2 then raise exception 'Unexpected care_alert_resolve note definition';end if;
 definition:=replace(definition,old,replacement);
 execute definition;
end $migration$;

-- No path, however it is written, may newly close an alert as a duplicate. Older rows keep their history and stay editable.
create function public._care_alert_no_new_duplicate()returns trigger language plpgsql set search_path=''as $$
begin
 if new.resolution='duplicate'and(tg_op='INSERT'or old.resolution is distinct from 'duplicate')then
  raise exception 'A care alert is linked to the open one, never closed as a duplicate' using errcode='23514';
 end if;
 return new;
end$$;
create trigger care_alerts_no_new_duplicate before insert or update of resolution on public.care_alerts
 for each row execute function public._care_alert_no_new_duplicate();
