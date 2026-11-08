-- Zoe app chat: a member's send is never refused by a stale grant, and a refusal says why (18 Oct).
--
-- On prod-as-staging every app send failed with insufficient_privilege (prod data, integrator
-- 18 Oct: the grant had EXPIRED; grant_seconds is one hour). conversation_grants is inserted with
-- `on conflict do nothing`, so once a session's grant expired, or conversation_policy.version or the
-- session's amr changed, the same live session was refused forever, members and staff alike.
--
-- 1. _conversation_authorize renews a lapsed or outdated grant in place, on a call whose checks have
--    all passed already: the auth.sessions row (not_after), the member's confirmed phone and case,
--    the actor not banned, and for staff (a <> m or staff_only; lead decision 18 Oct 11:43) active
--    staff, active clinic, the assignment, the invitation state, an allowed amr and no recovery amr.
--    Each failure raises before the renewal, so the renewal never widens who passes. It sets a new
--    expiry (still capped by the session's not_after), the current policy version and the session's
--    amr. A revoked grant stays revoked. A member acting through the member path while also being
--    workspace staff (a = m, not staff_only) is not renewed: that path skips the staff checks.
--    The grant id and generation are kept, so a member retry across a renewal replays, and a doctor's
--    open intents and queued approvals keep their authority within the same session. For staff an amr
--    change bumps the generation: what was approved or opened under the old sign-in method no longer
--    claims (the design's generation fence). conversation_claim calls with create_grant=false and
--    never renews: delivery still needs the approving grant to be live.
-- 2. conversation_receive: eligibility is checked before authorization and every permanent refusal
--    is a code, not an exception: not_eligible (unconfirmed phone, banned, or staff; the same parts
--    as _telegram_member_eligible), needs_review_request (no clinical case yet), sign_in_again (the auth session is gone or the grant was
--    revoked), busy (a row lock is held: transient, retry).

create or replace function public._conversation_authorize(m uuid,a uuid,sid uuid,amr jsonb,staff_only boolean,create_grant boolean)returns jsonb
language plpgsql security definer set search_path=''as $$
declare c public.patient_clinical_cases;s public.workspace_staff;g public.conversation_grants;p public.conversation_policy;i public.real_staff_invitations;session_created timestamptz;session_end timestamptz;conv uuid;
begin
 if m is null or a is null or sid is null then raise insufficient_privilege;end if;
 perform 1 from auth.users where id=m and phone is not null and phone_confirmed_at is not null for share nowait;if not found then raise insufficient_privilege;end if;
 perform 1 from auth.users where id=a and(banned_until is null or banned_until<=clock_timestamp())for share nowait;if not found then raise insufficient_privilege;end if;
 select * into c from public.patient_clinical_cases where user_id=m for update nowait;if not found then raise insufficient_privilege;end if;
 select id into conv from public.conversations where member_id=m for update nowait;
 select * into i from public.real_staff_invitations where auth_user_id=a for share nowait;
 select created_at,not_after into session_created,session_end from auth.sessions where id=sid and user_id=a and(not_after is null or not_after>clock_timestamp())for share nowait;
 if not found then raise insufficient_privilege;end if;
 if a<>m or staff_only then
  perform 1 from public.workspace_staff where user_id in(a,c.assigned_doctor_id)order by user_id for share nowait;
  select * into s from public.workspace_staff where user_id=a;
  perform 1 from public.workspace_clinics where id=s.clinic_id and active for share nowait;
  if not found or not s.active or s.removed_at is not null then raise insufficient_privilege;end if;
  if ((s.role='doctor'and c.assigned_doctor_id=a)or(not staff_only and s.role='nurse'and c.assigned_nurse_id=a and exists(select 1 from public.workspace_staff doctor where doctor.user_id=c.assigned_doctor_id and doctor.role='doctor'and doctor.active and doctor.removed_at is null and doctor.clinic_id=s.clinic_id)))is distinct from true then raise insufficient_privilege;end if;
  if i.id is not null then
   if i.status<>'accepted'or i.accepted_at is null or(session_created<i.accepted_at and i.accepted_session_id is distinct from sid) then raise insufficient_privilege;end if;
  end if;
  if not (i.accepted_session_id is not distinct from sid) and not public._real_staff_amr_allowed(amr) then raise insufficient_privilege;end if;
  -- Recovery AMR is never accepted as a clinical command, including old accepted IDs.
  if exists(select 1 from jsonb_array_elements(amr)x where x->>'method'='recovery')then raise insufficient_privilege;end if;
 elsif staff_only then raise insufficient_privilege;
 end if;
 select * into p from public.conversation_policy where singleton for share nowait;if not found then raise exception using errcode='55000',message='Conversation policy unavailable';end if;
 if create_grant then
  insert into public.conversation_grants as cg(actor_id,session_id,expires_at,policy_version,amr)
  values(a,sid,least(clock_timestamp()+make_interval(secs=>p.grant_seconds),coalesce(session_end,'infinity')),p.version,amr)
  on conflict(actor_id,session_id)do update set expires_at=excluded.expires_at,policy_version=excluded.policy_version,amr=excluded.amr,
   generation=case when(a<>m or staff_only)and cg.amr is distinct from excluded.amr then cg.generation+1 else cg.generation end
  -- 18 Oct: the live session renews its own lapsed or outdated grant once every check above passed.
  where(a<>m or staff_only or not exists(select 1 from public.workspace_staff ws where ws.user_id=a))
   and not cg.revoked
   and(cg.expires_at<=clock_timestamp()or cg.policy_version<>excluded.policy_version
    or cg.amr is distinct from excluded.amr);
 end if;
 select * into g from public.conversation_grants where actor_id=a and session_id=sid for share nowait;
 if not found or g.revoked or g.expires_at<=clock_timestamp()or g.policy_version<>p.version or g.amr is distinct from amr then raise insufficient_privilege;end if;
 return jsonb_build_object('actorId',a,'sessionId',sid,'grantId',g.id,'generation',g.generation,'clinicalRevision',c.revision,
 'doctor',case when s.user_id is null then null else jsonb_build_object('staffId',s.user_id,'displayName',s.display_name,'role',s.role,'clinicId',s.clinic_id)end);
end$$;

create or replace function public.conversation_receive(p_command jsonb)returns jsonb language plpgsql security definer set search_path=''as $$
declare a jsonb;c public.conversations;r jsonb;p public.conversation_policy;rid uuid;doc uuid;m uuid:=auth.uid();
begin
 if jsonb_typeof(p_command)is distinct from 'object'or not(p_command?&array['requestId','text'])or p_command-array['requestId','text']<>'{}'or jsonb_typeof(p_command->'requestId')is distinct from 'string'or jsonb_typeof(p_command->'text')is distinct from 'string'
  -- Same size cap as a Telegram text message (channel_inbox, conversation_endpoints.max_utf16).
  or public._conversation_utf16(p_command->>'text')not between 1 and 4096 or btrim(p_command->>'text')=''then return jsonb_build_object('ok',false,'code','invalid_command');end if;
 if auth.role()is distinct from 'authenticated'or m is null then raise insufficient_privilege;end if;
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
 r:=public._conversation_replay(c.id,a,rid::text,p_command);if r is not null then return r;end if;
 select * into p from public.conversation_policy where singleton;
 if(select count(*)from public.conversation_messages where conversation_id=c.id and created_at>clock_timestamp()-make_interval(secs=>p.intake_window_seconds))>=p.intake_max_messages then
  insert into public.conversation_audit(conversation_id,actor_id,kind,detail)values(c.id,m,'message.rate_limited',jsonb_build_object('channel','app','requestId',rid));
  return jsonb_build_object('ok',false,'code','rate_limited');end if;
 update public.conversations set version=version+1 where id=c.id returning * into c;
 insert into public.conversation_messages(conversation_id,seq,author_id,body,source,request_id)values(c.id,c.version,m,p_command->>'text','authenticated_member',rid);
 update public.conversation_intents set state='invalidated'where state='open'and draft_id in(select id from public.conversation_drafts where conversation_id=c.id);
 update public.conversation_deliveries set state='held',reason='newer_member_message',state_seq=state_seq+1 where conversation_id=c.id and state='queued';
 update public.conversation_deliveries set review_after_send=true where conversation_id=c.id and state in('sending','unknown');
 update public.conversation_drafts set state='superseded'where conversation_id=c.id and state in('pending','info_requested');
 insert into public.conversation_audit(conversation_id,actor_id,kind,detail)values(c.id,m,'message.received',jsonb_build_object('channel','app','requestId',rid,'seq',c.version));
 -- Same doctor alert row as Telegram text (it drives the staff notice); no Telegram acknowledgement
 -- is queued: the app shows the acknowledgement in the thread.
 select assigned_doctor_id into doc from public.patient_clinical_cases where user_id=m;
 insert into public.conversation_doctor_alerts(conversation_id,member_id,doctor_id,message_seq,inbox_id)values(c.id,m,doc,c.version,null);
 return public._conversation_receipt(c.id,a,rid::text,p_command,jsonb_build_object('ok',true,'conversationId',c.id,'version',c.version,'replayed',false));
exception when invalid_text_representation then return jsonb_build_object('ok',false,'code','invalid_command');
end$$;
-- create or replace keeps both functions' existing grants.
