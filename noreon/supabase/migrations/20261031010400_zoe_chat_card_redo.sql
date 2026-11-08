-- Zoe chat cards: an edited or forwarded text asks for a new message (QA a9-05), a refusal comes in the member's language (QA a9-03),
-- and a side effect chosen on a card enters the inbox as the member's own message. Dark with zoe_chat_actions_enabled.
-- Files through Telegram are out of the pilot (decision of 30 Oct): a file is media, nothing of it is fetched, and the member's reply
-- points to the app's upload page once that wording is approved. Until then the existing media reply goes.

alter table public.channel_inbox drop constraint channel_inbox_kind_check;
alter table public.channel_inbox add constraint channel_inbox_kind_check check(kind in('text','link','start','callback','media','contact','rejected','redo'));

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
 or(kind='text'and(payload-array['text','chatId','messageId']<>'{}'or jsonb_typeof(payload->'text')is distinct from 'string'or public._conversation_utf16(payload->>'text')not between 1 and 4096))
 or(kind='link'and(payload-array['tokenHash','chatId','messageId']<>'{}'or coalesce(payload->>'tokenHash','')!~'^[a-f0-9]{64}$'))
 or(kind='contact'and(jsonb_typeof(payload->'sentAt')is distinct from 'number'or not(
  (payload-array['phone','sentAt','chatId','messageId']='{}'and coalesce(payload->>'phone','')~'^\+[1-9][0-9]{6,14}$')
  or(payload-array['foreign','sentAt','chatId','messageId']='{}'and payload->'foreign'='true'::jsonb))))
 or(kind in('start','media','redo')and payload-array['chatId','messageId']<>'{}')
 or(kind='callback'and(payload-array['chatId','messageId','callbackId','intentRef']<>'{}'
  or jsonb_typeof(payload->'callbackId')is distinct from 'string'or coalesce(payload->>'callbackId','')!~'^[A-Za-z0-9_-]{1,128}$'
  or jsonb_typeof(payload->'intentRef')is distinct from 'string'or coalesce(payload->>'intentRef','')!~'^[A-Za-z0-9_-]{16,60}$'))
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

-- An edited or forwarded text (QA a9-05): not read, because it was not written here just now, and a reading in it must not be
-- taken as new. Nothing of it is stored. A linked member is told to send it as a new message; anyone else gets nothing, as before.
create function public._channel_inbox_receive_redo(r public.channel_inbox)returns jsonb
language plpgsql security definer set search_path=''as $$
declare ep public.conversation_endpoints;
begin
 if r.endpoint_id is not null and public._zoe_chat_actions_on()then
  select * into ep from public.conversation_endpoints where id=r.endpoint_id for share;
  if found and ep.active and ep.generation=r.endpoint_generation and ep.principal_ref=r.principal_ref and ep.expires_at>clock_timestamp()and public._telegram_member_eligible(ep.member_id)then
   return jsonb_build_object('ok',true,'redo',jsonb_build_object('inboxId',r.id,'memberId',ep.member_id,'locale',public._telegram_auth_locale(ep.member_id)));
  end if;
 end if;
 return public._channel_inbox_finish(r.id,'done','ignored_redo');
end$$;

create or replace function public.channel_inbox_process(p_id uuid)returns jsonb
language plpgsql security definer set search_path=''as $$
declare r public.channel_inbox;
begin
 if auth.role()is distinct from 'service_role'then raise insufficient_privilege;end if;
 perform set_config('lock_timeout','3s',true);
 select * into r from public.channel_inbox where id=p_id for update;
 if not found or r.status<>'processing'then return jsonb_build_object('ok',false,'code','not_leased');end if;
 begin
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

-- A redo row ends here too.
create or replace function public.channel_inbox_press_done(p_id uuid,p_result text)returns jsonb
language plpgsql security definer set search_path=''as $$
declare n integer;
begin
 if auth.role()is distinct from 'service_role'then raise insufficient_privilege;end if;
 if p_id is null or coalesce(p_result,'')!~'^[a-z_]{1,48}$'then return jsonb_build_object('ok',false,'code','invalid');end if;
 update public.channel_inbox set status='done',result='press_'||p_result,processed_at=clock_timestamp(),lease_until=null,payload=payload-'intentRef'
  where id=p_id and(kind in('callback','redo')or(kind='text'and public._channel_text_is_menu(payload->>'text')))and status='processing';
 get diagnostics n=row_count;
 return jsonb_build_object('ok',n=1);
end$$;

