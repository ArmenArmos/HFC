-- Telegram T1 follow-up (activation blocker AB-2): a linked member's photo, voice
-- note, file or other non-text message is no longer dropped silently. Only the
-- message identifiers are stored; the member gets a fixed reply (UNAPPROVED wording,
-- held at claim until signed off) and the assigned doctor an alert, once per intake
-- window. Ships dark like T1.

alter table public.channel_inbox drop constraint channel_inbox_kind_check;
alter table public.channel_inbox add constraint channel_inbox_kind_check check(kind in('text','link','start','callback','media','rejected'));

insert into public.system_message_templates(template_id,version,locale,body)values
 ('telegram.unsupported_media',1,'en','UNAPPROVED PLACEHOLDER. We can only read text messages here, not photos, voice messages, files or their captions. Please write your message as text. This chat is not for emergencies. If you think you may be in danger, call 103 now.'),
 ('telegram.unsupported_media',1,'hy','UNAPPROVED PLACEHOLDER. Այստեղ կարող ենք կարդալ միայն տեքստային հաղորդագրություններ, ոչ լուսանկարներ, ձայնային հաղորդագրություններ, ֆայլեր կամ դրանց նկարագրությունները։ Խնդրում ենք գրել ձեր հաղորդագրությունը տեքստով։ Այս զրույցը շտապ դեպքերի համար չէ։ Եթե կարծում եք, որ վտանգի մեջ եք, անմիջապես զանգահարեք 103։');

-- A private photo, voice note, file or other non-text message from a linked member.
-- Its content is never received or stored. The conversation moves on (earlier
-- approvals cannot send), and once per intake window the doctor is alerted and the
-- member is told the bot reads text only (wording UNAPPROVED, held at claim).
create function public._channel_inbox_receive_media(r public.channel_inbox)returns jsonb
language plpgsql security definer set search_path=''as $$
declare ep public.conversation_endpoints;cs public.patient_clinical_cases;c public.conversations;p public.conversation_policy;
begin
 if r.endpoint_id is null then return public._channel_inbox_finish(r.id,'done','principal_not_linked');end if;
 select * into ep from public.conversation_endpoints where id=r.endpoint_id;
 select * into cs from public.patient_clinical_cases where user_id=ep.member_id for update;
 select * into ep from public.conversation_endpoints where id=r.endpoint_id for share;
 if not found or not ep.active or ep.generation<>r.endpoint_generation or ep.principal_ref<>r.principal_ref then
  perform public._telegram_audit(ep.member_id,'inbox.generation_mismatch',jsonb_build_object('inboxId',r.id));
  return public._channel_inbox_finish(r.id,'done','generation_mismatch');end if;
 if cs.user_id is null or not public._telegram_member_eligible(ep.member_id)then return public._channel_inbox_finish(r.id,'done','member_not_eligible');end if;
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

create or replace function public.channel_inbox_commit(p_event jsonb)returns jsonb
language plpgsql security definer set search_path=''as $$
declare s public.telegram_channel_settings;kind text:=p_event->>'kind';ep public.conversation_endpoints;existing public.channel_inbox;inserted uuid;payload jsonb:=p_event->'payload';
begin
 if auth.role()is distinct from 'service_role'then raise insufficient_privilege;end if;
 if jsonb_typeof(p_event)is distinct from 'object'or p_event-array['adapter','eventId','fingerprint','principalRef','kind','payload']<>'{}'
 or not(p_event?&array['adapter','eventId','fingerprint','principalRef','kind','payload'])
 or p_event->>'adapter'is distinct from 'telegram'or coalesce(kind,'')not in('text','link','start','callback','media')
 or jsonb_typeof(p_event->'eventId')is distinct from 'string'or jsonb_typeof(p_event->'fingerprint')is distinct from 'string'or jsonb_typeof(p_event->'principalRef')is distinct from 'string'
 or length(p_event->>'eventId')not between 1 and 256 or length(p_event->>'fingerprint')not between 1 and 256 or length(p_event->>'principalRef')not between 1 and 256
 or jsonb_typeof(payload)is distinct from 'object'
 or(kind='text'and(payload-array['text','chatId','messageId']<>'{}'or jsonb_typeof(payload->'text')is distinct from 'string'or public._conversation_utf16(payload->>'text')not between 1 and 4096))
 or(kind='link'and(payload-array['tokenHash','chatId','messageId']<>'{}'or coalesce(payload->>'tokenHash','')!~'^[a-f0-9]{64}$'))
 or(kind in('start','callback','media')and payload-array['chatId','messageId']<>'{}')
 or jsonb_typeof(payload->'chatId')is distinct from 'number'or jsonb_typeof(payload->'messageId')is distinct from 'number'
 then return jsonb_build_object('status','failed','code','invalid_event');end if;
 select * into s from public.telegram_channel_settings where singleton;
 if not found then return jsonb_build_object('status','failed','code','unavailable');end if;
 -- Only principals of the configured bot, in their own private chat, are admitted.
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

