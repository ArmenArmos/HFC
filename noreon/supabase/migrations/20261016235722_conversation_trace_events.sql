-- Conversation decision journal (lead decision, output/tracing-research-2026-10-17/NOTE.md option 1).
-- One append-only table of trace events. Every rule or guard evaluation, approval, send
-- attempt, provider receipt and link change in the Telegram T1 flow writes one event, so
-- the backoffice can answer "why did it reply, or not?" for any member conversation.
--
-- Events are written by AFTER triggers on the existing T1 tables, so the reviewed T1
-- functions are unchanged. Payloads hold identifiers, codes and versions only: never
-- message text, draft text, summaries or phone numbers. Attribute names follow the
-- OpenTelemetry conventions (messaging.*, gen_ai.* later) plus noreon.* for our own
-- guard fields, so events can be exported to an OTel or Langfuse backend later.
-- Retention (Q17) is still open: there is deliberately no purge path yet.

create table public.conversation_trace_events (
 id bigint generated always as identity primary key,
 occurred_at timestamptz not null default clock_timestamp(),
 -- OTel: the trace is the member conversation; each event is one span-like step.
 member_id uuid,
 conversation_id uuid,
 -- The row this event is about: inbox event, message, draft, approval, delivery, system message, attempt, endpoint, consent.
 subject_kind text not null check(subject_kind ~ '^[a-z_]{1,40}$'),
 subject_id text check(length(subject_id)between 1 and 256),
 step text not null check(step in('intake','auto_ack','doctor_alert','draft','approval','delivery','provider','link','zoe')),
 name text not null check(name ~ '^[a-z][a-z0-9_.]{1,80}$'),
 outcome text not null check(outcome in('allow','block','redact','escalate','queued','held','sending','sent','failed','unknown','recorded','skipped','superseded')),
 reason_code text check(reason_code ~ '^[a-z0-9_.:-]{1,80}$'),
 rule_id text check(rule_id ~ '^[a-z0-9_.:-]{1,80}$'),
 rule_version text check(length(rule_version)between 1 and 80),
 actor_kind text not null check(actor_kind in('system','member','doctor','staff','admin','ai','provider')),
 actor_id uuid,
 attributes jsonb not null default '{}'check(jsonb_typeof(attributes)='object'
  -- Identifiers only: no free text may be journaled under any of these names.
  and not(attributes ?| array['text','body','summary','caption','phone','message','content','prompt','completion']))
);
create index conversation_trace_events_member on public.conversation_trace_events(member_id,occurred_at,id);
create index conversation_trace_events_recent on public.conversation_trace_events(occurred_at desc)where member_id is not null;

create function public._conversation_trace_immutable()returns trigger language plpgsql set search_path=''as $$begin
 raise exception using errcode='55000',message='Conversation trace events are append-only';end$$;
create trigger conversation_trace_events_append_only before update or delete on public.conversation_trace_events
 for each row execute function public._conversation_trace_immutable();
create trigger conversation_trace_events_no_truncate before truncate on public.conversation_trace_events
 for each statement execute function public._conversation_trace_immutable();

-- Free-form codes become short slugs ("Adapter unavailable before invocation" -> adapter_unavailable_before_invocation).
create function public._conversation_trace_code(x text)returns text language sql immutable set search_path=''as $$
 select case when x is null then null when x ~ '^[a-z0-9_.:-]{1,80}$'then x
  else coalesce(nullif(left(btrim(regexp_replace(lower(x),'[^a-z0-9]+','_','g'),'_'),80),''),'other')end
$$;

-- The single writer. Internal only; triggers and later Zoe functions call it. It never raises
-- on caller-supplied codes or versions: on the intake path a journal error would lose the
-- member's message (dead letter after retries), which is worse than an imperfect event.
create function public._conversation_trace(
 p_member uuid,p_conversation uuid,p_subject_kind text,p_subject_id text,p_step text,p_name text,p_outcome text,
 p_reason text,p_rule text,p_rule_version text,p_actor_kind text,p_actor uuid,p_attributes jsonb)returns void
language plpgsql security definer set search_path=''as $$
begin
 insert into public.conversation_trace_events(member_id,conversation_id,subject_kind,subject_id,step,name,outcome,reason_code,rule_id,rule_version,actor_kind,actor_id,attributes)
 values(p_member,coalesce(p_conversation,(select id from public.conversations where member_id=p_member)),p_subject_kind,p_subject_id,p_step,p_name,p_outcome,
  public._conversation_trace_code(p_reason),public._conversation_trace_code(p_rule),left(nullif(btrim(p_rule_version),''),80),
  p_actor_kind,p_actor,jsonb_strip_nulls(coalesce(p_attributes,'{}')));
