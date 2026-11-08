-- Noreon owns conversation state. No transport is activated by this migration.
create table public.conversation_policy (
 singleton boolean primary key default true check(singleton),version text not null,
 grant_seconds integer not null check(grant_seconds>0),intent_seconds integer not null check(intent_seconds>0),
 intake_window_seconds integer not null check(intake_window_seconds>0),intake_max_messages integer not null check(intake_max_messages>0),
 synthetic_engine boolean not null default false,clinical_protocol text,
 delivery_enabled boolean not null default false
);
-- Intentionally no policy seed: privacy/clinical lifetimes require approved configuration.
create table public.conversation_grants (
 id uuid primary key default gen_random_uuid(),actor_id uuid not null references auth.users(id),session_id uuid not null,
 generation bigint not null default 1 check(generation>0),expires_at timestamptz not null,revoked boolean not null default false,
 policy_version text not null,amr jsonb not null,unique(actor_id,session_id)
);
create table public.conversations (
 id uuid primary key default gen_random_uuid(),member_id uuid not null unique references public.patient_clinical_cases(user_id),
 version bigint not null default 0 check(version>=0),draft_epoch bigint not null default 0 check(draft_epoch>=0),created_at timestamptz not null default clock_timestamp()
);
create table public.conversation_messages (
 id uuid primary key default gen_random_uuid(),conversation_id uuid not null references public.conversations(id),seq bigint not null,
 author_id uuid not null references auth.users(id),body text not null check(length(body)between 1 and 8000),
 source text not null check(source='authenticated_member'),request_id uuid not null,created_at timestamptz not null default clock_timestamp(),unique(conversation_id,seq)
);
create table public.conversation_drafts (
 id uuid primary key default gen_random_uuid(),conversation_id uuid not null references public.conversations(id),revision bigint not null default 1,
 state text not null check(state in('pending','approved','rejected','info_requested','superseded')),context_version bigint not null,
 clinical_revision bigint not null,source_token text not null,created_at timestamptz not null default clock_timestamp()
);
create table public.conversation_revisions (
 draft_id uuid not null references public.conversation_drafts(id),revision bigint not null,body text not null check(length(body)between 1 and 8000),
 summary text not null check(length(summary)between 1 and 16000),content_hash text not null,author_id uuid not null references auth.users(id),author_kind text not null check(author_kind in('ai_assistant','staff')),
 provenance jsonb not null,created_at timestamptz not null default clock_timestamp(),primary key(draft_id,revision)
);
create table public.conversation_intents (
 id uuid primary key default gen_random_uuid(),draft_id uuid not null,revision bigint not null,foreign key(draft_id,revision)references public.conversation_revisions(draft_id,revision),
 actor_id uuid not null references auth.users(id),grant_id uuid not null references public.conversation_grants(id),grant_generation bigint not null,
 purpose text not null check(purpose in('reply.edit','reply.approve','reply.reject','reply.request_info')),
 context_version bigint not null,content_hash text not null,expires_at timestamptz not null,state text not null default 'open' check(state in('open','consumed','invalidated'))
);
create table public.conversation_approvals (
 id uuid primary key default gen_random_uuid(),draft_id uuid not null,revision bigint not null,foreign key(draft_id,revision)references public.conversation_revisions(draft_id,revision),
 context_version bigint not null,content_hash text not null,body text not null,doctor_id uuid not null references auth.users(id),doctor_name text not null,
 doctor_role text not null check(doctor_role='doctor'),clinic_id uuid not null references public.workspace_clinics(id),
 grant_id uuid not null references public.conversation_grants(id),grant_generation bigint not null,intent_id uuid not null unique references public.conversation_intents(id),
 created_at timestamptz not null default clock_timestamp(),unique(draft_id,revision,context_version)
);
create table public.conversation_receipts (
 actor_id uuid not null references auth.users(id),request_id text not null check(length(request_id)between 16 and 128),
 conversation_id uuid not null references public.conversations(id),grant_id uuid not null references public.conversation_grants(id),generation bigint not null,
 payload jsonb not null,state text not null default 'recorded'check(state in('recorded','retired')),result jsonb not null,created_at timestamptz not null default clock_timestamp(),primary key(actor_id,request_id)
);
-- No endpoint provisioning interface in this bounded slice: Telegram link and consent remain a gate.
create table public.conversation_endpoints (
 id uuid primary key default gen_random_uuid(),member_id uuid not null references auth.users(id),adapter text not null,account_ref text not null,principal_ref text not null,
 address text not null,generation bigint not null check(generation>0),active boolean not null default false,policy_version text not null,
 expires_at timestamptz not null,max_utf16 integer not null check(max_utf16>0),unique(adapter,account_ref,principal_ref)
);
create table public.conversation_deliveries (
 id uuid primary key default gen_random_uuid(),conversation_id uuid not null references public.conversations(id),approval_id uuid not null unique references public.conversation_approvals(id),
 state text not null check(state in('queued','held','sending','accepted_by_provider','definitely_failed','unknown')),reason text,
 state_seq bigint not null default 0,endpoint_id uuid references public.conversation_endpoints(id),endpoint_generation bigint,policy_version text,
 review_after_send boolean not null default false,created_at timestamptz not null default clock_timestamp()
);
create table public.conversation_attempts (
 id uuid primary key,delivery_id uuid not null unique references public.conversation_deliveries(id),state_seq bigint not null,envelope jsonb not null,
 claimed_at timestamptz not null default clock_timestamp(),outcome jsonb,outcome_at timestamptz
);
create table public.conversation_audit (
 id bigint generated always as identity primary key,conversation_id uuid not null references public.conversations(id),actor_id uuid references auth.users(id),
 kind text not null,detail jsonb not null,created_at timestamptz not null default clock_timestamp()
);
create index conversation_drafts_history on public.conversation_drafts(conversation_id,created_at,id);
create index conversation_messages_history on public.conversation_messages(conversation_id,seq);
create function public._conversation_immutable()returns trigger language plpgsql set search_path=''as $$begin raise exception using errcode='55000',message='Conversation history is immutable';end$$;
create function public._conversation_utf16(t text)returns integer language sql immutable strict set search_path=''as $$select coalesce(sum(case when ascii(ch)>65535 then 2 else 1 end),0)::integer from regexp_split_to_table(t,'')ch$$;
create function public._conversation_hash(c uuid,m uuid,b text)returns text language sql immutable strict set search_path=''as $$
 select encode(sha256(convert_to('["noreon.reply-content",1,'||to_json(c::text)::text||','||to_json(m::text)::text||','||to_json(b)::text||']','UTF8')),'hex')
