-- Recovery is independent of onboarding. No membership or accepted-session writes.
create function public._real_staff_amr_allowed(p_amr jsonb) returns boolean
language plpgsql immutable set search_path='' as $$
declare entry jsonb;password_seen boolean:=false;otp_seen boolean:=false;
begin
 if p_amr is null or jsonb_typeof(p_amr)<>'array' or jsonb_array_length(p_amr)=0 then return false;end if;
 for entry in select value from jsonb_array_elements(p_amr) loop
  if jsonb_typeof(entry)<>'object' or jsonb_typeof(entry->'method') is distinct from 'string' or length(entry->>'method')=0 then return false;end if;
  if entry->>'method'='recovery' then return false;end if;
  password_seen:=password_seen or entry->>'method'='password';otp_seen:=otp_seen or entry->>'method'='otp';
 end loop;
 return password_seen and (not otp_seen or password_seen);
end $$;
create or replace function public._real_staff_managed_session_allowed(p_actor uuid) returns boolean
language plpgsql stable security definer set search_path='' as $$
declare i public.real_staff_invitations;sid text;created timestamptz;has_invitation boolean;
begin
 -- Service callers must validate the end-user token before dispatch; their JWT is not the actor's.
 if auth.role()='service_role' then return true;end if;
 if auth.uid() is distinct from p_actor then return false;end if;
 sid:=auth.jwt()->>'session_id';if sid is null then return false;end if;
 select created_at into created from auth.sessions where id::text=sid and user_id=p_actor and (not_after is null or not_after>now());
 if not found then return false;end if;
 select * into i from public.real_staff_invitations where auth_user_id=p_actor;has_invitation:=found;
 if has_invitation then
  if i.status<>'accepted' or i.accepted_at is null then return false;end if;
  if sid=i.accepted_session_id::text then return true;end if;
  if created<i.accepted_at then return false;end if;
 end if;
 return public._real_staff_amr_allowed(auth.jwt()->'amr');
end $$;
create function public.real_staff_onboarding_session() returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.real_staff_invitations i join auth.sessions s on s.id=i.accepted_session_id and s.user_id=i.auth_user_id
 where i.auth_user_id=auth.uid() and i.status='accepted' and s.id::text=auth.jwt()->>'session_id' and (s.not_after is null or s.not_after>now()))
$$;
create or replace function public.real_clinical_staff_identity() returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('id',s.user_id,'role',s.role,'name',s.display_name,'clinicId',s.clinic_id)
 from public.workspace_staff s where s.user_id=auth.uid() and s.active and s.removed_at is null
 and (s.role='admin' or exists(select 1 from public.workspace_clinics c where c.id=s.clinic_id and c.active))
 and public._real_staff_managed_session_allowed(s.user_id)
$$;
create or replace function public._real_staff_require_admin() returns uuid
language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid();
begin
 perform 1 from public.workspace_staff where user_id=actor and role='admin' and active and removed_at is null for share;
 if not found or not public._real_staff_managed_session_allowed(actor) then raise insufficient_privilege using message='Active administrator session required';end if;
 return actor;
end $$;
-- Existing staff self reads must not reveal operational rows through quarantined JWTs.
alter policy workspace_staff_read_self on public.workspace_staff using(user_id=(select auth.uid()) and public._real_staff_managed_session_allowed(user_id));
revoke all on function public._real_staff_amr_allowed(jsonb),public.real_staff_onboarding_session() from public,anon,authenticated,service_role;
grant execute on function public.real_staff_onboarding_session() to authenticated;