end$$;

-- Who acted, from the request claims: the service role is the system, a staff row names the role.
create function public._conversation_trace_actor()returns text language sql stable security definer set search_path=''as $$
 select case when auth.uid()is null then 'system'
  else coalesce((select case role when 'doctor'then 'doctor'when 'admin'then 'admin'else 'staff'end from public.workspace_staff where user_id=auth.uid()and active and removed_at is null),'member')end
$$;

-- 1. Telegram intake -----------------------------------------------------------------

create function public._trace_channel_inbox()returns trigger language plpgsql security definer set search_path=''as $$
declare m uuid;ack public.system_messages;alerted boolean;pol public.conversation_policy;attrs jsonb;approved boolean;
begin
 if tg_op='UPDATE'and(new.status is not distinct from old.status or new.status not in('done','dead'))then return null;end if;
 select member_id into m from public.conversation_endpoints where id=new.endpoint_id;
 attrs:=jsonb_build_object('messaging.system','telegram','messaging.operation.type','receive','noreon.inbox.kind',new.kind,'noreon.inbox.attempts',new.attempts);
 if tg_op='INSERT'then
  if new.kind='rejected'then
   perform public._conversation_trace(m,null,'channel_inbox',new.id::text,'intake','intake.rejected','block',new.result,'telegram.ingress',null,'system',null,attrs);
  else
   perform public._conversation_trace(m,null,'channel_inbox',new.id::text,'intake','intake.committed','recorded',null,'telegram.ingress',null,'system',null,attrs);
  end if;
  return null;
 end if;
 if new.status='dead'then
  perform public._conversation_trace(m,null,'channel_inbox',new.id::text,'intake','intake.dead_lettered','failed',coalesce(lower(new.last_error),new.result,'retries_exhausted'),'telegram.inbox_retry',null,'system',null,attrs);
  return null;
 end if;
 select * into pol from public.conversation_policy where singleton;
 -- The guard decision for this inbound event.
 perform public._conversation_trace(m,null,'channel_inbox',new.id::text,
  case when new.result ~ '^(link|contact|auth):'then 'link'else 'intake'end,'intake.processed',
  case when new.result in('received')then 'allow'
       when new.result='media'then 'redact'
       when new.result in('rate_limited','principal_not_linked','generation_mismatch','member_not_eligible')then 'block'
       when new.result in('link:linked','contact:linked','contact:proven')then 'allow'
       when new.result='auth:prompted'then 'recorded'
       when new.result ~ '^(link|contact|auth):'then 'block'
       when new.result like 'ignored_%'then 'skipped'
       else 'recorded'end,
  case new.result when 'rate_limited'then 'member_over_intake_limit'when 'media'then 'unsupported_media_not_read'else new.result end,
  case when new.result='rate_limited'then 'conversation_policy.intake_max_messages'
       when new.result='generation_mismatch'then 'telegram.endpoint_generation'
       when new.result='member_not_eligible'then 'telegram.member_eligible'
       when new.result like 'link:%'then 'telegram.link_redeem'
       when new.result like 'contact:%'then 'telegram.contact_proof'
       when new.result like 'auth:%'then 'telegram.auth_start'
       else 'telegram.inbox_process'end,
  case when new.result='rate_limited'then pol.version end,'system',null,
  attrs||case when new.result='rate_limited'then jsonb_build_object('noreon.policy.intake_max_messages',pol.intake_max_messages,'noreon.policy.intake_window_seconds',pol.intake_window_seconds)else '{}'end);
 -- The acknowledgement decision and its reason, for every message that reached a conversation.
 if new.kind in('text','media')and new.result in('received','rate_limited','media')then
  select * into ack from public.system_messages where source_inbox_id=new.id and template_id in('telegram.ack','telegram.unsupported_media');
  alerted:=exists(select 1 from public.conversation_doctor_alerts where inbox_id=new.id);
  if ack.id is not null then
   select t.approved into approved from public.system_message_templates t where t.template_id=ack.template_id and t.version=ack.template_version and t.locale=ack.locale;
   perform public._conversation_trace(m,null,'system_message',ack.id::text,'auto_ack','auto_ack.decided','queued',
    -- Queued now; unapproved wording (D1) is held at claim and never sent.
    case when approved is not true then 'queued_wording_unapproved_will_be_held'
     else case new.result when 'media'then 'non_text_message'when 'rate_limited'then 'first_over_limit_message_this_window'else 'member_message_received'end end,ack.template_id,ack.template_version::text,'system',null,
    jsonb_build_object('noreon.inbox.id',new.id,'noreon.template.locale',ack.locale,'noreon.doctor_alert.created',alerted));
  else
   perform public._conversation_trace(m,null,'channel_inbox',new.id::text,'auto_ack','auto_ack.decided','skipped',
    case when new.result in('rate_limited','media')then 'already_acknowledged_this_window'else 'no_template_available'end,
    case when new.result='media'then 'telegram.unsupported_media'else 'telegram.ack'end,pol.version,'system',null,
    jsonb_build_object('noreon.doctor_alert.created',alerted,'noreon.policy.intake_window_seconds',pol.intake_window_seconds));
  end if;
 end if;
 return null;
