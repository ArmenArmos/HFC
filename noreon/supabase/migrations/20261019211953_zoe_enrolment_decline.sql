-- "Continue without Zoe" at sign-up is a recorded "no" (Gohar QA D-011, lead decision 19 Oct 23:10).
-- Before this, enrolment could record only a yes, so a member who declined Zoe at sign-up met the
-- one-time Home "Meet Zoe" card straight away. Now:
--  * enrolment may record a first "no" to zoe_reads_messages (source 'enrolment', granted=false),
--    under the same checks as an enrolment yes: collection on, the server's current wording, an
--    eligible member and an enrolment consent from the last hour. It never overturns a decision;
--  * the Home card (zoe_consent_prompt.show) stays hidden after that no, as after any no;
--  * the Zoe chat screen may overturn an enrolment no when the member presses "Agree and turn on"
--    there (source 'zoe_screen'): their own active choice on the Zoe page. zoe_consent_prompt gains
--    'zoeScreen', which offers that card only while there is no current grant and the latest choice
--    is not a no given in settings. The Home card and enrolment still never overturn a no.
-- Every change stays an append-only zoe_consents row plus a conversation trace event; a recorded
-- enrolment no is traced as zoe.consent.declined. zoe_consent_set otherwise unchanged from
-- 20261018170200_zoe_consent_trace_direct_answers.sql; zoe_consent_prompt from 20261018073940.
create or replace function public.zoe_consent_set(p_kind text,p_granted boolean,p_wording_version text,p_source text)returns jsonb
language plpgsql security definer set search_path=''as $$
declare m uuid:=auth.uid();s public.zoe_settings;cur boolean;cur_version text;cur_source text;stale boolean;v text;
 enrolment_no boolean:=p_source='enrolment'and not coalesce(p_granted,true);
begin
 if auth.role()is distinct from 'authenticated'or m is null then raise insufficient_privilege;end if;
 if p_kind is null or p_kind not in('zoe_reads_messages','zoe_scheduled_questions')or p_granted is null or coalesce(p_wording_version,'')!~'^[a-z0-9-]{1,64}$'
  or p_source is null or p_source not in('settings','enrolment','prompt','zoe_screen')then
  return jsonb_build_object('ok',false,'code','invalid');end if;
 -- Enrolment, the one-time card and the Zoe screen show one statement, about Zoe reading messages.
 -- The card and the Zoe screen can only record a yes ("Not now" records nothing); enrolment can also
 -- record the member's "Continue without Zoe".
 if p_source<>'settings'and(p_kind<>'zoe_reads_messages'or(not p_granted and not enrolment_no))then return jsonb_build_object('ok',false,'code','invalid');end if;
 select * into s from public.zoe_settings where singleton;
 -- Granting, and an enrolment no (a decision about the statement shown), need collection on, a
 -- current server-held wording that matches what the member was shown, and an eligible member.
 -- Withdrawing in settings is always possible.
 if p_granted or enrolment_no then
  if not found or not s.consent_collection_enabled or s.consent_wording_version is null then return jsonb_build_object('ok',false,'code','unavailable');end if;
  if p_wording_version is distinct from s.consent_wording_version then return jsonb_build_object('ok',false,'code','stale','wordingVersion',s.consent_wording_version);end if;
  if not public._zoe_member_eligible(m)then return jsonb_build_object('ok',false,'code','not_eligible');end if;
 end if;
 -- An enrolment decision rides on the Agree the member just pressed: it needs that enrolment
 -- consent, recorded within the hour.
 if p_source='enrolment'and not exists(select 1 from public.patient_consents where user_id=m and accepted_at>clock_timestamp()-interval '1 hour')then
  return jsonb_build_object('ok',false,'code','not_eligible');end if;
 perform pg_advisory_xact_lock(hashtextextended('zoe-consent:'||m::text,0));
 select granted,wording_version,source into cur,cur_version,cur_source from public.zoe_consents where member_id=m and kind=p_kind order by id desc limit 1;
 -- A grant of an outdated wording is no longer a decision about the current text (Fable F2).
 stale:=coalesce(cur,false)and s.singleton is not null and not public._zoe_wording_current(s,cur_version);
 -- Enrolment and the card only ever record a first decision, or a yes to new wording after a yes
 -- to old wording: they never overturn a choice about the current text, a "no" least of all.
 -- The one exception: a yes on the Zoe screen over a no given at enrolment.
 if p_source<>'settings'and cur is not null and not stale
  and not(p_source='zoe_screen'and p_granted and not cur and cur_source='enrolment')then
  return jsonb_build_object('ok',true,'changed',false)||public._zoe_consent_view(m);end if;
 if(p_granted and cur and not stale)or(not p_granted and not coalesce(cur,false)and not(enrolment_no and cur is null))then
  return jsonb_build_object('ok',true,'changed',false)||public._zoe_consent_view(m);end if;
 -- A grant or an enrolment no records the server's current wording. A withdrawal records the
 -- server's wording, or when none is held, the wording of the grant being withdrawn: never a client value.
 v:=case when p_granted or enrolment_no then s.consent_wording_version
  else coalesce(s.consent_wording_version,(select wording_version from public.zoe_consents where member_id=m and kind=p_kind order by id desc limit 1))end;
 insert into public.zoe_consents(member_id,kind,granted,wording_version,source)values(m,p_kind,p_granted,v,p_source);
 perform public._conversation_trace(m,null,'zoe_consent',p_kind,'zoe',
  case when p_granted then 'zoe.consent.granted'when enrolment_no then 'zoe.consent.declined'else 'zoe.consent.withdrawn'end,
  case when p_granted then 'allow'else 'block'end,p_kind,'zoe.consent',v,'member',m,
  jsonb_build_object('noreon.zoe.consent.kind',p_kind,'noreon.zoe.consent.source',p_source,
   'noreon.zoe.consent.direct_answers',coalesce(s.direct_answers_enabled,false)));
 return jsonb_build_object('ok',true,'changed',true)||public._zoe_consent_view(m);
end$$;

-- 'show' (the Home card) is unchanged: only with no decision yet, or a yes to an outdated wording.
-- 'zoeScreen' (the card on the Zoe chat): also after a no given at enrolment, never after a no given
-- in settings, which only settings can undo.
create or replace function public.zoe_consent_prompt()returns jsonb
language plpgsql stable security definer set search_path=''as $$
declare m uuid:=auth.uid();s public.zoe_settings;latest public.zoe_consents;open boolean;
begin
 if auth.role()is distinct from 'authenticated'or m is null then raise insufficient_privilege;end if;
 select * into s from public.zoe_settings where singleton;
 select * into latest from public.zoe_consents where member_id=m and kind='zoe_reads_messages'order by id desc limit 1;
 open:=coalesce(s.consent_collection_enabled,false)and s.consent_wording_version is not null and public._zoe_member_eligible(m);
 return jsonb_build_object('ok',true,'wordingVersion',s.consent_wording_version,'directAnswers',coalesce(s.direct_answers_enabled,false),
  'show',open and(latest.id is null or(latest.granted and not public._zoe_wording_current(s,latest.wording_version))),
  'zoeScreen',open and(latest.id is null or(latest.granted and not public._zoe_wording_current(s,latest.wording_version))
   or(not latest.granted and latest.source='enrolment')));
end$$;
-- create or replace keeps the existing grants (authenticated only, from 20261018073940).
