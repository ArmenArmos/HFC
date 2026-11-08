-- Future-dated blood pressure readings (live finding 18 Oct 15:47).
-- A reading saved with measured_at four days ahead counted as the member's "latest" reading for the
-- Zoe symptom intake, so every symptom message met RF-03 (stored reading 180/110 or more in the last
-- 24 h plus a symptom) and went to the urgent path. Thresholds are unchanged (Armen owns them); only
-- the time handling changes.
--
-- 1. Entry: no path may store a reading more than 5 minutes ahead of the server clock. The member,
--    BP week and staff command RPCs already refused it; the nurse visit evidence path did not. One
--    trigger now guards every insert and every change of measured_at. Existing future rows are kept
--    (docs/operations/future-dated-readings.md lists them) and only an update that sets a future time fails.
-- 2. Readers: zoe_run_claim picks the latest reading measured at or before now, and no longer clamps
--    minutesAgo at 0, so the TS RF-03 window is exactly measured_at between now-24h and now.

-- 1. Entry --------------------------------------------------------------------------------------------------
create function public._patient_measurement_not_future()returns trigger
language plpgsql set search_path=''as $$
begin
 if new.measured_at>clock_timestamp()+interval '5 minutes'then
  raise exception 'Measurement time is in the future' using errcode='23514';
 end if;
 return new;
end$$;
revoke all on function public._patient_measurement_not_future()from public,anon,authenticated;

create trigger patient_measurements_not_future before insert or update of measured_at on public.patient_measurements
 for each row execute function public._patient_measurement_not_future();