end$$;
create trigger conversation_trace_inbox after insert or update of status on public.channel_inbox
 for each row execute function public._trace_channel_inbox();

-- A stored member message (Telegram or the app).
create function public._trace_conversation_message()returns trigger language plpgsql security definer set search_path=''as $$
begin
 perform public._conversation_trace(new.author_id,new.conversation_id,'conversation_message',new.id::text,'intake','message.stored','recorded',new.source,null,null,'member',new.author_id,
  jsonb_build_object('messaging.system',case new.source when 'telegram_member'then 'telegram'else 'noreon_app'end,'noreon.message.seq',new.seq));
 return null;
end$$;
create trigger conversation_trace_message after insert on public.conversation_messages
 for each row execute function public._trace_conversation_message();

create function public._trace_doctor_alert()returns trigger language plpgsql security definer set search_path=''as $$
begin
 perform public._conversation_trace(new.member_id,new.conversation_id,'doctor_alert',new.id::text,'doctor_alert','doctor_alert.created',
  case when new.doctor_id is null then 'held'else 'escalate'end,case when new.doctor_id is null then 'no_assigned_doctor'else 'alert_recorded_for_assigned_doctor'end,
  'telegram.doctor_alert',null,'system',null,jsonb_build_object('noreon.doctor.id',new.doctor_id,'noreon.message.seq',new.message_seq,'noreon.inbox.id',new.inbox_id));
 return null;
end$$;
create trigger conversation_trace_doctor_alert after insert on public.conversation_doctor_alerts
 for each row execute function public._trace_doctor_alert();

-- 2. Automatic (system) messages: acknowledgement, link confirmation, non-text reply ---

create function public._trace_system_message()returns trigger language plpgsql security definer set search_path=''as $$
declare st text;
begin
 if tg_op='INSERT'then
  perform public._conversation_trace(new.member_id,null,'system_message',new.id::text,'auto_ack','system_message.enqueued','queued',null,new.template_id,new.template_version::text,'system',null,
   jsonb_build_object('noreon.template.locale',new.locale,'noreon.template.approved',(select approved from public.system_message_templates where template_id=new.template_id and version=new.template_version and locale=new.locale),'noreon.endpoint.generation',new.endpoint_generation));
  return null;
 end if;
 if new.state is not distinct from old.state then return null;end if;
 st:=case new.state when 'accepted_by_provider'then 'sent'when 'definitely_failed'then 'failed'else new.state end;
 perform public._conversation_trace(new.member_id,null,'system_message',new.id::text,case when new.state in('accepted_by_provider','definitely_failed','unknown')then 'provider'else 'auto_ack'end,
  'system_message.'||new.state,st,new.reason,new.template_id,new.template_version::text,case when new.state in('accepted_by_provider','definitely_failed','unknown')then 'provider'else 'system'end,null,
  jsonb_build_object('messaging.system','telegram','noreon.state_seq',new.state_seq));
 return null;
end$$;
create trigger conversation_trace_system_message after insert or update of state on public.system_messages
 for each row execute function public._trace_system_message();

-- 3. Doctor drafts, revisions and exact-text approvals ---------------------------------

