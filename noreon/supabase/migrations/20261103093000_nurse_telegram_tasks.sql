-- Nurse Telegram tasks only. Both switches and every renderer approval default off.
-- The service never supplies an actor, task command, reply target or member identity.
-- Those are derived from the committed inbox and the exact durable question.
create table public.telegram_nurse_settings(singleton boolean primary key default true check(singleton),enabled boolean not null default false);
insert into public.telegram_nurse_settings(singleton)values(true);

alter table public.channel_inbox
 add column nurse_binding_id uuid references public.telegram_auth_bindings(id),
 add column nurse_binding_generation bigint,
 add column nurse_at_commit boolean not null default false,
 add column nurse_context jsonb,
 add column nurse_result jsonb,
 add constraint channel_inbox_nurse_capture check(not nurse_at_commit or(nurse_binding_id is not null and nurse_binding_generation>0));

-- Capture even a revoked nurse binding. An old event may never acquire a new identity.
-- Existing contact/link proof and member endpoint capture remain unchanged.
create function public._telegram_nurse_capture()returns trigger language plpgsql security definer set search_path=''as $$
declare b public.telegram_auth_bindings;
begin
 select x.* into b from public.telegram_auth_bindings x where x.principal_ref=new.principal_ref
 order by x.active desc,x.generation desc,x.id desc limit 1 for share;
 if found and b.kind='staff'and exists(select 1 from public.workspace_staff where user_id=b.auth_user_id and role='nurse')then new.nurse_binding_id:=b.id;new.nurse_binding_generation:=b.generation;new.nurse_at_commit:=true;end if;
 return new;
end$$;
create trigger telegram_nurse_capture before insert on public.channel_inbox for each row execute function public._telegram_nurse_capture();

create or replace function public.channel_inbox_commit(p_event jsonb)returns jsonb
language plpgsql security definer set search_path=''as $$
declare s public.telegram_channel_settings;kind text:=p_event->>'kind';ep public.conversation_endpoints;existing public.channel_inbox;inserted uuid;payload jsonb:=p_event->'payload';
begin
 if auth.role()is distinct from 'service_role'then raise insufficient_privilege;end if;
 if jsonb_typeof(p_event)is distinct from 'object'or p_event-array['adapter','eventId','fingerprint','principalRef','kind','payload']<>'{}'
 or not(p_event?&array['adapter','eventId','fingerprint','principalRef','kind','payload'])
 or p_event->>'adapter'is distinct from 'telegram'or coalesce(kind,'')not in('text','link','start','callback','media','contact','redo')
 or jsonb_typeof(p_event->'eventId')is distinct from 'string'or jsonb_typeof(p_event->'fingerprint')is distinct from 'string'or jsonb_typeof(p_event->'principalRef')is distinct from 'string'
 or length(p_event->>'eventId')not between 1 and 256 or length(p_event->>'fingerprint')not between 1 and 256 or length(p_event->>'principalRef')not between 1 and 256
 or jsonb_typeof(payload)is distinct from 'object'
 or(kind='text'and(payload-array['text','chatId','messageId','replyToMessageId']<>'{}'or jsonb_typeof(payload->'text')is distinct from 'string'or public._conversation_utf16(payload->>'text')not between 1 and 4096))
 or(kind='link'and(payload-array['tokenHash','chatId','messageId']<>'{}'or coalesce(payload->>'tokenHash','')!~'^[a-f0-9]{64}$'))
 or(kind='contact'and(jsonb_typeof(payload->'sentAt')is distinct from 'number'or not(
  (payload-array['phone','sentAt','chatId','messageId']='{}'and coalesce(payload->>'phone','')~'^\+[1-9][0-9]{6,14}$')
  or(payload-array['foreign','sentAt','chatId','messageId']='{}'and payload->'foreign'='true'::jsonb))))
 or(kind in('start','media','redo')and payload-array['chatId','messageId']<>'{}')
 or(kind='callback'and(payload-array['chatId','messageId','callbackId','intentRef']<>'{}'
  or jsonb_typeof(payload->'callbackId')is distinct from 'string'or coalesce(payload->>'callbackId','')!~'^[A-Za-z0-9_-]{1,128}$'
  or jsonb_typeof(payload->'intentRef')is distinct from 'string'or coalesce(payload->>'intentRef','')!~'^[A-Za-z0-9_-]{16,60}$'))
 or(payload?'replyToMessageId'and(jsonb_typeof(payload->'replyToMessageId')is distinct from 'number'or coalesce(payload->>'replyToMessageId','')!~'^[1-9][0-9]{0,15}$'))
 or jsonb_typeof(payload->'chatId')is distinct from 'number'or jsonb_typeof(payload->'messageId')is distinct from 'number'
 then return jsonb_build_object('status','failed','code','invalid_event');end if;
 select * into s from public.telegram_channel_settings where singleton;
 if not found then return jsonb_build_object('status','failed','code','unavailable');end if;
 if p_event->>'principalRef'<>public._telegram_principal_ref(s,(payload->>'chatId')::bigint)then return jsonb_build_object('status','failed','code','foreign_principal');end if;
 select * into ep from public.conversation_endpoints where adapter='telegram'and account_ref=public._telegram_account_ref(s)and principal_ref=p_event->>'principalRef'and active;
 insert into public.channel_inbox(adapter,event_id,fingerprint,principal_ref,kind,payload,endpoint_id,endpoint_generation)
 values('telegram',p_event->>'eventId',p_event->>'fingerprint',p_event->>'principalRef',kind,payload,ep.id,ep.generation)
 on conflict(event_id)do nothing returning id into inserted;
 if inserted is not null then
  return jsonb_build_object('status','committed','eventId',p_event->>'eventId','fingerprint',p_event->>'fingerprint');end if;
 select * into existing from public.channel_inbox where event_id=p_event->>'eventId';
 if existing.fingerprint=p_event->>'fingerprint'then
  return jsonb_build_object('status','committed-duplicate','eventId',existing.event_id,'fingerprint',existing.fingerprint);end if;
 perform public._telegram_audit(null,'inbox.conflict',jsonb_build_object('inboxId',existing.id));
 return jsonb_build_object('status','conflict');
exception when numeric_value_out_of_range or invalid_text_representation then return jsonb_build_object('status','failed','code','invalid_event');
end$$;