create or replace function public.channel_inbox_process(p_id uuid)returns jsonb
language plpgsql security definer set search_path=''as $$
declare r public.channel_inbox;res jsonb;ep public.conversation_endpoints;
begin
 if auth.role()is distinct from 'service_role'then raise insufficient_privilege;end if;
 perform set_config('lock_timeout','3s',true);
 select * into r from public.channel_inbox where id=p_id for update;
 if not found or r.status<>'processing'then return jsonb_build_object('ok',false,'code','not_leased');end if;
 begin
  if r.kind='text'then return public._channel_inbox_receive_text(r);
  elsif r.kind='media'then return public._channel_inbox_receive_media(r);
  elsif r.kind='link'then
   res:=public._telegram_link_redeem(r.payload->>'tokenHash',r.principal_ref,(r.payload->>'chatId')::bigint);
   if res->>'ok'='true'then
    select * into ep from public.conversation_endpoints where id=(res->>'endpointId')::uuid;
    perform public._system_message_enqueue('telegram.link_confirmed',ep.member_id,ep,r.id);
   end if;
   return public._channel_inbox_finish(r.id,'done','link:'||(case when res->>'ok'='true'then 'linked'else res->>'code'end));
  else
   -- A bare /start or a button press does nothing in T1 (buttons arrive in T4).
   return public._channel_inbox_finish(r.id,'done','ignored_'||r.kind);
  end if;
 exception when others then
  -- Leave the lease to expire for a retry; record the error class only, never text.
  update public.channel_inbox set last_error=sqlstate where id=r.id;
  return jsonb_build_object('ok',false,'code','retry','sqlstate',sqlstate);
 end;
end$$;

create or replace function public.conversation_workspace(p_member uuid default null)returns jsonb language plpgsql security definer set search_path=''as $$
declare m uuid:=coalesce(p_member,auth.uid());a jsonb;c public.conversations;result jsonb;
begin
 a:=public._conversation_user(m,p_member is not null);
 select * into c from public.conversations where member_id=m;
 if not found then return jsonb_build_object('ok',true,'conversation',null);end if;
 if p_member is null then
  return jsonb_build_object('ok',true,'conversationId',c.id,'version',c.version,
  'messages',coalesce((select jsonb_agg(jsonb_build_object('seq',seq,'text',body,'at',created_at,'author','member')order by seq)from public.conversation_messages where conversation_id=c.id),'[]'),
  'replies',coalesce((select jsonb_agg(jsonb_build_object('approvalId',ap.id,'body',ap.body,'approvedAt',ap.created_at,'approvedBy',jsonb_build_object('displayName',ap.doctor_name),'deliveryState',dl.state)order by ap.created_at,ap.id)
   from public.conversation_deliveries dl join public.conversation_approvals ap on ap.id=dl.approval_id where dl.conversation_id=c.id and dl.state in('accepted_by_provider','unknown')),'[]'));
 end if;
 result:=jsonb_build_object('ok',true,'conversationId',c.id,'version',c.version,'messages',coalesce((select jsonb_agg(jsonb_build_object('seq',seq,'text',body,'at',created_at,'author','member')order by seq)from public.conversation_messages where conversation_id=c.id),'[]'),
 'replies',coalesce((select jsonb_agg(jsonb_build_object('approvalId',ap.id,'body',ap.body,'approvedAt',ap.created_at,'approvedBy',jsonb_build_object('staffId',ap.doctor_id,'displayName',ap.doctor_name,'role',ap.doctor_role,'clinicId',ap.clinic_id),'deliveryState',dl.state,'reviewAfterSend',dl.review_after_send)order by ap.created_at,ap.id)from public.conversation_deliveries dl join public.conversation_approvals ap on ap.id=dl.approval_id where dl.conversation_id=c.id and dl.state in('accepted_by_provider','unknown')),'[]'));
 return result||jsonb_build_object('memberName',coalesce((select display_name from public.profiles where id=m),''),
 'unsupportedMedia',exists(select 1 from public.conversation_audit au where au.conversation_id=c.id and au.kind='message.media'
  and(au.detail->>'version')::bigint>coalesce((select max(d.context_version)from public.conversation_drafts d where d.conversation_id=c.id and d.state in('approved','rejected')),0)),
 'unsavedOverLimit',exists(select 1 from public.conversation_audit au where au.conversation_id=c.id and au.kind='message.overflow'
  and(au.detail->>'version')::bigint>coalesce((select max(d.context_version)from public.conversation_drafts d where d.conversation_id=c.id and d.state in('approved','rejected')),0)),'clinicalRevision',a->'clinicalRevision','draftEpoch',c.draft_epoch,'sourceToken',public.patient_clinical_evidence(m)->>'token',
 'drafts',coalesce((select jsonb_agg(to_jsonb(d)||jsonb_build_object('revisions',(select jsonb_agg(to_jsonb(r)order by revision)from public.conversation_revisions r where draft_id=d.id))order by d.created_at,d.id)from public.conversation_drafts d where conversation_id=c.id),'[]'),
 'deliveries',coalesce((select jsonb_agg(to_jsonb(d)||jsonb_build_object('approval',to_jsonb(ap))order by d.created_at,d.id)from public.conversation_deliveries d join public.conversation_approvals ap on ap.id=d.approval_id where d.conversation_id=c.id),'[]'));