create function public._trace_draft()returns trigger language plpgsql security definer set search_path=''as $$
declare m uuid;
begin
 select member_id into m from public.conversations where id=new.conversation_id;
 if tg_op='INSERT'then
  perform public._conversation_trace(m,new.conversation_id,'conversation_draft',new.id::text,'draft','draft.created','recorded',new.state,null,null,public._conversation_trace_actor(),auth.uid(),
   jsonb_build_object('noreon.context.version',new.context_version,'noreon.clinical.revision',new.clinical_revision));
 elsif new.state is distinct from old.state then
  perform public._conversation_trace(m,new.conversation_id,'conversation_draft',new.id::text,'draft','draft.'||new.state,
   case new.state when 'approved'then 'allow'when 'rejected'then 'block'when 'superseded'then 'superseded'else 'recorded'end,
   case when new.state='superseded'then 'newer_context'else new.state end,null,null,public._conversation_trace_actor(),auth.uid(),
   jsonb_build_object('noreon.draft.revision',new.revision));
 end if;
 return null;
end$$;
create trigger conversation_trace_draft after insert or update of state on public.conversation_drafts
 for each row execute function public._trace_draft();

create function public._trace_revision()returns trigger language plpgsql security definer set search_path=''as $$
declare c uuid;m uuid;engine boolean:=new.author_kind='ai_assistant';
begin
 select d.conversation_id,cv.member_id into c,m from public.conversation_drafts d join public.conversations cv on cv.id=d.conversation_id where d.id=new.draft_id;
 -- An engine draft (today the synthetic or clinical draft engine, not Zoe) is journaled as the
 -- system with its provenance; the doctor who asked for it is kept separately.
 perform public._conversation_trace(m,c,'conversation_draft',new.draft_id::text,'draft','draft.revision_written','recorded',
  case when engine then 'engine_draft'else 'staff_draft'end,case when engine then 'draft_engine.'||coalesce(new.provenance->>'kind','unknown')end,new.provenance->>'version',
  case when engine then 'system'else public._conversation_trace_actor()end,case when engine then null else new.author_id end,
  jsonb_build_object('noreon.draft.revision',new.revision,'noreon.draft.requested_by',case when engine then new.author_id end));
 return null;
end$$;
create trigger conversation_trace_revision after insert on public.conversation_revisions
 for each row execute function public._trace_revision();

create function public._trace_approval()returns trigger language plpgsql security definer set search_path=''as $$
declare c uuid;m uuid;
begin
 select d.conversation_id,cv.member_id into c,m from public.conversation_drafts d join public.conversations cv on cv.id=d.conversation_id where d.id=new.draft_id;
 perform public._conversation_trace(m,c,'conversation_approval',new.id::text,'approval','approval.recorded','allow','exact_text_approved','conversation.exact_approval',null,'doctor',new.doctor_id,
  jsonb_build_object('noreon.draft.id',new.draft_id,'noreon.draft.revision',new.revision,'noreon.context.version',new.context_version,
   'noreon.grant.generation',new.grant_generation,'noreon.clinic.id',new.clinic_id));
 return null;
end$$;
create trigger conversation_trace_approval after insert on public.conversation_approvals
 for each row execute function public._trace_approval();

-- 4. Doctor-reply deliveries and provider receipts -------------------------------------

create function public._trace_delivery()returns trigger language plpgsql security definer set search_path=''as $$
declare m uuid;terminal boolean:=new.state in('accepted_by_provider','definitely_failed','unknown');
begin
 if tg_op='UPDATE'and new.state is not distinct from old.state and new.reason is not distinct from old.reason then return null;end if;
 select member_id into m from public.conversations where id=new.conversation_id;
 perform public._conversation_trace(m,new.conversation_id,'conversation_delivery',new.id::text,case when terminal then 'provider'else 'delivery'end,'delivery.'||new.state,
  case new.state when 'accepted_by_provider'then 'sent'when 'definitely_failed'then 'failed'else new.state end,new.reason,
  case when new.state='held'then 'conversation.delivery_guard'end,coalesce(new.policy_version,(select version from public.conversation_policy where singleton)),
  case when terminal then 'provider'else 'system'end,null,
  jsonb_build_object('messaging.system','telegram','noreon.approval.id',new.approval_id,'noreon.state_seq',new.state_seq,'noreon.endpoint.generation',new.endpoint_generation,'noreon.review_after_send',new.review_after_send));
 return null;
end$$;
create trigger conversation_trace_delivery after insert or update of state,reason on public.conversation_deliveries
 for each row execute function public._trace_delivery();