create table public.telegram_nurse_dialogs(
 binding_id uuid not null references public.telegram_auth_bindings(id),generation bigint not null check(generation>0),
 question_version bigint not null default 0,question_key text not null default 'idle'check(question_key in('idle','today','task-note')),
 task_id uuid references public.patient_coordination_tasks(id),task_revision bigint,
 prompt_message_id text,expected_mode text not null default 'none'check(expected_mode in('none','callback','reply')),
 pending_inbox uuid references public.channel_inbox(id),expires_at timestamptz not null default clock_timestamp(),
 primary key(binding_id,generation)
);
create table public.telegram_nurse_outbox(
 id uuid primary key default gen_random_uuid(),sequence bigint generated always as identity unique,
 binding_id uuid not null,generation bigint not null,
 foreign key(binding_id,generation)references public.telegram_nurse_dialogs(binding_id,generation),
 source_inbox uuid not null references public.channel_inbox(id),ordinal integer not null,
 question_version bigint not null,member_ids uuid[] not null default '{}',
 turn jsonb not null check(jsonb_typeof(turn)='object'),locale text not null check(locale in('en','hy','ru')),
 template_id text not null,template_version integer not null default 1,
 foreign key(template_id,template_version,locale)references public.system_message_templates(template_id,version,locale),
 state text not null default 'queued'check(state in('queued','sending','accepted','failed','unknown','suppressed')),
 attempt_id uuid unique,claimed_at timestamptz,provider_ref text,outcome jsonb,abandoned boolean not null default false,
 created_at timestamptz not null default clock_timestamp(),unique(source_inbox,ordinal)
);
create index telegram_nurse_outbox_pending on public.telegram_nurse_outbox(sequence)where state in('queued','sending','unknown');
create table public.telegram_nurse_intents(
 ref_hash text primary key,binding_id uuid not null,generation bigint not null,question_version bigint not null,
 task_id uuid not null references public.patient_coordination_tasks(id),task_revision bigint not null,
 outbox_id uuid not null references public.telegram_nurse_outbox(id),carrier_message_id text,
 expires_at timestamptz not null,used_at timestamptz,
 foreign key(binding_id,generation)references public.telegram_nurse_dialogs(binding_id,generation)
);

alter table public.system_message_templates drop constraint system_message_templates_locale_check;
alter table public.system_message_templates add constraint system_message_templates_locale_check check(locale in('en','hy')or(locale='ru'and template_id like 'telegram.nurse.%'));

-- Approval identifies the actual renderer, its bounded substitution schema and
-- clinical copy version. It is not approval for an arbitrary-text template shell.
alter table public.system_message_templates add column renderer_version text,
 add column substitution_schema jsonb,add column clinical_copy_version text;
create function public._telegram_nurse_template_schema(p_kind text)returns jsonb language sql immutable set search_path=''as $$
 select case p_kind
 when 'today' then '{"kind":"today","tasks":{"maxItems":8,"id":"uuid","title":160,"memberName":{"max":160,"nullable":true},"dueAt":"instant","intentRef":"opaque-or-null"},"hasMore":"boolean"}'::jsonb
 when 'action' then '{"kind":"action","nurseName":160,"title":160}'::jsonb
 when 'task-note' then '{"kind":"task-note","title":160,"instructions":2000,"memberName":{"max":160,"nullable":true}}'::jsonb
 when 'task-saved' then '{"kind":"task-saved","next":{"nullable":true,"title":160,"memberName":{"max":160,"nullable":true}}}'::jsonb
 when 'clear-controls' then '{"kind":"clear-controls","messageId":"positive-integer"}'::jsonb
 when 'pending' then '{"kind":"pending"}'::jsonb
 when 'refused' then '{"kind":"refused"}'::jsonb
 when 'help' then '{"kind":"help"}'::jsonb
 when 'task-recovered' then '{"kind":"task-recovered"}'::jsonb
 when 'cancelled' then '{"kind":"cancelled"}'::jsonb
 when 'followup-unavailable' then '{"kind":"followup-unavailable"}'::jsonb end
$$;
insert into public.system_message_templates(template_id,version,locale,body,renderer_version,substitution_schema,clinical_copy_version)
 select 'telegram.nurse.'||replace(k,'-','_'),1,l,'UNAPPROVED nurse-tasks-v1 renderer / nurse-task-copy-v1 / '||k,
 'nurse-tasks-v1',public._telegram_nurse_template_schema(k),'nurse-task-copy-v1'
 from unnest(array['today','action','task-note','task-saved','pending','refused','help','cancelled','task-recovered','followup-unavailable','clear-controls'])k cross join unnest(array['en','hy','ru'])l;

create function public._telegram_nurse_on(p_enabled boolean)returns boolean language plpgsql security definer set search_path=''as $$
begin
 if p_enabled is distinct from true then return false;end if;
 -- The lock makes a committed switch-off authoritative before the next operation.
 perform 1 from public.telegram_nurse_settings where singleton and enabled for share;
 if not found then return false;end if;
 perform 1 from public.telegram_channel_settings where singleton for share;
 if not found then return false;end if;
 perform 1 from public.conversation_policy where singleton and delivery_enabled for share;
 return found;
end$$;
create function public._telegram_nurse_inbox_authority(r public.channel_inbox)returns public.workspace_staff
language plpgsql security definer set search_path=''as $$
declare b public.telegram_auth_bindings;s public.telegram_channel_settings;actor public.workspace_staff;
begin
 if not r.nurse_at_commit then raise insufficient_privilege;end if;
 actor:=public._telegram_nurse_authority(r.nurse_binding_id,r.nurse_binding_generation);
 select * into b from public.telegram_auth_bindings where id=r.nurse_binding_id;
 select * into s from public.telegram_channel_settings where singleton;
 if b.principal_ref is distinct from r.principal_ref or b.account_ref is distinct from public._telegram_account_ref(s)
  or b.address is distinct from r.payload->>'chatId'then raise insufficient_privilege;end if;
 return actor;
end$$;

create function public._telegram_nurse_slot(p_text text,p_limit integer,p_line boolean default true)returns text
language plpgsql immutable set search_path=''as $$
declare value text:=regexp_replace(p_text,U&'[\0001-\0008\000B\000C\000E-\001F\007F]','','g');
begin
 if p_line then value:=regexp_replace(value,E'[\r\n]+',' ','g');end if;
 value:=left(value,p_limit);
 while public._conversation_utf16(value)>p_limit loop value:=left(value,length(value)-1);end loop;
 return nullif(btrim(value),'');
end$$;

