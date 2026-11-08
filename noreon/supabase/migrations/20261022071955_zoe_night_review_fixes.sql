-- 22 Oct 2026 Codex Astra overnight reviews (output/codex-night-2026-10-22/). Each function is its previous definition
-- with only the change named in its comment.
--
-- N1-2. zoe_run_urgent_window also returns urgentThroughSeq: the newest member message a 103 text of the current run
-- answered. The worker closes the window on an exit message sent after it («I called 103» with a higher seq), instead of
-- comparing whole-minute ages, which tie inside one minute (doctor mode: 103 text, «I called 103», «Thank you» in one
-- minute sent the 103 text again). Additive: a running worker ignores the new key.
-- N2-1. zoe_coach_claim takes the conversation row lock (skip locked) right after the member's coach lock, so it never
-- waits on the conversation while holding the coach lock; a doctor's reply holds the conversation and then waits for that
-- coach lock (_zoe_coach_on_takeover), which could deadlock with the claim's zoe_runs insert (its foreign key).

-- N1-2. Same as 20261021072028 plus urgentThroughSeq.
create or replace function public.zoe_run_urgent_window(p_runs uuid[])returns jsonb
language plpgsql stable security definer set search_path=''as $$
begin
 if auth.role()is distinct from 'service_role'then raise insufficient_privilege;end if;
 if p_runs is null or cardinality(p_runs)>50 then return '[]'::jsonb;end if;
 return coalesce((select jsonb_agg(jsonb_build_object('runId',r.id,
   'urgentSinceMinutes',case when w.started_at is not null then floor(extract(epoch from clock_timestamp()-w.started_at)/60)::integer end,
   'urgentOpenedBy',w.opened_by,
   'urgentThroughSeq',case when w.started_at is not null then(select max(a.message_seq)from public.zoe_member_answers a
     where a.conversation_id=r.conversation_id and a.kind='urgent'and a.created_at>=w.started_at and a.created_at<=clock_timestamp())end))
  from public.zoe_runs r cross join lateral public._zoe_urgent_window(r.conversation_id)w where r.id=any(p_runs)and r.state='started'),'[]'::jsonb);
end$$;