-- 2. Claim: everything else unchanged from 20261018075343 section 5 ----------------------------------------
create or replace function public.zoe_run_claim(p_limit integer)returns jsonb
language plpgsql security definer set search_path=''as $$
declare s public.zoe_settings;rec record;r public.zoe_runs;jobs jsonb:='[]';consent boolean;skip text;since timestamptz;ix public.zoe_symptom_intakes;
begin
 if auth.role()is distinct from 'service_role'then raise insufficient_privilege;end if;
 for r in update public.zoe_runs set state='finished',outcome='no_output',reason_code='worker_lost',finished_at=clock_timestamp()
  where state='started'and started_at<clock_timestamp()-interval '10 minutes'returning * loop
  perform public._zoe_run_events(r,jsonb_build_array(jsonb_build_object('name','zoe.route','outcome','failed','reason','worker_lost','rule','zoe.pipeline','ruleVersion','1','actor','system','attributes',jsonb_build_object('noreon.zoe.run.outcome','no_output'))));
 end loop;
 -- An intake idle for 12 hours ends; the doctor still gets what the member answered.
 for ix in update public.zoe_symptom_intakes set state='expired',ending='expired',finished_at=clock_timestamp(),updated_at=clock_timestamp(),
   summary=jsonb_set(summary,'{ending}','"expired"')
  where state='active'and updated_at<clock_timestamp()-interval '12 hours'and summary is not null returning * loop
  perform public._conversation_trace(ix.member_id,ix.conversation_id,'zoe_intake',ix.id::text,'zoe','zoe.intake.expired','recorded','member_idle_12h','zoe.symptom_intake','1','system',null,
   jsonb_build_object('noreon.zoe.intake.sheet',ix.sheet_id));
  perform public._zoe_intake_notice(ix.id);
 end loop;
 select * into s from public.zoe_settings where singleton;
 for rec in
  select c.id conversation_id,c.member_id,c.version,c.draft_epoch,lm.seq,cs.assigned_doctor_id,pr.display_name
  from public.conversations c
  join lateral(select m.seq,m.source,m.created_at from public.conversation_messages m where m.conversation_id=c.id order by m.seq desc limit 1)lm on true
  join public.patient_clinical_cases cs on cs.user_id=c.member_id
  left join public.profiles pr on pr.id=c.member_id
  where lm.source in('telegram_member','authenticated_member')and lm.created_at>clock_timestamp()-interval '24 hours'
   and not exists(select 1 from public.zoe_runs zr where zr.conversation_id=c.id and zr.message_seq>=lm.seq)
  order by lm.created_at limit greatest(1,least(coalesce(p_limit,10),20))
  for update of c skip locked
 loop
  -- Consent as 20261018073940 (#265): only a grant of the current wording (or one kept valid) counts.
  consent:=s.singleton is not null and s.consent_collection_enabled and s.consent_wording_version is not null
   and public._zoe_consent_current(rec.member_id,'zoe_reads_messages');
  skip:=case when s.singleton is null or not s.consent_collection_enabled or s.consent_wording_version is null then 'zoe_settings_off'
   when not consent then 'no_zoe_reads_messages_consent' when rec.assigned_doctor_id is null then 'no_assigned_doctor'
   when exists(select 1 from public.conversation_approvals ap join public.conversation_drafts d on d.id=ap.draft_id
    where d.conversation_id=rec.conversation_id and ap.context_version>=rec.version)then 'already_answered'end;
  insert into public.zoe_runs(conversation_id,member_id,message_seq,context_version,draft_epoch,spend_day,state,outcome,reason_code,finished_at)
  values(rec.conversation_id,rec.member_id,rec.seq,rec.version,rec.draft_epoch,(clock_timestamp()at time zone coalesce(s.time_zone,'Asia/Yerevan'))::date,
   case when skip is null then 'started'else 'finished'end,case when skip is null then null else 'skipped'end,skip,case when skip is null then null else clock_timestamp()end)
  on conflict(conversation_id,message_seq)do nothing returning * into r;
  if r.id is null then continue;end if;
  perform public._zoe_run_events(r,jsonb_build_array(jsonb_build_object('name','zoe.guard.consent','outcome',case when skip is null then 'allow'else 'block'end,
   'reason',coalesce(skip,'zoe_reads_messages_granted'),'rule','zoe.consent','ruleVersion',coalesce(s.consent_wording_version,'none'),'actor','system',
   'attributes',jsonb_build_object('noreon.zoe.guard.name','consent','noreon.zoe.consent.kind','zoe_reads_messages'))));
  if skip is not null then r:=null;continue;end if;
  since:=(select max(ap.created_at)from public.conversation_approvals ap join public.conversation_drafts d on d.id=ap.draft_id where d.conversation_id=rec.conversation_id);
  select * into ix from public.zoe_symptom_intakes where conversation_id=rec.conversation_id and state='active';
  jobs:=jobs||jsonb_build_array(jsonb_build_object('runId',r.id,'memberId',rec.member_id,'messageSeq',rec.seq,'displayName',rec.display_name,
   'messages',(select jsonb_agg(jsonb_build_object('seq',w.seq,'text',w.body,'minutesAgo',w.ago)order by w.seq)from(
     select m.seq,m.body,floor(extract(epoch from clock_timestamp()-m.created_at)/60)::integer ago from public.conversation_messages m
     -- An active intake keeps its own messages in the window, whatever was approved since.
     where m.conversation_id=rec.conversation_id and m.seq<=rec.seq and(since is null or m.created_at>since or m.seq=rec.seq or m.seq>=ix.started_seq)order by m.seq desc limit 20)w),
   'replies',coalesce((select jsonb_agg(jsonb_build_object('body',x.body,'minutesAgo',x.ago)order by x.created_at)from(
     select ap.body,ap.created_at,floor(extract(epoch from clock_timestamp()-ap.created_at)/60)::integer ago from public.conversation_approvals ap
     join public.conversation_drafts d on d.id=ap.draft_id where d.conversation_id=rec.conversation_id order by ap.created_at desc limit 3)x),'[]'),
   'answers',coalesce((select jsonb_agg(jsonb_build_object('body',x.body,'minutesAgo',x.ago)order by x.created_at)from(
     select a.body,a.created_at,floor(extract(epoch from clock_timestamp()-a.created_at)/60)::integer ago from public.zoe_member_answers a
     where a.conversation_id=rec.conversation_id and(since is null or a.created_at>since or a.message_seq>=ix.started_seq)order by a.created_at desc limit 10)x),'[]'),
   'directAnswers',coalesce(s.direct_answers_enabled,false))
   ||case when coalesce(s.symptom_intake_enabled,false)then jsonb_build_object('intake',jsonb_build_object('enabled',true,
     'registered',coalesce((select jsonb_agg(jsonb_build_object('id',sh.sheet_id,'version',sh.version)order by sh.sheet_id)from public.zoe_symptom_sheets sh),'[]'),
     'active',case when ix.id is null then null else jsonb_build_object('id',ix.id,'sheetId',ix.sheet_id,'sheetVersion',ix.sheet_version,'startedSeq',ix.started_seq,'language',ix.language,'record',ix.record)end,
     'doctorName',(select ws.display_name from public.workspace_staff ws where ws.user_id=rec.assigned_doctor_id and ws.active and ws.removed_at is null),
     -- Only readings measured at or before now: a future-dated row must not pose as the latest one.
     'latestReading',(select jsonb_build_object('systolic',pm.systolic,'diastolic',pm.diastolic,'minutesAgo',floor(extract(epoch from clock_timestamp()-pm.measured_at)/60)::integer)
       from public.patient_measurements pm where pm.user_id=rec.member_id and pm.measured_at<=clock_timestamp() order by pm.measured_at desc limit 1),
     'redFlagsAfterSeq',coalesce((select max(zr.message_seq)from public.zoe_runs zr where zr.conversation_id=rec.conversation_id and zr.outcome='intake_escalated'),0)))
   else '{}'::jsonb end);
  r:=null;ix:=null;
 end loop;
 return jobs;
end$$;