create function public._telegram_nurse_enqueue(r public.channel_inbox,p_question bigint,p_turn jsonb,p_members uuid[] default '{}')returns uuid
language plpgsql security definer set search_path=''as $$
declare oid uuid;ord integer;k text:=p_turn->>'kind';loc text;actor public.workspace_staff;
begin
 if public._telegram_nurse_template_schema(k)is null then raise check_violation using message='Unknown nurse renderer';end if;
 actor:=public._telegram_nurse_inbox_authority(r);
 select case when locale in('en','hy','ru')then locale else 'hy'end into loc from public.profiles where id=actor.user_id;
 loc:=coalesce(loc,'hy');
 select coalesce(max(ordinal),0)+1 into ord from public.telegram_nurse_outbox where source_inbox=r.id;
 insert into public.telegram_nurse_outbox(binding_id,generation,source_inbox,ordinal,question_version,member_ids,turn,locale,template_id)
 values(r.nurse_binding_id,r.nurse_binding_generation,r.id,ord,p_question,p_members,p_turn,loc,'telegram.nurse.'||replace(k,'-','_'))returning id into oid;
 return oid;
end$$;
create function public._telegram_nurse_intent_arm(p_outbox uuid,p_task uuid,p_revision bigint)returns text
language plpgsql security definer set search_path=''as $$
declare o public.telegram_nurse_outbox;ref text:=replace(gen_random_uuid()::text,'-','');
begin
 select * into o from public.telegram_nurse_outbox where id=p_outbox;
 insert into public.telegram_nurse_intents(ref_hash,binding_id,generation,question_version,task_id,task_revision,outbox_id,expires_at)
 values(encode(sha256(convert_to(ref,'UTF8')),'hex'),o.binding_id,o.generation,o.question_version,p_task,p_revision,o.id,clock_timestamp()+interval '30 minutes');
 return ref;
end$$;

-- Receive pins the exact command before the potentially uncertain business call.
-- A new lease can replay that command, never reinterpret the original answer.
create function public.telegram_nurse_receive(p_id uuid,p_enabled boolean)returns jsonb
language plpgsql security definer set search_path=''as $$
declare r public.channel_inbox;d public.telegram_nurse_dialogs;s public.workspace_staff;i public.telegram_nurse_intents;t jsonb;ctx jsonb;words text;previous_context jsonb;
begin
 if auth.role()is distinct from 'service_role'then raise insufficient_privilege;end if;
 select * into r from public.channel_inbox where id=p_id for update;
 if not found or not r.nurse_at_commit then return jsonb_build_object('handled',false);end if;
 if r.status not in('processing','done')or(r.status='processing'and(r.lease_until is null or r.lease_until<=clock_timestamp()))then return jsonb_build_object('handled',true,'inboxId',p_id,'leaseAttempt',coalesce(r.attempts,0),'status','not_leased');end if;
 begin s:=public._telegram_nurse_inbox_authority(r);
 exception when insufficient_privilege then
  update public.telegram_nurse_dialogs set pending_inbox=null,question_version=question_version+1,question_key='idle',expected_mode='none',task_id=null,task_revision=null,prompt_message_id=null,expires_at=clock_timestamp()where pending_inbox=r.id;
  perform public._channel_inbox_finish(r.id,'done','nurse_access');return jsonb_build_object('handled',true,'inboxId',p_id,'leaseAttempt',coalesce(r.attempts,0),'status','refused');end;
 if r.kind in('link','contact','rejected')or not public._telegram_nurse_on(p_enabled)then return jsonb_build_object('handled',false);end if;
 perform pg_advisory_xact_lock(hashtextextended('telegram-nurse:'||r.nurse_binding_id::text,0));
 insert into public.telegram_nurse_dialogs(binding_id,generation)values(r.nurse_binding_id,r.nurse_binding_generation)on conflict do nothing;
 select * into d from public.telegram_nurse_dialogs where binding_id=r.nurse_binding_id and generation=r.nurse_binding_generation for update;
 if r.status='done'then return jsonb_build_object('handled',true,'inboxId',p_id,'status','done','leaseAttempt',r.attempts);end if;
 if r.nurse_context is not null then return jsonb_build_object('handled',true,'inboxId',p_id,'status','ready','leaseAttempt',r.attempts);end if;
 words:=case when r.kind='text'then btrim(r.payload->>'text')end;
 ctx:=jsonb_build_object('action','refused','questionVersion',d.question_version);
 if d.pending_inbox is not null and d.pending_inbox<>r.id then
  if words='/resume'and not(r.payload?'replyToMessageId')then
   select nurse_context into previous_context from public.channel_inbox where id=d.pending_inbox;
   -- Recovery copies the already persisted command and request ID verbatim.
   -- It cannot turn a second typed answer into a new completion.
   ctx:=coalesce(previous_context,jsonb_build_object('action','pending','questionVersion',d.question_version))||jsonb_build_object('recover',true);
  else ctx:=jsonb_build_object('action','pending','questionVersion',d.question_version);end if;
 elsif r.kind='text'and words='/resume'and not(r.payload?'replyToMessageId')then
  ctx:=jsonb_build_object('action',case when d.expected_mode='reply'then 'refresh'else 'today'end,'questionVersion',d.question_version,'recover',true);
 elsif r.kind='callback'then
  select * into i from public.telegram_nurse_intents where ref_hash=encode(sha256(convert_to(r.payload->>'intentRef','UTF8')),'hex')for update;
  if found and i.binding_id=r.nurse_binding_id and i.generation=r.nurse_binding_generation and i.question_version=d.question_version
   and i.expires_at>clock_timestamp()and d.expires_at>clock_timestamp()and i.used_at is null and d.expected_mode='callback'
   and i.carrier_message_id is not null and i.carrier_message_id=r.payload->>'messageId'then
   t:=public._patient_coordination_snapshot_as(s.user_id,r.nurse_binding_id,r.nurse_binding_generation,i.task_id);
   if(t->>'revision')::bigint=i.task_revision and t->>'status'in('open','awaiting-member')and t->>'kind'<>'doctor-referral'and t->>'needsReassignment'='false'then
    ctx:=jsonb_build_object('action','select','taskId',i.task_id,'revision',i.task_revision,'questionVersion',d.question_version,'intentHash',i.ref_hash,'carrierMessageId',i.carrier_message_id);
   end if;
  end if;
 elsif r.kind='text'then
  words:=btrim(r.payload->>'text');
  if d.expected_mode='reply'and d.expires_at>clock_timestamp()and d.prompt_message_id is not null and d.prompt_message_id=r.payload->>'replyToMessageId'then
   if words='/cancel'then ctx:=jsonb_build_object('action','cancel','questionVersion',d.question_version);
   elsif length(words)between 1 and 2000 and public._conversation_utf16(words)<=2000 then
    ctx:=jsonb_build_object('action','complete','questionVersion',d.question_version,'command',jsonb_build_object('taskId',d.task_id,'revision',d.task_revision,
     'caseId',(select patient_case_id from public.patient_coordination_tasks where id=d.task_id),'requestId',gen_random_uuid(),'operation','complete','input',jsonb_build_object('note',words)));
   end if;
  elsif r.payload->'replyToMessageId'is null and(d.expected_mode<>'reply'or d.expires_at<=clock_timestamp())then
   ctx:=jsonb_build_object('action','today','questionVersion',d.question_version);
  end if;
 elsif r.kind='start'and(d.expected_mode<>'reply'or d.expires_at<=clock_timestamp())then
  ctx:=jsonb_build_object('action','today','questionVersion',d.question_version);
 end if;
 update public.channel_inbox set nurse_context=ctx where id=r.id;
 if ctx->>'action'not in('refused','pending')then
  update public.telegram_nurse_dialogs set pending_inbox=r.id where binding_id=d.binding_id and generation=d.generation;
 end if;
 return jsonb_build_object('handled',true,'status','ready','leaseAttempt',r.attempts,'inboxId',r.id,'callbackId',r.payload->>'callbackId','messageId',r.payload->>'messageId');