create table public.real_staff_recoveries (
 id uuid primary key default gen_random_uuid(),request_id uuid not null unique,admin_id uuid not null references auth.users(id),staff_id uuid not null references auth.users(id),
 input jsonb not null,identity_snapshot jsonb not null,generation bigint not null check(generation>0),
 token_digest text check(token_digest ~ '^[a-f0-9]{64}$'),issued_at timestamptz not null default clock_timestamp(),expires_at timestamptz not null default(clock_timestamp()+interval '1 hour'),
 status text not null default 'pending' check(status in('pending','verified','changing','completed','cancelled')),
 dispatch_state text not null default 'pending' check(dispatch_state in('pending','accepted','failed','unknown')),dispatch_claimed_at timestamptz,provider_reference text,
 verified_session_id uuid,verified_at timestamptz,password_claimed_at timestamptz,completed_at timestamptz,failure_category text,
 unique(staff_id,generation)
);
create table public.real_staff_recovery_events (
 id bigint generated always as identity primary key,recovery_id uuid not null references public.real_staff_recoveries(id),kind text not null,
 actor_id uuid references auth.users(id),created_at timestamptz not null default clock_timestamp(),unique(recovery_id,kind),
 check(kind in('requested','dispatch_claimed','token_prepared','dispatch_accepted','dispatch_failed','dispatch_unknown','verified','password_claimed','password_saved','password_failed','password_unknown','cancelled'))
);
alter table public.real_staff_recoveries enable row level security;
alter table public.real_staff_recovery_events enable row level security;
revoke all on public.real_staff_recoveries,public.real_staff_recovery_events from public,anon,authenticated,service_role;
revoke all on sequence public.real_staff_recovery_events_id_seq from public,anon,authenticated,service_role;

