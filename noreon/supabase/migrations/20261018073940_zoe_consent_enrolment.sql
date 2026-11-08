-- Zoe consent at enrolment (Khikar, 18 Oct 2026 11:37; lead design in output/zoe-consent-signup-2026-10-18/).
-- Zoe reading a member's messages is asked for explicitly, never pre-granted:
--  * enrolment: the sign-up Agree step shows a plain Zoe statement; pressing Agree records the
--    enrolment consent (save_patient_profile) and then a zoe_reads_messages grant here;
--  * prompt: members with no Zoe decision see a one-time card with the same statement (OK = grant);
--  * settings: the existing on/off switches, now under Me.
-- Every row says where it came from. zoe_run_claim needs the latest zoe_reads_messages row to be a
-- grant of the current wording (Fable F2): a new wording version re-asks (the card shows again) and
-- Zoe stops for that member until they agree to it. zoe_settings.consent_wording_also_valid lists
-- earlier versions an operator accepts as current after a purely editorial change. A withdrawal
-- stops Zoe for the next message; a run already claimed still finishes (Fable F5, accepted).
-- STAGING DRAFT WORDING (legal P14/P16, Tatevik): the server-held wording version moves to
-- zoe-consent-draft-2, the text with the enrolment statement.

-- Existing rows were all given on the settings screen.
alter table public.zoe_consents add column source text not null default 'settings'check(source in('settings','enrolment','prompt'));

-- Who may give a Zoe consent: a member with a confirmed phone who is not staff. Unlike Telegram
-- linking (_telegram_member_eligible) no clinical case is needed, because members agree at
-- enrolment, before a case exists. Zoe still runs only for a member with an assigned doctor.
create function public._zoe_member_eligible(m uuid)returns boolean
language sql stable security definer set search_path=''as $$
 select exists(select 1 from auth.users where id=m and phone is not null and phone_confirmed_at is not null
  and(banned_until is null or banned_until<=clock_timestamp()))
 and not exists(select 1 from public.workspace_staff where user_id=m)
$$;
revoke all on function public._zoe_member_eligible(uuid)from public,anon,authenticated,service_role;

-- Earlier wording versions that still count, for purely editorial changes (operator decision).
alter table public.zoe_settings add column consent_wording_also_valid text[] not null default '{}'
 check(cardinality(consent_wording_also_valid)<=10);

-- A Zoe grant counts only when it was given to the wording the server holds now (or one the
-- operator kept valid). With no server wording there is no current text, so nothing is current.
create function public._zoe_wording_current(s public.zoe_settings,v text)returns boolean
language sql stable set search_path=''as $$
 select s.consent_wording_version is not null and v is not null and(v=s.consent_wording_version or v=any(s.consent_wording_also_valid))
$$;
-- The member's latest choice for a kind is a grant of the current wording.
create function public._zoe_consent_current(m uuid,p_kind text)returns boolean
language sql stable security definer set search_path=''as $$
 select coalesce((select z.granted and public._zoe_wording_current(s,z.wording_version)
  from public.zoe_consents z,public.zoe_settings s where s.singleton and z.member_id=m and z.kind=p_kind order by z.id desc limit 1),false)
$$;
-- What the switches show: a grant of an outdated wording shows as off once the server holds a
-- wording (turning it on again agrees to the current text). With no server wording the raw latest
-- choice shows, so a grant can still be seen and withdrawn while collection is off.
create or replace function public._zoe_consent_view(m uuid)returns jsonb language sql stable security definer set search_path=''as $$
 select jsonb_build_object(
  'readsMessages',coalesce((select z.granted and(s.consent_wording_version is null or public._zoe_wording_current(s,z.wording_version))
   from public.zoe_consents z left join public.zoe_settings s on s.singleton where z.member_id=m and z.kind='zoe_reads_messages'order by z.id desc limit 1),false),
  'scheduledQuestions',coalesce((select z.granted and(s.consent_wording_version is null or public._zoe_wording_current(s,z.wording_version))
   from public.zoe_consents z left join public.zoe_settings s on s.singleton where z.member_id=m and z.kind='zoe_scheduled_questions'order by z.id desc limit 1),false))
$$;
revoke all on function public._zoe_wording_current(public.zoe_settings,text),public._zoe_consent_current(uuid,text),public._zoe_consent_view(uuid)
 from public,anon,authenticated,service_role;