exception when insufficient_privilege then
 perform public._channel_inbox_finish(p_id,'done','nurse_access');return jsonb_build_object('handled',true,'inboxId',p_id,'leaseAttempt',coalesce(r.attempts,0),'status','refused');
end$$;

create function public.telegram_nurse_apply(p_id uuid,p_enabled boolean,p_attempt integer)returns jsonb
language plpgsql security definer set search_path=''as $$
#variable_conflict use_variable
declare r public.channel_inbox;d public.telegram_nurse_dialogs;s public.workspace_staff;ctx jsonb;cmd jsonb;t jsonb;page jsonb;row_ jsonb;
 rows_ jsonb:='[]';members uuid[]:='{}';oid uuid;ref text;result jsonb;next_ jsonb;next_member uuid;refresh_ok boolean:=true;recovery_cmd jsonb;v bigint;action text;count_ integer:=0;has_more boolean;rec public.patient_coordination_receipts;
begin
 if auth.role()is distinct from 'service_role'then raise insufficient_privilege;end if;
 if not public._telegram_nurse_on(p_enabled)then return jsonb_build_object('ok',false,'status','disabled');end if;
 select * into r from public.channel_inbox where id=p_id for update;
 if not found or not r.nurse_at_commit or p_attempt is distinct from r.attempts or r.status not in('processing','done')
  or(r.status='processing'and(r.lease_until is null or r.lease_until<=clock_timestamp()))then return jsonb_build_object('ok',false,'status','not_leased');end if;
 s:=public._telegram_nurse_inbox_authority(r);
 ctx:=r.nurse_context;cmd:=ctx->'command';action:=ctx->>'action';
 if cmd is not null and not public._telegram_nurse_case_access(s.user_id,r.nurse_binding_id,r.nurse_binding_generation,(cmd->>'caseId')::uuid)then raise insufficient_privilege;end if;
 if r.status='done'then return coalesce(r.nurse_result,jsonb_build_object('ok',true,'status','done'));end if;
 if ctx is null then return jsonb_build_object('ok',false,'status','not_received');end if;
 perform pg_advisory_xact_lock(hashtextextended('telegram-nurse:'||r.nurse_binding_id::text,0));
 select * into d from public.telegram_nurse_dialogs where binding_id=r.nurse_binding_id and generation=r.nurse_binding_generation for update;
 v:=d.question_version;
 if action not in('refused','pending')and(d.pending_inbox is distinct from r.id or(ctx->>'questionVersion')::bigint<>d.question_version)then
  -- A newer recovery owns this dialog. Finish only the displaced inbox; never
  -- erase the newer pin, increment its question, or enqueue a misleading refusal.
  result:=jsonb_build_object('ok',true,'status','refused');
  update public.channel_inbox set nurse_result=result where id=r.id;
  perform public._channel_inbox_finish(r.id,'done','nurse_displaced');return result;
 end if;
 if ctx->>'recover'='true'then
  select previous.nurse_context->'command'into recovery_cmd from public.telegram_nurse_outbox uncertain
   join public.channel_inbox previous on previous.id=uncertain.source_inbox
   where uncertain.binding_id=d.binding_id and uncertain.generation=d.generation and not uncertain.abandoned
    and uncertain.state in('sending','unknown')and previous.nurse_result->>'status'='saved'
   order by uncertain.sequence desc limit 1;
  if recovery_cmd is not null and exists(select 1 from public.patient_coordination_receipts where request_id=(recovery_cmd->>'requestId')::uuid)then
   -- The shared replay rechecks current nurse/case authority before explaining
   -- the known result. No new ID, command, or business effect is created.
   begin
    perform public._patient_coordination_command_as(s.user_id,r.nurse_binding_id,r.nurse_binding_generation,(recovery_cmd->>'caseId')::uuid,(recovery_cmd->>'taskId')::uuid,
     (recovery_cmd->>'revision')::bigint,(recovery_cmd->>'requestId')::uuid,'complete',recovery_cmd->'input');
   exception when insufficient_privilege then recovery_cmd:=null;end;
  else recovery_cmd:=null;end if;
  -- Explicit resume creates new current output. The uncertain item is retained
  -- as unknown forever; its old unsent dependents cannot escape afterward.
  update public.telegram_nurse_outbox set abandoned=true where binding_id=d.binding_id and generation=d.generation and state in('sending','unknown');
  update public.telegram_nurse_outbox set state='suppressed'where binding_id=d.binding_id and generation=d.generation and state='queued';
  if recovery_cmd is not null then perform public._telegram_nurse_enqueue(r,v,jsonb_build_object('kind','task-recovered'),array[(recovery_cmd->>'caseId')::uuid]);end if;
 end if;
 if action='refresh'then
  begin t:=public._patient_coordination_snapshot_as(s.user_id,r.nurse_binding_id,r.nurse_binding_generation,d.task_id);
  exception when insufficient_privilege then action:='refused';end;
  if action='refused'or t->>'status'not in('open','awaiting-member')or t->>'kind'='doctor-referral'or t->>'needsReassignment'<>'false'then action:='refused';
  else
   v:=v+1;
   update public.telegram_nurse_dialogs set question_version=v,task_revision=(t->>'revision')::bigint,prompt_message_id=null,pending_inbox=null,expires_at=clock_timestamp()+interval '30 minutes'
    where binding_id=d.binding_id and generation=d.generation;
   perform public._telegram_nurse_enqueue(r,v,jsonb_build_object('kind','task-note','title',public._telegram_nurse_slot(t->>'title',160),'instructions',public._telegram_nurse_slot(t->>'instructions',2000,false),'memberName',public._telegram_nurse_slot(t->>'memberName',160)),array[(t->>'caseId')::uuid]);
  end if;
 elsif action='complete'then
  -- The command and its request ID survive all unknown outcomes. Current authority
  -- is checked above and again by the shared body even for an existing receipt.
  begin
   result:=public._patient_coordination_command_as(s.user_id,r.nurse_binding_id,r.nurse_binding_generation,(cmd->>'caseId')::uuid,(cmd->>'taskId')::uuid,
    (cmd->>'revision')::bigint,(cmd->>'requestId')::uuid,'complete',cmd->'input');
  exception when serialization_failure or check_violation then action:='refused';end;
  if action='complete'then
   v:=v+1;
   update public.telegram_nurse_dialogs set question_version=v,question_key='idle',expected_mode='none',task_id=null,task_revision=null,prompt_message_id=null,pending_inbox=null,expires_at=clock_timestamp()
    where binding_id=d.binding_id and generation=d.generation;
   -- Refresh is a subtransaction: failure cannot undo the known saved command.
   begin
    page:=public._patient_coordination_queue_as(s.user_id,r.nurse_binding_id,r.nurse_binding_generation,null,'active',null,null,50);
    select jsonb_build_object('title',public._telegram_nurse_slot(x->>'title',160),'memberName',public._telegram_nurse_slot(x->>'memberName',160)),(x->>'caseId')::uuid into next_,next_member
     from jsonb_array_elements(page->'tasks')x where x->>'dueAt'is not null and((x->>'dueAt')::timestamptz at time zone 'Asia/Yerevan')::date<=(clock_timestamp()at time zone 'Asia/Yerevan')::date
     order by(x->>'dueAt')::timestamptz,x->>'id'limit 1;
   exception when others then next_:=null;refresh_ok:=false;end;
   perform public._telegram_nurse_enqueue(r,v,case when refresh_ok then jsonb_build_object('kind','task-saved','next',next_)else jsonb_build_object('kind','followup-unavailable')end,array_remove(array[(cmd->>'caseId')::uuid,next_member],null));
  end if;
 elsif action='select'then
  t:=public._patient_coordination_snapshot_as(s.user_id,r.nurse_binding_id,r.nurse_binding_generation,(ctx->>'taskId')::uuid);
  if(t->>'revision')::bigint<>(ctx->>'revision')::bigint or t->>'status'not in('open','awaiting-member')or t->>'kind'='doctor-referral'or t->>'needsReassignment'<>'false'then action:='refused';
  else
   v:=v+1;
   update public.telegram_nurse_intents set used_at=clock_timestamp()where ref_hash=ctx->>'intentHash';
   update public.telegram_nurse_dialogs set question_version=v,question_key='task-note',expected_mode='reply',task_id=(t->>'id')::uuid,task_revision=(t->>'revision')::bigint,
    prompt_message_id=null,pending_inbox=null,expires_at=clock_timestamp()+interval '30 minutes'where binding_id=d.binding_id and generation=d.generation;
   perform public._telegram_nurse_enqueue(r,v,jsonb_build_object('kind','clear-controls','messageId',(ctx->>'carrierMessageId')::bigint));
   perform public._telegram_nurse_enqueue(r,v,jsonb_build_object('kind','action','nurseName',public._telegram_nurse_slot(s.display_name,160),'title',public._telegram_nurse_slot(t->>'title',160)),array[(t->>'caseId')::uuid]);
   perform public._telegram_nurse_enqueue(r,v,jsonb_build_object('kind','task-note','title',public._telegram_nurse_slot(t->>'title',160),'instructions',public._telegram_nurse_slot(t->>'instructions',2000,false),'memberName',public._telegram_nurse_slot(t->>'memberName',160)),array[(t->>'caseId')::uuid]);
  end if;
 elsif action='today'then
  v:=v+1;
  update public.telegram_nurse_dialogs set question_version=v,question_key='today',expected_mode='callback',task_id=null,task_revision=null,prompt_message_id=null,pending_inbox=null,
   expires_at=clock_timestamp()+interval '30 minutes'where binding_id=d.binding_id and generation=d.generation;
  page:=public._patient_coordination_queue_as(s.user_id,r.nurse_binding_id,r.nurse_binding_generation,null,'active',null,null,50);
  has_more:=page->'nextCursor'<>'null'::jsonb;
  -- Same loaded page and Yerevan due rule as the web nurse Today view. Future and
  -- undated tasks remain absent; closed tasks are excluded by the shared queue.
  for t in select x from jsonb_array_elements(page->'tasks')x where x->>'dueAt'is not null
   and((x->>'dueAt')::timestamptz at time zone 'Asia/Yerevan')::date<=(clock_timestamp()at time zone 'Asia/Yerevan')::date
   order by(x->>'dueAt')::timestamptz,x->>'id'loop
   if count_=0 then oid:=public._telegram_nurse_enqueue(r,v,jsonb_build_object('kind','today','tasks','[]'::jsonb,'hasMore',false));end if;
   ref:=null;
   if t->>'status'in('open','awaiting-member')and t->>'kind'<>'doctor-referral'and t->>'needsReassignment'='false'then
    ref:=public._telegram_nurse_intent_arm(oid,(t->>'id')::uuid,(t->>'revision')::bigint);end if;
   rows_:=rows_||jsonb_build_array(jsonb_build_object('id',t->>'id','title',public._telegram_nurse_slot(t->>'title',160),'memberName',public._telegram_nurse_slot(t->>'memberName',160),'dueAt',t->'dueAt','intentRef',ref));
   members:=array_append(members,(t->>'caseId')::uuid);count_:=count_+1;
   perform public._access_audit_record_as(s.user_id,r.nurse_binding_id,r.nurse_binding_generation,(t->>'caseId')::uuid,'member_coordination',t->>'id');
   update public.telegram_nurse_outbox set turn=jsonb_build_object('kind','today','tasks',rows_,'hasMore',false),member_ids=members where id=oid;
   if count_=8 then rows_:='[]';members:='{}';count_:=0;end if;
  end loop;
  if oid is null then oid:=public._telegram_nurse_enqueue(r,v,jsonb_build_object('kind','today','tasks','[]'::jsonb,'hasMore',has_more));
  else update public.telegram_nurse_outbox set turn=jsonb_set(turn,'{hasMore}',to_jsonb(has_more))where id=oid;end if;
 elsif action in('cancel','help')then
  v:=v+1;
  update public.telegram_nurse_dialogs set question_version=v,question_key='idle',expected_mode='none',task_id=null,task_revision=null,prompt_message_id=null,pending_inbox=null,expires_at=clock_timestamp()
   where binding_id=d.binding_id and generation=d.generation;
  perform public._telegram_nurse_enqueue(r,v,jsonb_build_object('kind',case when action='cancel'then 'cancelled'else 'help'end));
 end if;
 if action='refused'and ctx->>'action'in('complete','select','refresh')then
  v:=v+1;
  update public.telegram_nurse_dialogs set question_version=v,question_key='idle',expected_mode='none',task_id=null,task_revision=null,prompt_message_id=null,pending_inbox=null,expires_at=clock_timestamp()
   where binding_id=d.binding_id and generation=d.generation;
 end if;
 if action in('refused','pending')then
  perform public._telegram_nurse_enqueue(r,v,jsonb_build_object('kind',action));
  update public.telegram_nurse_dialogs set pending_inbox=null where binding_id=d.binding_id and generation=d.generation and pending_inbox=r.id;
 end if;
 if action<>'pending'then
  update public.telegram_nurse_outbox set state='suppressed'where source_inbox=r.id and state='queued'and turn->>'kind'='pending';
 end if;
 update public.telegram_nurse_outbox set state='suppressed'where binding_id=d.binding_id and generation=d.generation and state='queued'
  and question_version<>v and turn->>'kind'in('today','task-note');
 result:=jsonb_build_object('ok',true,'status',case when action='complete'then 'saved'when action in('refused','pending')then action else 'queued'end);
 update public.channel_inbox set nurse_result=result where id=r.id;
 perform public._channel_inbox_finish(r.id,'done','nurse_'||action);
 return result;
