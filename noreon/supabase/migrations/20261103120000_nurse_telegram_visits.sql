-- Visits extend the existing captured-binding dialog and ordered, one-attempt outbox.
-- Renderer and clinical copy approvals remain off. No new actor-accepting service API.
alter table public.telegram_nurse_dialogs
 drop constraint telegram_nurse_dialogs_question_key_check,
 drop constraint telegram_nurse_dialogs_expected_mode_check,
 add constraint telegram_nurse_dialogs_question_key_check check(question_key in('idle','today','task-note','visit')),
 add constraint telegram_nurse_dialogs_expected_mode_check check(expected_mode in('none','callback','reply','both')),
 add column visit_source text check(visit_source in('home-request','appointment')),
 add column visit_id uuid,add column visit_member_id uuid,
 add column visit_flow jsonb not null default '{"skipped":[],"editing":null,"view":"question","comment":""}',
 add column visit_snapshot_token text,add column visit_question_key text,add column visit_completion_ids jsonb;
alter table public.telegram_nurse_intents alter column task_id drop not null,alter column task_revision drop not null,
 add column visit_source text check(visit_source in('home-request','appointment')),
 add column visit_id uuid,add column visit_member_id uuid,add column visit_action text,
 add column visit_question_key text,add column visit_snapshot_token text,
 add constraint telegram_nurse_intents_target check(
 (task_id is not null and task_revision is not null and visit_id is null and visit_action is null)
 or(task_id is null and task_revision is null and visit_id is not null and visit_member_id is not null and visit_source is not null and visit_action is not null));

alter function public._telegram_nurse_template_schema(text)rename to _telegram_nurse_task_template_schema;
create function public._telegram_nurse_template_schema(p_kind text)returns jsonb language sql immutable set search_path=''as $$
 select case p_kind
 when 'visit-refused' then '{"kind":"visit-refused"}'::jsonb
 when 'visit-pending' then '{"kind":"visit-pending","operation":"mark-or-step-or-complete-or-null"}'::jsonb
 when 'visit-list' then '{"kind":"visit-list","visits":{"maxItems":8,"memberName":160,"location":1000,"clinic":500,"intentRef":"opaque"}}'::jsonb
 when 'visit-opening' then '{"kind":"visit-opening","visit":{"memberName":160,"location":1000,"clinic":500},"early":"boolean"}'::jsonb
 when 'visit-action' then '{"kind":"visit-action","nurseName":160,"action":"enum","questionKey":"question-or-null","item":"bounded-safe-item-or-null","step":"enum-or-null"}'::jsonb
 when 'visit-question' then '{"kind":"visit-question","data":"bounded-ready-snapshot-no-notes-or-values","flow":"visit-flow-no-comment","controls":{"maxItems":160,"action":"enum-or-question","ref":"opaque"},"error":"code-or-null"}'::jsonb
 else public._telegram_nurse_task_template_schema(p_kind)end
$$;
insert into public.system_message_templates(template_id,version,locale,body,renderer_version,substitution_schema,clinical_copy_version)
 select 'telegram.nurse.'||replace(k,'-','_'),1,l,'UNAPPROVED nurse-visits-v1 renderer / nurse-visit-copy-v1 / '||k,
 'nurse-visits-v1',public._telegram_nurse_template_schema(k),'nurse-visit-copy-v1'
 from unnest(array['visit-list','visit-opening','visit-action','visit-question','visit-pending','visit-refused'])k cross join unnest(array['en','hy','ru'])l;

-- Same lock as the web business bodies, plus source/case rows shared by booking
-- writers. Snapshot comparison and execution hold these until transaction end.
create function public._telegram_nurse_visit_detail(r public.channel_inbox,s public.workspace_staff,m uuid,src text,sid uuid)returns jsonb
language plpgsql security definer set search_path=''as $$
begin
 perform pg_advisory_xact_lock(hashtextextended('nurse-visit:'||sid::text,0));
 perform 1 from public.patient_clinical_cases where user_id=m for update;
 if src='home-request'then perform 1 from public.patient_test_requests where id=sid for update;
 elsif src='appointment'then perform 1 from public.booking_appointments where id=sid for update;
 else raise insufficient_privilege;end if;
 return public._nurse_visit_detail_as(s.user_id,r.nurse_binding_id,r.nurse_binding_generation,m,src,sid);
end$$;
create function public._telegram_nurse_visit_token(p_snapshot jsonb)returns text language sql immutable set search_path=''as $$
 select encode(sha256(convert_to(p_snapshot::text,'UTF8')),'hex')
$$;
create function public._telegram_nurse_visit_work(r public.channel_inbox,p_phase text)returns jsonb
language plpgsql security definer set search_path=''as $$
declare loc text;ctx jsonb:=r.nurse_context;s public.workspace_staff;
begin
 s:=public._telegram_nurse_inbox_authority(r);
 select case when locale in('en','hy','ru')then locale else 'hy'end into loc from public.profiles where id=s.user_id;
 return jsonb_build_object('phase',p_phase,'snapshot',ctx->'snapshot','flow',ctx->'flow','input',ctx->'input','token',ctx->>'token','locale',coalesce(loc,'hy'));
end$$;
create function public._telegram_nurse_visit_clear(p_binding uuid,p_generation bigint)returns void language plpgsql security definer set search_path=''as $$
declare work_ text;
begin
 select i.nurse_context->>'visitWorkId'into work_ from public.telegram_nurse_dialogs d join public.channel_inbox i on i.id=d.pending_inbox
 where d.binding_id=p_binding and d.generation=p_generation and d.question_key='visit';
 if work_ is not null then
  update public.channel_inbox set nurse_context=null,payload=payload-'text'-'phone',nurse_result=jsonb_build_object('ok',false,'status','refused'),
   status=case when status='dead'then status else 'done'end,lease_until=null,processed_at=clock_timestamp(),result='nurse_visit_refused'
  where nurse_binding_id=p_binding and nurse_binding_generation=p_generation and nurse_context->>'visitWorkId'=work_;
 end if;
 update public.telegram_nurse_dialogs set question_version=question_version+1,question_key='idle',expected_mode='none',prompt_message_id=null,
 pending_inbox=null,visit_source=null,visit_id=null,visit_member_id=null,visit_snapshot_token=null,visit_question_key=null,visit_completion_ids=null,
 visit_flow='{"skipped":[],"editing":null,"view":"question","comment":""}',expires_at=clock_timestamp()
 where binding_id=p_binding and generation=p_generation and question_key='visit';
end$$;
-- Retire every /resume transport copy of this exact unresolved work, immediately.
create function public._telegram_nurse_visit_retire(r public.channel_inbox,p_status text)returns void language plpgsql security definer set search_path=''as $$
begin
 if r.nurse_context->>'action'is distinct from 'visit'then return;end if;
 update public.channel_inbox set payload=payload-'text'-'phone',nurse_context=null,
 nurse_result=jsonb_build_object('ok',true,'status',p_status),
 status=case when status='dead'then status else 'done'end,lease_until=null,processed_at=clock_timestamp(),result='nurse_visit_'||p_status
 where nurse_binding_id=r.nurse_binding_id and nurse_binding_generation=r.nurse_binding_generation
 and(nurse_context->>'visitWorkId'=r.nurse_context->>'visitWorkId' or id=r.id);
