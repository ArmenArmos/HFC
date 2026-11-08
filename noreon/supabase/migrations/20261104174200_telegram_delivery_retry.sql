-- Explicit doctor-requested Telegram delivery retries; originals remain immutable evidence.
-- Stamp 20261104174200 from the integrator (Armen audit 5 Nov, P1-03; restamped after #697).
-- One child per delivery makes repeated/concurrent requests idempotent. A failed child may
-- itself be retried. Queued/sending/accepted/unknown children can never create another send.
alter table public.conversation_deliveries add column retry_of uuid references public.conversation_deliveries(id);
create unique index conversation_delivery_one_retry on public.conversation_deliveries(retry_of) where retry_of is not null;

-- Same authentication and grant lifecycle as _conversation_authorize (18 Oct), with one
-- narrow difference: this immutable approval's doctor may act after a same-clinic handover.
-- Both the actor and the current assigned doctor must remain active in that clinic.
create function public._conversation_retry_authorize(m uuid,a uuid,sid uuid,amr jsonb,staff_only boolean,create_grant boolean,p_approver uuid,p_clinic uuid)returns jsonb
language plpgsql security definer set search_path=''as $$
declare c public.patient_clinical_cases;s public.workspace_staff;g public.conversation_grants;p public.conversation_policy;i public.real_staff_invitations;session_created timestamptz;session_end timestamptz;conv uuid;
begin
 if m is null or a is null or sid is null then raise insufficient_privilege;end if;
 perform 1 from auth.users where id=m and phone is not null and phone_confirmed_at is not null for share nowait;if not found then raise insufficient_privilege;end if;
 perform 1 from auth.users where id=a and(banned_until is null or banned_until<=clock_timestamp())for share nowait;if not found then raise insufficient_privilege;end if;
 select * into c from public.patient_clinical_cases where user_id=m for update;if not found then raise insufficient_privilege;end if;
 select id into conv from public.conversations where member_id=m for update;
 select * into i from public.real_staff_invitations where auth_user_id=a for share nowait;
 select created_at,not_after into session_created,session_end from auth.sessions where id=sid and user_id=a and(not_after is null or not_after>clock_timestamp())for share nowait;
 if not found then raise insufficient_privilege;end if;
 if a<>m or staff_only then
  perform 1 from public.workspace_staff where user_id in(a,c.assigned_doctor_id)order by user_id for share nowait;
  select * into s from public.workspace_staff where user_id=a;
  perform 1 from public.workspace_clinics where id=s.clinic_id and active for share nowait;
  if not found or not s.active or s.removed_at is not null then raise insufficient_privilege;end if;
  if (s.role='doctor'and s.clinic_id=p_clinic and (c.assigned_doctor_id=a or a=p_approver) and exists(select 1 from public.workspace_staff doctor where doctor.user_id=c.assigned_doctor_id and doctor.role='doctor'and doctor.active and doctor.removed_at is null and doctor.clinic_id=s.clinic_id))is distinct from true then raise insufficient_privilege;end if;
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
  -- Fable F1 (18 Oct): read without a lock, and take the row exclusively only when a renewal is
  -- due. A live grant is locked FOR SHARE below, as before #263, so a delivery claim for another
  -- member of the same doctor and the doctor's parallel calls never wait on it.
  select * into g from public.conversation_grants where actor_id=a and session_id=sid;
  if not found then
   insert into public.conversation_grants(actor_id,session_id,expires_at,policy_version,amr)
   values(a,sid,least(clock_timestamp()+make_interval(secs=>p.grant_seconds),coalesce(session_end,'infinity')),p.version,amr)on conflict(actor_id,session_id)do nothing;
  elsif not g.revoked and(g.expires_at<=clock_timestamp()or g.policy_version<>p.version or g.amr is distinct from amr)
   -- The member path of a workspace staff user skips the staff checks: never renewed.
   and(a<>m or staff_only or not exists(select 1 from public.workspace_staff ws where ws.user_id=a))then
   -- Every check above has passed on this call. The WHERE is re-read after a parallel renewer
   -- commits, so a second caller updates nothing and goes on to the shared read.
   update public.conversation_grants cg set expires_at=least(clock_timestamp()+make_interval(secs=>p.grant_seconds),coalesce(session_end,'infinity')),
    policy_version=p.version,amr=_conversation_retry_authorize.amr,
    -- Staff authority is fenced when the sign-in method or the policy changed (Fable F2): intents
    -- and approvals made before no longer act. Members keep the generation (replay keys on it).
    generation=case when(a<>m or staff_only)and(cg.amr is distinct from _conversation_retry_authorize.amr or cg.policy_version<>p.version)then cg.generation+1 else cg.generation end
   where cg.id=g.id and not cg.revoked
    and(cg.expires_at<=clock_timestamp()or cg.policy_version<>p.version or cg.amr is distinct from _conversation_retry_authorize.amr);
  end if;
 end if;
 select * into g from public.conversation_grants where actor_id=a and session_id=sid for share nowait;
 if not found or g.revoked or g.expires_at<=clock_timestamp()or g.policy_version<>p.version or g.amr is distinct from amr then raise insufficient_privilege;end if;
 return jsonb_build_object('actorId',a,'sessionId',sid,'grantId',g.id,'generation',g.generation,'clinicalRevision',c.revision,
 'doctor',case when s.user_id is null then null else jsonb_build_object('staffId',s.user_id,'displayName',s.display_name,'role',s.role,'clinicId',s.clinic_id)end);
end$$;

-- Private eligibility predicate shared by the mutation and opt-in workspace. Authorization
-- is the wrapper's responsibility; no caller has direct execution rights on this function.
create function public._conversation_retry_block(p_delivery uuid)returns text
language plpgsql volatile security definer set search_path=''as $$
declare dl public.conversation_deliveries;ap public.conversation_approvals;d public.conversation_drafts;
 c public.conversations;cs public.patient_clinical_cases;p public.conversation_policy;ep public.conversation_endpoints;
begin
 select * into dl from public.conversation_deliveries where id=p_delivery;
 if not found then return 'delivery_unknown';end if;
 if exists(select 1 from public.conversation_deliveries where retry_of=dl.id)then return 'already_retried';end if;
 if (dl.state='definitely_failed'or(dl.state='held'and dl.reason in('route_unavailable','route_policy_missing','approval_authority_lapsed')))is distinct from true then return 'delivery_not_retryable';end if;
 select * into ap from public.conversation_approvals where id=dl.approval_id;
 select * into d from public.conversation_drafts where id=ap.draft_id;
 select * into c from public.conversations where id=dl.conversation_id;
 select * into cs from public.patient_clinical_cases where user_id=c.member_id;
 if c.version is distinct from ap.context_version or d.context_version is distinct from c.version
 or d.revision is distinct from ap.revision or d.state is distinct from 'approved'
 or d.clinical_revision is distinct from cs.revision
 or d.source_token is distinct from (public.patient_clinical_evidence(c.member_id)->>'token')
 or ap.content_hash is distinct from public._conversation_hash(c.id,c.member_id,ap.body)
 or not exists(select 1 from public.conversation_revisions r where r.draft_id=d.id and r.revision=ap.revision and r.body=ap.body and r.content_hash=ap.content_hash)
 or exists(select 1 from public.conversation_messages where conversation_id=c.id and seq>ap.context_version)
 or exists(select 1 from public.conversation_audit where conversation_id=c.id and kind in('message.media','message.overflow')and (detail->>'version')::bigint>ap.context_version)
 then return 'stale_context';end if;
 select * into p from public.conversation_policy where singleton;
 if p.singleton is null or not p.delivery_enabled then return 'route_policy_missing';end if;
 select * into ep from public.conversation_endpoints where member_id=c.member_id and active and adapter='telegram'and expires_at>clock_timestamp()and policy_version=p.version;
 if ep.id is null or public._conversation_utf16((select display_name from public.workspace_staff where user_id=auth.uid())||E'\n\n'||ap.body)>ep.max_utf16 then return 'route_unavailable';end if;
 return null;
end$$;

create function public.conversation_retry_delivery(p_delivery uuid)returns jsonb
language plpgsql volatile security definer set search_path=''as $$
declare dl public.conversation_deliveries;ap public.conversation_approvals;d public.conversation_drafts;r public.conversation_revisions;
 c public.conversations;p public.conversation_policy;ep public.conversation_endpoints;a jsonb;child uuid;nd uuid;ni uuid;na uuid;why text;
begin
 if auth.role()is distinct from 'authenticated'then raise insufficient_privilege;end if;
 perform pg_advisory_xact_lock(hashtextextended('conversation-retry:'||p_delivery::text,0));
 select * into dl from public.conversation_deliveries where id=p_delivery;
 if not found then return jsonb_build_object('ok',false,'code','delivery_unknown');end if;
 select * into c from public.conversations where id=dl.conversation_id;
 select * into ap from public.conversation_approvals where id=dl.approval_id;
 a:=public._conversation_retry_authorize(c.member_id,auth.uid(),(auth.jwt()->>'session_id')::uuid,coalesce(auth.jwt()->'amr','[]'),true,true,ap.doctor_id,ap.clinic_id);
 -- Authorization takes the same case/conversation locks and order as approval/claim.
 select * into dl from public.conversation_deliveries where id=p_delivery for update;
 select id into child from public.conversation_deliveries where retry_of=p_delivery;
 if child is not null then return jsonb_build_object('ok',true,'deliveryId',child,'replayed',true);end if;
 perform public._conversation_source(c.member_id);
 why:=public._conversation_retry_block(p_delivery);
 if why is not null then return jsonb_build_object('ok',false,'code',why);end if;
 select * into d from public.conversation_drafts where id=ap.draft_id;
 select * into r from public.conversation_revisions where draft_id=d.id and revision=ap.revision;
 select * into p from public.conversation_policy where singleton;
 select * into ep from public.conversation_endpoints where member_id=c.member_id and active and adapter='telegram'and expires_at>clock_timestamp()and policy_version=p.version for share nowait;
 if ep.id is null or public._conversation_utf16((a#>>'{doctor,displayName}')||E'\n\n'||ap.body)>ep.max_utf16 then return jsonb_build_object('ok',false,'code','route_unavailable');end if;
 -- A new immutable approval is bound to this live session. Clone the draft instead of
 -- weakening UNIQUE(draft_id,revision,context_version), or altering the original approval.
 insert into public.conversation_drafts(conversation_id,revision,state,context_version,clinical_revision,source_token)
 values(c.id,1,'approved',ap.context_version,d.clinical_revision,d.source_token)returning id into nd;
 insert into public.conversation_revisions(draft_id,revision,body,summary,content_hash,author_id,author_kind,provenance)
 values(nd,1,ap.body,r.summary,ap.content_hash,auth.uid(),'staff',jsonb_build_object('operation','delivery.retry','retryOf',p_delivery,'originalDraftId',d.id,'originalRevision',ap.revision));
 insert into public.conversation_intents(draft_id,revision,actor_id,grant_id,grant_generation,purpose,context_version,content_hash,expires_at,state)
 values(nd,1,auth.uid(),(a->>'grantId')::uuid,(a->>'generation')::bigint,'reply.approve',ap.context_version,ap.content_hash,clock_timestamp()+make_interval(secs=>p.intent_seconds),'consumed')returning id into ni;
 insert into public.conversation_approvals(draft_id,revision,context_version,content_hash,body,doctor_id,doctor_name,doctor_role,clinic_id,grant_id,grant_generation,intent_id)
 values(nd,1,ap.context_version,ap.content_hash,ap.body,auth.uid(),a#>>'{doctor,displayName}','doctor',(a#>>'{doctor,clinicId}')::uuid,(a->>'grantId')::uuid,(a->>'generation')::bigint,ni)returning id into na;
 insert into public.conversation_deliveries(conversation_id,approval_id,state,endpoint_id,endpoint_generation,policy_version,retry_of)
 values(c.id,na,'queued',ep.id,ep.generation,p.version,p_delivery)returning id into child;
 update public.conversations set draft_epoch=draft_epoch+1 where id=c.id;
 perform public._conversation_audit(c.id,'delivery.retry_requested',jsonb_build_object('deliveryId',child,'retryOf',p_delivery,'approvalId',na));
 return jsonb_build_object('ok',true,'deliveryId',child,'replayed',false);
exception when invalid_text_representation then raise insufficient_privilege;
 when lock_not_available then return jsonb_build_object('ok',false,'code','busy');
end$$;

-- The existing worker calls this same claim RPC; ordinary deliveries keep their exact
-- authorization path. Retry claims revalidate the actual retry approver's live grant.
create or replace function public.conversation_claim(p_delivery uuid,p_attempt uuid)returns jsonb language plpgsql security definer set search_path=''as $$
declare dl public.conversation_deliveries;ap public.conversation_approvals;d public.conversation_drafts;c public.conversations;g public.conversation_grants;ep public.conversation_endpoints;p public.conversation_policy;a jsonb;envelope jsonb;lapsed boolean:=false;parent_ap public.conversation_approvals;
begin
 if auth.role()is distinct from 'service_role'then raise insufficient_privilege;end if;
 perform pg_advisory_xact_lock(hashtextextended('conversation-attempt:'||p_attempt::text,0));
 select * into dl from public.conversation_deliveries where id=p_delivery;
 if not found then return jsonb_build_object('ok',false,'code','delivery_unknown');end if;
 select * into ap from public.conversation_approvals where id=dl.approval_id;
 select * into c from public.conversations where id=dl.conversation_id;
 select * into g from public.conversation_grants where id=ap.grant_id;
 begin
  if dl.retry_of is null then
   a:=public._conversation_authorize(c.member_id,ap.doctor_id,g.session_id,g.amr,true,false);
  else
   select pa.* into parent_ap from public.conversation_deliveries pd join public.conversation_approvals pa on pa.id=pd.approval_id where pd.id=dl.retry_of;
   a:=public._conversation_retry_authorize(c.member_id,ap.doctor_id,g.session_id,g.amr,true,false,parent_ap.doctor_id,parent_ap.clinic_id);
  end if;
  if (a->>'grantId')::uuid<>ap.grant_id or(a->>'generation')::bigint<>ap.grant_generation or(a#>>'{doctor,clinicId}')::uuid<>ap.clinic_id then raise insufficient_privilege;end if;
 exception when insufficient_privilege then lapsed:=true;
 end;
 if lapsed then
  perform set_config('lock_timeout','2s',true);
  perform 1 from public.conversations where id=c.id for update;
  select * into dl from public.conversation_deliveries where id=p_delivery for update;
  if dl.state='queued'and not exists(select 1 from public.conversation_attempts where delivery_id=p_delivery)then
   update public.conversation_deliveries set state='held',reason='approval_authority_lapsed',state_seq=state_seq+1 where id=dl.id;
   perform public._conversation_audit(c.id,'delivery.held',jsonb_build_object('deliveryId',dl.id,'reason','approval_authority_lapsed'));
  end if;
  return jsonb_build_object('ok',false,'code','approval_authority_lapsed');
 end if;
 select * into c from public.conversations where id=c.id;
 select * into dl from public.conversation_deliveries where id=p_delivery for update;
 -- Replays authorize first and never grant a second transport invocation.
 if dl.state<>'queued'or exists(select 1 from public.conversation_attempts where id=p_attempt or delivery_id=p_delivery)then return jsonb_build_object('ok',false,'code','already_claimed_or_held');end if;
 select * into d from public.conversation_drafts where id=ap.draft_id;
 if c.version<>ap.context_version or d.revision<>ap.revision or d.state<>'approved'or d.clinical_revision<>(a->>'clinicalRevision')::bigint or d.source_token<>public._conversation_source(c.member_id)
 or ap.content_hash<>public._conversation_hash(c.id,c.member_id,ap.body)then
  update public.conversation_deliveries set state='held',reason='stale_context',state_seq=state_seq+1 where id=dl.id;
  perform public._conversation_audit(c.id,'delivery.held',jsonb_build_object('deliveryId',dl.id,'reason','stale_context'));
  return jsonb_build_object('ok',false,'code','stale_context');end if;
 select * into p from public.conversation_policy where singleton;
 select * into ep from public.conversation_endpoints where id=dl.endpoint_id for share nowait;
 if not p.delivery_enabled or p.version is distinct from dl.policy_version or ep.id is null or not ep.active or ep.expires_at<=clock_timestamp()
 or ep.member_id<>c.member_id or ep.generation<>dl.endpoint_generation or ep.policy_version<>p.version
 or public._conversation_utf16(ap.doctor_name||E'\n\n'||ap.body)>ep.max_utf16 then
  update public.conversation_deliveries set state='held',reason='route_unavailable',state_seq=state_seq+1 where id=dl.id;
  perform public._conversation_audit(c.id,'delivery.held',jsonb_build_object('deliveryId',dl.id,'reason','route_unavailable'));
  return jsonb_build_object('ok',false,'code','route_unavailable');end if;
 envelope:=jsonb_build_object('deliveryId',dl.id,'attemptId',p_attempt,'attemptSeq',1,'endpointId',ep.id,'address',ep.address,'generation',ep.generation,
 'body',ap.body,'contentHash',ap.content_hash,'approvalId',ap.id,'approvedBy',jsonb_build_object('staffId',ap.doctor_id,'displayName',ap.doctor_name,'role',ap.doctor_role,'clinicId',ap.clinic_id));
 update public.conversation_deliveries set state='sending',state_seq=state_seq+1 where id=dl.id returning * into dl;
 insert into public.conversation_attempts(id,delivery_id,state_seq,envelope)values(p_attempt,dl.id,dl.state_seq,envelope);
 perform public._conversation_audit(c.id,'delivery.claimed',jsonb_build_object('deliveryId',dl.id,'attemptId',p_attempt,'authorizationCutoff','claim_commit'));
 return jsonb_build_object('ok',true,'fresh',true,'adapter',ep.adapter,'accountRef',ep.account_ref,'envelope',envelope);
end$$;


-- Transport retries are one clinical reply in the member app. Preserve the existing
-- eligibility and sticky release writes, then project every retry chain onto its root
-- approval's stable identity and metadata. No release/history row is changed or removed.
alter function public.conversation_member_thread()rename to _conversation_member_thread_before_retry;
revoke all on function public._conversation_member_thread_before_retry()from public,anon,authenticated,service_role;
create function public.conversation_member_thread()returns jsonb
language plpgsql volatile security definer set search_path=''as $$
declare w jsonb:=public._conversation_member_thread_before_retry();replies jsonb;
begin
 if not(w?'replies')then return w;end if;
 with recursive shown as(
  select x,n from jsonb_array_elements(w->'replies')with ordinality e(x,n)
 ),ancestry(shown_id,delivery_id,approval_id,retry_of,path)as(
  select x->>'id',d.id,d.approval_id,d.retry_of,array[d.id]
  from shown join public.conversation_deliveries d on d.approval_id=(x->>'id')::uuid
  join public.conversations c on c.id=d.conversation_id and c.member_id=auth.uid()
  union all
  select a.shown_id,p.id,p.approval_id,p.retry_of,a.path||p.id
  from ancestry a join public.conversation_deliveries child on child.id=a.delivery_id
  join public.conversation_deliveries p on p.id=a.retry_of and p.conversation_id=child.conversation_id
  where not p.id=any(a.path)
 ),roots as(
  select a.shown_id,ap.id,ap.body,ap.created_at,ap.doctor_name
  from ancestry a join public.conversation_approvals ap on ap.id=a.approval_id where a.retry_of is null
 ),projected as(
  select n,case when r.id is null then x else x||jsonb_build_object('id',r.id,'text',r.body,'at',r.created_at,'doctorName',r.doctor_name)end item
  from shown left join roots r on r.shown_id=x->>'id'
 ),deduped as(
  select distinct on(item->>'id')item from projected order by item->>'id',n
 )select coalesce(jsonb_agg(item order by(item->>'at')::timestamptz,item->>'id'),'[]')into replies from deduped;
 return jsonb_set(w,'{replies}',replies);
end$$;
revoke all on function public.conversation_member_thread()from public,anon,authenticated,service_role;
grant execute on function public.conversation_member_thread()to authenticated;

-- Adding a table column must not add keys to legacy strict JSON consumers. The existing
-- wrapper retains its direct member access audit and nurse reply projection.
create or replace function public.conversation_workspace(p_member uuid default null)returns jsonb
language plpgsql volatile security definer set search_path=''as $$
declare w jsonb;replies jsonb;
begin
 w:=public.conversation_workspace_unlogged(p_member);
 if w is not null and coalesce(w->>'enabled','true')<>'false'then perform public._access_audit_record(p_member,'member_messages',null);end if;
 if w?'conversationId'then
  replies:=public._conversation_nurse_replies((w->>'conversationId')::uuid);
  if jsonb_array_length(replies)>0 then w:=w||jsonb_build_object('nurseReplies',replies);end if;
 end if;
 if w?'deliveries'then w:=jsonb_set(w,'{deliveries}',coalesce((select jsonb_agg(x-'retry_of'-'can_retry'order by n)from jsonb_array_elements(w->'deliveries')with ordinality e(x,n)),'[]'));end if;
 return w;
end$$;

-- Provider strings are untrusted and may contain member content. Expose a fixed reason
-- code for the outcome, keeping transport evidence only in its existing private history.
create function public._conversation_delivery_reason(p_delivery uuid)returns text
language sql volatile security definer set search_path=''as $$
 select coalesce(d.reason,case
  when a.outcome->>'kind'='definitely_failed'and a.outcome->>'evidence'in('telegram_bot_blocked','telegram_chat_not_found','telegram_message_refused','not_sent_unsupported_payload','Adapter unavailable before invocation')then a.outcome->>'evidence'
  when a.outcome->>'kind'='definitely_failed'then 'provider_definitely_failed'
  when a.outcome->>'kind'='unknown'and a.outcome->>'reason'in('telegram_timeout','timeout')then 'telegram_timeout'
  when a.outcome->>'kind'='unknown'then 'provider_outcome_unknown'end)
 from public.conversation_deliveries d left join public.conversation_attempts a on a.delivery_id=d.id where d.id=p_delivery
$$;
create function public._conversation_retry_workspace_projection(p_workspace jsonb)returns jsonb
language plpgsql volatile security definer set search_path=''as $$
declare w jsonb:=p_workspace;items jsonb;
begin
 if w?'deliveries'then
  select coalesce(jsonb_agg(x||jsonb_build_object('retry_of',d.retry_of,'can_retry',
   public._conversation_retry_block(d.id)is null and ap.clinic_id=(select clinic_id from public.workspace_staff where user_id=auth.uid()),
   'reason',public._conversation_delivery_reason(d.id))order by n),'[]')into items
  from jsonb_array_elements(w->'deliveries')with ordinality e(x,n)
  join public.conversation_deliveries d on d.id=(x->>'id')::uuid
  join public.conversation_approvals ap on ap.id=d.approval_id;
  w:=jsonb_set(w,'{deliveries}',items);
 end if;
 return w;
end$$;

create function public.conversation_retry_workspace(p_member uuid)returns jsonb
language plpgsql volatile security definer set search_path=''as $$
begin
 if p_member is null then raise insufficient_privilege;end if;
 return public._conversation_retry_workspace_projection(public.conversation_workspace(p_member));
end$$;

-- Keep the existing atomic staff-care/mode/settings guard, then opt into the retry
-- fields on that already-authorized workspace. No second read or access audit is needed.
create function public.doctor_chat_retry_conversation(p_member uuid)returns jsonb
language plpgsql volatile security definer set search_path=''as $$
declare w jsonb:=public.doctor_chat_conversation(p_member);
begin
 return jsonb_set(w,'{workspace}',public._conversation_retry_workspace_projection(w->'workspace'));
end$$;

alter function public.conversation_awaiting_replies()rename to _conversation_awaiting_before_retry;
revoke all on function public._conversation_awaiting_before_retry()from public,anon,authenticated,service_role;
create function public.conversation_awaiting_replies()returns jsonb
language plpgsql volatile security definer set search_path=''as $$
declare w jsonb:=public._conversation_awaiting_before_retry();
begin
 return jsonb_set(w,'{items}',coalesce((select jsonb_agg(x||jsonb_build_object('latestReason',coalesce(public._conversation_delivery_reason((select d.id from public.conversation_deliveries d join public.conversations c on c.id=d.conversation_id where c.member_id=(x->>'memberId')::uuid order by d.created_at desc,d.id desc limit 1)),x->>'latestReason'))order by n)from jsonb_array_elements(w->'items')with ordinality e(x,n)),'[]'));
end$$;

alter function public.telegram_delivery_problems()rename to _telegram_delivery_problems_before_retry;
revoke all on function public._telegram_delivery_problems_before_retry()from public,anon,authenticated,service_role;
create function public.telegram_delivery_problems()returns jsonb
language plpgsql volatile security definer set search_path=''as $$
declare w jsonb:=public._telegram_delivery_problems_before_retry();
begin
 -- Keep historical failures in the workspace, but only unresolved leaf deliveries in
 -- the operational problem list. Preserve all existing response keys.
 return jsonb_set(w,'{replies}',coalesce((select jsonb_agg(x||jsonb_build_object('reason',public._conversation_delivery_reason((x->>'id')::uuid))order by n)from jsonb_array_elements(w->'replies')with ordinality e(x,n)where not exists(select 1 from public.conversation_deliveries child where child.retry_of=(x->>'id')::uuid)),'[]'));
end$$;

revoke all on function public._conversation_retry_authorize(uuid,uuid,uuid,jsonb,boolean,boolean,uuid,uuid),public._conversation_retry_block(uuid),public._conversation_delivery_reason(uuid),public._conversation_retry_workspace_projection(jsonb),public.doctor_chat_retry_conversation(uuid),public.conversation_retry_delivery(uuid),public.conversation_retry_workspace(uuid),public.conversation_workspace(uuid),public.conversation_awaiting_replies(),public.telegram_delivery_problems()from public,anon,authenticated,service_role;
grant execute on function public.doctor_chat_retry_conversation(uuid),public.conversation_retry_delivery(uuid),public.conversation_retry_workspace(uuid),public.conversation_workspace(uuid),public.conversation_awaiting_replies(),public.telegram_delivery_problems()to authenticated;

-- Opt in through the existing nurse-scoped RPC. Keep the one-argument response
-- unchanged for the deployed app's strict parser while migrations ship first.
-- The environment flag affects explanation only, never authority to send.
create function public.conversation_nurse_workspace(p_member uuid,p_telegram_enabled boolean)returns jsonb
language plpgsql security definer set search_path=''as $$
declare w jsonb;p public.conversation_policy;
begin
 w:=public.conversation_nurse_workspace(p_member);
 if w->>'ok'is distinct from 'true'then return w;end if;
 select * into p from public.conversation_policy where singleton;
 return w||jsonb_build_object(
  'telegramLinked',exists(select 1 from public.conversation_endpoints ep where ep.member_id=p_member
   and ep.adapter='telegram'and ep.active and ep.expires_at>clock_timestamp()and ep.policy_version=p.version),
  'telegramSendingEnabled',coalesce(p_telegram_enabled,false)and coalesce(p.delivery_enabled,false));
end$$;
revoke all on function public.conversation_nurse_workspace(uuid,boolean)from public,anon,authenticated,service_role;
grant execute on function public.conversation_nurse_workspace(uuid,boolean)to authenticated;
