-- Extend the applied BP migration additively. Existing card kinds and BP retry functions stay intact.
alter table public.patient_measurements drop constraint patient_measurements_entry_source_check;
alter table public.patient_measurements add constraint patient_measurements_entry_source_check
 check(entry_source in('patient_text_entry','patient_voice_confirmed'));

-- The card is claimed before the existing measurement save. Copy provenance in that same insert,
-- so a failed zone/queue RPC or a lost confirmation reply cannot leave a saved voice reading untagged.
create function public._zoe_bp_entry_source()returns trigger
language plpgsql security definer set search_path=''as $$
begin
 if new.submission_id is not null and exists(
  select 1 from public.zoe_chat_cards k where k.member_id=new.user_id and k.kind='bp'
   and k.claims#>>'{bp,op}'=new.submission_id::text
   and k.snapshot#>>'{typed,entrySource}'='patient_voice_confirmed'
   -- Only the dictated numbers and time keep voice provenance: an edited card saves as typed.
   and (k.snapshot#>>'{typed,systolic}')::integer is not distinct from new.systolic
   and (k.snapshot#>>'{typed,diastolic}')::integer is not distinct from new.diastolic
   and (k.snapshot#>>'{typed,pulse}')::integer is not distinct from new.pulse
   and (k.snapshot#>>'{typed,measuredAt}')::timestamptz is not distinct from new.measured_at
 )then new.entry_source:='patient_voice_confirmed';end if;
 return new;
end$$;
revoke all on function public._zoe_bp_entry_source()from public,anon,authenticated,service_role;
create trigger zoe_bp_entry_source before insert on public.patient_measurements
 for each row execute function public._zoe_bp_entry_source();

create or replace function public.zoe_bp_reading_zone(p_member uuid,p_reading uuid,p_zone text,p_rule_version text)returns jsonb
language plpgsql security definer set search_path=''as $$
begin
 if p_member is null or p_reading is null or p_zone is null or p_zone not in('green','yellow','orange','red')or p_rule_version is null or length(p_rule_version)not between 1 and 80
 then return jsonb_build_object('ok',false,'code','invalid');end if;
 update public.patient_measurements set zone=p_zone,zone_rule_version=p_rule_version,entry_source=coalesce(entry_source,'patient_text_entry')where id=p_reading and user_id=p_member;
 if not found then return jsonb_build_object('ok',false,'code','not_found');end if;
 return jsonb_build_object('ok',true);
end$$;

-- Signed transcription evidence is inserted with the explicitly sent message, before a card opens.
-- The server verifies it at send and recovery against the immutable message creation time.
-- No direct table access is added; existing RLS/grants and immutability triggers stay in force.
alter table public.conversation_messages add column voice_receipt text
 check(voice_receipt is null or length(voice_receipt)<=128);

-- The three-argument overload inserts provenance. All existing receive rules stay intact.
create function public.conversation_receive(p_command jsonb,p_to_doctor boolean,p_voice_receipt text)returns jsonb language plpgsql security definer set search_path=''as $$
declare a jsonb;c public.conversations;r jsonb;p public.conversation_policy;rid uuid;doc uuid;payload jsonb;m uuid:=auth.uid();
begin
 if length(p_voice_receipt)>128 or p_to_doctor is null or jsonb_typeof(p_command)is distinct from 'object'or not(p_command?&array['requestId','text'])or p_command-array['requestId','text']<>'{}'or jsonb_typeof(p_command->'requestId')is distinct from 'string'or jsonb_typeof(p_command->'text')is distinct from 'string'
  -- Same size cap as a Telegram text message (channel_inbox, conversation_endpoints.max_utf16).
  or public._conversation_utf16(p_command->>'text')not between 1 and 4096 or btrim(p_command->>'text')=''then return jsonb_build_object('ok',false,'code','invalid_command');end if;
 if auth.role()is distinct from 'authenticated'or m is null then raise insufficient_privilege;end if;
 -- Keep default-mode payloads compatible with receipts recorded before this migration.
 -- The route is part of idempotency: a retry cannot silently redirect an accepted message.
 payload:=p_command||case when p_to_doctor then jsonb_build_object('toDoctor',true)else '{}'::jsonb end;
 rid:=(p_command->>'requestId')::uuid;
 perform pg_advisory_xact_lock(hashtextextended('conversation-command:'||m::text||':'||rid::text,0));
 -- Same eligibility as Telegram intake, checked first so the member is told what to do (18 Oct).
 if not exists(select 1 from auth.users where id=m and phone is not null and phone_confirmed_at is not null and(banned_until is null or banned_until<=clock_timestamp()))
  or exists(select 1 from public.workspace_staff where user_id=m)then return jsonb_build_object('ok',false,'code','not_eligible');end if;
 if not exists(select 1 from public.patient_clinical_cases where user_id=m)then return jsonb_build_object('ok',false,'code','needs_review_request');end if;
 begin
  a:=public._conversation_user(m,false);
 exception
  when lock_not_available then return jsonb_build_object('ok',false,'code','busy');
  -- Eligible member, refused authority: the auth session ended or the grant was revoked.
  when insufficient_privilege then return jsonb_build_object('ok',false,'code','sign_in_again');
 end;
 insert into public.conversations(member_id)values(m)on conflict(member_id)do nothing;
 select * into c from public.conversations where member_id=m for update;
 r:=public._conversation_replay(c.id,a,rid::text,payload);if r is not null then return r;end if;
 select * into p from public.conversation_policy where singleton;
 if(select count(*)from public.conversation_messages where conversation_id=c.id and created_at>clock_timestamp()-make_interval(secs=>p.intake_window_seconds))>=p.intake_max_messages then
  insert into public.conversation_audit(conversation_id,actor_id,kind,detail)values(c.id,m,'message.rate_limited',jsonb_build_object('channel','app','requestId',rid));
  return jsonb_build_object('ok',false,'code','rate_limited');end if;
 update public.conversations set version=version+1 where id=c.id returning * into c;
 insert into public.conversation_messages(conversation_id,seq,author_id,body,source,request_id,to_doctor,voice_receipt)values(c.id,c.version,m,p_command->>'text','authenticated_member',rid,p_to_doctor,p_voice_receipt);
 update public.conversation_intents set state='invalidated'where state='open'and draft_id in(select id from public.conversation_drafts where conversation_id=c.id);
 update public.conversation_deliveries set state='held',reason='newer_member_message',state_seq=state_seq+1 where conversation_id=c.id and state='queued';
 update public.conversation_deliveries set review_after_send=true where conversation_id=c.id and state in('sending','unknown');
 update public.conversation_drafts set state='superseded'where conversation_id=c.id and state in('pending','info_requested');
 insert into public.conversation_audit(conversation_id,actor_id,kind,detail)values(c.id,m,'message.received',jsonb_build_object('channel','app','requestId',rid,'seq',c.version));
 -- Same doctor alert row as Telegram text (it drives the staff notice); no Telegram acknowledgement
 -- is queued: the app shows the acknowledgement in the thread.
 select assigned_doctor_id into doc from public.patient_clinical_cases where user_id=m;
 insert into public.conversation_doctor_alerts(conversation_id,member_id,doctor_id,message_seq,inbox_id)values(c.id,m,doc,c.version,null);
 return public._conversation_receipt(c.id,a,rid::text,payload,jsonb_build_object('ok',true,'conversationId',c.id,'version',c.version,'replayed',false));
exception when invalid_text_representation then return jsonb_build_object('ok',false,'code','invalid_command');
end$$;

revoke all on function public.conversation_receive(jsonb,boolean,text)from public,anon,authenticated,service_role;
grant execute on function public.conversation_receive(jsonb,boolean,text)to authenticated;

-- Preserve the existing signature, defaults, grants and callers without provenance.
create or replace function public.conversation_receive(p_command jsonb,p_to_doctor boolean default false)returns jsonb
language sql security definer set search_path=''as $$
 select public.conversation_receive(p_command,p_to_doctor,null::text)
$$;

create function public.conversation_member_voice_receipt(p_seq bigint)returns jsonb
language plpgsql stable security definer set search_path=''as $$
begin
 if auth.role()is distinct from 'authenticated'or auth.uid()is null then raise insufficient_privilege;end if;
 if not coalesce((select p.app_chat_enabled from public.conversation_policy p where p.singleton),false)or not public._telegram_member_eligible(auth.uid())then return null;end if;
 return(select jsonb_build_object('receipt',case when m.source='authenticated_member'then m.voice_receipt end,'memberId',c.member_id,'text',m.body,'at',m.created_at)
  from public.conversation_messages m join public.conversations c on c.id=m.conversation_id
  where c.member_id=auth.uid()and m.author_id=auth.uid()and m.seq=p_seq);
end$$;
revoke all on function public.conversation_member_voice_receipt(bigint)from public,anon,authenticated,service_role;
grant execute on function public.conversation_member_voice_receipt(bigint)to authenticated;
