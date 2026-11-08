-- The bot always answers (Khikar, 17 Oct 2026). A message from a chat with no replies link, or
-- from a member who cannot message yet, used to be dropped silently; Khikar's own "hello" was
-- (no review request yet, so no clinical case and no replies link). Now:
--  * a chat bound to a member account (Telegram sign-in) gets that member's next step with a link
--    to the right page (profile, questionnaire, review request, or turning replies back on); when the
--    member can already message, the chat is linked now (enrolment consent, as at sign-in) and the
--    message is received normally;
--  * a chat bound only to a staff account is told it is for staff sign-in codes;
--  * an unknown chat gets a sign-up pointer to the app.
-- This covers text, photos and other media, and a bare /start (a member who can already message
-- is told so). An expired sign-in link already answers (telegram.link_expired). A member who has a
-- case but cannot message (banned, phone no longer confirmed) gets the generic pointer.
-- At most one such reply per chat per hour. Every reply carries the 103 line. Replies go through the
-- Telegram auth outbox, which holds unapproved wording (STAGING copies via a SQL step). The one-tap
-- sign-in link is a separate change.

insert into public.system_message_templates(template_id,version,locale,body)values
 ('telegram.signup',1,'hy','UNAPPROVED PLACEHOLDER. Noreon-ին միանալու համար բացեք https://app.noreon.health/patient և մուտք գործեք ձեր հեռախոսահամարով։ Շտապ դեպքում զանգահարեք 103։
To get started, open https://app.noreon.health/patient and sign in with your phone number. In an emergency, call 103.'),
 ('telegram.signup',1,'en','UNAPPROVED PLACEHOLDER. To get started, open https://app.noreon.health/patient and sign in with your phone number. In an emergency, call 103.'),
 ('telegram.staff_chat',1,'hy','UNAPPROVED PLACEHOLDER. Այս զրույցն օգտագործվում է ձեր Noreon աշխատակցի մուտքի կոդերի համար։ Շտապ դեպքում զանգահարեք 103։
This chat is used for your Noreon staff sign-in codes. In an emergency, call 103.'),
 ('telegram.staff_chat',1,'en','UNAPPROVED PLACEHOLDER. This chat is used for your Noreon staff sign-in codes. In an emergency, call 103.'),
 ('telegram.next_profile',1,'hy','UNAPPROVED PLACEHOLDER. Ձեր խնամքի թիմին գրելու համար նախ լրացրեք ձեր պրոֆիլը՝ https://app.noreon.health/patient/profile Շտապ դեպքում զանգահարեք 103։
To message your care team, first complete your profile: https://app.noreon.health/patient/profile In an emergency, call 103.'),
 ('telegram.next_profile',1,'en','UNAPPROVED PLACEHOLDER. To message your care team, first complete your profile: https://app.noreon.health/patient/profile In an emergency, call 103.'),
 ('telegram.next_questionnaire',1,'hy','UNAPPROVED PLACEHOLDER. Ձեր խնամքի թիմին գրելու համար նախ ավարտեք առողջական հարցաշարը՝ https://app.noreon.health/patient/questions Շտապ դեպքում զանգահարեք 103։
To message your care team, first finish your health questionnaire: https://app.noreon.health/patient/questions In an emergency, call 103.'),
 ('telegram.next_questionnaire',1,'en','UNAPPROVED PLACEHOLDER. To message your care team, first finish your health questionnaire: https://app.noreon.health/patient/questions In an emergency, call 103.'),
 ('telegram.next_review',1,'hy','UNAPPROVED PLACEHOLDER. Ձեր խնամքի թիմին գրելու համար ուղարկեք դիտարկման հայտը՝ https://app.noreon.health/patient/review Շտապ դեպքում զանգահարեք 103։
To message your care team, send your review request: https://app.noreon.health/patient/review In an emergency, call 103.'),
 ('telegram.next_review',1,'en','UNAPPROVED PLACEHOLDER. To message your care team, send your review request: https://app.noreon.health/patient/review In an emergency, call 103.'),
 ('telegram.replies_off',1,'hy','UNAPPROVED PLACEHOLDER. Telegram-ով պատասխաններն անջատված են։ Միացրեք դրանք այստեղ՝ https://app.noreon.health/patient/account/telegram Շտապ դեպքում զանգահարեք 103։
Replies in Telegram are turned off. Turn them on here: https://app.noreon.health/patient/account/telegram In an emergency, call 103.'),
 ('telegram.replies_off',1,'en','UNAPPROVED PLACEHOLDER. Replies in Telegram are turned off. Turn them on here: https://app.noreon.health/patient/account/telegram In an emergency, call 103.'),
 ('telegram.ready',1,'hy','UNAPPROVED PLACEHOLDER. Կարող եք գրել ձեր խնամքի թիմին այստեղ։ Շտապ դեպքում զանգահարեք 103։
You can message your care team here. In an emergency, call 103.'),
 ('telegram.ready',1,'en','UNAPPROVED PLACEHOLDER. You can message your care team here. In an emergency, call 103.');

-- What to tell this chat; links the chat when the bound member can already message.
create function public._telegram_bot_next_step(r public.channel_inbox)returns jsonb
language plpgsql security definer set search_path=''as $$
declare addr text:=r.payload->>'chatId';s public.telegram_channel_settings;b public.telegram_auth_bindings;u uuid;step text;tpl text;loc text;act jsonb;ep public.conversation_endpoints;
begin
 if r.principal_ref is null or coalesce(addr,'')!~'^[1-9][0-9]{0,15}$'then return jsonb_build_object('result','no_chat');end if;
 select * into s from public.telegram_channel_settings where singleton;
 select * into b from public.telegram_auth_bindings where principal_ref=r.principal_ref and active and kind='member'
  and account_ref=public._telegram_account_ref(s);
 if found then
  u:=b.auth_user_id;
  if exists(select 1 from public.workspace_staff where user_id=u)then step:='staff_chat';
  elsif not exists(select 1 from public.profiles where id=u and nullif(btrim(display_name),'')is not null and birth_date is not null and biological_sex in('male','female'))
   or not exists(select 1 from public.patient_consents where user_id=u and version='patient-pilot-v1')then step:='next_profile';
  elsif not exists(select 1 from public.patient_assessments where user_id=u and completed_at is not null)then step:='next_questionnaire';
  elsif not exists(select 1 from public.patient_clinical_cases where user_id=u)then step:='next_review';
  elsif r.endpoint_id is not null then
   -- Already linked (the caller may hold the case lock: never relink here, lock order).
   step:=case when public._telegram_member_eligible(u)then 'ready'else 'unavailable'end;
  else
   -- Can message: link this chat now (respects the member's own turn-off).
   act:=public._telegram_replies_auto(u,false);
   if act->>'ok'='true'then
    select * into ep from public.conversation_endpoints where member_id=u and adapter='telegram'and active and principal_ref=r.principal_ref;
    if ep.id is not null then
     if r.kind in('text','media')then return jsonb_build_object('result','linked','endpointId',ep.id,'generation',ep.generation);end if;
     -- /start that links the chat now: the link confirmation already answers (one message, not two).
     if act->>'result'='linked'then return jsonb_build_object('result','linked');end if;
     step:='ready';
    end if;
   end if;
   step:=coalesce(step,case when act->>'code'='turned_off'then 'replies_off'else 'unavailable'end);
  end if;
  loc:=public._telegram_auth_locale(u);
 elsif exists(select 1 from public.telegram_auth_bindings where principal_ref=r.principal_ref and active and kind='staff')then
  step:='staff_chat';loc:='hy';
 else
  step:='signup';loc:='hy';
 end if;
 -- A member who cannot message for another reason gets the generic pointer (sign in in the app).
 tpl:='telegram.'||case when step='unavailable'then 'signup'else step end;
 -- At most one next-step reply per chat per hour, serialized per chat (a leaf lock nothing else takes).
 perform pg_advisory_xact_lock(hashtextextended('telegram-next-step:'||r.principal_ref,0));
 if exists(select 1 from public.telegram_auth_messages where principal_ref=r.principal_ref
   and template_id in('telegram.signup','telegram.staff_chat','telegram.next_profile','telegram.next_questionnaire','telegram.next_review','telegram.replies_off','telegram.ready')
   and created_at>clock_timestamp()-interval '1 hour')then
  perform public._telegram_audit(u,'bot.next_step',jsonb_build_object('step',step,'inboxId',r.id,'rateLimited',true));
  return jsonb_build_object('result',step||'_rate_limited');end if;
 perform public._telegram_auth_enqueue(tpl,coalesce(loc,'hy'),addr,r.principal_ref,null,r.id);
 perform public._telegram_audit(u,'bot.next_step',jsonb_build_object('step',step,'inboxId',r.id));
 return jsonb_build_object('result',step);
end$$;
revoke all on function public._telegram_bot_next_step(public.channel_inbox)from public,anon,authenticated,service_role;

create or replace function public._channel_inbox_receive_text(r public.channel_inbox)returns jsonb
language plpgsql security definer set search_path=''as $$
declare ep public.conversation_endpoints;cs public.patient_clinical_cases;c public.conversations;p public.conversation_policy;nx jsonb;
begin
 -- The bot always answers (Khikar, 17 Oct): an unlinked chat gets its next step, or, when the bound
 -- member can already message, is linked now and this message is received.
 if r.endpoint_id is null then
  nx:=public._telegram_bot_next_step(r);
  if nx->>'result'='linked'then
   r.endpoint_id:=(nx->>'endpointId')::uuid;r.endpoint_generation:=(nx->>'generation')::bigint;
   update public.channel_inbox set endpoint_id=r.endpoint_id,endpoint_generation=r.endpoint_generation where id=r.id;
   return public._channel_inbox_receive_text(r);
  end if;
  -- The result stays as before (the trace view classifies on it); the step is in the audit.
  return public._channel_inbox_finish(r.id,'done','principal_not_linked');
 end if;
 select * into ep from public.conversation_endpoints where id=r.endpoint_id;
 select * into cs from public.patient_clinical_cases where user_id=ep.member_id for update;
 select * into ep from public.conversation_endpoints where id=r.endpoint_id for share;
 -- G2: the endpoint must still be the exact generation the event arrived under.
 if not found or not ep.active or ep.generation<>r.endpoint_generation or ep.principal_ref<>r.principal_ref then
  perform public._telegram_audit(ep.member_id,'inbox.generation_mismatch',jsonb_build_object('inboxId',r.id));
  return public._channel_inbox_finish(r.id,'done','generation_mismatch');end if;
 if cs.user_id is null or not public._telegram_member_eligible(ep.member_id)then
  nx:=public._telegram_bot_next_step(r);
  return public._channel_inbox_finish(r.id,'done','member_not_eligible');
 end if;
 select * into p from public.conversation_policy where singleton;
 if not found then raise exception using errcode='55000',message='Conversation policy unavailable';end if;
 insert into public.conversations(member_id)values(ep.member_id)on conflict(member_id)do nothing;
 select * into c from public.conversations where member_id=ep.member_id for update;
 if(select count(*)from public.conversation_messages where conversation_id=c.id and created_at>clock_timestamp()-make_interval(secs=>p.intake_window_seconds))>=p.intake_max_messages then
  -- Over the intake limit the text is not stored, but the safety path still runs: the
  -- conversation moves on so no earlier approval can be sent, and the doctor alert and
  -- acknowledgement are recorded once per intake window (bounded, never per message).
  update public.conversations set version=version+1 where id=c.id returning * into c;
  update public.conversation_intents set state='invalidated'where state='open'and draft_id in(select id from public.conversation_drafts where conversation_id=c.id);
  update public.conversation_deliveries set state='held',reason='member_over_intake_limit',state_seq=state_seq+1 where conversation_id=c.id and state='queued';
  update public.conversation_deliveries set review_after_send=true where conversation_id=c.id and state in('sending','unknown');
  update public.conversation_drafts set state='superseded'where conversation_id=c.id and state in('pending','info_requested');
  if not exists(select 1 from public.conversation_audit where conversation_id=c.id and kind='message.overflow'and created_at>clock_timestamp()-make_interval(secs=>p.intake_window_seconds))then
   insert into public.conversation_doctor_alerts(conversation_id,member_id,doctor_id,message_seq,inbox_id)values(c.id,ep.member_id,cs.assigned_doctor_id,c.version,r.id);
   perform public._system_message_enqueue('telegram.ack',ep.member_id,ep,r.id);
  end if;
  insert into public.conversation_audit(conversation_id,actor_id,kind,detail)values(c.id,null,'message.overflow',jsonb_build_object('channel','telegram','inboxId',r.id,'version',c.version));
  return public._channel_inbox_finish(r.id,'done','rate_limited');end if;
 update public.conversations set version=version+1 where id=c.id returning * into c;
 insert into public.conversation_messages(conversation_id,seq,author_id,body,source,request_id)values(c.id,c.version,ep.member_id,r.payload->>'text','telegram_member',r.id);
 -- Same invalidation as conversation_receive: new information voids earlier approvals.
 update public.conversation_intents set state='invalidated'where state='open'and draft_id in(select id from public.conversation_drafts where conversation_id=c.id);
 update public.conversation_deliveries set state='held',reason='newer_member_message',state_seq=state_seq+1 where conversation_id=c.id and state='queued';
 update public.conversation_deliveries set review_after_send=true where conversation_id=c.id and state in('sending','unknown');
 update public.conversation_drafts set state='superseded'where conversation_id=c.id and state in('pending','info_requested');
 insert into public.conversation_audit(conversation_id,actor_id,kind,detail)values(c.id,null,'message.received',jsonb_build_object('channel','telegram','inboxId',r.id,'seq',c.version));
 -- Urgent minimum: the doctor alert and the fixed acknowledgement are both recorded
 -- here, independently; a later send failure of one never affects the other.
 insert into public.conversation_doctor_alerts(conversation_id,member_id,doctor_id,message_seq,inbox_id)values(c.id,ep.member_id,cs.assigned_doctor_id,c.version,r.id);
 perform public._system_message_enqueue('telegram.ack',ep.member_id,ep,r.id);
 return public._channel_inbox_finish(r.id,'done','received');
end$$;

-- Photos and other media from an unlinked chat, or a member who cannot message: same answer as text.
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
  perform public._system_message_enqueue('telegram.unsupported_media',ep.member_id,ep,r.id);
 end if;
 insert into public.conversation_audit(conversation_id,actor_id,kind,detail)values(c.id,null,'message.media',jsonb_build_object('channel','telegram','inboxId',r.id,'version',c.version));
 return public._channel_inbox_finish(r.id,'done','media');
end$$;

-- A bare /start (the first thing a new person taps) answers too; the result stays ignored_start.
create or replace function public.channel_inbox_process(p_id uuid)returns jsonb
language plpgsql security definer set search_path=''as $$
declare r public.channel_inbox;
begin
 if auth.role()is distinct from 'service_role'then raise insufficient_privilege;end if;
 perform set_config('lock_timeout','3s',true);
 select * into r from public.channel_inbox where id=p_id for update;
 if not found or r.status<>'processing'then return jsonb_build_object('ok',false,'code','not_leased');end if;
 begin
  if r.kind='text'then return public._channel_inbox_receive_text(r);
  elsif r.kind='media'then return public._channel_inbox_receive_media(r);
  elsif r.kind='link'then return public._telegram_auth_start(r);
  elsif r.kind='contact'then return public._telegram_auth_contact(r);
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