create function public.zoe_consent_set(p_kind text,p_granted boolean,p_wording_version text,p_source text)returns jsonb
language plpgsql security definer set search_path=''as $$
declare m uuid:=auth.uid();s public.zoe_settings;cur boolean;cur_version text;stale boolean;v text;
begin
 if auth.role()is distinct from 'authenticated'or m is null then raise insufficient_privilege;end if;
 if p_kind is null or p_kind not in('zoe_reads_messages','zoe_scheduled_questions')or p_granted is null or coalesce(p_wording_version,'')!~'^[a-z0-9-]{1,64}$'
  or p_source is null or p_source not in('settings','enrolment','prompt')then
  return jsonb_build_object('ok',false,'code','invalid');end if;
 -- Enrolment and the one-time card show one statement, about Zoe reading messages, and can only
 -- record a yes to it. "Not now" on the card records nothing.
 if p_source<>'settings'and(p_kind<>'zoe_reads_messages'or not p_granted)then return jsonb_build_object('ok',false,'code','invalid');end if;
 select * into s from public.zoe_settings where singleton;
 -- Granting needs collection on, a current server-held wording that matches what the member
 -- was shown, and an eligible member. Withdrawing is always possible.
 if p_granted then
  if not found or not s.consent_collection_enabled or s.consent_wording_version is null then return jsonb_build_object('ok',false,'code','unavailable');end if;
  if p_wording_version is distinct from s.consent_wording_version then return jsonb_build_object('ok',false,'code','stale','wordingVersion',s.consent_wording_version);end if;
  if not public._zoe_member_eligible(m)then return jsonb_build_object('ok',false,'code','not_eligible');end if;
 end if;
 -- An enrolment grant rides on the Agree the member just pressed: it needs that enrolment
 -- consent, recorded within the hour.
 if p_source='enrolment'and not exists(select 1 from public.patient_consents where user_id=m and accepted_at>clock_timestamp()-interval '1 hour')then
  return jsonb_build_object('ok',false,'code','not_eligible');end if;
 perform pg_advisory_xact_lock(hashtextextended('zoe-consent:'||m::text,0));
 select granted,wording_version into cur,cur_version from public.zoe_consents where member_id=m and kind=p_kind order by id desc limit 1;
 -- A grant of an outdated wording is no longer a decision about the current text (Fable F2).
 stale:=coalesce(cur,false)and s.singleton is not null and not public._zoe_wording_current(s,cur_version);
 -- Enrolment and the card only ever record a first decision, or a yes to new wording after a yes
 -- to old wording: they never overturn a choice about the current text, a "no" least of all.
 if p_source<>'settings'and cur is not null and not stale then return jsonb_build_object('ok',true,'changed',false)||public._zoe_consent_view(m);end if;
 if(p_granted and cur and not stale)or(not p_granted and not coalesce(cur,false))then
  return jsonb_build_object('ok',true,'changed',false)||public._zoe_consent_view(m);end if;
 -- A grant records the server's current wording. A withdrawal records the server's wording, or
 -- when none is held, the wording of the grant being withdrawn: never a client value.
 v:=case when p_granted then s.consent_wording_version
  else coalesce(s.consent_wording_version,(select wording_version from public.zoe_consents where member_id=m and kind=p_kind order by id desc limit 1))end;
 insert into public.zoe_consents(member_id,kind,granted,wording_version,source)values(m,p_kind,p_granted,v,p_source);
 perform public._conversation_trace(m,null,'zoe_consent',p_kind,'zoe',case when p_granted then 'zoe.consent.granted'else 'zoe.consent.withdrawn'end,
  case when p_granted then 'allow'else 'block'end,p_kind,'zoe.consent',v,'member',m,
  jsonb_build_object('noreon.zoe.consent.kind',p_kind,'noreon.zoe.consent.source',p_source));
 return jsonb_build_object('ok',true,'changed',true)||public._zoe_consent_view(m);
end$$;

-- The settings screen's three-argument call keeps working (and an app deployed before this
-- migration keeps working): it is the settings source.
create or replace function public.zoe_consent_set(p_kind text,p_granted boolean,p_wording_version text)returns jsonb
language sql security invoker set search_path=''as $$
 select public.zoe_consent_set(p_kind,p_granted,p_wording_version,'settings')
$$;

-- Whether to show the Zoe statement or the one-time card: collection is on with a server-held
-- wording, the member may consent, and they have never decided about Zoe reading their messages,
-- or their latest choice is a yes to an outdated wording (Fable F2). directAnswers says whether
-- Zoe answers simple questions herself, so the copy can say so only when it is true (Fable F3).
create function public.zoe_consent_prompt()returns jsonb
language plpgsql stable security definer set search_path=''as $$
declare m uuid:=auth.uid();s public.zoe_settings;latest public.zoe_consents;
begin
 if auth.role()is distinct from 'authenticated'or m is null then raise insufficient_privilege;end if;
 select * into s from public.zoe_settings where singleton;
 select * into latest from public.zoe_consents where member_id=m and kind='zoe_reads_messages'order by id desc limit 1;
 return jsonb_build_object('ok',true,'wordingVersion',s.consent_wording_version,'directAnswers',coalesce(s.direct_answers_enabled,false),
  'show',coalesce(s.consent_collection_enabled,false)and s.consent_wording_version is not null and public._zoe_member_eligible(m)
   and(latest.id is null or(latest.granted and not public._zoe_wording_current(s,latest.wording_version))));
