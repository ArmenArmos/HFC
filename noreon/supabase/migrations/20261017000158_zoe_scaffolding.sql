-- Zoe non-AI scaffolding (K3, K4, K7 decided 16 Oct; design output/zoe-ai-design-2026-10-16/).
-- No model calls, no provider, no scheduled sends. Dark twice: the app flag
-- NOREON_ZOE_SCAFFOLD_ENABLED and the absent zoe_settings row (absent = off).
-- Every Zoe-path decision writes a conversation trace event (step 'zoe').
-- Consent wording (S6) and the urgent word list (S1) are NOT signed off.

-- Singleton switches. No row is seeded: a reviewed activation migration adds it.
create table public.zoe_settings (
 singleton boolean primary key default true check(singleton),
 consent_collection_enabled boolean not null default false,
 -- K7: model calls pause when the day's spend reaches this. Decided at US$10/day; never above.
 daily_spend_cap_usd numeric(8,2)not null default 10 check(daily_spend_cap_usd>=0 and daily_spend_cap_usd<=10),
 -- K3: quiet hours and the default daily cap on scheduled questions.
 quiet_start time not null default '21:00',quiet_end time not null default '09:00',time_zone text not null default 'Asia/Yerevan',
 scheduled_daily_max integer not null default 2 check(scheduled_daily_max between 0 and 10),
 -- K2 launch gate: no model call is allowed until DPA, Q17 and residency evidence are in.
 model_calls_allowed boolean not null default false check(model_calls_allowed=false),
 updated_at timestamptz not null default clock_timestamp()
);

-- K4: two Zoe consents, separate from the T1 Telegram replies consent (the endpoint link).
-- Append-only history; the latest row per member and kind is the current choice.
create table public.zoe_consents (
 id bigint generated always as identity primary key,
 member_id uuid not null references auth.users(id),
 kind text not null check(kind in('zoe_reads_messages','zoe_scheduled_questions')),
 granted boolean not null,
 wording_version text not null check(wording_version ~ '^[a-z0-9-]{1,64}$'),
 created_at timestamptz not null default clock_timestamp()
);
create index zoe_consents_member on public.zoe_consents(member_id,kind,id desc);
create function public._zoe_consents_immutable()returns trigger language plpgsql set search_path=''as $$begin
 raise exception using errcode='55000',message='Zoe consent history is append-only';end$$;
create trigger zoe_consents_append_only before update or delete on public.zoe_consents for each row execute function public._zoe_consents_immutable();

create function public._zoe_consent_view(m uuid)returns jsonb language sql stable security definer set search_path=''as $$
 select jsonb_build_object('readsMessages',coalesce((select granted from public.zoe_consents where member_id=m and kind='zoe_reads_messages'order by id desc limit 1),false),
  'scheduledQuestions',coalesce((select granted from public.zoe_consents where member_id=m and kind='zoe_scheduled_questions'order by id desc limit 1),false))
$$;

-- The member's own Zoe consents. Not available unless consent collection is switched on.
-- Consent counts only while Zoe is on: the Zoe runtime must treat every consent as void when
-- the settings row is absent, collection is off, or the app flag NOREON_ZOE_SCAFFOLD_ENABLED is off
-- (the runtime runs behind the same flag).
create function public.zoe_consent_status()returns jsonb
language plpgsql security definer set search_path=''as $$
declare m uuid:=auth.uid();s public.zoe_settings;
begin
 if auth.role()is distinct from 'authenticated'or m is null then raise insufficient_privilege;end if;
 select * into s from public.zoe_settings where singleton;
 return jsonb_build_object('ok',true,'available',coalesce(s.consent_collection_enabled,false))||public._zoe_consent_view(m);
end$$;