exception when insufficient_privilege then
 update public.telegram_nurse_dialogs set pending_inbox=null,question_version=question_version+1,question_key='idle',expected_mode='none',task_id=null,task_revision=null,prompt_message_id=null,expires_at=clock_timestamp()where pending_inbox=p_id;
 perform public._channel_inbox_finish(p_id,'done','nurse_access');return jsonb_build_object('ok',false,'status','refused');
 when lock_not_available or query_canceled or deadlock_detected then
 if r.id is not null and r.nurse_context is not null and not exists(select 1 from public.telegram_nurse_outbox where source_inbox=r.id and turn->>'kind'='pending')then
  perform public._telegram_nurse_enqueue(r,coalesce(d.question_version,0),jsonb_build_object('kind','pending'));
 end if;
 return jsonb_build_object('ok',false,'status','pending');
end$$;

create function public.telegram_nurse_resume(p_id uuid,p_enabled boolean,p_attempt integer)returns jsonb
language plpgsql security definer set search_path=''as $$
begin
 if auth.role()is distinct from 'service_role'then raise insufficient_privilege;end if;
 return public.telegram_nurse_apply(p_id,p_enabled,p_attempt);
end$$;

-- A send claim is permission for one attempt, never a retry. Unknown delivery is
-- retained. Dependent turns wait until a new explicit resume abandons that chain.
create function public.telegram_nurse_outbox_queue(p_enabled boolean,p_limit integer default 20)returns jsonb
language plpgsql security definer set search_path=''as $$
declare ids jsonb;
begin
 if auth.role()is distinct from 'service_role'then raise insufficient_privilege;end if;
 if not public._telegram_nurse_on(p_enabled)then return jsonb_build_object('ids','[]'::jsonb);end if;
 if p_limit is null or p_limit not between 1 and 100 then return jsonb_build_object('ids','[]'::jsonb);end if;
 select coalesce(jsonb_agg(id order by sequence),'[]')into ids from(select o.id,o.sequence from public.telegram_nurse_outbox o
  where o.state='queued'and not o.abandoned and not exists(select 1 from public.telegram_nurse_outbox earlier
   where earlier.binding_id=o.binding_id and earlier.generation=o.generation and earlier.sequence<o.sequence and not earlier.abandoned
    and earlier.state in('queued','sending','unknown'))order by o.sequence limit p_limit)q;
 return jsonb_build_object('ids',ids);
