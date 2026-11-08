-- Fable #265 follow-up N3: the consent trace says whether Zoe's direct answers were on when the
-- choice was made, because the statement the member read is longer while they are on
-- (lib/zoe/consent-copy.ts). Switching direct answers on for real members is a new wording
-- version, which re-asks (docs/operations/staging-ai-mode.md). Body otherwise unchanged from
-- 20261018121002_zoe_warm_replies.sql (which added the 'zoe_screen' source).
create or replace function public.zoe_consent_set(p_kind text,p_granted boolean,p_wording_version text,p_source text)returns jsonb
language plpgsql security definer set search_path=''as $$
declare m uuid:=auth.uid();s public.zoe_settings;cur boolean;cur_version text;stale boolean;v text;
begin
 if auth.role()is distinct from 'authenticated'or m is null then raise insufficient_privilege;end if;
 if p_kind is null or p_kind not in('zoe_reads_messages','zoe_scheduled_questions')or p_granted is null or coalesce(p_wording_version,'')!~'^[a-z0-9-]{1,64}$'
  or p_source is null or p_source not in('settings','enrolment','prompt','zoe_screen')then
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
  jsonb_build_object('noreon.zoe.consent.kind',p_kind,'noreon.zoe.consent.source',p_source,
   'noreon.zoe.consent.direct_answers',coalesce(s.direct_answers_enabled,false)));
 return jsonb_build_object('ok',true,'changed',true)||public._zoe_consent_view(m);
end$$;