-- A side effect chosen on a card is the member's own message: it enters the inbox as a text from the same chat, so Zoe's checks,
-- care alerts and the doctor see it exactly as if it were typed. The words are the card's fixed label. Once per card and choice.
create function public.channel_inbox_card_text(p_press uuid,p_card uuid,p_text text)returns jsonb
language plpgsql security definer set search_path=''as $$
declare r public.channel_inbox;t public.channel_inbox;id_ text;
begin
 if auth.role()is distinct from 'service_role'then raise insufficient_privilege;end if;
 if p_card is null or coalesce(public._conversation_utf16(p_text),0)not between 1 and 4096 then return jsonb_build_object('ok',false,'code','invalid');end if;
 select * into r from public.channel_inbox where id=p_press and kind='callback';
 if not found then return jsonb_build_object('ok',false,'code','not_found');end if;
 id_:=r.adapter||':card_text:'||p_card::text;
 insert into public.channel_inbox(adapter,event_id,fingerprint,principal_ref,kind,payload,endpoint_id,endpoint_generation)
 values(r.adapter,id_,id_,r.principal_ref,'text',jsonb_build_object('text',p_text,'chatId',r.payload->'chatId','messageId',r.payload->'messageId'),r.endpoint_id,r.endpoint_generation)
 on conflict(event_id)do nothing returning * into t;
 -- Received now, so this sweep's screening and Zoe's run see it, as they do a typed message (Astra).
 if t.id is not null then
  update public.channel_inbox set status='processing',attempts=1,lease_until=clock_timestamp()+interval '60 seconds'where id=t.id returning * into t;
  perform public._channel_inbox_receive_text(t);
 end if;
 return jsonb_build_object('ok',true);
end$$;
alter table public.zoe_chat_card_intents drop constraint zoe_chat_card_intents_action_check;
alter table public.zoe_chat_card_intents add constraint zoe_chat_card_intents_action_check check(action in('dose_taken','dose_skipped','bp_save','open_card','show_current','visit_accept','ldl_visit_accept','ask_reason','side_effect_pick'));
revoke all on function public.channel_inbox_card_text(uuid,uuid,text)from public,anon,authenticated;
grant execute on function public.channel_inbox_card_text(uuid,uuid,text)to service_role;

revoke all on function public._channel_inbox_receive_redo(public.channel_inbox)from public,anon,authenticated,service_role;

create or replace function public._channel_inbox_receive_callback(r public.channel_inbox)returns jsonb
language plpgsql security definer set search_path=''as $$
declare ep public.conversation_endpoints;i public.zoe_chat_card_intents;bound uuid;
begin
 -- The chat is not linked: the same next step as a text from it, and the press does nothing. A chat still bound for
 -- sign-in is answered in its member's language; that binding gives this press no other standing.
 if r.endpoint_id is null then
  select b.auth_user_id into bound from public.telegram_auth_bindings b where b.principal_ref=r.principal_ref and b.active and b.kind='member';
  perform public._telegram_bot_next_step(r);
  return public._channel_inbox_press_refused(r,bound,'not_linked');
 end if;
 select * into ep from public.conversation_endpoints where id=r.endpoint_id for share;
 -- G2: the endpoint must still be the exact generation the press arrived under.
 if not found or not ep.active or ep.generation<>r.endpoint_generation or ep.principal_ref<>r.principal_ref then
  perform public._telegram_audit(ep.member_id,'inbox.generation_mismatch',jsonb_build_object('inboxId',r.id));
  -- In the language of the member the chat belonged to (QA a9-03); an unknown endpoint has none.
  return public._channel_inbox_press_refused(r,ep.member_id,'not_linked');end if;
 if ep.expires_at<=clock_timestamp()then return public._channel_inbox_press_refused(r,ep.member_id,'binding_expired');end if;
 if not public._telegram_member_eligible(ep.member_id)then return public._channel_inbox_press_refused(r,ep.member_id,'not_eligible');end if;
 if not public._zoe_chat_actions_on()then return public._channel_inbox_press_refused(r,ep.member_id,'disabled');end if;
 select * into i from public.zoe_chat_card_intents where ref_hash=encode(sha256(convert_to(r.payload->>'intentRef','UTF8')),'hex');
 -- Unknown, or issued to anyone else or to an earlier link: the same answer, so a guess learns nothing.
 if not found or i.member_id<>ep.member_id or i.endpoint_id<>ep.id or i.endpoint_generation<>ep.generation then
  return public._channel_inbox_press_refused(r,ep.member_id,'unknown');end if;
 if i.expires_at<=clock_timestamp()then return public._channel_inbox_press_refused(r,ep.member_id,'expired');end if;
 return jsonb_build_object('ok',true,'press',jsonb_build_object('inboxId',r.id,'callbackId',r.payload->>'callbackId','chatId',r.payload->'chatId','messageId',r.payload->'messageId',
  'memberId',ep.member_id,'endpointId',ep.id,'generation',ep.generation,'cardId',i.card_id,'action',i.action,'item',i.item,'locale',public._telegram_auth_locale(ep.member_id)));
end$$;