end$$;
create function public.telegram_nurse_outbox_claim(p_id uuid,p_enabled boolean)returns jsonb
language plpgsql security definer set search_path=''as $$
declare o public.telegram_nurse_outbox;d public.telegram_nurse_dialogs;s public.workspace_staff;b public.telegram_auth_bindings;
 r public.channel_inbox;tpl public.system_message_templates;member uuid;aid uuid;turn_kind text;
begin
 if auth.role()is distinct from 'service_role'then raise insufficient_privilege;end if;
 if not public._telegram_nurse_on(p_enabled)then return jsonb_build_object('ok',false,'status','disabled');end if;
 select * into o from public.telegram_nurse_outbox where id=p_id;
 if not found then return jsonb_build_object('ok',false,'status','not_found');end if;
 select * into r from public.channel_inbox where id=o.source_inbox;
 s:=public._telegram_nurse_inbox_authority(r);
 perform pg_advisory_xact_lock(hashtextextended('telegram-nurse:'||o.binding_id::text,0));
 select * into o from public.telegram_nurse_outbox where id=p_id for update;
 if o.state<>'queued'or o.abandoned or o.attempt_id is not null then return jsonb_build_object('ok',false,'status','already_claimed');end if;
 select * into d from public.telegram_nurse_dialogs where binding_id=o.binding_id and generation=o.generation for update;
 turn_kind:=o.turn->>'kind';
 if turn_kind in('today','task-note')and(o.question_version<>d.question_version or d.expires_at<=clock_timestamp())then
  update public.telegram_nurse_outbox set state='suppressed'where id=o.id;return jsonb_build_object('ok',false,'status','stale');end if;
 if exists(select 1 from public.telegram_nurse_outbox earlier where earlier.binding_id=o.binding_id and earlier.generation=o.generation
  and earlier.sequence<o.sequence and not earlier.abandoned and earlier.state in('queued','sending','unknown'))then return jsonb_build_object('ok',false,'status','blocked');end if;
 foreach member in array o.member_ids loop
  if not public._telegram_nurse_case_access(s.user_id,o.binding_id,o.generation,member)then raise insufficient_privilege;end if;
 end loop;
 if turn_kind='today'and exists(select 1 from public.telegram_nurse_intents i join public.patient_coordination_tasks t on t.id=i.task_id
  where i.outbox_id=o.id and(t.revision<>i.task_revision or t.status not in('open','awaiting-member')or not public._patient_coordination_owner_valid(t.patient_case_id,t.owner_id,false)))then
  update public.telegram_nurse_outbox set state='suppressed'where id=o.id;return jsonb_build_object('ok',false,'status','stale');end if;
 if turn_kind='task-note'and not exists(select 1 from public.patient_coordination_tasks t where t.id=d.task_id and t.revision=d.task_revision
   and t.status in('open','awaiting-member')and t.kind<>'doctor-referral'and public._patient_coordination_owner_valid(t.patient_case_id,t.owner_id,false))then
  update public.telegram_nurse_outbox set state='suppressed'where id=o.id;return jsonb_build_object('ok',false,'status','stale');end if;
 select * into tpl from public.system_message_templates where template_id=o.template_id and version=o.template_version and locale=o.locale for share;
 if not found or not tpl.approved or tpl.renderer_version is distinct from 'nurse-tasks-v1'
  or tpl.clinical_copy_version is distinct from 'nurse-task-copy-v1'
  or tpl.substitution_schema is distinct from public._telegram_nurse_template_schema(turn_kind)
  or tpl.body is distinct from 'UNAPPROVED nurse-tasks-v1 renderer / nurse-task-copy-v1 / '||turn_kind then
  return jsonb_build_object('ok',false,'status','unapproved');end if;
 select * into b from public.telegram_auth_bindings where id=o.binding_id;
 aid:=gen_random_uuid();
 update public.telegram_nurse_outbox set state='sending',attempt_id=aid,claimed_at=clock_timestamp()where id=o.id;
 return jsonb_build_object('ok',true,'envelope',jsonb_build_object('outboxId',o.id,'attemptId',aid,'address',b.address,'locale',o.locale,'turn',o.turn,
  'rendererVersion',tpl.renderer_version,'clinicalCopyVersion',tpl.clinical_copy_version));