-- The send attempt itself (claim) for doctor replies; system-message claims show as state 'sending'.
create function public._trace_attempt()returns trigger language plpgsql security definer set search_path=''as $$
declare c uuid;m uuid;
begin
 select d.conversation_id,cv.member_id into c,m from public.conversation_deliveries d join public.conversations cv on cv.id=d.conversation_id where d.id=new.delivery_id;
 perform public._conversation_trace(m,c,'conversation_attempt',new.id::text,'delivery','send.attempt','sending',null,'conversation.claim',null,'system',null,
  jsonb_build_object('messaging.system','telegram','messaging.operation.type','send','noreon.delivery.id',new.delivery_id,'noreon.state_seq',new.state_seq));
 return null;
end$$;
create trigger conversation_trace_attempt after insert on public.conversation_attempts
 for each row execute function public._trace_attempt();

-- What the transport reported, as soon as it is retained (before any outcome projection).
create function public._trace_observation()returns trigger language plpgsql security definer set search_path=''as $$
declare c uuid;m uuid;k text:=new.outcome->>'kind';
begin
 if new.channel='conversation'then
  select d.conversation_id,cv.member_id into c,m from public.conversation_attempts a join public.conversation_deliveries d on d.id=a.delivery_id join public.conversations cv on cv.id=d.conversation_id where a.id=new.attempt_id;
 else
  select sm.member_id into m from public.system_message_attempts a join public.system_messages sm on sm.id=a.message_id where a.id=new.attempt_id;
 end if;
 perform public._conversation_trace(m,c,'delivery_observation',new.attempt_id::text,'provider','provider.receipt',
  case k when 'accepted'then 'sent'when 'definitely_failed'then 'failed'else 'unknown'end,
  -- Provider evidence and reasons are short codes from our transport; refs are kept as identifiers.
  case k when 'accepted'then 'accepted'when 'definitely_failed'then new.outcome->>'evidence'else new.outcome->>'reason'end,
  'telegram.send_message',null,'provider',null,
  jsonb_build_object('messaging.system','telegram','noreon.delivery.channel',new.channel,-- The provider reference is [adapter, account, bot, chat, message]; the chat id is the member's
  -- Telegram user id, so only the trailing message id is kept.
  'messaging.message.id',case when k='accepted'then substring(new.outcome->>'providerRef' from ',\s*(\d{1,20})\s*\]\s*$')end));
 return null;
end$$;
create trigger conversation_trace_observation after insert on public.delivery_observations
 for each row execute function public._trace_observation();

-- 5. Linking and unlinking ---------------------------------------------------------------

create function public._trace_endpoint()returns trigger language plpgsql security definer set search_path=''as $$
begin
 if tg_op='UPDATE'and new.active is not distinct from old.active and new.generation is not distinct from old.generation then return null;end if;
 perform public._conversation_trace(new.member_id,null,'conversation_endpoint',new.id::text,'link',case when new.active then 'link.active'else 'link.inactive'end,
  case when new.active then 'allow'else 'block'end,case when new.active then 'linked'else 'unlinked_or_revoked'end,'telegram.endpoint',new.policy_version,
  public._conversation_trace_actor(),auth.uid(),jsonb_build_object('messaging.system',new.adapter,'noreon.endpoint.generation',new.generation));
 return null;
end$$;
create trigger conversation_trace_endpoint after insert or update of active,generation on public.conversation_endpoints
 for each row execute function public._trace_endpoint();

-- Link requests that never became an endpoint (issued, refused, unlinked counts).
create function public._trace_telegram_audit()returns trigger language plpgsql security definer set search_path=''as $$
begin
 if new.kind not like 'link.%'then return null;end if;
 perform public._conversation_trace(new.member_id,null,'telegram_audit',new.id::text,'link',new.kind,
  case new.kind when 'link.refused'then 'block'when 'link.unlinked'then 'recorded'else 'recorded'end,new.detail->>'reason','telegram.link',new.detail->>'consentVersion',
  public._conversation_trace_actor(),auth.uid(),jsonb_build_object('messaging.system','telegram'));
 return null;
end$$;
create trigger conversation_trace_telegram_audit after insert on public.telegram_audit
 for each row execute function public._trace_telegram_audit();