$$;
-- These private functions accept identity only from authenticated wrappers or immutable grants.
create function public._conversation_authorize(m uuid,a uuid,sid uuid,amr jsonb,staff_only boolean,create_grant boolean)returns jsonb
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
  insert into public.conversation_grants(actor_id,session_id,expires_at,policy_version,amr)
  values(a,sid,least(clock_timestamp()+make_interval(secs=>p.grant_seconds),coalesce(session_end,'infinity')),p.version,amr)on conflict(actor_id,session_id)do nothing;
 end if;
 select * into g from public.conversation_grants where actor_id=a and session_id=sid for share nowait;
 if not found or g.revoked or g.expires_at<=clock_timestamp()or g.policy_version<>p.version or g.amr is distinct from amr then raise insufficient_privilege;end if;
 return jsonb_build_object('actorId',a,'sessionId',sid,'grantId',g.id,'generation',g.generation,'clinicalRevision',c.revision,
 'doctor',case when s.user_id is null then null else jsonb_build_object('staffId',s.user_id,'displayName',s.display_name,'role',s.role,'clinicId',s.clinic_id)end);
end$$;
create function public._conversation_user(m uuid,staff_only boolean)returns jsonb language plpgsql security definer set search_path=''as $$
begin
 if auth.role()is distinct from 'authenticated'then raise insufficient_privilege;end if;
 return public._conversation_authorize(m,auth.uid(),(auth.jwt()->>'session_id')::uuid,coalesce(auth.jwt()->'amr','[]'),staff_only,true);
exception when invalid_text_representation then raise insufficient_privilege;
end$$;
create function public._conversation_source(m uuid)returns text language plpgsql security definer set search_path=''as $$begin
 lock table public.profiles,public.patient_consents,public.patient_assessments,public.patient_measurements,public.patient_reports,public.patient_care_visits,public.patient_care_visit_entries in share mode nowait;
 return public.patient_clinical_evidence(m)->>'token';
end$$;
create function public._conversation_audit(c uuid,k text,d jsonb)returns void language sql security definer set search_path=''as $$insert into public.conversation_audit(conversation_id,actor_id,kind,detail)values(c,auth.uid(),k,d)$$;
create function public._conversation_replay(c uuid,a jsonb,r text,p jsonb)returns jsonb language plpgsql security definer set search_path=''as $$
declare old public.conversation_receipts;
begin
 select * into old from public.conversation_receipts where actor_id=(a->>'actorId')::uuid and request_id=r;
 if not found then return null;end if;
 if old.conversation_id<>c or old.payload is distinct from p or old.grant_id<>(a->>'grantId')::uuid or old.generation<>(a->>'generation')::bigint then return jsonb_build_object('ok',false,'code','request_conflict');end if;
 if old.state='retired'then return jsonb_build_object('ok',false,'code','command_retired');end if;
 perform public._conversation_audit(c,'command.replay',jsonb_build_object('requestId',r));
 return old.result||jsonb_build_object('replayed',true);
end$$;
create function public._conversation_receipt(c uuid,a jsonb,r text,p jsonb,result jsonb)returns jsonb language plpgsql security definer set search_path=''as $$begin
 insert into public.conversation_receipts(actor_id,request_id,conversation_id,grant_id,generation,payload,result)values((a->>'actorId')::uuid,r,c,(a->>'grantId')::uuid,(a->>'generation')::bigint,p,result);
 perform public._conversation_audit(c,'command.recorded',jsonb_build_object('requestId',r,'result',result));return result;