exception when insufficient_privilege then
 update public.telegram_nurse_outbox set state='suppressed'where id=p_id and state='queued';
 return jsonb_build_object('ok',false,'status','access');
end$$;
create function public.telegram_nurse_outbox_outcome(p_id uuid,p_attempt uuid,p_enabled boolean,p_result jsonb)returns jsonb
language plpgsql security definer set search_path=''as $$
declare o public.telegram_nurse_outbox;r public.channel_inbox;d public.telegram_nurse_dialogs;s public.workspace_staff;member uuid;k text:=p_result->>'kind';ref text:=p_result->>'providerRef';
begin
 if auth.role()is distinct from 'service_role'then raise insufficient_privilege;end if;
 if not public._telegram_nurse_on(p_enabled)then return jsonb_build_object('ok',false,'status','disabled');end if;
 if jsonb_typeof(p_result)is distinct from 'object'or p_result-array['kind','providerRef']<>'{}'or coalesce(k,'')not in('accepted','failed','unknown')
  or(k='accepted'and coalesce(ref,'')!~'^[1-9][0-9]{0,15}$')then return jsonb_build_object('ok',false,'status','invalid');end if;
 select * into o from public.telegram_nurse_outbox where id=p_id;
 if not found then return jsonb_build_object('ok',false,'status','not_found');end if;
 select * into r from public.channel_inbox where id=o.source_inbox;
 s:=public._telegram_nurse_inbox_authority(r);
 perform pg_advisory_xact_lock(hashtextextended('telegram-nurse:'||o.binding_id::text,0));
 select * into o from public.telegram_nurse_outbox where id=p_id for update;
 foreach member in array o.member_ids loop
  if not public._telegram_nurse_case_access(s.user_id,o.binding_id,o.generation,member)then raise insufficient_privilege;end if;
 end loop;
 if o.attempt_id is distinct from p_attempt or p_attempt is null then return jsonb_build_object('ok',false,'status','stale');end if;
 if o.outcome is not null then return jsonb_build_object('ok',o.outcome=p_result,'status',case when o.outcome=p_result then 'recorded'else 'conflict'end);end if;
 if o.state not in('sending','unknown')then return jsonb_build_object('ok',false,'status','stale');end if;
 -- A keyboard edit has no business effect and cannot block the acknowledgement.
 update public.telegram_nurse_outbox set state=case when o.turn->>'kind'='clear-controls'and k<>'accepted'then 'failed'else k end,
  provider_ref=case when k='accepted'then ref end,outcome=p_result where id=o.id;
 if k='accepted'and not o.abandoned then
  select * into d from public.telegram_nurse_dialogs where binding_id=o.binding_id and generation=o.generation for update;
  if d.question_version=o.question_version and d.expires_at>clock_timestamp()then
   if o.turn->>'kind'='task-note'then
    update public.telegram_nurse_dialogs set prompt_message_id=ref,expires_at=clock_timestamp()+interval '30 minutes'where binding_id=d.binding_id and generation=d.generation;
   elsif o.turn->>'kind'='today'then
    update public.telegram_nurse_intents set carrier_message_id=ref,expires_at=clock_timestamp()+interval '30 minutes'where outbox_id=o.id;
    update public.telegram_nurse_dialogs set expires_at=clock_timestamp()+interval '30 minutes'where binding_id=d.binding_id and generation=d.generation;
   end if;
  end if;
 end if;
 return jsonb_build_object('ok',true,'status','recorded');
exception when insufficient_privilege then return jsonb_build_object('ok',false,'status','access');
end$$;
create function public.telegram_nurse_outbox_reconcile(p_enabled boolean)returns jsonb
language plpgsql security definer set search_path=''as $$
declare n integer;
begin
 if auth.role()is distinct from 'service_role'then raise insufficient_privilege;end if;
 if not public._telegram_nurse_on(p_enabled)then return jsonb_build_object('ok',false,'status','disabled');end if;
 -- No resend, and no business command. An operator/provider receipt can still
 -- record the exact attempt later; a nurse can explicitly resume current work.
 update public.telegram_nurse_outbox set state=case when turn->>'kind'='clear-controls'then 'failed'else 'unknown'end
  where state='sending'and claimed_at<clock_timestamp()-interval '2 minutes';
 get diagnostics n=row_count;return jsonb_build_object('ok',true,'reconciled',n);
end$$;

-- No direct API table access, including service_role. Only the named service RPCs
-- may cross this boundary; private functions are not actor-accepting back doors.
do $$declare n text;f regprocedure;begin
 foreach n in array array['telegram_nurse_settings','telegram_nurse_dialogs','telegram_nurse_outbox','telegram_nurse_intents']loop
  execute format('alter table public.%I enable row level security',n);
  execute format('revoke all on table public.%I from public,anon,authenticated,service_role',n);
 end loop;
 for f in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public'and(p.proname like '\_telegram\_nurse\_%'escape '\'or p.proname like 'telegram\_nurse\_%'escape '\')loop
  execute format('revoke all on function %s from public,anon,authenticated,service_role',f);
  if f::text like 'telegram_nurse_%'or f::text like 'public.telegram_nurse_%'then execute format('grant execute on function %s to service_role',f);end if;
 end loop;
end$$;

revoke all on sequence public.telegram_nurse_outbox_sequence_seq from public,anon,authenticated,service_role;

