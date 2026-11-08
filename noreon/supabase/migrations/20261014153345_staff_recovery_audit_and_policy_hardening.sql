-- Forward correction of recovery audit attempts, RLS wrapper and strict replay guards.
create function public.real_staff_clinical_session_allowed() returns boolean
language sql stable security definer set search_path='' as $$select public._real_staff_managed_session_allowed(auth.uid())$$;
revoke all on function public.real_staff_clinical_session_allowed() from public,anon,authenticated,service_role;
grant execute on function public.real_staff_clinical_session_allowed() to authenticated;
alter policy workspace_staff_read_self on public.workspace_staff using(user_id=(select auth.uid()) and public.real_staff_clinical_session_allowed());
alter table public.real_staff_recoveries add column password_attempt integer not null default 0 check(password_attempt>=0);
alter table public.real_staff_recovery_events add column attempt integer not null default 0 check(attempt>=0);
alter table public.real_staff_recovery_events drop constraint real_staff_recovery_events_recovery_id_kind_key;
alter table public.real_staff_recovery_events add constraint real_staff_recovery_events_recovery_id_kind_attempt_key unique(recovery_id,kind,attempt);
create or replace function public.real_admin_request_staff_recovery(p_staff_id uuid,p_expected_version text,p_request_id uuid) returns jsonb
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
 if exists(select 1 from public.real_staff_recoveries where staff_id=p_staff_id and (issued_at>clock_timestamp()-interval '60 seconds' or (dispatch_claimed_at>clock_timestamp()-interval '2 minutes' and dispatch_state='pending' and status='pending'))) then raise serialization_failure using message='Wait before sending another recovery';end if;
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
create or replace function public.real_staff_recovery_step(p_id uuid,p_generation bigint,p_step text,p_digest text default null,p_session uuid default null,p_reference text default null) returns jsonb
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
 if r.status='completed' and p_step='complete' and p_session=r.verified_session_id and p_digest=r.token_digest then return public._real_staff_recovery_json(r)||jsonb_build_object('claimed',false);end if;
 case p_step
 when 'claim-dispatch' then
  if r.status<>'pending' or r.dispatch_claimed_at is not null then return public._real_staff_recovery_json(r)||jsonb_build_object('claimed',false);end if;
  r.dispatch_claimed_at:=clock_timestamp();claimed:=true;kind_value:='dispatch_claimed';
 when 'token' then
  if r.status<>'pending' or r.dispatch_claimed_at is null or r.token_digest is not null or p_digest is null or p_digest !~ '^[a-f0-9]{64}$' then raise insufficient_privilege using message='Recovery dispatch changed';end if;
  r.token_digest:=p_digest;kind_value:='token_prepared';
 when 'accepted','failed','unknown' then
  if r.status<>'pending' or r.dispatch_claimed_at is null or r.dispatch_state<>'pending' then raise insufficient_privilege using message='Recovery dispatch changed';end if;
  r.dispatch_state:=p_step;r.provider_reference:=case when p_step='accepted' then left(p_reference,255) end;kind_value:='dispatch_'||p_step;
 when 'verify' then
  if r.status not in('pending','verified') or r.token_digest is null or p_digest is distinct from r.token_digest or p_session is null or (r.verified_session_id is not null and r.verified_session_id<>p_session) then raise insufficient_privilege using message='Recovery verification changed';end if;
  r.status:='verified';r.verified_session_id:=p_session;r.verified_at:=coalesce(r.verified_at,clock_timestamp());kind_value:='verified';
 when 'claim-password' then
  if r.status<>'verified' or p_session is distinct from r.verified_session_id or p_digest is distinct from r.token_digest then return public._real_staff_recovery_json(r)||jsonb_build_object('claimed',false);end if;
  r.status:='changing';r.password_attempt:=r.password_attempt+1;r.password_claimed_at:=clock_timestamp();kind_value:='password_claimed';claimed:=true;
 when 'password-failed','password-unknown' then
  if r.status<>'changing' or p_session is distinct from r.verified_session_id then raise insufficient_privilege using message='Password operation unavailable';end if;
  -- Unknown mutations require an explicit new recovery generation, never automatic retry.
  r.status:=case when p_step='password-failed' then 'verified' else 'cancelled' end;r.failure_category:=p_step;kind_value:=replace(p_step,'-','_');
 when 'complete' then
  if r.status<>'changing' or p_session is distinct from r.verified_session_id or p_digest is distinct from r.token_digest then raise insufficient_privilege using message='Password confirmation unavailable';end if;
  r.status:='completed';r.completed_at:=clock_timestamp();r.failure_category:=null;kind_value:='password_saved';
 else raise invalid_parameter_value using message='Recovery step unavailable';
 end case;
 update public.real_staff_recoveries set token_digest=r.token_digest,status=r.status,dispatch_claimed_at=r.dispatch_claimed_at,dispatch_state=r.dispatch_state,provider_reference=r.provider_reference,verified_session_id=r.verified_session_id,verified_at=r.verified_at,password_attempt=r.password_attempt,password_claimed_at=r.password_claimed_at,completed_at=r.completed_at,failure_category=r.failure_category where id=r.id;
 insert into public.real_staff_recovery_events(recovery_id,kind,actor_id,attempt) values(r.id,kind_value,case when p_session is null then r.admin_id else r.staff_id end,case when kind_value like 'password_%' then r.password_attempt else 0 end) on conflict do nothing;
 return public._real_staff_recovery_json(r)||jsonb_build_object('claimed',claimed);
end $$;