end$$;
create function public._telegram_nurse_visit_arm(p_outbox uuid,p_source text,p_id uuid,p_member uuid,p_action text,p_key text,p_token text)returns text
language plpgsql security definer set search_path=''as $$
declare o public.telegram_nurse_outbox;ref text:=replace(gen_random_uuid()::text,'-','');
begin
 select * into o from public.telegram_nurse_outbox where id=p_outbox;
 insert into public.telegram_nurse_intents(ref_hash,binding_id,generation,question_version,outbox_id,expires_at,visit_source,visit_id,visit_member_id,visit_action,visit_question_key,visit_snapshot_token)
 values(encode(sha256(convert_to(ref,'UTF8')),'hex'),o.binding_id,o.generation,o.question_version,o.id,clock_timestamp()+interval '30 minutes',p_source,p_id,p_member,p_action,p_key,p_token);
 return ref;
end$$;

-- Pending is clinical copy, not the task-completion-note renderer. It never
-- releases the pin or allocates a new command identity.
create function public._telegram_nurse_visit_pending(r public.channel_inbox,p_question bigint,p_member uuid,p_operation text)returns jsonb
language plpgsql security definer set search_path=''as $$
begin
 if not exists(select 1 from public.telegram_nurse_outbox where source_inbox=r.id and turn->>'kind'='visit-pending')then
  perform public._telegram_nurse_enqueue(r,p_question,jsonb_build_object('kind','visit-pending','operation',p_operation),array_remove(array[p_member],null));
 end if;
 return jsonb_build_object('ok',false,'status','pending');
end$$;

alter function public.telegram_nurse_receive(uuid,boolean)rename to _telegram_nurse_task_receive;
create function public.telegram_nurse_receive(p_id uuid,p_enabled boolean)returns jsonb
language plpgsql security definer set search_path=''as $$
declare r public.channel_inbox;d public.telegram_nurse_dialogs;s public.workspace_staff;i public.telegram_nurse_intents;
 snap jsonb;ctx jsonb;action_ text;words text;flow_ jsonb;reply_ boolean:=false;result jsonb;