end$$;
create function public.conversation_receive(p_command jsonb)returns jsonb language plpgsql security definer set search_path=''as $$
declare a jsonb;c public.conversations;r jsonb;p public.conversation_policy;rid uuid;
begin
 if jsonb_typeof(p_command)is distinct from 'object'or not(p_command?&array['requestId','text'])or p_command-array['requestId','text']<>'{}'or jsonb_typeof(p_command->'requestId')is distinct from 'string'or jsonb_typeof(p_command->'text')is distinct from 'string'or public._conversation_utf16(p_command->>'text')not between 1 and 8000 then return jsonb_build_object('ok',false,'code','invalid_command');end if;
 rid:=(p_command->>'requestId')::uuid;
 perform pg_advisory_xact_lock(hashtextextended('conversation-command:'||auth.uid()::text||':'||rid::text,0));
 a:=public._conversation_user(auth.uid(),false);
 insert into public.conversations(member_id)values(auth.uid())on conflict(member_id)do nothing;
 select * into c from public.conversations where member_id=auth.uid()for update;
 r:=public._conversation_replay(c.id,a,rid::text,p_command);if r is not null then return r;end if;
 select * into p from public.conversation_policy where singleton;
 if(select count(*)from public.conversation_messages where conversation_id=c.id and created_at>clock_timestamp()-make_interval(secs=>p.intake_window_seconds))>=p.intake_max_messages then return jsonb_build_object('ok',false,'code','rate_limited');end if;
 update public.conversations set version=version+1 where id=c.id returning * into c;
 insert into public.conversation_messages(conversation_id,seq,author_id,body,source,request_id)values(c.id,c.version,auth.uid(),p_command->>'text','authenticated_member',rid);
 update public.conversation_intents set state='invalidated'where state='open'and draft_id in(select id from public.conversation_drafts where conversation_id=c.id);
 update public.conversation_deliveries set state='held',reason='newer_member_message',state_seq=state_seq+1 where conversation_id=c.id and state='queued';
 update public.conversation_deliveries set review_after_send=true where conversation_id=c.id and state in('sending','unknown');
 update public.conversation_drafts set state='superseded'where conversation_id=c.id and state in('pending','info_requested');
 return public._conversation_receipt(c.id,a,rid::text,p_command,jsonb_build_object('ok',true,'conversationId',c.id,'version',c.version,'replayed',false));
exception when invalid_text_representation then return jsonb_build_object('ok',false,'code','invalid_command');
end$$;
create function public.conversation_workspace(p_member uuid default null)returns jsonb language plpgsql security definer set search_path=''as $$
declare m uuid:=coalesce(p_member,auth.uid());a jsonb;c public.conversations;result jsonb;
begin
 a:=public._conversation_user(m,p_member is not null);
 select * into c from public.conversations where member_id=m;
 if not found then return jsonb_build_object('ok',true,'conversation',null);end if;
 result:=jsonb_build_object('ok',true,'conversationId',c.id,'version',c.version,'messages',coalesce((select jsonb_agg(jsonb_build_object('seq',seq,'text',body,'at',created_at,'author','member')order by seq)from public.conversation_messages where conversation_id=c.id),'[]'),
 'replies',coalesce((select jsonb_agg(jsonb_build_object('approvalId',ap.id,'body',ap.body,'approvedAt',ap.created_at,'approvedBy',jsonb_build_object('staffId',ap.doctor_id,'displayName',ap.doctor_name,'role',ap.doctor_role,'clinicId',ap.clinic_id),'deliveryState',dl.state,'reviewAfterSend',dl.review_after_send)order by ap.created_at,ap.id)from public.conversation_deliveries dl join public.conversation_approvals ap on ap.id=dl.approval_id where dl.conversation_id=c.id and dl.state in('accepted_by_provider','unknown')),'[]'));
 -- No member inbox publication or disclosure of private drafts, approvals or transport metadata.
 if p_member is null then return result;end if;
 return result||jsonb_build_object('clinicalRevision',a->'clinicalRevision','draftEpoch',c.draft_epoch,'sourceToken',public._conversation_source(m),
 'drafts',coalesce((select jsonb_agg(to_jsonb(d)||jsonb_build_object('revisions',(select jsonb_agg(to_jsonb(r)order by revision)from public.conversation_revisions r where draft_id=d.id))order by d.created_at,d.id)from public.conversation_drafts d where conversation_id=c.id),'[]'),
 'deliveries',coalesce((select jsonb_agg(to_jsonb(d)||jsonb_build_object('approval',to_jsonb(ap))order by d.created_at,d.id)from public.conversation_deliveries d join public.conversation_approvals ap on ap.id=d.approval_id where d.conversation_id=c.id),'[]'));
end$$;
-- Explicit nurse intake scope: member-originated text only, no drafts, clinical sources or approval capabilities.
create function public.conversation_intake_workspace(p_member uuid)returns jsonb language plpgsql security definer set search_path=''as $$
declare a jsonb;c public.conversations;
begin
 a:=public._conversation_user(p_member,false);
 if a->'doctor'='null'::jsonb then raise insufficient_privilege;end if;
 select * into c from public.conversations where member_id=p_member;
 if not found then return jsonb_build_object('ok',true,'conversation',null);end if;
 return jsonb_build_object('ok',true,'conversationId',c.id,'version',c.version,'messages',coalesce((select jsonb_agg(jsonb_build_object('seq',seq,'text',body,'at',created_at,'author','member')order by seq)from public.conversation_messages where conversation_id=c.id),'[]'),'replies','[]'::jsonb);