-- Member Telegram bindings (T-auth): created, re-proven and revoked, with the revocation reason.
create function public._trace_telegram_auth_audit()returns trigger language plpgsql security definer set search_path=''as $$
begin
 if new.kind not like 'binding.%'or not exists(select 1 from public.patient_clinical_cases where user_id=new.auth_user_id)then return null;end if;
 perform public._conversation_trace(new.auth_user_id,null,'telegram_binding',new.detail->>'bindingId','link',new.kind,
  case new.kind when 'binding.revoked'then 'block'else 'allow'end,coalesce(new.detail->>'reason',case when new.detail->>'replaced'='true'then 'replaced_earlier_binding'end),
  'telegram.binding',null,public._conversation_trace_actor(),auth.uid(),jsonb_build_object('messaging.system','telegram','noreon.binding.generation',new.detail->>'generation'));
 return null;
end$$;
create trigger conversation_trace_telegram_auth_audit after insert on public.telegram_auth_audit
 for each row execute function public._trace_telegram_auth_audit();

-- 6. Admin read ---------------------------------------------------------------------------

-- Recent conversations with trace events. Admins already see member names and delivery
-- states on the delivery-problems page; this adds no message text.
create function public.conversation_trace_members(p_limit integer default 50)returns jsonb
language plpgsql security definer set search_path=''as $$
begin
 perform public._real_staff_require_admin();
 return jsonb_build_object('ok',true,'asOf',statement_timestamp(),'members',coalesce((select jsonb_agg(x order by x->>'lastAt' desc)from(
  select jsonb_build_object('memberId',t.member_id,'memberName',coalesce(pr.display_name,''),'lastAt',max(t.occurred_at),'events',count(*),
   'blocked',count(*)filter(where t.outcome in('block','held','failed','unknown')))x
  from public.conversation_trace_events t left join public.profiles pr on pr.id=t.member_id
  where t.member_id is not null and t.occurred_at>clock_timestamp()-interval '30 days'
  group by t.member_id,pr.display_name order by max(t.occurred_at)desc limit greatest(1,least(coalesce(p_limit,50),200)))s),'[]'));
end$$;

create function public.conversation_trace(p_member uuid,p_before bigint default null)returns jsonb
language plpgsql security definer set search_path=''as $$
declare rows jsonb;
begin
 perform public._real_staff_require_admin();
 select coalesce(jsonb_agg(jsonb_build_object('id',t.id,'at',t.occurred_at,'step',t.step,'name',t.name,'outcome',t.outcome,'reason',t.reason_code,
   'rule',t.rule_id,'ruleVersion',t.rule_version,'actorKind',t.actor_kind,'actorName',coalesce(ws.display_name,case when t.actor_id=t.member_id then pr.display_name end),
   'subjectKind',t.subject_kind,'subjectId',t.subject_id,'attributes',t.attributes)order by t.id),'[]')into rows
 from(select * from public.conversation_trace_events where member_id=p_member and(p_before is null or id<p_before)order by id desc limit 300)t
 left join public.workspace_staff ws on ws.user_id=t.actor_id left join public.profiles pr on pr.id=t.member_id;
 return jsonb_build_object('ok',true,'asOf',statement_timestamp(),'memberId',p_member,
  'memberName',coalesce((select display_name from public.profiles where id=p_member),''),
  'conversationId',(select id from public.conversations where member_id=p_member),'events',rows);
end$$;

-- 7. RLS and grants ----------------------------------------------------------------------

alter table public.conversation_trace_events enable row level security;
revoke all on public.conversation_trace_events from public,anon,authenticated,service_role;
revoke all on sequence public.conversation_trace_events_id_seq from public,anon,authenticated,service_role;
revoke all on function public._conversation_trace(uuid,uuid,text,text,text,text,text,text,text,text,text,uuid,jsonb),public._conversation_trace_actor(),
 public._conversation_trace_immutable(),public._trace_channel_inbox(),public._trace_conversation_message(),public._trace_doctor_alert(),public._trace_system_message(),
 public._trace_draft(),public._trace_revision(),public._trace_approval(),public._trace_delivery(),public._trace_attempt(),public._trace_observation(),
 public._trace_endpoint(),public._trace_telegram_audit(),public._trace_telegram_auth_audit(),public._conversation_trace_code(text),public.conversation_trace_members(integer),public.conversation_trace(uuid,bigint)
 from public,anon,authenticated,service_role;
grant execute on function public.conversation_trace_members(integer),public.conversation_trace(uuid,bigint)to authenticated;
