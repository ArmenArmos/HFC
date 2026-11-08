-- Fable review fixes (output/fable-review-2026-10-17/MISC_REVIEW.md): F2, F3, F5 (Zoe consents
-- only) and F6 (retention note). Dark: nothing here switches any feature on.

-- F2. The trace writer can never fail the transaction that called it. Every field the CHECK
-- constraints test is normalised first, and any remaining error (a future step or outcome
-- value, a lock timeout) is caught: the event is dropped with a warning instead of aborting
-- the member's link, binding, intake or delivery. It now reports whether the event was
-- written, so callers that promise "journaled or not done" (zoe_trace_record) can say so.
drop function public._conversation_trace(uuid,uuid,text,text,text,text,text,text,text,text,text,uuid,jsonb);
create function public._conversation_trace(
 p_member uuid,p_conversation uuid,p_subject_kind text,p_subject_id text,p_step text,p_name text,p_outcome text,
 p_reason text,p_rule text,p_rule_version text,p_actor_kind text,p_actor uuid,p_attributes jsonb)returns boolean
language plpgsql security definer set search_path=''as $$
declare n text;k text;
begin
 -- Event names keep their dots; they must start with a letter (link.Re-Issued -> link.re_issued).
 n:=regexp_replace(regexp_replace(lower(coalesce(p_name,'')),'[^a-z0-9_.]+','_','g'),'^[^a-z]+','');
 n:=left(n,81);if length(n)<2 then n:='unknown_event';end if;
 k:=left(btrim(regexp_replace(lower(coalesce(p_subject_kind,'')),'[^a-z_]+','_','g'),'_'),40);if k=''then k:='unknown';end if;
 begin
  insert into public.conversation_trace_events(member_id,conversation_id,subject_kind,subject_id,step,name,outcome,reason_code,rule_id,rule_version,actor_kind,actor_id,attributes)
  values(p_member,coalesce(p_conversation,(select id from public.conversations where member_id=p_member)),k,nullif(left(p_subject_id,256),''),p_step,n,p_outcome,
   public._conversation_trace_code(p_reason),public._conversation_trace_code(p_rule),left(nullif(btrim(p_rule_version),''),80),
   p_actor_kind,p_actor,jsonb_strip_nulls(coalesce(p_attributes,'{}')));
  return true;
 exception when others then
  -- The SQLSTATE and the normalised name only: never the attributes or the member.
  raise warning 'conversation trace event % dropped (%)',n,sqlstate;
  return false;
 end;
end$$;
revoke all on function public._conversation_trace(uuid,uuid,text,text,text,text,text,text,text,text,text,uuid,jsonb)from public,anon,authenticated,service_role;