end$$;
create function public.conversation_propose(p_member uuid,p_request_id uuid,p_expected_version bigint,p_expected_clinical_revision bigint,p_expected_draft_epoch bigint,p_expected_source text,p_body text,p_summary text,p_provenance jsonb)returns jsonb
language plpgsql security definer set search_path=''as $$
declare a jsonb;c public.conversations;d uuid;r jsonb;payload jsonb;policy public.conversation_policy;
begin
 perform pg_advisory_xact_lock(hashtextextended('conversation-command:'||auth.uid()::text||':'||p_request_id::text,0));
 a:=public._conversation_user(p_member,true);
 select * into c from public.conversations where member_id=p_member;if not found then return jsonb_build_object('ok',false,'code','conversation_unknown');end if;
 payload:=jsonb_build_object('op','propose','memberId',p_member,'requestId',p_request_id,'expectedVersion',p_expected_version,'clinicalRevision',p_expected_clinical_revision,'draftEpoch',p_expected_draft_epoch,'source',p_expected_source,'body',p_body,'summary',p_summary,'provenance',p_provenance);
 r:=public._conversation_replay(c.id,a,p_request_id::text,payload);if r is not null then return r;end if;
 if p_body is null or public._conversation_utf16(p_body)not between 1 and 8000 or p_summary is null or public._conversation_utf16(p_summary)not between 1 and 16000 or jsonb_typeof(p_provenance)is distinct from 'object'
 or not(p_provenance?&array['kind','engine','version','protocolVersion'])or p_provenance-array['kind','engine','version','protocolVersion']<>'{}'
 or exists(select 1 from jsonb_each(p_provenance)where jsonb_typeof(value)<>'string'or length(value#>>'{}')not between 1 and 128)then return jsonb_build_object('ok',false,'code','invalid_command');end if;
 select * into policy from public.conversation_policy where singleton;
 if p_provenance->>'kind'='staff'then p_provenance:=jsonb_build_object('kind','staff','actor',a->'doctor');
 elsif not ((p_provenance->>'kind'='synthetic'and policy.synthetic_engine)or(p_provenance->>'kind'='clinical'and policy.clinical_protocol is not null and p_provenance->>'protocolVersion'=policy.clinical_protocol))then return jsonb_build_object('ok',false,'code','policy_unavailable');end if;
 if c.version is distinct from p_expected_version or c.draft_epoch is distinct from p_expected_draft_epoch or (a->>'clinicalRevision')::bigint is distinct from p_expected_clinical_revision or public._conversation_source(p_member)is distinct from p_expected_source then return jsonb_build_object('ok',false,'code','stale_context');end if;
 update public.conversation_intents set state='invalidated'where state='open'and draft_id in(select id from public.conversation_drafts where conversation_id=c.id);
 update public.conversation_drafts set state='superseded'where conversation_id=c.id and state in('pending','info_requested');
 update public.conversations set draft_epoch=draft_epoch+1 where id=c.id;
 insert into public.conversation_drafts(conversation_id,state,context_version,clinical_revision,source_token)values(c.id,'pending',c.version,p_expected_clinical_revision,p_expected_source)returning id into d;
 insert into public.conversation_revisions(draft_id,revision,body,summary,content_hash,author_id,author_kind,provenance)values(d,1,p_body,p_summary,public._conversation_hash(c.id,p_member,p_body),auth.uid(),case when p_provenance->>'kind'='staff'then 'staff'else 'ai_assistant'end,p_provenance);
 return public._conversation_receipt(c.id,a,p_request_id::text,payload,jsonb_build_object('ok',true,'draftId',d,'revision',1,'replayed',false));
end$$;
create function public.conversation_compose(p_member uuid,p_request_id uuid,p_expected_version bigint,p_expected_clinical_revision bigint,p_expected_draft_epoch bigint,p_expected_source text,p_body text,p_summary text)returns jsonb language sql security definer set search_path=''as $$
 select public.conversation_propose(p_member,p_request_id,p_expected_version,p_expected_clinical_revision,p_expected_draft_epoch,p_expected_source,p_body,p_summary,'{"kind":"staff","engine":"doctor-authored","version":"1","protocolVersion":"not-applicable"}'::jsonb)
$$;
create function public.conversation_edit_summary(p_member uuid,p_request_id uuid,p_draft uuid,p_expected_revision bigint,p_summary text)returns jsonb language plpgsql security definer set search_path=''as $$
declare a jsonb;c public.conversations;d public.conversation_drafts;r public.conversation_revisions;payload jsonb;result jsonb;
begin
 perform pg_advisory_xact_lock(hashtextextended('conversation-command:'||auth.uid()::text||':'||p_request_id::text,0));
 a:=public._conversation_user(p_member,true);select * into c from public.conversations where member_id=p_member;
 if not found then return jsonb_build_object('ok',false,'code','conversation_unknown');end if;
 payload:=jsonb_build_object('op','summary.edit','draftId',p_draft,'expectedRevision',p_expected_revision,'summary',p_summary);
 result:=public._conversation_replay(c.id,a,p_request_id::text,payload);if result is not null then return result;end if;
 if p_summary is null or public._conversation_utf16(p_summary)not between 1 and 16000 then return jsonb_build_object('ok',false,'code','invalid_command');end if;
 select * into d from public.conversation_drafts where id=p_draft and conversation_id=c.id for update;
 if not found or d.state<>'pending'or d.revision is distinct from p_expected_revision or d.context_version<>c.version or d.clinical_revision<>(a->>'clinicalRevision')::bigint or d.source_token<>public._conversation_source(p_member)then return jsonb_build_object('ok',false,'code','stale_context');end if;
 select * into r from public.conversation_revisions where draft_id=d.id and revision=d.revision;
 update public.conversation_intents set state='invalidated'where draft_id=d.id and state='open';
 update public.conversation_drafts set revision=revision+1 where id=d.id returning * into d;
 update public.conversations set draft_epoch=draft_epoch+1 where id=c.id;
 insert into public.conversation_revisions(draft_id,revision,body,summary,content_hash,author_id,author_kind,provenance)
 values(d.id,d.revision,r.body,p_summary,r.content_hash,auth.uid(),'staff',jsonb_build_object('previousRevision',r.revision,'editedBy',a->'doctor','operation','summary.edit'));
 return public._conversation_receipt(c.id,a,p_request_id::text,payload,jsonb_build_object('ok',true,'draftId',d.id,'revision',d.revision,'replayed',false));
end$$;
create function public.conversation_actions(p_member uuid)returns jsonb language plpgsql security definer set search_path=''as $$
declare a jsonb;c public.conversations;d public.conversation_drafts;r public.conversation_revisions;p public.conversation_policy;purpose text;i uuid;actions jsonb:='[]';
begin
 a:=public._conversation_user(p_member,true);select * into c from public.conversations where member_id=p_member;
 select * into d from public.conversation_drafts where conversation_id=c.id and state='pending'order by created_at desc,id desc limit 1;
 if not found then return jsonb_build_object('ok',false,'code','draft_not_pending');end if;
 if d.context_version<>c.version or d.clinical_revision<>(a->>'clinicalRevision')::bigint or d.source_token<>public._conversation_source(p_member)then return jsonb_build_object('ok',false,'code','stale_context');end if;
 select * into r from public.conversation_revisions where draft_id=d.id and revision=d.revision;
 select * into p from public.conversation_policy where singleton;
 -- Invalidate prior unconsumed views for this actor; prevents unbounded live intent accumulation.
 update public.conversation_intents set state='invalidated'where draft_id=d.id and actor_id=auth.uid()and state='open';
 foreach purpose in array array['reply.approve','reply.edit','reply.reject','reply.request_info']loop
  insert into public.conversation_intents(draft_id,revision,actor_id,grant_id,grant_generation,purpose,context_version,content_hash,expires_at)
  values(d.id,d.revision,auth.uid(),(a->>'grantId')::uuid,(a->>'generation')::bigint,purpose,c.version,r.content_hash,clock_timestamp()+make_interval(secs=>p.intent_seconds))returning id into i;
  actions:=actions||jsonb_build_array(jsonb_build_object('purpose',purpose,'intentId',replace(i::text,'-','')));
 end loop;
 perform public._conversation_audit(c.id,'actions.issued',jsonb_build_object('draftId',d.id,'revision',d.revision));
 return jsonb_build_object('ok',true,'view',jsonb_build_object('conversationId',c.id,'conversationVersion',c.version,'draft',jsonb_build_object('revision',d.revision,'body',r.body,'summary',r.summary,'contentHash',r.content_hash,'author',r.author_kind),'actions',actions));
end$$;
create function public.conversation_command(p_command jsonb)returns jsonb language plpgsql security definer set search_path=''as $$
declare a jsonb;c public.conversations;d public.conversation_drafts;i public.conversation_intents;r public.conversation_revisions;res jsonb;aid uuid;did uuid;ep public.conversation_endpoints;pol public.conversation_policy;purpose text;rid text;body text;
begin
 purpose:=p_command->>'purpose';rid:=p_command->>'requestId';
 if jsonb_typeof(p_command)is distinct from 'object'or p_command->'schema'is distinct from '1'::jsonb or not(p_command?&array['schema','purpose','intentId','requestId'])
 or jsonb_typeof(p_command->'requestId')is distinct from 'string'or jsonb_typeof(p_command->'intentId')is distinct from 'string'
 or coalesce(purpose,'')not in('reply.approve','reply.edit','reply.reject','reply.request_info')or coalesce(rid,'')!~'^[A-Za-z0-9_-]{16,128}$'
 or coalesce(p_command->>'intentId','')!~'^[A-Za-z0-9_-]{16,128}$'
 or p_command-(case when purpose='reply.edit'then array['schema','purpose','intentId','requestId','body']else array['schema','purpose','intentId','requestId']end)<>'{}'
 or(purpose='reply.edit'and(jsonb_typeof(p_command->'body')is distinct from 'string'or public._conversation_utf16(p_command->>'body')not between 1 and 8000))then return jsonb_build_object('ok',false,'code','invalid_command');end if;
 perform pg_advisory_xact_lock(hashtextextended('conversation-command:'||auth.uid()::text||':'||rid,0));
 select * into i from public.conversation_intents where id=(p_command->>'intentId')::uuid;
 if not found then return jsonb_build_object('ok',false,'code','intent_unknown');end if;
 select * into d from public.conversation_drafts where id=i.draft_id;select * into c from public.conversations where id=d.conversation_id;
 a:=public._conversation_user(c.member_id,true);
 -- Refresh all mutable rows after case/conversation serialization.
 select * into c from public.conversations where id=c.id;
 select * into d from public.conversation_drafts where id=i.draft_id for update;
 select * into i from public.conversation_intents where id=i.id for update;
 res:=public._conversation_replay(c.id,a,rid,p_command);if res is not null then return res;end if;
 if i.actor_id<>auth.uid()or i.grant_id<>(a->>'grantId')::uuid or i.grant_generation<>(a->>'generation')::bigint or i.purpose<>purpose then return jsonb_build_object('ok',false,'code','intent_actor_mismatch');end if;
 if i.state<>'open'or i.expires_at<=clock_timestamp()then return jsonb_build_object('ok',false,'code','intent_invalidated');end if;
 if d.state<>'pending'or d.revision<>i.revision or c.version<>i.context_version or d.context_version<>c.version or d.clinical_revision<>(a->>'clinicalRevision')::bigint or d.source_token<>public._conversation_source(c.member_id)then return jsonb_build_object('ok',false,'code','stale_context');end if;
 select * into r from public.conversation_revisions where draft_id=d.id and revision=d.revision;
 if r.content_hash<>i.content_hash or r.content_hash<>public._conversation_hash(c.id,c.member_id,r.body)then return jsonb_build_object('ok',false,'code','content_hash_mismatch');end if;
 update public.conversation_intents set state='invalidated'where draft_id=d.id and state='open';
 update public.conversation_intents set state='consumed'where id=i.id;
 update public.conversations set draft_epoch=draft_epoch+1 where id=c.id;
 if purpose='reply.edit'then
  body:=p_command->>'body';update public.conversation_drafts set revision=revision+1 where id=d.id returning * into d;
  insert into public.conversation_revisions(draft_id,revision,body,summary,content_hash,author_id,author_kind,provenance)values(d.id,d.revision,body,r.summary,public._conversation_hash(c.id,c.member_id,body),auth.uid(),'staff',jsonb_build_object('previousRevision',r.revision,'editedBy',a->'doctor','operation','reply.edit'));
 elsif purpose='reply.approve'then
  insert into public.conversation_approvals(draft_id,revision,context_version,content_hash,body,doctor_id,doctor_name,doctor_role,clinic_id,grant_id,grant_generation,intent_id)
  values(d.id,d.revision,c.version,r.content_hash,r.body,auth.uid(),a#>>'{doctor,displayName}','doctor',(a#>>'{doctor,clinicId}')::uuid,(a->>'grantId')::uuid,(a->>'generation')::bigint,i.id)returning id into aid;
  select * into pol from public.conversation_policy where singleton;
  select * into ep from public.conversation_endpoints where member_id=c.member_id and active and expires_at>clock_timestamp()and policy_version=pol.version order by id limit 1 for share nowait;
  insert into public.conversation_deliveries(conversation_id,approval_id,state,reason,endpoint_id,endpoint_generation,policy_version)
  values(c.id,aid,case when pol.delivery_enabled and ep.id is not null then 'queued'else 'held'end,case when pol.delivery_enabled and ep.id is not null then null else 'route_policy_missing'end,ep.id,ep.generation,pol.version)returning id into did;
  update public.conversation_drafts set state='approved'where id=d.id;
 elsif purpose='reply.reject'then update public.conversation_drafts set state='rejected'where id=d.id;
 else
  update public.conversation_drafts set state='info_requested'where id=d.id;
  -- Durable internal request only; no unapproved AI question or escalation is sent.
  perform public._conversation_audit(c.id,'intake.requested',jsonb_build_object('draftId',d.id,'state','awaiting_configured_engine'));
 end if;
 return public._conversation_receipt(c.id,a,rid,p_command,jsonb_strip_nulls(jsonb_build_object('ok',true,'purpose',purpose,'draftId',d.id,'revision',d.revision,'approvalId',aid,'deliveryId',did,'replayed',false)));
exception when invalid_text_representation then return jsonb_build_object('ok',false,'code','invalid_command');
end$$;
create unique index conversation_one_active_endpoint on public.conversation_endpoints(member_id)where active;
create function public.conversation_claim(p_delivery uuid,p_attempt uuid)returns jsonb language plpgsql security definer set search_path=''as $$
declare dl public.conversation_deliveries;ap public.conversation_approvals;d public.conversation_drafts;c public.conversations;g public.conversation_grants;ep public.conversation_endpoints;p public.conversation_policy;a jsonb;envelope jsonb;
begin
 if auth.role()is distinct from 'service_role'then raise insufficient_privilege;end if;
 perform pg_advisory_xact_lock(hashtextextended('conversation-attempt:'||p_attempt::text,0));
 select * into dl from public.conversation_deliveries where id=p_delivery;
 if not found then return jsonb_build_object('ok',false,'code','delivery_unknown');end if;
 select * into ap from public.conversation_approvals where id=dl.approval_id;
 select * into c from public.conversations where id=dl.conversation_id;
 select * into g from public.conversation_grants where id=ap.grant_id;
 a:=public._conversation_authorize(c.member_id,ap.doctor_id,g.session_id,g.amr,true,false);
 if (a->>'grantId')::uuid<>ap.grant_id or(a->>'generation')::bigint<>ap.grant_generation or(a#>>'{doctor,clinicId}')::uuid<>ap.clinic_id then raise insufficient_privilege;end if;
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
 return jsonb_build_object('ok',true,'fresh',true,'adapter',ep.adapter,'envelope',envelope);
end$$;
create function public.conversation_outcome(p_attempt uuid,p_outcome jsonb)returns jsonb language plpgsql security definer set search_path=''as $$
declare at public.conversation_attempts;dl public.conversation_deliveries;kind text:=p_outcome->>'kind';
begin
 if auth.role()is distinct from 'service_role'then raise insufficient_privilege;end if;
 if jsonb_typeof(p_outcome)is distinct from 'object'or coalesce(kind,'')not in('accepted','definitely_failed','unknown')or
 p_outcome-(case kind when 'accepted'then array['kind','providerRef']when 'definitely_failed'then array['kind','evidence']else array['kind','reason']end)<>'{}'
 or jsonb_typeof(p_outcome->(case kind when 'accepted'then 'providerRef'when 'definitely_failed'then 'evidence'else 'reason'end))is distinct from 'string'
 or length(p_outcome->>(case kind when 'accepted'then 'providerRef'when 'definitely_failed'then 'evidence'else 'reason'end))not between 1 and 512 then return jsonb_build_object('ok',false,'code','invalid_outcome');end if;
 select * into at from public.conversation_attempts where id=p_attempt;if not found then return jsonb_build_object('ok',false,'code','attempt_unknown');end if;
 -- Outcomes record observations, not fresh authorization to send or read clinical data.
 -- Conversation first, matching command/claim order and the audit FK lock.
 perform 1 from public.conversations where id=(select conversation_id from public.conversation_deliveries where id=at.delivery_id)for update nowait;
 select * into dl from public.conversation_deliveries where id=at.delivery_id for update;
 select * into at from public.conversation_attempts where id=p_attempt for update;
 if dl.state<>'sending'or dl.state_seq<>at.state_seq or at.outcome is not null then
  perform public._conversation_audit(dl.conversation_id,'delivery.late_outcome',jsonb_build_object('attemptId',at.id,'outcome',p_outcome));return jsonb_build_object('ok',true,'applied',false);end if;
 update public.conversation_attempts set outcome=p_outcome,outcome_at=clock_timestamp()where id=at.id;
 update public.conversation_deliveries set state=case kind when 'accepted'then 'accepted_by_provider'when 'definitely_failed'then 'definitely_failed'else 'unknown'end,state_seq=state_seq+1 where id=dl.id;
 perform public._conversation_audit(dl.conversation_id,'delivery.outcome',jsonb_build_object('attemptId',at.id,'outcome',p_outcome));
 return jsonb_build_object('ok',true,'applied',true);
end$$;
create function public.conversation_reconcile(p_attempt uuid)returns jsonb language sql security definer set search_path=''as $$
 select public.conversation_outcome(p_attempt,jsonb_build_object('kind','unknown','reason','Claim acknowledgement or transport outcome unresolved; reconciliation required, no resend'))
$$;
-- Recovery never executes. A missing request is retired under the EXACT execution lock
-- and immutable actor/payload binding before reporting definitive non-recording.
create function public.conversation_recover(p_member uuid,p_request_id text,p_payload jsonb)returns jsonb language plpgsql security definer set search_path=''as $$
declare a jsonb;c uuid;r public.conversation_receipts;k text;n numeric;bound_draft uuid;
begin
 if p_request_id is null or p_request_id!~'^[A-Za-z0-9_-]{16,128}$'or jsonb_typeof(p_payload)is distinct from 'object'then return jsonb_build_object('status','unknown');end if;
 -- UUID RPC parameters are canonicalized by PostgreSQL before execution. Recovery
 -- must use that same namespace even when a caller supplies uppercase UUID text.
 if p_payload->>'op'in('propose','summary.edit')then
  p_request_id:=p_request_id::uuid::text;
  if p_payload->>'op'='propose'then
   if jsonb_typeof(p_payload->'requestId')is distinct from 'string'or jsonb_typeof(p_payload->'memberId')is distinct from 'string'then return jsonb_build_object('status','unknown');end if;
   p_payload:=jsonb_set(jsonb_set(p_payload,'{requestId}',to_jsonb((p_payload->>'requestId')::uuid::text)),'{memberId}',to_jsonb((p_payload->>'memberId')::uuid::text));
  else
   if jsonb_typeof(p_payload->'draftId')is distinct from 'string'then return jsonb_build_object('status','unknown');end if;
   p_payload:=jsonb_set(p_payload,'{draftId}',to_jsonb((p_payload->>'draftId')::uuid::text));
  end if;
 end if;
 perform pg_advisory_xact_lock(hashtextextended('conversation-command:'||auth.uid()::text||':'||p_request_id,0));
 a:=public._conversation_user(p_member,true);select id into c from public.conversations where member_id=p_member;
 if c is null then return jsonb_build_object('status','unknown');end if;
 select * into r from public.conversation_receipts where actor_id=auth.uid()and request_id=p_request_id;
 if found then
  if r.conversation_id is distinct from c or r.payload is distinct from p_payload or r.grant_id<>(a->>'grantId')::uuid or r.generation<>(a->>'generation')::bigint then raise insufficient_privilege;end if;
  if r.state='retired'then return jsonb_build_object('status','not-recorded','requestId',p_request_id,'serialized',true);end if;
  return jsonb_build_object('status','recorded','result',r.result);
 end if;
 if p_payload->>'op'='propose'then
  if not(p_payload?&array['op','memberId','requestId','expectedVersion','clinicalRevision','draftEpoch','source','body','summary','provenance'])
   or p_payload-array['op','memberId','requestId','expectedVersion','clinicalRevision','draftEpoch','source','body','summary','provenance']<>'{}'
   or(p_payload->>'memberId')::uuid is distinct from p_member or p_payload->>'requestId'is distinct from p_request_id
   or p_payload->'provenance'is distinct from '{"kind":"staff","engine":"doctor-authored","version":"1","protocolVersion":"not-applicable"}'::jsonb
   or jsonb_typeof(p_payload->'source')is distinct from 'string'or length(p_payload->>'source')not between 1 and 128 then return jsonb_build_object('status','unknown');end if;
  foreach k in array array['expectedVersion','clinicalRevision','draftEpoch']loop
   if jsonb_typeof(p_payload->k)is distinct from 'number'then return jsonb_build_object('status','unknown');end if;
   n:=(p_payload->>k)::numeric;if n<>trunc(n)or n not between 0 and 9007199254740991 then return jsonb_build_object('status','unknown');end if;
  end loop;
 elsif p_payload->>'op'='summary.edit'then
  if not(p_payload?&array['op','draftId','expectedRevision','summary'])or p_payload-array['op','draftId','expectedRevision','summary']<>'{}'
   or jsonb_typeof(p_payload->'expectedRevision')is distinct from 'number'then return jsonb_build_object('status','unknown');end if;
  n:=(p_payload->>'expectedRevision')::numeric;if n<>trunc(n)or n not between 1 and 9007199254740991 then return jsonb_build_object('status','unknown');end if;
  bound_draft:=(p_payload->>'draftId')::uuid;
  if not exists(select 1 from public.conversation_drafts where id=bound_draft and conversation_id=c)then raise insufficient_privilege;end if;
 else
  if not(p_payload?&array['schema','purpose','intentId','requestId'])or p_payload->'schema'is distinct from '1'::jsonb
   or p_payload->>'requestId'is distinct from p_request_id or coalesce(p_payload->>'purpose','')not in('reply.approve','reply.edit','reply.reject','reply.request_info')
   or p_payload-(case when p_payload->>'purpose'='reply.edit'then array['schema','purpose','intentId','requestId','body']else array['schema','purpose','intentId','requestId']end)<>'{}'then return jsonb_build_object('status','unknown');end if;
  if not exists(select 1 from public.conversation_intents i join public.conversation_drafts d on d.id=i.draft_id where i.id=(p_payload->>'intentId')::uuid and d.conversation_id=c and i.actor_id=auth.uid()and i.grant_id=(a->>'grantId')::uuid and i.grant_generation=(a->>'generation')::bigint and i.purpose=p_payload->>'purpose')then raise insufficient_privilege;end if;
 end if;
 if(p_payload->>'op'='propose'or p_payload->>'purpose'='reply.edit')and(jsonb_typeof(p_payload->'body')is distinct from 'string'or public._conversation_utf16(p_payload->>'body')not between 1 and 8000)then return jsonb_build_object('status','unknown');end if;
 if p_payload->>'op'in('propose','summary.edit')and(jsonb_typeof(p_payload->'summary')is distinct from 'string'or public._conversation_utf16(p_payload->>'summary')not between 1 and 16000)then return jsonb_build_object('status','unknown');end if;
 insert into public.conversation_receipts(actor_id,request_id,conversation_id,grant_id,generation,payload,state,result)
 values(auth.uid(),p_request_id,c,(a->>'grantId')::uuid,(a->>'generation')::bigint,p_payload,'retired',jsonb_build_object('ok',false,'code','command_retired'));
 perform public._conversation_audit(c,'command.retired',jsonb_build_object('requestId',p_request_id));
 return jsonb_build_object('status','not-recorded','requestId',p_request_id,'serialized',true);
exception when invalid_text_representation or numeric_value_out_of_range then return jsonb_build_object('status','unknown');
end$$;
create function public.conversation_revoke_grant()returns boolean language plpgsql security definer set search_path=''as $$begin
 if auth.role()is distinct from 'authenticated'or auth.uid()is null then raise insufficient_privilege;end if;
 -- Revoker intentionally does not acquire the clinical-case lock after the grant.
 update public.conversation_grants set revoked=true,generation=generation+1 where actor_id=auth.uid()and session_id=(auth.jwt()->>'session_id')::uuid and not revoked;
 return found;
end$$;
create function public._conversation_attempt_guard()returns trigger language plpgsql set search_path=''as $$begin
 if tg_op='DELETE'or new.id<>old.id or new.delivery_id<>old.delivery_id or new.envelope<>old.envelope or new.state_seq<>old.state_seq or new.claimed_at<>old.claimed_at or old.outcome is not null then raise exception using errcode='55000',message='Frozen conversation attempt cannot change';end if;return new;
end$$;
create trigger conversation_attempt_frozen before update or delete on public.conversation_attempts for each row execute function public._conversation_attempt_guard();
do $$declare n text;f record;begin
 foreach n in array array['conversation_policy','conversation_grants','conversations','conversation_messages','conversation_drafts','conversation_revisions','conversation_intents','conversation_approvals','conversation_receipts','conversation_endpoints','conversation_deliveries','conversation_attempts','conversation_audit']loop
  execute format('alter table public.%I enable row level security',n);execute format('revoke all on public.%I from public,anon,authenticated,service_role',n);
 end loop;
 foreach n in array array['conversation_messages','conversation_revisions','conversation_approvals','conversation_receipts','conversation_audit']loop
  execute format('create trigger %I before update or delete on public.%I for each row execute function public._conversation_immutable()',n||'_immutable',n);
 end loop;
 for f in select p.oid::regprocedure sig from pg_proc p join pg_namespace ns on ns.oid=p.pronamespace where ns.nspname='public'and(p.proname like '\_conversation\_%'escape '\'or p.proname like 'conversation\_%'escape '\')loop
  execute format('revoke all on function %s from public,anon,authenticated,service_role',f.sig);
 end loop;
end$$;
revoke all on sequence public.conversation_audit_id_seq from public,anon,authenticated,service_role;
grant execute on function public.conversation_receive(jsonb),public.conversation_workspace(uuid),public.conversation_intake_workspace(uuid),public.conversation_propose(uuid,uuid,bigint,bigint,bigint,text,text,text,jsonb),public.conversation_compose(uuid,uuid,bigint,bigint,bigint,text,text,text),public.conversation_edit_summary(uuid,uuid,uuid,bigint,text),public.conversation_actions(uuid),public.conversation_command(jsonb),public.conversation_revoke_grant(),public.conversation_recover(uuid,text,jsonb)to authenticated;
grant execute on function public.conversation_claim(uuid,uuid),public.conversation_outcome(uuid,jsonb),public.conversation_reconcile(uuid)to service_role;