create function public._real_staff_recovery_identity(p_staff uuid,p_session uuid default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare i public.real_staff_invitations;s public.workspace_staff;e text;created timestamptz;
begin
 select * into i from public.real_staff_invitations where auth_user_id=p_staff for share;
 if found and i.status<>'accepted' then raise insufficient_privilege using message='Accepted staff required';end if;
 select * into s from public.workspace_staff where user_id=p_staff for share;
 if not found or s.role not in('doctor','nurse') or not s.active or s.removed_at is not null then raise insufficient_privilege using message='Active clinical staff required';end if;
 perform 1 from public.workspace_clinics where id=s.clinic_id and active for share;if not found then raise insufficient_privilege using message='Active clinic required';end if;
 select lower(email) into e from auth.users where id=p_staff and email_confirmed_at is not null;if e is null then raise insufficient_privilege using message='Verified staff email required';end if;
 if p_session is not null then
  select created_at into created from auth.sessions where id=p_session and user_id=p_staff and (not_after is null or not_after>clock_timestamp());
  if not found or (i.id is not null and p_session is distinct from i.accepted_session_id and created<i.accepted_at) then raise insufficient_privilege using message='Live staff session required';end if;
 end if;
 return jsonb_build_object('id',s.user_id,'name',s.display_name,'email',e,'role',s.role,'clinicId',s.clinic_id);
end $$;
create function public._real_staff_recovery_json(r public.real_staff_recoveries) returns jsonb
language sql stable set search_path='' as $$
 select jsonb_build_object('id',r.id,'requestId',r.request_id,'adminId',r.admin_id,'staffId',r.staff_id,'generation',r.generation,'identity',r.identity_snapshot,'tokenDigest',r.token_digest,'expiresAt',r.expires_at,'status',r.status,'dispatchState',r.dispatch_state,'verifiedSessionId',r.verified_session_id)
$$;
create function public.real_admin_request_staff_recovery(p_staff_id uuid,p_expected_version text,p_request_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=public._real_staff_require_admin();r public.real_staff_recoveries;identity jsonb;input_value jsonb;g bigint;
begin
 if p_staff_id is null or p_request_id is null or p_expected_version !~ '^[a-f0-9]{32}$' then raise invalid_parameter_value using message='Check recovery details';end if;
 perform pg_advisory_xact_lock(hashtextextended('real-recovery-request:'||p_request_id::text,0));
 perform pg_advisory_xact_lock(hashtextextended('real-recovery-staff:'||p_staff_id::text,0));
 input_value:=jsonb_build_object('staffId',p_staff_id,'version',p_expected_version);
 select * into r from public.real_staff_recoveries where request_id=p_request_id for update;
 if found then
  if r.admin_id<>actor or r.input<>input_value then raise invalid_parameter_value using message='Request identity conflicts';end if;
  perform public._real_staff_recovery_identity(p_staff_id);return public._real_staff_recovery_json(r)-'tokenDigest';
 end if;
 if exists(select 1 from public.real_staff_recoveries where staff_id=p_staff_id and (issued_at>clock_timestamp()-interval '60 seconds' or (dispatch_claimed_at>clock_timestamp()-interval '2 minutes' and dispatch_state='pending'))) then raise serialization_failure using message='Wait before sending another recovery';end if;
 -- Recovery rows precede invitation/membership locks, matching all recovery steps.
 perform 1 from public.real_staff_recoveries where staff_id=p_staff_id order by generation for update;
 identity:=public._real_staff_recovery_identity(p_staff_id);
 if public._real_staff_directory_row(p_staff_id)->>'version' is distinct from p_expected_version then raise serialization_failure using message='Staff changed. Reload the directory';end if;
 select coalesce(max(generation),0)+1 into g from public.real_staff_recoveries where staff_id=p_staff_id;
 with cancelled as(update public.real_staff_recoveries set status='cancelled',token_digest=null,failure_category='superseded' where staff_id=p_staff_id and status not in('completed','cancelled') returning id)
 insert into public.real_staff_recovery_events(recovery_id,kind,actor_id) select id,'cancelled',actor from cancelled on conflict do nothing;
 insert into public.real_staff_recoveries(request_id,admin_id,staff_id,input,identity_snapshot,generation) values(p_request_id,actor,p_staff_id,input_value,identity,g) returning * into r;
 insert into public.real_staff_recovery_events(recovery_id,kind,actor_id) values(r.id,'requested',actor);
 return public._real_staff_recovery_json(r)-'tokenDigest';
end $$;
create function public.real_staff_recovery_context(p_id uuid,p_generation bigint,p_session uuid default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r public.real_staff_recoveries;identity jsonb;
begin
 select * into r from public.real_staff_recoveries where id=p_id and generation=p_generation;
 if not found or (r.status='cancelled' or (r.status='completed' and (p_session is null or p_session is distinct from r.verified_session_id))) or r.expires_at<=clock_timestamp() then raise insufficient_privilege using message='Recovery unavailable';end if;
 identity:=public._real_staff_recovery_identity(r.staff_id,p_session);
 if identity->>'email' is distinct from r.identity_snapshot->>'email' or identity->>'role' is distinct from r.identity_snapshot->>'role' or identity->>'clinicId' is distinct from r.identity_snapshot->>'clinicId' then raise insufficient_privilege using message='Staff identity changed';end if;
 return public._real_staff_recovery_json(r)||jsonb_build_object('identity',identity);
end $$;
create function public.real_staff_recovery_step(p_id uuid,p_generation bigint,p_step text,p_digest text default null,p_session uuid default null,p_reference text default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r public.real_staff_recoveries;kind_value text;claimed boolean:=false;
begin
 -- Namespace locks precede row locks. No case rows or external calls occur here.
 select * into r from public.real_staff_recoveries where id=p_id;
 if not found then raise insufficient_privilege using message='Recovery unavailable';end if;
 perform pg_advisory_xact_lock(hashtextextended('real-recovery-staff:'||r.staff_id::text,0));
 select * into r from public.real_staff_recoveries where id=p_id and generation=p_generation for update;
 if not found then raise serialization_failure using message='Recovery changed';end if;
 perform public.real_staff_recovery_context(p_id,p_generation,p_session);
 if r.status='completed' and p_step='complete' and p_session=r.verified_session_id then return public._real_staff_recovery_json(r)||jsonb_build_object('claimed',false);end if;
 case p_step
 when 'claim-dispatch' then
  if r.status<>'pending' or r.dispatch_claimed_at is not null then return public._real_staff_recovery_json(r)||jsonb_build_object('claimed',false);end if;
  r.dispatch_claimed_at:=clock_timestamp();claimed:=true;kind_value:='dispatch_claimed';
 when 'token' then
  if r.status<>'pending' or r.dispatch_claimed_at is null or r.token_digest is not null or p_digest !~ '^[a-f0-9]{64}$' then raise insufficient_privilege using message='Recovery dispatch changed';end if;
  r.token_digest:=p_digest;kind_value:='token_prepared';
 when 'accepted','failed','unknown' then
  if r.status<>'pending' or r.dispatch_claimed_at is null or r.dispatch_state<>'pending' then raise insufficient_privilege using message='Recovery dispatch changed';end if;
  r.dispatch_state:=p_step;r.provider_reference:=case when p_step='accepted' then left(p_reference,255) end;kind_value:='dispatch_'||p_step;
 when 'verify' then
  if r.status not in('pending','verified') or r.token_digest is null or p_digest is distinct from r.token_digest or p_session is null or (r.verified_session_id is not null and r.verified_session_id<>p_session) then raise insufficient_privilege using message='Recovery verification changed';end if;
  r.status:='verified';r.verified_session_id:=p_session;r.verified_at:=coalesce(r.verified_at,clock_timestamp());kind_value:='verified';
 when 'claim-password' then
  if r.status<>'verified' or p_session is distinct from r.verified_session_id or p_digest is distinct from r.token_digest then return public._real_staff_recovery_json(r)||jsonb_build_object('claimed',false);end if;
  r.status:='changing';r.password_claimed_at:=clock_timestamp();kind_value:='password_claimed';claimed:=true;
 when 'password-failed','password-unknown' then
  if r.status<>'changing' or p_session is distinct from r.verified_session_id then raise insufficient_privilege using message='Password operation unavailable';end if;
  -- Unknown mutations require an explicit new recovery generation, never automatic retry.
  r.status:=case when p_step='password-failed' then 'verified' else 'cancelled' end;r.failure_category:=p_step;kind_value:=replace(p_step,'-','_');
 when 'complete' then
  if r.status<>'changing' or p_session is distinct from r.verified_session_id or p_digest is distinct from r.token_digest then raise insufficient_privilege using message='Password confirmation unavailable';end if;
  r.status:='completed';r.completed_at:=clock_timestamp();kind_value:='password_saved';
 else raise invalid_parameter_value using message='Recovery step unavailable';
 end case;
 update public.real_staff_recoveries set token_digest=r.token_digest,status=r.status,dispatch_claimed_at=r.dispatch_claimed_at,dispatch_state=r.dispatch_state,provider_reference=r.provider_reference,verified_session_id=r.verified_session_id,verified_at=r.verified_at,password_claimed_at=r.password_claimed_at,completed_at=r.completed_at,failure_category=r.failure_category where id=r.id;
 insert into public.real_staff_recovery_events(recovery_id,kind,actor_id) values(r.id,kind_value,case when p_session is null then r.admin_id else r.staff_id end) on conflict do nothing;
 return public._real_staff_recovery_json(r)||jsonb_build_object('claimed',claimed);
end $$;
create function public.real_admin_staff_recovery_summaries() returns jsonb
language plpgsql security definer set search_path='' as $$
begin
 perform public._real_staff_require_admin();
 return(select coalesce(jsonb_agg(jsonb_build_object('id',id,'staffId',staff_id,'generation',generation,'status',case when status not in('completed','cancelled') and expires_at<=clock_timestamp() then 'expired' else status end,'dispatchState',dispatch_state,'issuedAt',issued_at,'expiresAt',expires_at,'failureCategory',failure_category) order by issued_at desc),'[]') from(select * from public.real_staff_recoveries order by issued_at desc limit 200) rows);
end $$;
revoke all on function public._real_staff_recovery_identity(uuid,uuid),public._real_staff_recovery_json(public.real_staff_recoveries),public.real_admin_request_staff_recovery(uuid,text,uuid),public.real_admin_staff_recovery_summaries(),public.real_staff_recovery_context(uuid,bigint,uuid),public.real_staff_recovery_step(uuid,bigint,text,text,uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.real_admin_request_staff_recovery(uuid,text,uuid),public.real_admin_staff_recovery_summaries() to authenticated;
grant execute on function public.real_staff_recovery_context(uuid,bigint,uuid),public.real_staff_recovery_step(uuid,bigint,text,text,uuid,text) to service_role;