end$$;

-- The run claim, unchanged from 20261017190654_staging_ai_mode.sql except the consent line.
create or replace function public.zoe_run_claim(p_limit integer)returns jsonb
language plpgsql security definer set search_path=''as $$
declare s public.zoe_settings;rec record;r public.zoe_runs;jobs jsonb:='[]';consent boolean;skip text;since timestamptz;
begin
 if auth.role()is distinct from 'service_role'then raise insufficient_privilege;end if;
 for r in update public.zoe_runs set state='finished',outcome='no_output',reason_code='worker_lost',finished_at=clock_timestamp()
  where state='started'and started_at<clock_timestamp()-interval '10 minutes'returning * loop
  perform public._zoe_run_events(r,jsonb_build_array(jsonb_build_object('name','zoe.route','outcome','failed','reason','worker_lost','rule','zoe.pipeline','ruleVersion','1','actor','system','attributes',jsonb_build_object('noreon.zoe.run.outcome','no_output'))));
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
  -- K4: consent counts only while collection is on with a server-held wording.
  -- Fable F2: and only a grant of the current wording (or one the operator kept valid) counts.
  consent:=s.singleton is not null and s.consent_collection_enabled and s.consent_wording_version is not null
   and public._zoe_consent_current(rec.member_id,'zoe_reads_messages');
  skip:=case when s.singleton is null or not s.consent_collection_enabled or s.consent_wording_version is null then 'zoe_settings_off'
   when not consent then 'no_zoe_reads_messages_consent' when rec.assigned_doctor_id is null then 'no_assigned_doctor'
   -- Fable Z-F3: a message the doctor already answered gets no AI draft.
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
  -- The window: member messages since the last approved reply (at most 20), the last approved
  -- replies, and Zoe's own answers in the same window (at most 10).
  since:=(select max(ap.created_at)from public.conversation_approvals ap join public.conversation_drafts d on d.id=ap.draft_id where d.conversation_id=rec.conversation_id);
  jobs:=jobs||jsonb_build_array(jsonb_build_object('runId',r.id,'memberId',rec.member_id,'messageSeq',rec.seq,'displayName',rec.display_name,
   'messages',(select jsonb_agg(jsonb_build_object('seq',w.seq,'text',w.body,'minutesAgo',w.ago)order by w.seq)from(
     select m.seq,m.body,floor(extract(epoch from clock_timestamp()-m.created_at)/60)::integer ago from public.conversation_messages m
     where m.conversation_id=rec.conversation_id and m.seq<=rec.seq and(since is null or m.created_at>since or m.seq=rec.seq)order by m.seq desc limit 20)w),
   'replies',coalesce((select jsonb_agg(jsonb_build_object('body',x.body,'minutesAgo',x.ago)order by x.created_at)from(
     select ap.body,ap.created_at,floor(extract(epoch from clock_timestamp()-ap.created_at)/60)::integer ago from public.conversation_approvals ap
     join public.conversation_drafts d on d.id=ap.draft_id where d.conversation_id=rec.conversation_id order by ap.created_at desc limit 3)x),'[]'),
   'answers',coalesce((select jsonb_agg(jsonb_build_object('body',x.body,'minutesAgo',x.ago)order by x.created_at)from(
     select a.body,a.created_at,floor(extract(epoch from clock_timestamp()-a.created_at)/60)::integer ago from public.zoe_member_answers a
     where a.conversation_id=rec.conversation_id and(since is null or a.created_at>since)order by a.created_at desc limit 10)x),'[]'),
   'directAnswers',coalesce(s.direct_answers_enabled,false)));
  r:=null;
 end loop;
 return jobs;
end$$;

revoke all on function public.zoe_consent_set(text,boolean,text,text),public.zoe_consent_set(text,boolean,text),public.zoe_consent_prompt()
 from public,anon,authenticated,service_role;
grant execute on function public.zoe_consent_set(text,boolean,text,text),public.zoe_consent_set(text,boolean,text),public.zoe_consent_prompt()to authenticated;

-- The wording now includes the enrolment statement. Only the staging draft moves; a null or any
-- other (signed) version is left for the operator.
update public.zoe_settings set consent_wording_version='zoe-consent-draft-2'where consent_wording_version='zoe-consent-draft-1';