end$$;

create or replace function public.conversation_awaiting_replies()returns jsonb
language plpgsql security definer set search_path=''as $$
declare who jsonb:=public.real_clinical_staff_identity();
begin
 if who is null or who->>'role'<>'doctor'then raise insufficient_privilege;end if;
 return jsonb_build_object('ok',true,'items',coalesce((select jsonb_agg(item order by item->>'reason',item->>'lastMessageAt')from(
  select jsonb_build_object('memberId',cs.user_id,'memberName',coalesce(pr.display_name,''),'lastMessageAt',greatest(lm.created_at,lmed.at),'unanswered',
   (select count(*)from public.conversation_messages m2 where m2.conversation_id=c.id and m2.seq>coalesce(dec.v,0)),
   'latestDelivery',ld.state,'latestReason',ld.reason,
   'reason',case when c.version>coalesce(dec.v,0)then 'new_message'else 'not_delivered'end,
   'mediaPending',exists(select 1 from public.conversation_audit au where au.conversation_id=c.id and au.kind='message.media'and(au.detail->>'version')::bigint>coalesce(dec.v,0)),
   'overLimit',exists(select 1 from public.conversation_audit au where au.conversation_id=c.id and au.kind='message.overflow'and(au.detail->>'version')::bigint>coalesce(dec.v,0)),
   'channel',case when lm.source='telegram_member'or(lm.source is null and lmed.at is not null)or lmed.at>lm.created_at then 'telegram'else 'app'end)as item
  from public.patient_clinical_cases cs join public.conversations c on c.member_id=cs.user_id
  left join public.profiles pr on pr.id=cs.user_id
  -- A conversation may start with a message the bot cannot read: no stored message row.
  left join lateral(select m.seq,m.created_at,m.source from public.conversation_messages m where m.conversation_id=c.id order by m.seq desc limit 1)lm on true
  left join lateral(select max(au.created_at)at from public.conversation_audit au where au.conversation_id=c.id and au.kind='message.media')lmed on true
  left join lateral(select max(d.context_version)v from public.conversation_drafts d where d.conversation_id=c.id and d.state in('approved','rejected'))dec on true
  left join lateral(select dl.state,dl.reason,dl.created_at from public.conversation_deliveries dl where dl.conversation_id=c.id order by dl.created_at desc,dl.id desc limit 1)ld on true
  -- The conversation version moves with every member message, stored or over the
  -- intake limit, so a message that was not saved still puts the member on the list.
  -- An undelivered last reply stays listed for 30 days.
  where cs.assigned_doctor_id=(who->>'id')::uuid and(c.version>coalesce(dec.v,0)
   or(ld.created_at>clock_timestamp()-interval '30 days'and(ld.state in('definitely_failed','unknown')or(ld.state='held'and ld.reason is distinct from 'newer_member_message'))
    -- A later decision (for example rejecting a draft as no reply needed) clears it.
    and not exists(select 1 from public.conversation_drafts d2 where d2.conversation_id=c.id and d2.state='rejected'and d2.created_at>ld.created_at))))q),'[]'));
end$$;

revoke all on function public._channel_inbox_receive_media(public.channel_inbox)from public,anon,authenticated,service_role;