create function public.zoe_consent_set(p_kind text,p_granted boolean,p_wording_version text)returns jsonb
language plpgsql security definer set search_path=''as $$
declare m uuid:=auth.uid();s public.zoe_settings;cur boolean;
begin
 if auth.role()is distinct from 'authenticated'or m is null then raise insufficient_privilege;end if;
 if p_kind is null or p_kind not in('zoe_reads_messages','zoe_scheduled_questions')or p_granted is null or coalesce(p_wording_version,'')!~'^[a-z0-9-]{1,64}$'then
  return jsonb_build_object('ok',false,'code','invalid');end if;
 select * into s from public.zoe_settings where singleton;
 -- Granting needs collection on and an eligible member (confirmed phone, a clinical case, not
 -- staff). Withdrawing is always possible, even after collection is switched off.
 if p_granted then
  if not found or not s.consent_collection_enabled then return jsonb_build_object('ok',false,'code','unavailable');end if;
  if not public._telegram_member_eligible(m)then return jsonb_build_object('ok',false,'code','not_eligible');end if;
 end if;
 perform pg_advisory_xact_lock(hashtextextended('zoe-consent:'||m::text,0));
 select granted into cur from public.zoe_consents where member_id=m and kind=p_kind order by id desc limit 1;
 -- Nothing is granted by default, so a "no" without an earlier "yes" changes nothing and writes nothing.
 if cur is not distinct from p_granted or(not p_granted and cur is null)then return jsonb_build_object('ok',true,'changed',false)||public._zoe_consent_view(m);end if;
 insert into public.zoe_consents(member_id,kind,granted,wording_version)values(m,p_kind,p_granted,p_wording_version);
 perform public._conversation_trace(m,null,'zoe_consent',p_kind,'zoe',case when p_granted then 'zoe.consent.granted'else 'zoe.consent.withdrawn'end,
  case when p_granted then 'allow'else 'block'end,p_kind,'zoe.consent',p_wording_version,'member',m,jsonb_build_object('noreon.zoe.consent.kind',p_kind));
 return jsonb_build_object('ok',true,'changed',true)||public._zoe_consent_view(m);
end$$;

-- Server-side Zoe policy decisions (quiet hours, scheduled-question cap, spend cap,
-- urgent matcher) are pure functions in lib/zoe; each evaluation in the Zoe path is
-- journaled here. Service role only; names are restricted to the zoe.* namespace.
create function public.zoe_trace_record(p_member uuid,p_name text,p_outcome text,p_reason text,p_rule text,p_rule_version text,p_attributes jsonb)returns jsonb
language plpgsql security definer set search_path=''as $$
begin
 if auth.role()is distinct from 'service_role'then raise insufficient_privilege;end if;
 if coalesce(p_name,'')!~'^zoe\.[a-z0-9_.]{1,60}$'or p_outcome is null or p_outcome not in('allow','block','escalate','skipped','recorded')
  or jsonb_typeof(coalesce(p_attributes,'{}'))<>'object'then return jsonb_build_object('ok',false,'code','invalid');end if;
 -- Codes only, never free text (a slugged sentence would still be text).
 if p_reason!~'^[a-z0-9_.:-]{1,80}$'or p_rule!~'^[a-z0-9_.:-]{1,80}$'or length(p_rule_version)>80 then return jsonb_build_object('ok',false,'code','invalid');end if;
 -- Identifiers and counts only: at most 20 dotted keys with scalar values, strings at most 128 characters.
 if(select count(*)>20 or bool_or(k!~'^[a-z][a-z0-9_.]{1,80}$'or jsonb_typeof(v)not in('string','number','boolean')or(jsonb_typeof(v)='string'and length(v#>>'{}')>128))
  from jsonb_each(coalesce(p_attributes,'{}'))e(k,v))then return jsonb_build_object('ok',false,'code','invalid');end if;
 perform public._conversation_trace(p_member,null,'zoe_decision',null,'zoe',p_name,p_outcome,p_reason,p_rule,p_rule_version,'system',null,p_attributes);
 return jsonb_build_object('ok',true);
end$$;

alter table public.zoe_settings enable row level security;
alter table public.zoe_consents enable row level security;
revoke all on public.zoe_settings,public.zoe_consents from public,anon,authenticated,service_role;
revoke all on sequence public.zoe_consents_id_seq from public,anon,authenticated,service_role;
revoke all on function public._zoe_consents_immutable(),public._zoe_consent_view(uuid),public.zoe_consent_status(),public.zoe_consent_set(text,boolean,text),
 public.zoe_trace_record(uuid,text,text,text,text,text,jsonb)from public,anon,authenticated,service_role;
grant execute on function public.zoe_consent_status(),public.zoe_consent_set(text,boolean,text)to authenticated;
grant execute on function public.zoe_trace_record(uuid,text,text,text,text,text,jsonb)to service_role;