begin
 if auth.role()is distinct from 'service_role'then raise insufficient_privilege;end if;
 select * into r from public.channel_inbox where id=p_id for update;
 if not found or not r.nurse_at_commit then return jsonb_build_object('handled',false);end if;
 if r.status not in('processing','done')or(r.status='processing'and(r.lease_until is null or r.lease_until<=clock_timestamp()))then
 return jsonb_build_object('handled',true,'inboxId',p_id,'leaseAttempt',r.attempts,'status','not_leased');end if;
 s:=public._telegram_nurse_inbox_authority(r);
 if r.kind in('link','contact','rejected')then return public._telegram_nurse_task_receive(p_id,p_enabled);end if;
 if not public._telegram_nurse_on(p_enabled)then
  perform public._telegram_nurse_visit_clear(r.nurse_binding_id,r.nurse_binding_generation);
  perform public._telegram_nurse_visit_retire(r,'refused');return public._telegram_nurse_task_receive(p_id,p_enabled);
 end if;
 perform pg_advisory_xact_lock(hashtextextended('telegram-nurse:'||r.nurse_binding_id::text,0));
 select * into d from public.telegram_nurse_dialogs where binding_id=r.nurse_binding_id and generation=r.nurse_binding_generation for update;
 if r.status='done'then return jsonb_build_object('handled',true,'inboxId',r.id,'leaseAttempt',r.attempts,'status','done');end if;
 if r.nurse_context->>'action'='visit'then
  return jsonb_build_object('handled',true,'inboxId',r.id,'leaseAttempt',r.attempts,'status','ready','visit',case when not(r.nurse_context?'prepared')then public._telegram_nurse_visit_work(r,'input')end);
 elsif r.nurse_context is not null then return public._telegram_nurse_task_receive(p_id,p_enabled);end if;
 words:=case when r.kind='text'then btrim(r.payload->>'text')end;
 if d.pending_inbox is not null then
  select nurse_context into ctx from public.channel_inbox where id=d.pending_inbox;
  if ctx->>'action'<>'visit'or ctx is null then return public._telegram_nurse_task_receive(p_id,p_enabled);end if;
  if words='/resume'and not(r.payload?'replyToMessageId')then
   ctx:=ctx||jsonb_build_object('recover',true);
   update public.channel_inbox set nurse_context=ctx where id=r.id returning * into r;
   update public.telegram_nurse_dialogs set pending_inbox=r.id where binding_id=d.binding_id and generation=d.generation;
   return jsonb_build_object('handled',true,'inboxId',r.id,'leaseAttempt',r.attempts,'status','ready','visit',case when not(ctx?'prepared')then public._telegram_nurse_visit_work(r,'input')end);
  end if;
  -- Refuse unrelated answers without displacing or changing the pinned command.
  perform public._telegram_nurse_visit_pending(r,d.question_version,d.visit_member_id,ctx->>'operation');
  perform public._channel_inbox_finish(r.id,'done','nurse_visit_pending');
  return jsonb_build_object('handled',true,'inboxId',r.id,'leaseAttempt',r.attempts,'status','done');
 end if;
 if d.question_key='visit'and words in('/menu','/today','/visits')and not(r.payload?'replyToMessageId')then
  perform public._telegram_nurse_visit_clear(d.binding_id,d.generation);
  return public._telegram_nurse_task_receive(p_id,p_enabled);
 end if;
 if r.kind='callback'then
  select * into i from public.telegram_nurse_intents where ref_hash=encode(sha256(convert_to(r.payload->>'intentRef','UTF8')),'hex')for update;
  if i.visit_id is null then
   if d.question_key<>'visit'then return public._telegram_nurse_task_receive(p_id,p_enabled);end if;
  elsif i.binding_id=r.nurse_binding_id and i.generation=r.nurse_binding_generation and i.question_version=d.question_version
   and i.used_at is null and i.expires_at>clock_timestamp()and d.expires_at>clock_timestamp()
   and d.expected_mode in('callback','both')and i.carrier_message_id is not null and i.carrier_message_id=r.payload->>'messageId'
   and(i.visit_action='open'or(i.visit_id=d.visit_id and i.visit_source=d.visit_source and i.visit_member_id=d.visit_member_id
    and i.visit_question_key is not distinct from d.visit_question_key and i.visit_snapshot_token is not distinct from d.visit_snapshot_token))then
   action_:=i.visit_action;
  end if;
 elsif d.question_key='visit'and r.kind='text'then
  if words='/resume'and not(r.payload?'replyToMessageId')then action_:='refresh';
  elsif d.expected_mode='both'and d.expires_at>clock_timestamp()and d.prompt_message_id is not null and d.prompt_message_id=r.payload->>'replyToMessageId'then
   reply_:=true;
   action_:=case when words='/cancel'then 'cancel'when d.visit_flow->>'view'='comment'then 'comment-save'
    when d.visit_flow->>'view'='complete'then 'reason'when d.visit_question_key like 'measure:%'then 'reading'else null end;
  end if;
 elsif d.question_key is distinct from 'visit'then return public._telegram_nurse_task_receive(p_id,p_enabled);end if;
 if reply_ and(length(words)>case when action_='reading'then 160 else 1000 end
  or public._conversation_utf16(words)>case when action_='reading'then 160 else 1000 end
  or public._telegram_nurse_slot(words,2000,false)is distinct from words)then action_:=null;end if;
 if action_ is null then
  perform public._telegram_nurse_enqueue(r,d.question_version,jsonb_build_object('kind','visit-refused'));
  perform public._channel_inbox_finish(r.id,'done','nurse_visit_refused');
  return jsonb_build_object('handled',true,'inboxId',r.id,'leaseAttempt',r.attempts,'status','done');
 end if;
 snap:=public._telegram_nurse_visit_detail(r,s,case when action_='open'then i.visit_member_id else d.visit_member_id end,
  case when action_='open'then i.visit_source else d.visit_source end,case when action_='open'then i.visit_id else d.visit_id end);
 if snap->>'status'='unavailable'then return jsonb_build_object('handled',true,'inboxId',r.id,'leaseAttempt',r.attempts,'status','pending');end if;
 if snap->>'enabled'is distinct from 'true'then raise insufficient_privilege;end if;
 if action_='reason'and not exists(select 1 from jsonb_array_elements(snap->'items')it where it#>>'{mark,done}'is distinct from 'true')then
  perform public._telegram_nurse_enqueue(r,d.question_version,jsonb_build_object('kind','visit-refused'));
  perform public._channel_inbox_finish(r.id,'done','nurse_visit_refused');
  return jsonb_build_object('handled',true,'inboxId',r.id,'leaseAttempt',r.attempts,'status','done');
 end if;
 flow_:=case when action_='open'then '{"skipped":[],"editing":null,"view":"question","comment":""}'::jsonb else d.visit_flow end;
 if action_<>'open'and public._telegram_nurse_visit_token(snap)is distinct from d.visit_snapshot_token then
  action_:='refresh';words:=null;reply_:=false;flow_:=flow_||'{"comment":"","editing":null,"view":"question"}'::jsonb;
 end if;
 ctx:=jsonb_build_object('action','visit','visitWorkId',gen_random_uuid(),'questionVersion',d.question_version,'snapshot',snap,
  'token',public._telegram_nurse_visit_token(snap),'flow',flow_,'originalFlow',flow_,'input',jsonb_strip_nulls(jsonb_build_object('action',action_,'words',case when reply_ then words end)),
  'questionKey',case when action_='open'then null else d.visit_question_key end,'carrierMessageId',case when r.kind='callback'then i.carrier_message_id end,
  'error',case when action_='refresh'and words is null then 'changed'else null end,'recover',words='/resume');
 if action_='open'then
  update public.telegram_nurse_dialogs set visit_source=i.visit_source,visit_id=i.visit_id,visit_member_id=i.visit_member_id,
   visit_completion_ids=jsonb_build_object('submissionId',gen_random_uuid(),'visitId',gen_random_uuid(),'openSubmissionId',gen_random_uuid(),'appendSubmissionId',gen_random_uuid()),
   visit_flow=flow_,question_key='visit',task_id=null,task_revision=null where binding_id=d.binding_id and generation=d.generation;
 end if;
 if i.ref_hash is not null then update public.telegram_nurse_intents set used_at=clock_timestamp()where ref_hash=i.ref_hash;end if;
 update public.channel_inbox set nurse_context=ctx where id=r.id returning * into r;
 update public.telegram_nurse_dialogs set pending_inbox=r.id where binding_id=d.binding_id and generation=d.generation;
 return jsonb_build_object('handled',true,'inboxId',r.id,'leaseAttempt',r.attempts,'status','ready','visit',public._telegram_nurse_visit_work(r,'input'));
exception when insufficient_privilege then
 perform public._telegram_nurse_visit_retire(r,'refused');perform public._telegram_nurse_visit_clear(r.nurse_binding_id,r.nurse_binding_generation);
 perform public._channel_inbox_finish(p_id,'done','nurse_access');return jsonb_build_object('handled',true,'inboxId',p_id,'leaseAttempt',r.attempts,'status','refused');
 when lock_not_available or query_canceled or deadlock_detected then return jsonb_build_object('handled',true,'inboxId',p_id,'leaseAttempt',r.attempts,'status','pending');
end$$;

create function public._telegram_nurse_visit_key(p_snapshot jsonb,p_key text)returns boolean language sql immutable set search_path=''as $$
 select p_key is null or p_key in('finish','step:confirmed','step:started','step:samples-collected','step:samples-at-lab')
 or exists(select 1 from jsonb_array_elements(p_snapshot->'items')i where i->>'key'=p_key)
$$;
create function public._telegram_nurse_visit_flow_valid(p_snapshot jsonb,p_flow jsonb)returns boolean language plpgsql immutable set search_path=''as $$
declare k jsonb;
begin
 if jsonb_typeof(p_flow)is distinct from 'object'or p_flow-array['skipped','editing','view','comment']<>'{}'
 or not(p_flow?&array['skipped','editing','view','comment'])or jsonb_typeof(p_flow->'skipped')is distinct from 'array'
 or jsonb_array_length(p_flow->'skipped')>160 or coalesce(p_flow->>'view','')not in('question','change','complete','comment')
 or jsonb_typeof(p_flow->'comment')is distinct from 'string'or length(p_flow->>'comment')>1000
 or public._conversation_utf16(p_flow->>'comment')>1000 or jsonb_typeof(p_flow->'editing')not in('null','string')
 or not public._telegram_nurse_visit_key(p_snapshot,p_flow->>'editing')then return false;end if;
 for k in select value from jsonb_array_elements(p_flow->'skipped')loop
  if jsonb_typeof(k)<>'string'or not public._telegram_nurse_visit_key(p_snapshot,k#>>'{}')then return false;end if;
 end loop;
 return true;
end$$;
create function public.telegram_nurse_visit_prepare(p_id uuid,p_enabled boolean,p_attempt integer,p_plan jsonb)returns jsonb
language plpgsql security definer set search_path=''as $$
declare r public.channel_inbox;d public.telegram_nurse_dialogs;s public.workspace_staff;ctx jsonb;snap jsonb;cmd jsonb;item_ jsonb;
 op text:=p_plan->>'operation';q text;action_ text;flow_ jsonb;words text;
begin
 if auth.role()is distinct from 'service_role'then raise insufficient_privilege;end if;
 select * into r from public.channel_inbox where id=p_id for update;
 if not found or r.status<>'processing'or r.attempts is distinct from p_attempt or r.lease_until is null or r.lease_until<=clock_timestamp()then return jsonb_build_object('ok',false,'status','not_leased');end if;
 s:=public._telegram_nurse_inbox_authority(r);
 if not public._telegram_nurse_on(p_enabled)then raise insufficient_privilege;end if;
 perform pg_advisory_xact_lock(hashtextextended('telegram-nurse:'||r.nurse_binding_id::text,0));
 select * into d from public.telegram_nurse_dialogs where binding_id=r.nurse_binding_id and generation=r.nurse_binding_generation for update;
 ctx:=r.nurse_context;
 if ctx->>'action'is distinct from 'visit'or d.pending_inbox is distinct from r.id or(ctx->>'questionVersion')::bigint<>d.question_version then return jsonb_build_object('ok',false,'status','stale');end if;
 if ctx?'prepared'then return jsonb_build_object('ok',true,'status','ready');end if;
 q:=ctx->>'questionKey';action_:=ctx#>>'{input,action}';words:=ctx#>>'{input,words}';flow_:=p_plan->'flow';
 if jsonb_typeof(p_plan)is distinct from 'object'or p_plan-array['token','flow','operation','values','done','error','questionKey']<>'{}'
 or p_plan->>'token'is distinct from ctx->>'token'
 or(op is not null and p_plan->>'questionKey'is distinct from q)or not public._telegram_nurse_visit_key(ctx->'snapshot',p_plan->>'questionKey')
 or(op is not null and op not in('mark','step','complete'))or(p_plan->>'error'is not null and p_plan->>'error'not in('measurement','reason'))
 or not public._telegram_nurse_visit_flow_valid(ctx->'snapshot',flow_)then return jsonb_build_object('ok',false,'status','invalid');end if;
 snap:=public._telegram_nurse_visit_detail(r,s,d.visit_member_id,d.visit_source,d.visit_id);
 if snap->>'status'='unavailable'then return jsonb_build_object('ok',false,'status','pending');end if;
 if snap->>'enabled'is distinct from 'true'then raise insufficient_privilege;end if;
 if public._telegram_nurse_visit_token(snap)is distinct from ctx->>'token'then
  ctx:=ctx||jsonb_build_object('snapshot',snap,'token',public._telegram_nurse_visit_token(snap),'prepared',true,'input',jsonb_build_object('action','refresh'),
   'error','changed','flow',d.visit_flow||'{"editing":null,"view":"question","comment":""}'::jsonb);
  update public.channel_inbox set nurse_context=ctx,payload=payload-'text'where id=r.id;
  return jsonb_build_object('ok',true,'status','ready');
 end if;
 -- Draft words only come from the correlated input. The service cannot substitute a
 -- different comment or reason, and an unparsed measurement never becomes a note.
 if action_='comment-save'then
  if words is null or length(words)>1000 or public._conversation_utf16(words)>1000 then return jsonb_build_object('ok',false,'status','invalid');end if;
  flow_:=jsonb_set(flow_,'{comment}',to_jsonb(btrim(words)));
 elsif action_ like 'choose:%'then
  select i into item_ from jsonb_array_elements(snap->'items')i where i->>'key'=substr(action_,8);
  if flow_->>'comment'is distinct from coalesce(item_#>>'{mark,note}','')then return jsonb_build_object('ok',false,'status','invalid');end if;
 elsif flow_->>'comment'not in('',coalesce(ctx#>>'{flow,comment}',''))then return jsonb_build_object('ok',false,'status','invalid');end if;
 if op is not null then
  cmd:=jsonb_build_object('version','nurse-visit-v1','memberId',d.visit_member_id,'source',d.visit_source,'sourceId',d.visit_id);
  if op='mark'then
   select i into item_ from jsonb_array_elements(snap->'items')i where i->>'key'=q;
   if item_ is null or action_ not in('answer-done','answer-not-done','reading')or jsonb_typeof(p_plan->'done')is distinct from 'boolean'
    or(p_plan->>'done')::boolean is distinct from(action_<>'answer-not-done')
    or(jsonb_typeof(p_plan->'values')not in('null','object'))then return jsonb_build_object('ok',false,'status','invalid');end if;
   cmd:=cmd||jsonb_build_object('submissionId',gen_random_uuid(),'startsAt',snap#>>'{visit,startsAt}','item',q,'done',p_plan->'done',
    'note',nullif(ctx#>>'{flow,comment}',''),'values',coalesce(p_plan->'values','null'::jsonb));
   if item_->>'kind'='check'then cmd:=cmd||jsonb_build_object('checklistVersion',item_->>'version');end if;
  elsif op='step'then
   if action_<>'answer-done'or q not in('step:confirmed','step:started','step:samples-collected','step:samples-at-lab')then return jsonb_build_object('ok',false,'status','invalid');end if;
   cmd:=cmd||jsonb_build_object('submissionId',gen_random_uuid(),'step',substr(q,6));
  else
   if action_ not in('complete','reason')or ctx#>>'{flow,view}'<>'complete'or(q is not null and q<>'finish')
    or(words is not null and(length(words)>1000 or public._conversation_utf16(words)>1000))then return jsonb_build_object('ok',false,'status','invalid');end if;
   cmd:=cmd||d.visit_completion_ids||jsonb_build_object('reason',case when exists(select 1 from jsonb_array_elements(snap->'items')it where it#>>'{mark,done}'is distinct from 'true')then nullif(btrim(words),'')else null end);
  end if;
 end if;
 ctx:=ctx||jsonb_build_object('prepared',true,'flow',flow_,'operation',op,'error',case when p_plan->>'error'is not null then p_plan->'error'else coalesce(ctx->'error','null'::jsonb)end);
 if cmd is not null then ctx:=ctx||jsonb_build_object('command',cmd);end if;
 update public.channel_inbox set nurse_context=ctx,payload=payload-'text'where id=r.id;
 return jsonb_build_object('ok',true,'status','ready');
exception when insufficient_privilege then
 perform public._telegram_nurse_visit_retire(r,'refused');perform public._telegram_nurse_visit_clear(r.nurse_binding_id,r.nurse_binding_generation);
 perform public._channel_inbox_finish(p_id,'done','nurse_access');return jsonb_build_object('ok',false,'status','refused');
 when lock_not_available or query_canceled or deadlock_detected then return jsonb_build_object('ok',false,'status','pending');
end$$;

-- The task implementation remains intact; Today appends the current web visit list.
alter function public.telegram_nurse_apply(uuid,boolean,integer)rename to _telegram_nurse_task_apply;
create function public.telegram_nurse_apply(p_id uuid,p_enabled boolean,p_attempt integer)returns jsonb
language plpgsql security definer set search_path=''as $$
declare r public.channel_inbox;d public.telegram_nurse_dialogs;s public.workspace_staff;ctx jsonb;snap jsonb;cmd jsonb;result jsonb;
 page jsonb;row_ jsonb;rows_ jsonb:='[]';members uuid[]:='{}';oid uuid;ref text;count_ integer:=0;op text;replay_ boolean:=false;
begin
 if auth.role()is distinct from 'service_role'then raise insufficient_privilege;end if;
 select * into r from public.channel_inbox where id=p_id for update;
 if not found or not r.nurse_at_commit or r.attempts is distinct from p_attempt or r.status not in('processing','done')
 or(r.status='processing'and(r.lease_until is null or r.lease_until<=clock_timestamp()))then return jsonb_build_object('ok',false,'status','not_leased');end if;
 s:=public._telegram_nurse_inbox_authority(r);
 if not public._telegram_nurse_on(p_enabled)then
  perform public._telegram_nurse_visit_retire(r,'refused');perform public._telegram_nurse_visit_clear(r.nurse_binding_id,r.nurse_binding_generation);
  return jsonb_build_object('ok',false,'status','disabled');end if;
 if r.nurse_context->>'action'is distinct from 'visit'then
  result:=public._telegram_nurse_task_apply(p_id,p_enabled,p_attempt);
  if r.status='done'or r.nurse_context->>'action'is distinct from 'today'or result->>'ok'<>'true'then return result;end if;
  select * into d from public.telegram_nurse_dialogs where binding_id=r.nurse_binding_id and generation=r.nurse_binding_generation;
  -- Isolated list failure cannot roll back task output or a task save.
  begin
   page:=public._nurse_visit_list_as(s.user_id,r.nurse_binding_id,r.nurse_binding_generation);
   if page->>'enabled'='true'then
    for row_ in select v from jsonb_array_elements(page->'visits')v where
     (v->'completion'='null'::jsonb and((v->>'startsAt')::timestamptz at time zone 'Asia/Yerevan')::date=(page->>'today')::date)
     or(v->'completion'<>'null'::jsonb and exists(select 1 from jsonb_array_elements(v->'steps')e where e->>'step'='samples-collected')
      and not exists(select 1 from jsonb_array_elements(v->'steps')e where e->>'step'='samples-at-lab'))
     order by v->>'startsAt',v->>'id'loop
     if count_=0 then oid:=public._telegram_nurse_enqueue(r,d.question_version,jsonb_build_object('kind','visit-list','visits','[]'::jsonb));end if;
     ref:=public._telegram_nurse_visit_arm(oid,row_->>'source',(row_->>'id')::uuid,(row_->>'memberId')::uuid,'open',null,null);
     row_:=row_||jsonb_build_object('memberName',public._telegram_nurse_slot(row_->>'memberName',160),'location',public._telegram_nurse_slot(row_->>'location',1000),
      'clinic',public._telegram_nurse_slot(row_->>'clinic',500),'nurseName',public._telegram_nurse_slot(row_->>'nurseName',160),'intentRef',ref);
     rows_:=rows_||jsonb_build_array(row_);members:=array_append(members,(row_->>'memberId')::uuid);count_:=count_+1;
     perform public._access_audit_record_as(s.user_id,r.nurse_binding_id,r.nurse_binding_generation,(row_->>'memberId')::uuid,'member_nurse_visit',row_->>'id');
     update public.telegram_nurse_outbox set turn=jsonb_build_object('kind','visit-list','visits',rows_),member_ids=members where id=oid;
     if count_=8 then count_:=0;rows_:='[]';members:='{}';end if;
    end loop;
   end if;
  exception when others then null;end;
  return result;
 end if;
 if r.status='done'then return coalesce(r.nurse_result,jsonb_build_object('ok',true,'status','done'));end if;
 perform pg_advisory_xact_lock(hashtextextended('telegram-nurse:'||r.nurse_binding_id::text,0));
 select * into d from public.telegram_nurse_dialogs where binding_id=r.nurse_binding_id and generation=r.nurse_binding_generation for update;
 ctx:=r.nurse_context;cmd:=ctx->'command';op:=ctx->>'operation';
 if d.pending_inbox is distinct from r.id or(ctx->>'questionVersion')::bigint<>d.question_version then
  if d.pending_inbox=r.id then perform public._telegram_nurse_visit_retire(r,'refused');perform public._telegram_nurse_visit_clear(d.binding_id,d.generation);end if;
  perform public._channel_inbox_finish(p_id,'done','nurse_displaced');return jsonb_build_object('ok',false,'status','refused');end if;
 if not(ctx?'prepared')then return jsonb_build_object('ok',false,'status','not_prepared');end if;
 if not public._telegram_nurse_case_access(s.user_id,r.nurse_binding_id,r.nurse_binding_generation,d.visit_member_id)then raise insufficient_privilege;end if;
 if ctx#>>'{input,action}'='cancel'and cmd is null then
  perform public._telegram_nurse_enqueue(r,d.question_version+1,jsonb_build_object('kind','cancelled'));
  perform public._telegram_nurse_visit_retire(r,'queued');perform public._telegram_nurse_visit_clear(d.binding_id,d.generation);
  perform public._channel_inbox_finish(p_id,'done','nurse_visit_cancel');return jsonb_build_object('ok',true,'status','queued');end if;
 snap:=public._telegram_nurse_visit_detail(r,s,d.visit_member_id,d.visit_source,d.visit_id);
 if snap->>'status'='unavailable'then return public._telegram_nurse_visit_pending(r,coalesce(d.question_version,0),d.visit_member_id,op);end if;
 if snap->>'enabled'is distinct from 'true'then raise insufficient_privilege;end if;
 if cmd is not null then
  -- A committed effect may have outlived its HTTP result. Receipt replay wins over
  -- changed snapshot, but the private body still validates actor and exact payload.
  replay_:=case op when 'mark'then exists(select 1 from public.nurse_visit_marks where member_id=d.visit_member_id and submission_id=(cmd->>'submissionId')::uuid)
   when 'step'then exists(select 1 from public.nurse_visit_events where member_id=d.visit_member_id and submission_id=(cmd->>'submissionId')::uuid)
   when 'complete'then exists(select 1 from public.nurse_visit_completions where source=d.visit_source and source_id=d.visit_id and submission_id=(cmd->>'submissionId')::uuid)else false end;
  if not replay_ and public._telegram_nurse_visit_token(snap)is distinct from ctx->>'token'then
   ctx:=ctx-'command'||jsonb_build_object('operation',null,'input',jsonb_build_object('action','refresh'),'error','changed',
    'flow',ctx->'flow'||'{"comment":"","editing":null,"view":"question"}'::jsonb);
  else
   result:=case op when 'mark'then public._nurse_visit_mark_as(s.user_id,r.nurse_binding_id,r.nurse_binding_generation,cmd)
    when 'step'then public._nurse_visit_step_as(s.user_id,r.nurse_binding_id,r.nurse_binding_generation,cmd)
    when 'complete'then public._nurse_visit_complete_as(s.user_id,r.nurse_binding_id,r.nurse_binding_generation,cmd)end;
   if result->>'status'in('unavailable','outcome-unknown')or result is null then return public._telegram_nurse_visit_pending(r,coalesce(d.question_version,0),d.visit_member_id,op);end if;
   if result->>'status'in('access','disabled')then raise insufficient_privilege;end if;
   ctx:=ctx||jsonb_build_object('businessResult',result,'error',case when result->>'status'in('saved','already-recorded')then 'null'::jsonb else jsonb_build_object('operation',op,'status',result->>'status')end);
   if result->>'status'not in('saved','already-recorded','completed')then
    ctx:=ctx||jsonb_build_object('flow',coalesce(ctx->'originalFlow',ctx->'flow')||'{"comment":""}'::jsonb);
   end if;
   if result->>'status'in('saved','already-recorded','completed')then
    ctx:=ctx||jsonb_build_object('flow',ctx->'flow'||jsonb_build_object('editing',null,'view','question','comment','')||case when op='complete'then '{"skipped":[]}'::jsonb else '{}'::jsonb end);
   end if;
   -- A failed follow-up read keeps this exact command, its IDs and frozen dialog.
   begin snap:=public._telegram_nurse_visit_detail(r,s,d.visit_member_id,d.visit_source,d.visit_id);
   exception when others then snap:=jsonb_build_object('status','unavailable');end;
   if snap->>'status'='unavailable'then
    update public.channel_inbox set nurse_context=ctx where id=r.id;return public._telegram_nurse_visit_pending(r,coalesce(d.question_version,0),d.visit_member_id,op);end if;
   if snap->>'enabled'is distinct from 'true'then raise insufficient_privilege;end if;
  end if;
 elsif public._telegram_nurse_visit_token(snap)is distinct from ctx->>'token'then
  ctx:=ctx||jsonb_build_object('input',jsonb_build_object('action','refresh'),'error','changed','flow',ctx->'flow'||'{"comment":"","editing":null,"view":"question"}'::jsonb);
 end if;
 ctx:=ctx||jsonb_build_object('snapshot',snap,'token',public._telegram_nurse_visit_token(snap),'renderReady',true);
 update public.channel_inbox set nurse_context=ctx where id=r.id returning * into r;
 return jsonb_build_object('ok',true,'status','visit-render','visit',public._telegram_nurse_visit_work(r,'render'));
exception when insufficient_privilege then
 perform public._telegram_nurse_visit_retire(r,'refused');perform public._telegram_nurse_visit_clear(r.nurse_binding_id,r.nurse_binding_generation);
 perform public._channel_inbox_finish(p_id,'done','nurse_access');return jsonb_build_object('ok',false,'status','refused');
 when lock_not_available or query_canceled or deadlock_detected then return public._telegram_nurse_visit_pending(r,coalesce(d.question_version,0),d.visit_member_id,op);
end$$;

-- Preserve the ready shape consumed by the shared copy, stripping every historical
-- free-text note, completion reason and measurement value before durable output.
create function public._telegram_nurse_visit_safe(p_snapshot jsonb)returns jsonb language plpgsql immutable set search_path=''as $$
declare snap jsonb:=p_snapshot;items_ jsonb:='[]';i jsonb;v jsonb;steps_ jsonb:='[]';e jsonb;
begin
 v:=snap->'visit';
 v:=v||jsonb_build_object('memberName',public._telegram_nurse_slot(v->>'memberName',160),'location',public._telegram_nurse_slot(v->>'location',1000),'clinic',public._telegram_nurse_slot(v->>'clinic',500));
 if v->'completion'<>'null'::jsonb then v:=jsonb_set(v,'{completion,nurseName}',to_jsonb(public._telegram_nurse_slot(v#>>'{completion,nurseName}',160)));end if;
 for i in select value from jsonb_array_elements(snap->'items')loop
  if i->'mark'<>'null'::jsonb then i:=jsonb_set(i,'{mark}',i->'mark'||jsonb_build_object('note',null,'values',null,'nurseName',public._telegram_nurse_slot(i#>>'{mark,nurseName}',160)));end if;
  if i?'title'then i:=jsonb_set(i,'{title}',to_jsonb(public._telegram_nurse_slot(i->>'title',500)));end if;
  if i?'label'then i:=jsonb_set(i,'{label}',jsonb_build_object('en',public._telegram_nurse_slot(i#>>'{label,en}',500),'hy',public._telegram_nurse_slot(i#>>'{label,hy}',500)));end if;
  if i?'model'then i:=jsonb_set(i,'{model}',to_jsonb(public._telegram_nurse_slot(i->>'model',120)));end if;
  if i?'serial'then i:=jsonb_set(i,'{serial}',to_jsonb(public._telegram_nurse_slot(i->>'serial',64)));end if;
  items_:=items_||jsonb_build_array(i);
 end loop;
 for e in select value from jsonb_array_elements(snap->'steps')loop steps_:=steps_||jsonb_build_array(e||jsonb_build_object('by',public._telegram_nurse_slot(e->>'by',160)));end loop;
 snap:=snap||jsonb_build_object('visit',v,'items',items_,'steps',steps_);
 if snap->'completion'<>'null'::jsonb then snap:=jsonb_set(snap,'{completion}',snap->'completion'||jsonb_build_object('reason',null,'nurseName',public._telegram_nurse_slot(snap#>>'{completion,nurseName}',160)));end if;
 return snap;
end$$;
create function public.telegram_nurse_visit_render(p_id uuid,p_enabled boolean,p_attempt integer,p_plan jsonb)returns jsonb
language plpgsql security definer set search_path=''as $$
declare r public.channel_inbox;d public.telegram_nurse_dialogs;s public.workspace_staff;ctx jsonb;snap jsonb;safe_ jsonb;
 q text:=p_plan->>'questionKey';choice_ text;controls_ jsonb:='[]';oid uuid;ref text;v bigint;item_ jsonb;action_ text;
begin
 if auth.role()is distinct from 'service_role'then raise insufficient_privilege;end if;
 select * into r from public.channel_inbox where id=p_id for update;
 if not found or r.attempts is distinct from p_attempt or r.status not in('processing','done')
 or(r.status='processing'and(r.lease_until is null or r.lease_until<=clock_timestamp()))then return jsonb_build_object('ok',false,'status','not_leased');end if;
 s:=public._telegram_nurse_inbox_authority(r);
 if not public._telegram_nurse_on(p_enabled)then raise insufficient_privilege;end if;
 if r.status='done'then return coalesce(r.nurse_result,jsonb_build_object('ok',true,'status','done'));end if;
 perform pg_advisory_xact_lock(hashtextextended('telegram-nurse:'||r.nurse_binding_id::text,0));
 select * into d from public.telegram_nurse_dialogs where binding_id=r.nurse_binding_id and generation=r.nurse_binding_generation for update;
 ctx:=r.nurse_context;
 if ctx->>'action'is distinct from 'visit'or ctx->>'renderReady'is distinct from 'true'or d.pending_inbox is distinct from r.id
 or(ctx->>'questionVersion')::bigint<>d.question_version then return jsonb_build_object('ok',false,'status','stale');end if;
 if jsonb_typeof(p_plan)is distinct from 'object'or p_plan-array['token','questionKey','choices']<>'{}'
 or p_plan->>'token'is distinct from ctx->>'token'or not public._telegram_nurse_visit_key(ctx->'snapshot',q)
 or jsonb_typeof(p_plan->'choices')is distinct from 'array'or jsonb_array_length(p_plan->'choices')>160 then return jsonb_build_object('ok',false,'status','invalid');end if;
 for choice_ in select value#>>'{}'from jsonb_array_elements(p_plan->'choices')loop
  if choice_ not in('answer-done','answer-not-done','skip','comment','comment-back','comment-clear','change','finish','back','complete','refresh','cancel')
   and not(choice_ like 'choose:%'and public._telegram_nurse_visit_key(ctx->'snapshot',substr(choice_,8)))then return jsonb_build_object('ok',false,'status','invalid');end if;
 end loop;
 snap:=public._telegram_nurse_visit_detail(r,s,d.visit_member_id,d.visit_source,d.visit_id);
 if snap->>'status'='unavailable'then return public._telegram_nurse_visit_pending(r,coalesce(d.question_version,0),d.visit_member_id,ctx->>'operation');end if;
 if snap->>'enabled'is distinct from 'true'then raise insufficient_privilege;end if;
 if public._telegram_nurse_visit_token(snap)is distinct from ctx->>'token'then
  ctx:=ctx||jsonb_build_object('snapshot',snap,'token',public._telegram_nurse_visit_token(snap),'error','changed','input',jsonb_build_object('action','refresh'),
   'flow',ctx->'flow'||'{"comment":"","editing":null,"view":"question"}'::jsonb);
  update public.channel_inbox set nurse_context=ctx,payload=payload-'text'where id=r.id returning * into r;
  return jsonb_build_object('ok',true,'status','visit-render','visit',public._telegram_nurse_visit_work(r,'render'));
 end if;
 if ctx->>'recover'='true'then
  update public.telegram_nurse_outbox set abandoned=true where binding_id=d.binding_id and generation=d.generation and state in('sending','unknown');
  update public.telegram_nurse_outbox set state='suppressed'where binding_id=d.binding_id and generation=d.generation and state='queued';
 end if;
 safe_:=public._telegram_nurse_visit_safe(snap);v:=d.question_version+1;action_:=ctx#>>'{input,action}';
 if ctx->>'carrierMessageId'is not null then perform public._telegram_nurse_enqueue(r,v,jsonb_build_object('kind','clear-controls','messageId',(ctx->>'carrierMessageId')::bigint));end if;
 if ctx->>'carrierMessageId'is not null and action_<>'refresh'then
  select i into item_ from jsonb_array_elements(safe_->'items')i where i->>'key'=case when action_ like 'choose:%'then substr(action_,8)else ctx->>'questionKey'end;
  perform public._telegram_nurse_enqueue(r,v,jsonb_build_object('kind','visit-action','nurseName',public._telegram_nurse_slot(s.display_name,160),
   'action',action_,'questionKey',ctx->>'questionKey')||case when item_ is not null then jsonb_build_object('item',item_)else '{}'::jsonb end||case when action_ like 'choose:step:%'then jsonb_build_object('step',substr(action_,13))when ctx->>'questionKey'like 'step:%'then jsonb_build_object('step',substr(ctx->>'questionKey',6))else '{}'::jsonb end,array[d.visit_member_id]);
 end if;
 if action_='open'then
  perform public._telegram_nurse_enqueue(r,v,jsonb_build_object('kind','visit-opening','visit',safe_->'visit',
   'early',((snap#>>'{visit,startsAt}')::timestamptz at time zone 'Asia/Yerevan')::date>(snap->>'today')::date),array[d.visit_member_id]);
 end if;
 oid:=public._telegram_nurse_enqueue(r,v,jsonb_build_object('kind','visit-question','data',safe_,'flow',ctx->'flow'||'{"comment":""}'::jsonb,'controls','[]'::jsonb,'error',ctx->'error'),array[d.visit_member_id]);
 for choice_ in select value#>>'{}'from jsonb_array_elements(p_plan->'choices')loop
  ref:=public._telegram_nurse_visit_arm(oid,d.visit_source,d.visit_id,d.visit_member_id,choice_,q,ctx->>'token');
  controls_:=controls_||jsonb_build_array(jsonb_build_object('action',choice_,'ref',ref));
 end loop;
 update public.telegram_nurse_outbox set turn=jsonb_set(turn,'{controls}',controls_)where id=oid;
 update public.telegram_nurse_dialogs set question_version=v,question_key='visit',expected_mode='both',prompt_message_id=null,pending_inbox=null,
  visit_flow=ctx->'flow',visit_question_key=q,visit_snapshot_token=ctx->>'token',expires_at=clock_timestamp()+interval '30 minutes'
  where binding_id=d.binding_id and generation=d.generation;
 update public.telegram_nurse_outbox set state='suppressed'where binding_id=d.binding_id and generation=d.generation and state='queued'
  and((question_version<>v and turn->>'kind'in('today','task-note','visit-list','visit-question','visit-pending'))or(source_inbox=r.id and turn->>'kind'in('pending','visit-pending')));
 perform public._telegram_nurse_visit_retire(r,case when ctx#>>'{businessResult,status}'='saved'then 'saved'else 'queued'end);
 perform public._channel_inbox_finish(p_id,'done','nurse_visit');
 return jsonb_build_object('ok',true,'status','queued');
exception when insufficient_privilege then
 perform public._telegram_nurse_visit_retire(r,'refused');perform public._telegram_nurse_visit_clear(r.nurse_binding_id,r.nurse_binding_generation);
 perform public._channel_inbox_finish(p_id,'done','nurse_access');return jsonb_build_object('ok',false,'status','refused');
 when lock_not_available or query_canceled or deadlock_detected then return public._telegram_nurse_visit_pending(r,coalesce(d.question_version,0),d.visit_member_id,ctx->>'operation');
end$$;

-- Extend claim/outcome in place: task checks, ordering and one-attempt semantics remain.
create or replace function public.telegram_nurse_outbox_claim(p_id uuid,p_enabled boolean)returns jsonb
language plpgsql security definer set search_path=''as $$
declare o public.telegram_nurse_outbox;d public.telegram_nurse_dialogs;s public.workspace_staff;b public.telegram_auth_bindings;
 r public.channel_inbox;tpl public.system_message_templates;member uuid;aid uuid;turn_kind text;
 snap_ jsonb;selection_ record;
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
 if turn_kind like 'visit-%'and not public._nurse_visit_enabled()then
  update public.telegram_nurse_outbox set state='suppressed'where id=o.id;return jsonb_build_object('ok',false,'status','disabled');end if;
 if turn_kind in('today','task-note','visit-list','visit-question','visit-opening','visit-action','visit-pending')and(o.question_version<>d.question_version or d.expires_at<=clock_timestamp())then
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
 if turn_kind in('visit-question','visit-opening','visit-action')then
  snap_:=public._telegram_nurse_visit_detail(r,s,d.visit_member_id,d.visit_source,d.visit_id);
  if snap_->>'status'='unavailable'then return jsonb_build_object('ok',false,'status','pending');end if;
  if snap_->>'enabled'is distinct from 'true'then
   update public.telegram_nurse_outbox set state='suppressed'where id=o.id;
   perform public._telegram_nurse_visit_clear(d.binding_id,d.generation);return jsonb_build_object('ok',false,'status','access');end if;
  if public._telegram_nurse_visit_token(snap_)is distinct from d.visit_snapshot_token then
   update public.telegram_nurse_outbox set state='suppressed'where id=o.id;return jsonb_build_object('ok',false,'status','stale');end if;
 elsif turn_kind='visit-list'then
  for selection_ in select * from public.telegram_nurse_intents where outbox_id=o.id loop
   snap_:=public._telegram_nurse_visit_detail(r,s,selection_.visit_member_id,selection_.visit_source,selection_.visit_id);
   if snap_->>'status'='unavailable'then return jsonb_build_object('ok',false,'status','pending');end if;
   if snap_->>'enabled'is distinct from 'true'or not(
    (snap_->'completion'='null'::jsonb and((snap_#>>'{visit,startsAt}')::timestamptz at time zone 'Asia/Yerevan')::date=(snap_->>'today')::date)
    or(snap_->'completion'<>'null'::jsonb and exists(select 1 from jsonb_array_elements(snap_->'steps')e where e->>'step'='samples-collected')
     and not exists(select 1 from jsonb_array_elements(snap_->'steps')e where e->>'step'='samples-at-lab')))then
    update public.telegram_nurse_outbox set state='suppressed'where id=o.id;return jsonb_build_object('ok',false,'status','stale');end if;
  end loop;
 end if;
 select * into tpl from public.system_message_templates where template_id=o.template_id and version=o.template_version and locale=o.locale for share;
 if not found or not tpl.approved or tpl.renderer_version is distinct from (case when turn_kind like 'visit-%'then 'nurse-visits-v1' else 'nurse-tasks-v1' end)
  or tpl.clinical_copy_version is distinct from (case when turn_kind like 'visit-%'then 'nurse-visit-copy-v1' else 'nurse-task-copy-v1' end)
  or tpl.substitution_schema is distinct from public._telegram_nurse_template_schema(turn_kind)
  or tpl.body is distinct from (case when turn_kind like 'visit-%'then 'UNAPPROVED nurse-visits-v1 renderer / nurse-visit-copy-v1 / ' else 'UNAPPROVED nurse-tasks-v1 renderer / nurse-task-copy-v1 / ' end)||turn_kind then
  return jsonb_build_object('ok',false,'status','unapproved');end if;
 select * into b from public.telegram_auth_bindings where id=o.binding_id;
 aid:=gen_random_uuid();
 update public.telegram_nurse_outbox set state='sending',attempt_id=aid,claimed_at=clock_timestamp()where id=o.id;
 return jsonb_build_object('ok',true,'envelope',jsonb_build_object('outboxId',o.id,'attemptId',aid,'address',b.address,'locale',o.locale,'turn',o.turn,
  'rendererVersion',tpl.renderer_version,'clinicalCopyVersion',tpl.clinical_copy_version));
exception when insufficient_privilege then
 update public.telegram_nurse_outbox set state='suppressed'where id=p_id and state='queued';
 return jsonb_build_object('ok',false,'status','access');
 when lock_not_available or query_canceled or deadlock_detected then return jsonb_build_object('ok',false,'status','pending');
end$$;
create or replace function public.telegram_nurse_outbox_outcome(p_id uuid,p_attempt uuid,p_enabled boolean,p_result jsonb)returns jsonb
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
   if o.turn->>'kind'in('task-note','visit-question')then
    update public.telegram_nurse_dialogs set prompt_message_id=ref,expires_at=clock_timestamp()+interval '30 minutes'where binding_id=d.binding_id and generation=d.generation;
   end if;
   if o.turn->>'kind'in('today','visit-list','visit-question')then
    update public.telegram_nurse_intents set carrier_message_id=ref,expires_at=clock_timestamp()+interval '30 minutes'where outbox_id=o.id;
    update public.telegram_nurse_dialogs set expires_at=clock_timestamp()+interval '30 minutes'where binding_id=d.binding_id and generation=d.generation;
   end if;
  end if;
 end if;
 return jsonb_build_object('ok',true,'status','recorded');
exception when insufficient_privilege then return jsonb_build_object('ok',false,'status','access');
end$$;

-- Expired drafts have no reason to retain comments. Pending command material stays
-- only in the pinned inbox until an authorized definitive result retires it.
alter function public.auth_cleanup_run()rename to _telegram_nurse_task_cleanup_run;
create function public.auth_cleanup_run()returns jsonb language plpgsql security definer set search_path=''as $$
declare result jsonb;
begin
 if auth.role()is distinct from 'service_role'then raise insufficient_privilege;end if;
 result:=public._telegram_nurse_task_cleanup_run();
 update public.telegram_nurse_dialogs set visit_flow=jsonb_set(visit_flow,'{comment}','""'::jsonb),prompt_message_id=null
 where expires_at<=clock_timestamp()and question_key='visit';
 return result;
end$$;
revoke all on function public.auth_cleanup_run()from public,anon,authenticated,service_role;
grant execute on function public.auth_cleanup_run()to service_role;

create or replace function public._telegram_nurse_enqueue(r public.channel_inbox,p_question bigint,p_turn jsonb,p_members uuid[] default '{}')returns uuid
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
create or replace function public.telegram_nurse_resume(p_id uuid,p_enabled boolean,p_attempt integer)returns jsonb
language plpgsql security definer set search_path=''as $$
begin
 if auth.role()is distinct from 'service_role'then raise insufficient_privilege;end if;
 return public.telegram_nurse_apply(p_id,p_enabled,p_attempt);
end$$;

do $$declare f regprocedure;begin
 for f in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public'and(p.proname like '\_telegram\_nurse\_%'escape '\'or p.proname like 'telegram\_nurse\_%'escape '\')loop
  execute format('revoke all on function %s from public,anon,authenticated,service_role',f);
  if f::text like 'telegram_nurse_%'or f::text like 'public.telegram_nurse_%'then execute format('grant execute on function %s to service_role',f);end if;
 end loop;
end$$;