-- The captured-identity boundary is independent of both nurse switches.
create or replace function public.channel_inbox_process(p_id uuid)returns jsonb
language plpgsql security definer set search_path=''as $$
declare r public.channel_inbox;b public.telegram_auth_bindings;s public.telegram_channel_settings;
begin
 if auth.role()is distinct from 'service_role'then raise insufficient_privilege;end if;
 perform set_config('lock_timeout','3s',true);
 select * into r from public.channel_inbox where id=p_id for update;
 if not found or r.status<>'processing'then return jsonb_build_object('ok',false,'code','not_leased');end if;
 begin
  -- Captured staff input is never reinterpreted under a replacement member.
  -- This entry point is also used when the nurse environment gate is off.
  if r.nurse_binding_id is not null then
   select * into b from public.telegram_auth_bindings where id=r.nurse_binding_id for share;
   select * into s from public.telegram_channel_settings where singleton;
   if b.id is null or not b.active or b.revoked_at is not null or b.kind<>'staff'
    or b.generation is distinct from r.nurse_binding_generation or b.principal_ref is distinct from r.principal_ref
    or b.account_ref is distinct from public._telegram_account_ref(s)or b.address is distinct from r.payload->>'chatId'then
    update public.telegram_nurse_dialogs set pending_inbox=null,question_version=question_version+1,question_key='idle',expected_mode='none',task_id=null,task_revision=null,prompt_message_id=null,expires_at=clock_timestamp()where pending_inbox=r.id;
    return public._channel_inbox_finish(r.id,'done','nurse_access');
   end if;
   if r.nurse_at_commit and r.kind not in('link','contact','rejected')then
    perform public._telegram_bot_next_step(r);
    return public._channel_inbox_finish(r.id,'done','principal_not_linked');
   end if;
  end if;
  if r.kind='text'then
   if public._zoe_chat_actions_on()and public._channel_text_is_menu(r.payload->>'text')then return public._channel_inbox_receive_menu(r);end if;
   return public._channel_inbox_receive_text(r);
  elsif r.kind='media'then return public._channel_inbox_receive_media(r);
  elsif r.kind='redo'then return public._channel_inbox_receive_redo(r);
  elsif r.kind='link'then return public._telegram_auth_start(r);
  elsif r.kind='contact'then return public._telegram_auth_contact(r);
  elsif r.kind='callback'then return public._channel_inbox_receive_callback(r);
  elsif r.kind='start'then
   perform public._telegram_bot_next_step(r);
   return public._channel_inbox_finish(r.id,'done','ignored_start');
  else
   return public._channel_inbox_finish(r.id,'done','ignored_'||r.kind);
  end if;
 exception when others then
  update public.channel_inbox set last_error=sqlstate where id=r.id;
  return jsonb_build_object('ok',false,'code','retry','sqlstate',sqlstate);
 end;
end$$;


create or replace function public._channel_inbox_finish(i uuid,st text,r text)returns jsonb
language plpgsql security definer set search_path=''as $$begin
 -- A definitive refusal resolves the command, including the original row that
 -- /resume copied. Displacement alone is not a refusal of the business command.
 if r in('nurse_access','nurse_refused')then
  update public.channel_inbox transport set payload=transport.payload-'text'-'phone',nurse_context=null
   from public.channel_inbox refused where refused.id=i
    and transport.nurse_binding_id=refused.nurse_binding_id
    and transport.nurse_binding_generation=refused.nurse_binding_generation
    and transport.nurse_context->'command'=refused.nurse_context->'command';
 end if;
 update public.channel_inbox set status=st,result=r,processed_at=clock_timestamp(),lease_until=null,
  payload=payload-'text'-'phone',
  nurse_context=case when r in('nurse_access','nurse_refused','nurse_displaced')then null else nurse_context end where id=i;
 return jsonb_build_object('ok',true,'status',st,'result',r);
end$$;

-- Extend the existing auth cleanup sweep, which runs even when sending is off.
create or replace function public.auth_cleanup_run()returns jsonb
language plpgsql security definer set search_path=''as $$
declare j public.auth_cleanup_jobs;n integer;total integer:=0;
begin
 if auth.role()is distinct from 'service_role'then raise insufficient_privilege;end if;
 for j in select * from public.auth_cleanup_jobs where state='due'and due_at<=clock_timestamp()order by due_at limit 50 for update skip locked loop
  update public.auth_cleanup_jobs set attempts=attempts+1 where id=j.id;
  delete from auth.sessions s where s.user_id=j.auth_user_id and not exists(
   select 1 from public.auth_code_requests r join public.telegram_auth_bindings b on b.id=coalesce(r.binding_id,(select x.id from public.telegram_auth_bindings x where x.auth_user_id=j.auth_user_id and x.active))
   where r.verified_session=s.id and r.state='verified'and r.updated_at>j.revoked_at and b.active and b.created_at>=j.revoked_at-interval '1 second')
  and not exists(
   select 1 from public.auth_admissions a join public.telegram_auth_bindings b on b.id=a.binding_id
   where a.session_id=s.id and a.auth_user_id=j.auth_user_id and a.state='admitted'and a.created_at>j.revoked_at and b.active and b.generation=a.binding_generation
    and b.created_at>=j.revoked_at-interval '1 second')
  -- A staff password sign-in made after the revocation is kept while the code step is not
  -- required; when it is required, such a session is unadmitted and refused anyway (Fable F-7).
  and not(s.created_at>j.revoked_at and not public._staff_signin_required()and public._staff_account_exists(j.auth_user_id));
  get diagnostics n=row_count;total:=total+n;
  update public.auth_cleanup_jobs set state='done',done_at=clock_timestamp(),deleted_sessions=n where id=j.id;
 end loop;
 -- Thirty-minute nurse transport lifecycle, matching the dialog/control window.
 -- Keep rows and attempt identities for deduplication and late outcomes, but
 -- discard snapshots. Unknown sends still block their chain until explicit resume.
 delete from public.telegram_nurse_intents where expires_at<=clock_timestamp()or used_at is not null;
 update public.telegram_nurse_outbox set
  state=case when state='queued'then 'suppressed'else state end,
  turn=jsonb_build_object('kind',turn->>'kind')
  where created_at<clock_timestamp()-interval '30 minutes'
   and(state='queued'or turn-array['kind']<>'{}');
 update public.channel_inbox i set nurse_context=null
  where i.nurse_context is not null and i.status in('done','dead')
   and i.processed_at<clock_timestamp()-interval '30 minutes'
   -- An unresolved business command must remain byte-for-byte replayable.
   and(not(i.nurse_context?'command')or i.nurse_result->>'status'='saved')
   and not exists(select 1 from public.telegram_nurse_dialogs d where d.pending_inbox=i.id)
   and not exists(select 1 from public.telegram_nurse_outbox o where o.source_inbox=i.id and not o.abandoned and o.state in('sending','unknown'));
 return jsonb_build_object('ok',true,'deleted',total);
end$$;
