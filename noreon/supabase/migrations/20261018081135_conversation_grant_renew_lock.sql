-- Conversation grant renewal (follow-up to #263, Fable review 18 Oct, findings F1 and F2).
--
-- F1: #263 renewed with `insert ... on conflict do update ... where`, which locks the existing grant
--     row FOR UPDATE on every call, renewal due or not. A delivery claim for another member of the
--     same doctor then failed with 55P03 and waited for the next sweep, and a doctor's parallel
--     calls serialised. Now the grant is read first; only a lapsed or outdated grant is updated
--     (the exclusive lock only then), and a live one is locked FOR SHARE as before #263.
-- F2: a conversation_policy.version change now bumps the staff generation too, like an amr change,
--     so intents and approvals issued under the old policy are fenced. Members keep theirs.
--
-- Unchanged: who passes (every check raises before any renewal), revoked grants stay revoked, the
-- expiry is capped by auth.sessions.not_after, create_grant=false (conversation_claim) never renews.

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
    policy_version=p.version,amr=_conversation_authorize.amr,
    -- Staff authority is fenced when the sign-in method or the policy changed (Fable F2): intents
    -- and approvals made before no longer act. Members keep the generation (replay keys on it).
    generation=case when(a<>m or staff_only)and(cg.amr is distinct from _conversation_authorize.amr or cg.policy_version<>p.version)then cg.generation+1 else cg.generation end
   where cg.id=g.id and not cg.revoked
    and(cg.expires_at<=clock_timestamp()or cg.policy_version<>p.version or cg.amr is distinct from _conversation_authorize.amr);
  end if;
 end if;
 select * into g from public.conversation_grants where actor_id=a and session_id=sid for share nowait;
 if not found or g.revoked or g.expires_at<=clock_timestamp()or g.policy_version<>p.version or g.amr is distinct from amr then raise insufficient_privilege;end if;
 return jsonb_build_object('actorId',a,'sessionId',sid,'grantId',g.id,'generation',g.generation,'clinicalRevision',c.revision,
 'doctor',case when s.user_id is null then null else jsonb_build_object('staffId',s.user_id,'displayName',s.display_name,'role',s.role,'clinicId',s.clinic_id)end);
end$$;
-- create or replace keeps the function's existing grants.