-- zoe_trace_record answers ok only when the event was actually written.
create or replace function public.zoe_trace_record(p_member uuid,p_name text,p_outcome text,p_reason text,p_rule text,p_rule_version text,p_attributes jsonb)returns jsonb
language plpgsql security definer set search_path=''as $$
begin
 if auth.role()is distinct from 'service_role'then raise insufficient_privilege;end if;
 if coalesce(p_name,'')!~'^zoe\.[a-z0-9_.]{1,60}$'or p_outcome is null or p_outcome not in('allow','block','escalate','skipped','recorded')
  or jsonb_typeof(coalesce(p_attributes,'{}'))<>'object'then return jsonb_build_object('ok',false,'code','invalid');end if;
 if p_reason!~'^[a-z0-9_.:-]{1,80}$'or p_rule!~'^[a-z0-9_.:-]{1,80}$'or length(p_rule_version)>80 then return jsonb_build_object('ok',false,'code','invalid');end if;
 if(select count(*)>20 or bool_or(k!~'^[a-z][a-z0-9_.]{1,80}$'or jsonb_typeof(v)not in('string','number','boolean')or(jsonb_typeof(v)='string'and length(v#>>'{}')>128))
  from jsonb_each(coalesce(p_attributes,'{}'))e(k,v))then return jsonb_build_object('ok',false,'code','invalid');end if;
 if not public._conversation_trace(p_member,null,'zoe_decision',null,'zoe',p_name,p_outcome,p_reason,p_rule,p_rule_version,'system',null,p_attributes)then
  return jsonb_build_object('ok',false,'code','not_recorded');end if;
 return jsonb_build_object('ok',true);
end$$;
revoke all on function public.zoe_trace_record(uuid,text,text,text,text,text,jsonb)from public,anon,authenticated,service_role;
grant execute on function public.zoe_trace_record(uuid,text,text,text,text,text,jsonb)to service_role;

-- F6. Retention is not decided (Q17). The journal grows from the moment the triggers exist,
-- whatever the page flag says. Before real members: a definer purge function with its own
-- audit row, and partitioning or an occurred_at index sized for it.
comment on table public.conversation_trace_events is
 'Append-only conversation decision journal (identifiers, codes and versions only). Retention is open (Q17): add an audited purge path before real members.';

-- F3. The consent wording a member agrees to is held by the server, not sent by the client.
-- The activation migration sets it when the S6 wording is signed; until then no grant is possible.
alter table public.zoe_settings add column consent_wording_version text check(consent_wording_version ~ '^[a-z0-9-]{1,64}$');

create or replace function public.zoe_consent_status()returns jsonb
language plpgsql security definer set search_path=''as $$
declare m uuid:=auth.uid();s public.zoe_settings;
begin
 if auth.role()is distinct from 'authenticated'or m is null then raise insufficient_privilege;end if;
 select * into s from public.zoe_settings where singleton;
 return jsonb_build_object('ok',true,'available',coalesce(s.consent_collection_enabled,false)and s.consent_wording_version is not null,
  'wordingVersion',s.consent_wording_version)||public._zoe_consent_view(m);
end$$;

-- p_wording_version is now only a staleness check: the version recorded is always the server's.
create or replace function public.zoe_consent_set(p_kind text,p_granted boolean,p_wording_version text)returns jsonb
language plpgsql security definer set search_path=''as $$
declare m uuid:=auth.uid();s public.zoe_settings;cur boolean;v text;
begin
 if auth.role()is distinct from 'authenticated'or m is null then raise insufficient_privilege;end if;
 if p_kind is null or p_kind not in('zoe_reads_messages','zoe_scheduled_questions')or p_granted is null or coalesce(p_wording_version,'')!~'^[a-z0-9-]{1,64}$'then
  return jsonb_build_object('ok',false,'code','invalid');end if;
 select * into s from public.zoe_settings where singleton;
 -- Granting needs collection on, a current server-held wording that matches what the member
 -- was shown, and an eligible member. Withdrawing is always possible.
 if p_granted then
  if not found or not s.consent_collection_enabled or s.consent_wording_version is null then return jsonb_build_object('ok',false,'code','unavailable');end if;
  if p_wording_version is distinct from s.consent_wording_version then return jsonb_build_object('ok',false,'code','stale','wordingVersion',s.consent_wording_version);end if;
  if not public._telegram_member_eligible(m)then return jsonb_build_object('ok',false,'code','not_eligible');end if;
 end if;
 perform pg_advisory_xact_lock(hashtextextended('zoe-consent:'||m::text,0));
 select granted into cur from public.zoe_consents where member_id=m and kind=p_kind order by id desc limit 1;
 if cur is not distinct from p_granted or(not p_granted and cur is null)then return jsonb_build_object('ok',true,'changed',false)||public._zoe_consent_view(m);end if;
 -- A grant records the server's current wording. A withdrawal records the server's wording, or
 -- when none is held, the wording of the grant being withdrawn: never a client value.
 v:=case when p_granted then s.consent_wording_version
  else coalesce(s.consent_wording_version,(select wording_version from public.zoe_consents where member_id=m and kind=p_kind order by id desc limit 1))end;
 insert into public.zoe_consents(member_id,kind,granted,wording_version)values(m,p_kind,p_granted,v);
 perform public._conversation_trace(m,null,'zoe_consent',p_kind,'zoe',case when p_granted then 'zoe.consent.granted'else 'zoe.consent.withdrawn'end,
  case when p_granted then 'allow'else 'block'end,p_kind,'zoe.consent',v,'member',m,jsonb_build_object('noreon.zoe.consent.kind',p_kind));
 return jsonb_build_object('ok',true,'changed',true)||public._zoe_consent_view(m);
end$$;
revoke all on function public.zoe_consent_status(),public.zoe_consent_set(text,boolean,text)from public,anon,authenticated,service_role;
grant execute on function public.zoe_consent_status(),public.zoe_consent_set(text,boolean,text)to authenticated;

-- F5 (Zoe consents only; lead decision pending Q17 review): deleting a member's account deletes
-- their Zoe consent history. The append-only guard lets exactly that cascade through.
alter table public.zoe_consents drop constraint zoe_consents_member_id_fkey;
alter table public.zoe_consents add constraint zoe_consents_member_id_fkey foreign key(member_id)references auth.users(id)on delete cascade;
create or replace function public._zoe_consents_immutable()returns trigger language plpgsql set search_path=''as $$begin
 if tg_op='DELETE'and not exists(select 1 from auth.users where id=old.member_id)then return old;end if;
 raise exception using errcode='55000',message='Zoe consent history is append-only';end$$;
