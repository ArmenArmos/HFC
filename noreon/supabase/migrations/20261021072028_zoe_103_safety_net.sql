-- Zoe 103 safety net (Armen and Khikar, 20 Oct 19:00; lib/zoe/urgent-check.ts). Two real false 103s on Armen's staging
-- account: a model-only emergency, then a 103 window that repeated the 103 text to his correction and a new topic for two
-- hours. This migration gives the worker who opened the window, and the assigned doctor a way to clear it.
--
-- 1. _zoe_urgent_window(conversation): the current run of Zoe's urgent texts (as zoe_run_urgent_window, 20261019184651):
--    minutes since it began, and who opened it: 'model' when every urgent text in the run came from a model's own
--    emergency (zoe_runs.reason_code urgent_health_answer_model) or repeated it in the window (urgent_in_window_no_model_call),
--    'rule' when any came from a fixed rule (urgent words, a red flag, a yes to a danger-sign question, an intake escalation).
--    A doctor's clear (zoe_urgent_clears) ends the run like an ordinary answer does; a window repeat from a run that was
--    already in flight then does not reopen it. The worker also stops re-reading urgent words from messages Zoe has already
--    answered (lib/zoe/pipeline.ts), so a cleared or expired window is not reopened by the history either.
-- 2. zoe_run_urgent_window returns urgentOpenedBy as well (additive: the running worker ignores it and keeps today's exits).
-- 3. doctor_zoe_urgent_window(member) and doctor_zoe_clear_urgent(member): the assigned doctor with care access only (the
--    _zoe_mode_doctor rule from 20261020082321); members, nurses, admins and other doctors are refused. Every clear is in
--    conversation_audit (zoe.urgent_cleared) and access_audit. Clearing does not resolve the care alert (that stays for review
--    on the care alerts page) and sends the member nothing; it only stops the repeated 103 text.
-- No clinical rule changes: what is urgent is decided where it was (lib/zoe).

create table public.zoe_urgent_clears(
 id uuid primary key default gen_random_uuid(),
 conversation_id uuid not null references public.conversations(id)on delete cascade,
 member_id uuid not null references auth.users(id)on delete cascade,
 cleared_by uuid not null references auth.users(id),
 opened_by text not null check(opened_by in('model','rule')),
 window_started_at timestamptz not null,
 cleared_at timestamptz not null default clock_timestamp()
);
create index zoe_urgent_clears_thread on public.zoe_urgent_clears(conversation_id,cleared_at desc);
alter table public.zoe_urgent_clears enable row level security;
revoke all on public.zoe_urgent_clears from public,anon,authenticated,service_role;
comment on table public.zoe_urgent_clears is
 'A doctor ended a member''s 103 window (Zoe stops repeating the 103 text). Written only by doctor_zoe_clear_urgent; audited.';

-- 1. The current run of urgent texts in one conversation: when it began and who opened it. Null start: none.
create function public._zoe_urgent_window(p_conversation uuid)returns table(started_at timestamptz,opened_by text)
language sql stable security definer set search_path=''as $$
 with boundary as(select greatest(
   coalesce((select max(b.created_at)from public.zoe_member_answers b where b.conversation_id=p_conversation and b.kind<>'urgent'and b.created_at<=clock_timestamp()),'-infinity'::timestamptz),
   coalesce((select max(k.cleared_at)from public.zoe_urgent_clears k where k.conversation_id=p_conversation and k.cleared_at<=clock_timestamp()),'-infinity'::timestamptz))at),
 -- A window repeat from a run that started before the boundary (in flight when the doctor cleared it) does not reopen it.
 run as(select a.created_at,z.reason_code from public.zoe_member_answers a join public.zoe_runs z on z.id=a.run_id,boundary
   where a.conversation_id=p_conversation and a.kind='urgent'and a.created_at<=clock_timestamp()and a.created_at>boundary.at
    and not(z.reason_code='urgent_in_window_no_model_call'and z.started_at<=boundary.at))
 select min(run.created_at),case when count(*)=0 then null
  when bool_and(run.reason_code in('urgent_health_answer_model','urgent_in_window_no_model_call'))
   and bool_or(run.reason_code='urgent_health_answer_model')then 'model'else 'rule'end from run
$$;
revoke all on function public._zoe_urgent_window(uuid)from public,anon,authenticated,service_role;

-- 2. The worker's read, with the opener. Same rows and minutes as before; a clear ends the run.
create or replace function public.zoe_run_urgent_window(p_runs uuid[])returns jsonb
language plpgsql stable security definer set search_path=''as $$
begin
 if auth.role()is distinct from 'service_role'then raise insufficient_privilege;end if;
 if p_runs is null or cardinality(p_runs)>50 then return '[]'::jsonb;end if;
 return coalesce((select jsonb_agg(jsonb_build_object('runId',r.id,
   'urgentSinceMinutes',case when w.started_at is not null then floor(extract(epoch from clock_timestamp()-w.started_at)/60)::integer end,
   'urgentOpenedBy',w.opened_by))
  from public.zoe_runs r cross join lateral public._zoe_urgent_window(r.conversation_id)w where r.id=any(p_runs)and r.state='started'),'[]'::jsonb);
end$$;

-- 3. The doctor's surfaces. The window is open while its run began at most 120 minutes ago (lib/zoe/urgent-window.ts).
create function public.doctor_zoe_urgent_window(p_member uuid)returns jsonb
language plpgsql security definer set search_path=''as $$
declare me uuid:=public._zoe_mode_doctor(p_member);c public.conversations;w record;
begin
 select * into c from public.conversations where member_id=p_member;
 if c.id is not null then select * into w from public._zoe_urgent_window(c.id);end if;
 perform public._access_audit_record(p_member,'doctor_zoe_urgent_window','read');
 return jsonb_build_object('ok',true,'open',coalesce(w.started_at>=clock_timestamp()-interval '120 minutes',false),
  'since',w.started_at,'openedBy',w.opened_by);
end$$;

-- The clear. Under the conversation row lock (zoe_run_finish takes it too), so a clear and an urgent text never interleave.
-- Idempotent: nothing open, nothing written.
create function public.doctor_zoe_clear_urgent(p_member uuid)returns jsonb
language plpgsql security definer set search_path=''as $$
declare me uuid:=public._zoe_mode_doctor(p_member);c public.conversations;w record;kid uuid;
begin
 select * into c from public.conversations where member_id=p_member for update;
 if not found then return jsonb_build_object('ok',true,'replayed',true);end if;
 select * into w from public._zoe_urgent_window(c.id);
 if w.started_at is null or w.started_at<clock_timestamp()-interval '120 minutes'then return jsonb_build_object('ok',true,'replayed',true);end if;
 insert into public.zoe_urgent_clears(conversation_id,member_id,cleared_by,opened_by,window_started_at)
 values(c.id,p_member,me,w.opened_by,w.started_at)returning id into kid;
 insert into public.conversation_audit(conversation_id,actor_id,kind,detail)
 values(c.id,me,'zoe.urgent_cleared',jsonb_build_object('clearId',kid,'openedBy',w.opened_by,'windowStartedAt',w.started_at,'version',c.version));
 perform public._access_audit_record(p_member,'doctor_zoe_urgent_window','clear');
 return jsonb_build_object('ok',true,'replayed',false,'openedBy',w.opened_by);
end$$;
revoke all on function public.doctor_zoe_urgent_window(uuid),public.doctor_zoe_clear_urgent(uuid)from public,anon,authenticated,service_role;
grant execute on function public.doctor_zoe_urgent_window(uuid),public.doctor_zoe_clear_urgent(uuid)to authenticated;
comment on function public.doctor_zoe_clear_urgent(uuid)is
 'The assigned doctor ends a member''s 103 window: Zoe stops repeating the 103 text. Audited; sends the member nothing; the care alert stays for review.';