-- The media reply, for a file or anything else that is not text. Nothing is downloaded: this row holds only identifiers.
insert into public.system_message_templates(template_id,version,locale,body)values
 ('telegram.media_to_app',1,'en','UNAPPROVED PLACEHOLDER. We can only read text messages here, not photos, voice messages, files or their captions. To send a report or photo, open Progress in the Noreon app and choose Add earlier results. This chat is not for emergencies. If you think you may be in danger, call 103 now.'),
 ('telegram.media_to_app',1,'hy','UNAPPROVED PLACEHOLDER. Այստեղ կարող ենք կարդալ միայն տեքստային հաղորդագրություններ, ոչ լուսանկարներ, ձայնային հաղորդագրություններ, ֆայլեր կամ դրանց նկարագրությունները։ Հաշվետվություն կամ լուսանկար ուղարկելու համար Noreon հավելվածում բացեք «Առաջընթաց» բաժինը և ընտրեք «Ավելացնել նախկին արդյունքներ»։ Այս զրույցը շտապ դեպքերի համար չէ։ Եթե կարծում եք, որ կարող եք վտանգի մեջ լինել, անմիջապես զանգահարեք 103։');

create or replace function public._channel_inbox_receive_media(r public.channel_inbox)returns jsonb
language plpgsql security definer set search_path=''as $$
declare ep public.conversation_endpoints;cs public.patient_clinical_cases;c public.conversations;p public.conversation_policy;nx jsonb;
begin
 if r.endpoint_id is null then
  nx:=public._telegram_bot_next_step(r);
  if nx->>'result'='linked'then
   r.endpoint_id:=(nx->>'endpointId')::uuid;r.endpoint_generation:=(nx->>'generation')::bigint;
   update public.channel_inbox set endpoint_id=r.endpoint_id,endpoint_generation=r.endpoint_generation where id=r.id;
   return public._channel_inbox_receive_media(r);
  end if;
  return public._channel_inbox_finish(r.id,'done','principal_not_linked');
 end if;
 select * into ep from public.conversation_endpoints where id=r.endpoint_id;
 select * into cs from public.patient_clinical_cases where user_id=ep.member_id for update;
 select * into ep from public.conversation_endpoints where id=r.endpoint_id for share;
 if not found or not ep.active or ep.generation<>r.endpoint_generation or ep.principal_ref<>r.principal_ref then
  perform public._telegram_audit(ep.member_id,'inbox.generation_mismatch',jsonb_build_object('inboxId',r.id));
  return public._channel_inbox_finish(r.id,'done','generation_mismatch');end if;
 if cs.user_id is null or not public._telegram_member_eligible(ep.member_id)then
  nx:=public._telegram_bot_next_step(r);
  return public._channel_inbox_finish(r.id,'done','member_not_eligible');end if;
 select * into p from public.conversation_policy where singleton;
 if not found then raise exception using errcode='55000',message='Conversation policy unavailable';end if;
 insert into public.conversations(member_id)values(ep.member_id)on conflict(member_id)do nothing;
 select * into c from public.conversations where member_id=ep.member_id for update;
 update public.conversations set version=version+1 where id=c.id returning * into c;
 update public.conversation_intents set state='invalidated'where state='open'and draft_id in(select id from public.conversation_drafts where conversation_id=c.id);
 update public.conversation_deliveries set state='held',reason='member_sent_unsupported_media',state_seq=state_seq+1 where conversation_id=c.id and state='queued';
 update public.conversation_deliveries set review_after_send=true where conversation_id=c.id and state in('sending','unknown');
 update public.conversation_drafts set state='superseded'where conversation_id=c.id and state in('pending','info_requested');
 if not exists(select 1 from public.conversation_audit where conversation_id=c.id and kind='message.media'and created_at>clock_timestamp()-make_interval(secs=>p.intake_window_seconds))then
  insert into public.conversation_doctor_alerts(conversation_id,member_id,doctor_id,message_seq,inbox_id)values(c.id,ep.member_id,cs.assigned_doctor_id,c.version,r.id);
  -- The wording that names the upload page goes only once its newest version is approved for this language.
  perform public._system_message_enqueue(coalesce((select case when t.approved then t.template_id end from public.system_message_templates t
    where t.template_id='telegram.media_to_app'and t.locale=coalesce((select locale from public.profiles where id=ep.member_id),'hy')order by t.version desc limit 1),
   'telegram.unsupported_media'),ep.member_id,ep,r.id);
 end if;
 insert into public.conversation_audit(conversation_id,actor_id,kind,detail)values(c.id,null,'message.media',jsonb_build_object('channel','telegram','inboxId',r.id,'version',c.version));
 return public._channel_inbox_finish(r.id,'done','media');
end$$;

-- The acknowledgement decision knows the new reply, so the trace does not call a first reply already acknowledged (Astra REVIEW_21).
create or replace function public._trace_channel_inbox()returns trigger language plpgsql security definer set search_path=''as $$
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
  select * into ack from public.system_messages where source_inbox_id=new.id and template_id in('telegram.ack','telegram.unsupported_media','telegram.media_to_app');
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