-- N2-1. Same as 20261020103406 plus the conversation lock after the coach lock.
create or replace function public.zoe_coach_claim(p_limit integer)returns jsonb
language plpgsql security definer set search_path=''as $$
declare ev public.coach_events;chk record;cv public.conversations;r public.zoe_runs;s public.zoe_settings;jobs jsonb:='[]';redeliver jsonb:='[]';seq_ bigint;
begin
 if auth.role()is distinct from 'service_role'then raise insufficient_privilege;end if;
 select * into s from public.zoe_settings where singleton;
 -- A generating row whose run ended without zoe_coach_finish (worker lost) or was never finished in 15 minutes: retry.
 for ev in select e.* from public.coach_events e left join public.zoe_runs z on z.id=e.run_id
   where e.state='generating'and(z.id is null or z.state='finished'or e.claimed_at<clock_timestamp()-interval '15 minutes')
   order by e.claimed_at limit 20 for update of e skip locked loop
  if not pg_try_advisory_xact_lock(hashtextextended('zoe-coach:'||ev.member_id::text,0))then continue;end if;
  if ev.attempts>=3 then perform public._zoe_coach_move(ev.id,'cancelled','too_many_attempts',null);
  else perform public._zoe_coach_move(ev.id,'deferred','worker_lost',clock_timestamp()+interval '1 hour');end if;
 end loop;
 -- Fable C0-05: published rows that stalled. Past their week: cancelled (a queued teaser held). A teaser the outbox held or
 -- failed, or a ready row left unqueued for 30 minutes (worker lost between finish and queue): delivered again later.
 for ev in select e.* from public.coach_events e left join public.telegram_auth_messages t on t.id=e.telegram_message_id
   where(e.state in('scheduled','deferred','ready','queued')and clock_timestamp()>=public._zoe_coach_week_end(e.due_at))
    or(e.state='queued'and t.state in('held','definitely_failed'))or(e.state='ready'and e.updated_at<clock_timestamp()-interval '30 minutes')
   order by e.updated_at limit 20 for update of e skip locked loop
  if not pg_try_advisory_xact_lock(hashtextextended('zoe-coach:'||ev.member_id::text,0))then continue;end if;
  if clock_timestamp()>=public._zoe_coach_week_end(ev.due_at)then
   update public.telegram_auth_messages set state='held',reason='coach_cancelled',state_seq=state_seq+1,updated_at=clock_timestamp()
    where id=ev.telegram_message_id and state='queued';
   perform public._zoe_coach_move(ev.id,'cancelled','week_passed',null);
  else perform public._zoe_coach_move(ev.id,'deferred','redeliver',clock_timestamp()+case when ev.state='queued'then interval '1 hour'else interval '0 seconds'end);end if;
 end loop;
 for ev in select * from public.coach_events where state in('scheduled','deferred')and coalesce(retry_at,due_at)<=clock_timestamp()
   order by coalesce(retry_at,due_at)limit greatest(1,least(coalesce(p_limit,10),20))for update skip locked loop
  if not pg_try_advisory_xact_lock(hashtextextended('zoe-coach:'||ev.member_id::text,0))then continue;end if;
  -- N2-1: the conversation row now, without waiting (a doctor's reply holds it, then waits for the coach lock held here).
  cv:=null;
  select * into cv from public.conversations where member_id=ev.member_id for update skip locked;
  if cv.id is null and exists(select 1 from public.conversations where member_id=ev.member_id)then continue;end if;
  select * into chk from public._zoe_coach_check(ev,'claim');
  if chk.reason is not null then
   perform public._zoe_coach_move(ev.id,case when public._zoe_coach_retryable(chk.reason)then 'deferred'else 'cancelled'end,chk.reason,chk.retry_at);continue;end if;
  if ev.ready_at is not null then
   -- Published before; only its delivery was deferred. The text is not generated again.
   perform public._zoe_coach_move(ev.id,'ready','redeliver',null);
   redeliver:=redeliver||jsonb_build_array(jsonb_build_object('eventId',ev.id,'memberId',ev.member_id,'kind',ev.kind));continue;end if;
  if cv.id is null then
   insert into public.conversations(member_id)values(ev.member_id)on conflict(member_id)do nothing;
   select * into cv from public.conversations where member_id=ev.member_id for update;
  end if;
  seq_:=coalesce((select max(m.seq)from public.conversation_messages m where m.conversation_id=cv.id and m.source in('telegram_member','authenticated_member')),0);
  insert into public.zoe_runs(conversation_id,member_id,message_seq,context_version,draft_epoch,spend_day,state,kind)
  values(cv.id,ev.member_id,null,cv.version,cv.draft_epoch,(clock_timestamp()at time zone coalesce(s.time_zone,'Asia/Yerevan'))::date,'started','coach_'||ev.kind)
  returning * into r;
  update public.coach_events set state='generating',reason=null,retry_at=null,conversation_id=cv.id,run_id=r.id,claimed_member_seq=seq_,
   claimed_at=clock_timestamp(),attempts=attempts+1 where id=ev.id returning * into ev;
  perform public._zoe_run_events(r,jsonb_build_array(jsonb_build_object('name','zoe.coach.claim','outcome','allow','reason','coach_claimed','rule','zoe.coach',
   'ruleVersion','c0-1','actor','system','attributes',jsonb_build_object('noreon.zoe.coach.kind',ev.kind,'noreon.zoe.coach.week',ev.iso_week,'noreon.zoe.coach.attempt',ev.attempts))));
  jobs:=jobs||jsonb_build_array(jsonb_build_object('runId',r.id,'eventId',ev.id,'memberId',ev.member_id,'kind',ev.kind,'isoWeek',ev.iso_week,
   'displayName',(select pr.display_name from public.profiles pr where pr.id=ev.member_id),
   'locale',(select case when pr.locale='en'then 'en'else 'hy'end from public.profiles pr where pr.id=ev.member_id)));
 end loop;
 return jsonb_build_object('jobs',jobs,'redeliver',redeliver);
end$$;
