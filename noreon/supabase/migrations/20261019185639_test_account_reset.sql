-- Test accounts and the "Reset test account" action (Khikar, 19 Oct 22:51).
-- A tester signs up again with the same phone and Telegram: the old account keeps every row,
-- its Telegram is unlinked through the existing revoke path, its sessions end and its Auth
-- phone moves to an unassigned +999 placeholder (country code 999 is unassigned; never +37499,
-- a real Armenian range). The phone change itself needs the Auth admin API, so the server
-- action calls test_account_reset_begin first and test_account_reset_finish after the change.
--
-- Roles: an admin flags accounts and resets them. The new staff role 'qa' has no clinic, so
-- real_clinical_staff_identity() and every staff surface built on it refuse it; qa reaches only
-- the functions below, and only for flagged accounts. Staff and clinic accounts can never be
-- flagged or reset.

-- 1. The flag on profiles. Members own their profile row, so a trigger refuses any client
--    (authenticated or anon) write to these columns; only the definer functions below set them.
alter table public.profiles
 add column is_test_account boolean not null default false,
 add column test_account_reset_at timestamptz,
 add column test_account_reset_count integer not null default 0 check(test_account_reset_count>=0);
create index profiles_test_accounts on public.profiles(id)where is_test_account;

create function public._profiles_test_flag_guard()returns trigger
language plpgsql set search_path=''as $$
begin
 if current_user in('authenticated','anon')and(
  (tg_op='INSERT'and(new.is_test_account or new.test_account_reset_at is not null or new.test_account_reset_count<>0))
  or(tg_op='UPDATE'and(new.is_test_account is distinct from old.is_test_account or new.test_account_reset_at is distinct from old.test_account_reset_at
   or new.test_account_reset_count is distinct from old.test_account_reset_count)))
 then raise insufficient_privilege using message='Test account fields are set by an administrator';end if;
 return new;
end$$;
create trigger profiles_test_flag_guard before insert or update on public.profiles for each row execute function public._profiles_test_flag_guard();
revoke all on function public._profiles_test_flag_guard()from public,anon,authenticated,service_role;

-- 2. The qa staff role: no clinic, ever.
alter table public.workspace_staff drop constraint workspace_staff_role_check;
alter table public.workspace_staff add constraint workspace_staff_role_check check(role in('admin','doctor','nurse','qa'));
alter table public.workspace_staff drop constraint workspace_staff_doctor_clinic;
alter table public.workspace_staff add constraint workspace_staff_doctor_clinic check(role in('admin','qa')or clinic_id is not null);
alter table public.workspace_staff add constraint workspace_staff_qa_no_clinic check(role<>'qa'or clinic_id is null);

-- qa may sign in (password plus the staff Telegram step when it is required); everything after
-- sign-in still checks the role.
create or replace function public._staff_signin_eligible(u uuid)returns boolean language sql stable security definer set search_path=''as $$
 select exists(select 1 from public.workspace_staff s where s.user_id=u and s.active and s.removed_at is null
  and(s.role in('admin','qa')or exists(select 1 from public.workspace_clinics c where c.id=s.clinic_id and c.active)))
 or exists(select 1 from public.clinic_portal_memberships m join public.workspace_clinics c on c.id=m.clinic_id and c.active where m.user_id=u and m.active)
$$;

-- 3. Records. Clients never read these tables directly.
create table public.test_account_audit(
 id bigint generated always as identity primary key,
 at timestamptz not null default clock_timestamp(),
 actor_id uuid not null,
 actor_role text not null check(actor_role in('admin','qa')),
 member_id uuid not null,
 action text not null check(action in('flag.set','flag.cleared','reset.started','reset.phone_changed','reset.phone_failed')),
 reset_id uuid,
 details jsonb not null default '{}'::jsonb check(jsonb_typeof(details)='object'),
 session_id text check(length(session_id)<=80)
);
create index test_account_audit_member on public.test_account_audit(member_id,at desc);
alter table public.test_account_audit enable row level security;
revoke all on public.test_account_audit from public,anon,authenticated,service_role;

create sequence public.test_account_placeholder_seq;
revoke all on sequence public.test_account_placeholder_seq from public,anon,authenticated,service_role;

create table public.test_account_resets(
 id uuid primary key default gen_random_uuid(),
 member_id uuid not null references public.profiles(id),
 request_key uuid not null unique,
 actor_id uuid not null,
 actor_role text not null check(actor_role in('admin','qa')),
 -- Digits as Auth stores them (no plus sign): 9990 and eight digits.
 placeholder_phone text not null unique check(placeholder_phone ~ '^9990[0-9]{8}$'),
 -- Kept only so an operator can undo a reset (see PROD_ENV_ROLLBACK); never returned to clients.
 previous_phone text,
 state text not null default 'phone_pending' check(state in('phone_pending','done')),
 telegram_revoked boolean not null,
 sessions_revoked integer not null check(sessions_revoked>=0),
 started_at timestamptz not null default clock_timestamp(),
 finished_at timestamptz,
 -- One caller at a time may run the Auth phone change (review RESET-01 round 2): it claims the
 -- reset first; a duplicate request sees the live claim and makes no Auth call.
 claim_token uuid,
 claimed_at timestamptz,
 check((state='done')=(finished_at is not null)),
 check((claim_token is null)=(claimed_at is null))
);
-- At most one unfinished reset per account: a retry or a second click finishes the same one.
create unique index test_account_resets_one_pending on public.test_account_resets(member_id)where state='phone_pending';
alter table public.test_account_resets enable row level security;
revoke all on public.test_account_resets from public,anon,authenticated,service_role;

-- 4. Who may operate test accounts: an active, not removed admin or qa with a live managed staff
--    session (the same session boundary every real staff function uses).
create function public._test_account_operator()returns public.workspace_staff
language plpgsql stable security definer set search_path=''as $$
declare s public.workspace_staff;
begin
 if auth.role()is distinct from 'authenticated'or auth.uid()is null then raise insufficient_privilege using message='Test account access refused';end if;
 select * into s from public.workspace_staff where user_id=auth.uid()and role in('admin','qa')and active and removed_at is null;
 if not found or not public._real_staff_managed_session_allowed(s.user_id)then raise insufficient_privilege using message='Test account access refused';end if;
 return s;
end$$;

-- A user who is staff or clinic staff is never a test member, whatever the flag says.
create function public._test_account_is_staff(u uuid)returns boolean language sql stable security definer set search_path=''as $$
 select exists(select 1 from public.workspace_staff where user_id=u)or exists(select 1 from public.clinic_portal_memberships where user_id=u)
$$;

-- True while a reset could still change the Auth phone: unfinished, or claimed within the last
-- three minutes (the server action aborts its Auth call after 20 seconds; a claim lasts two).
create function public._test_account_reset_busy(m uuid)returns boolean language sql stable security definer set search_path=''as $$
 select exists(select 1 from public.test_account_resets where member_id=m and(state='phone_pending'or claimed_at>clock_timestamp()-interval '3 minutes'))
$$;

create function public._test_account_audit(s public.workspace_staff,m uuid,a text,r uuid,d jsonb)returns void
language sql security definer set search_path=''as $$
 insert into public.test_account_audit(actor_id,actor_role,member_id,action,reset_id,details,session_id)
 values(s.user_id,s.role,m,a,r,d,left(auth.jwt()->>'session_id',80))
$$;

-- 5. Sign-in routing and the operator's own identity (admin or qa), or null.
create function public.test_account_operator_identity()returns jsonb
language plpgsql stable security definer set search_path=''as $$
declare s public.workspace_staff;
begin
 begin s:=public._test_account_operator();exception when insufficient_privilege then return null;end;
 return jsonb_build_object('id',s.user_id,'role',s.role,'name',s.display_name);
end$$;

-- 6. Admin only: flag or unflag a member account.
create function public.admin_set_test_account(p_member uuid,p_test boolean,p_reason text)returns jsonb
language plpgsql security definer set search_path=''as $$
declare s public.workspace_staff:=public._test_account_operator();p public.profiles;
begin
 if s.role<>'admin'then raise insufficient_privilege using message='Only an administrator marks test accounts';end if;
 if p_member is null or p_test is null or p_reason is null or length(btrim(p_reason))not between 3 and 300 then
  raise invalid_parameter_value using message='A reason of 3 to 300 characters is required';end if;
 perform pg_advisory_xact_lock(hashtextextended('test-account:'||p_member::text,0));
 select * into p from public.profiles where id=p_member for update;
 if not found then raise no_data_found using message='Member not found';end if;
 if p_test and public._test_account_is_staff(p_member)then raise insufficient_privilege using message='Staff and clinic accounts cannot be test accounts';end if;
 if p.is_test_account=p_test then return jsonb_build_object('ok',true,'changed',false,'isTest',p_test);end if;
 -- An unfinished reset may still change the Auth phone; it must finish first (review RESET-01).
 if not p_test and public._test_account_reset_busy(p_member)then
  raise exception using errcode='55006',message='Finish the pending reset before removing the test mark';end if;
 update public.profiles set is_test_account=p_test where id=p_member;
 perform public._test_account_audit(s,p_member,case when p_test then 'flag.set'else 'flag.cleared'end,null,jsonb_build_object('reason',btrim(p_reason)));
 return jsonb_build_object('ok',true,'changed',true,'isTest',p_test);
end$$;

-- 7. The test account list (admin and qa): only flagged member accounts, only what a tester needs.
create function public.test_accounts_list()returns jsonb
language plpgsql stable security definer set search_path=''as $$
declare s public.workspace_staff:=public._test_account_operator();
begin
 return coalesce((select jsonb_agg(jsonb_build_object(
   'id',p.id,'name',p.display_name,'createdAt',p.created_at,
   'phoneEnding',case when u.phone ~ '^9990'then null else right(u.phone,3)end,
   'placeholder',coalesce(u.phone ~ '^9990',false),
   'telegramLinked',exists(select 1 from public.telegram_auth_bindings b where b.auth_user_id=p.id and b.kind='member'and b.active),
   'resetAt',p.test_account_reset_at,'resetCount',p.test_account_reset_count,
   'resetPending',exists(select 1 from public.test_account_resets r where r.member_id=p.id and r.state='phone_pending'))
  order by p.created_at desc,p.id)
  from public.profiles p left join auth.users u on u.id=p.id
  where p.is_test_account and not public._test_account_is_staff(p.id)),'[]'::jsonb);
end$$;

-- 8. The TEST badge for staff views: which of the given members are test accounts. Any active
--    real staff member or operator may ask; the answer is only the flag.
create function public.staff_test_account_flags(p_ids uuid[])returns uuid[]
language plpgsql stable security definer set search_path=''as $$
begin
 if coalesce(cardinality(p_ids),0)>500 then raise invalid_parameter_value using message='Too many members';end if;
 if public.real_clinical_staff_identity()is null and public.test_account_operator_identity()is null then
  raise insufficient_privilege using message='Staff access required';end if;
 if(public.real_clinical_staff_identity()->>'role')is not null and not public._real_staff_managed_session_allowed(auth.uid())then
  raise insufficient_privilege using message='Staff access required';end if;
 return coalesce((select array_agg(id order by id)from public.profiles where id=any(p_ids)and is_test_account),'{}'::uuid[]);
end$$;

-- 9. Reset, step one (admin or qa, flagged accounts only). Idempotent per request key; a second
--    request while one is unfinished returns that one, so a double click resets once.
--    Lock order: test-account advisory lock, then the Telegram user lock telegram_auth_unlink
--    takes, then the profile row; _telegram_revoke_binding continues with its own order.
create function public.test_account_reset_begin(p_member uuid,p_request_key uuid)returns jsonb
language plpgsql security definer set search_path=''as $$
declare s public.workspace_staff:=public._test_account_operator();p public.profiles;r public.test_account_resets;
 b public.telegram_auth_bindings;revoked boolean:=false;n integer;sessions integer:=0;candidate text;old_phone text;
begin
 if p_member is null or p_request_key is null then raise invalid_parameter_value using message='Member and request key are required';end if;
 perform pg_advisory_xact_lock(hashtextextended('test-account:'||p_member::text,0));
 perform pg_advisory_xact_lock(hashtextextended('tg-auth-user:'||p_member::text,0));
 -- The target is checked before any replay (review RESET-01): a replayed click never reaches
 -- the Auth phone change for an account that is no longer a flagged member account.
 select * into p from public.profiles where id=p_member for update;
 if not found or not p.is_test_account or public._test_account_is_staff(p_member)then
  raise insufficient_privilege using message='Only test accounts can be reset';end if;
 select * into r from public.test_account_resets where request_key=p_request_key;
 if found then
  if r.member_id<>p_member then raise invalid_parameter_value using message='Request key belongs to another reset';end if;
  return jsonb_build_object('ok',true,'replay',true,'resetId',r.id,'memberId',r.member_id,'placeholder','+'||r.placeholder_phone,'state',r.state);
 end if;
 select * into r from public.test_account_resets where member_id=p_member and state='phone_pending';
 if found then
  return jsonb_build_object('ok',true,'replay',true,'resetId',r.id,'memberId',r.member_id,'placeholder','+'||r.placeholder_phone,'state',r.state);
 end if;
 -- Telegram: the same revoke the member's own unlink uses (endpoints, held deliveries, open
 -- challenges, outstanding codes, sessions, delayed cleanup, Telegram audit).
 for b in select * from public.telegram_auth_bindings where auth_user_id=p_member and kind='member'and active loop
  revoked:=coalesce((public._telegram_revoke_binding(b.id,'test_account_reset')->>'revoked')::boolean,false)or revoked;
 end loop;
 -- Sessions, also when no Telegram was linked: the same steps as the revoke path.
 update auth.users set confirmation_token='',recovery_token='',phone_change_token='',reauthentication_token='',email_change_token_new='',email_change_token_current=''where id=p_member;
 delete from auth.one_time_tokens where user_id=p_member;
 delete from auth.sessions where user_id=p_member;get diagnostics n=row_count;sessions:=n;
 insert into public.auth_cleanup_jobs(auth_user_id,revoked_at,due_at)values(p_member,clock_timestamp(),clock_timestamp()+interval '6 minutes');
 select phone into old_phone from auth.users where id=p_member for update;
 loop
  candidate:='9990'||lpad(nextval('public.test_account_placeholder_seq')::text,8,'0');
  exit when not exists(select 1 from auth.users where phone=candidate)and not exists(select 1 from public.test_account_resets where placeholder_phone=candidate);
 end loop;
 insert into public.test_account_resets(member_id,request_key,actor_id,actor_role,placeholder_phone,previous_phone,telegram_revoked,sessions_revoked)
 values(p_member,p_request_key,s.user_id,s.role,candidate,old_phone,revoked,sessions)returning * into r;
 update public.profiles set test_account_reset_at=r.started_at,test_account_reset_count=test_account_reset_count+1 where id=p_member;
 perform public._test_account_audit(s,p_member,'reset.started',r.id,jsonb_build_object('telegramRevoked',revoked,'sessions',sessions));
 return jsonb_build_object('ok',true,'replay',false,'resetId',r.id,'memberId',r.member_id,'placeholder','+'||r.placeholder_phone,'state',r.state);
end$$;

-- 10a. Reset, the claim before the Auth call: the target is checked again, and only one live
--      claim exists per reset. Returns the claim token, or done/busy.
create function public.test_account_reset_claim(p_reset uuid)returns jsonb
language plpgsql security definer set search_path=''as $$
declare s public.workspace_staff:=public._test_account_operator();r public.test_account_resets;p public.profiles;
begin
 select * into r from public.test_account_resets where id=p_reset;
 if not found then raise no_data_found using message='Reset not found';end if;
 perform pg_advisory_xact_lock(hashtextextended('test-account:'||r.member_id::text,0));
 select * into p from public.profiles where id=r.member_id for update;
 if not found or not p.is_test_account or public._test_account_is_staff(r.member_id)then
  raise insufficient_privilege using message='Only test accounts can be reset';end if;
 select * into r from public.test_account_resets where id=p_reset for update;
 if r.state='done'then return jsonb_build_object('ok',false,'code','done');end if;
 if r.claimed_at>clock_timestamp()-interval '2 minutes'then return jsonb_build_object('ok',false,'code','busy');end if;
 update public.test_account_resets set claim_token=gen_random_uuid(),claimed_at=clock_timestamp()where id=r.id returning * into r;
 return jsonb_build_object('ok',true,'claimToken',r.claim_token,'memberId',r.member_id,'placeholder','+'||r.placeholder_phone);
end$$;

-- 10. Reset, step two: record the Auth phone change. Done only when Auth really holds the
--     placeholder, so the step cannot be marked done without the change.
create function public.test_account_reset_finish(p_reset uuid,p_ok boolean,p_claim uuid)returns jsonb
language plpgsql security definer set search_path=''as $$
declare s public.workspace_staff:=public._test_account_operator();r public.test_account_resets;p public.profiles;phone_now text;
begin
 select * into r from public.test_account_resets where id=p_reset;
 if not found then raise no_data_found using message='Reset not found';end if;
 perform pg_advisory_xact_lock(hashtextextended('test-account:'||r.member_id::text,0));
 select * into p from public.profiles where id=r.member_id for update;
 if not found or not p.is_test_account or public._test_account_is_staff(r.member_id)then
  raise insufficient_privilege using message='Only test accounts can be reset';end if;
 select * into r from public.test_account_resets where id=p_reset for update;
 if r.state='done'then return jsonb_build_object('ok',true,'state','done','replay',true);end if;
 if p_claim is null or r.claim_token is distinct from p_claim then raise invalid_parameter_value using message='This reset is claimed by another request';end if;
 select phone into phone_now from auth.users where id=r.member_id;
 if coalesce(p_ok,false)and phone_now is not distinct from r.placeholder_phone then
  update public.test_account_resets set state='done',finished_at=clock_timestamp()where id=r.id;
  perform public._test_account_audit(s,r.member_id,'reset.phone_changed',r.id,'{}'::jsonb);
  return jsonb_build_object('ok',true,'state','done','replay',false);
 end if;
 perform public._test_account_audit(s,r.member_id,'reset.phone_failed',r.id,'{}'::jsonb);
 -- The claim ends so a retry may claim again at once.
 update public.test_account_resets set claim_token=null,claimed_at=null where id=r.id;
 return jsonb_build_object('ok',false,'state','phone_pending');
end$$;

-- 11. A flagged test account never becomes staff or clinic staff (review RESET-01): the flag
--     cannot be removed while a reset is pending, so a pending Auth change stays on a member.
create function public._test_account_staff_guard()returns trigger
language plpgsql security definer set search_path=''as $$
begin
 perform 1 from public.profiles where id=new.user_id and is_test_account for share;
 if found or public._test_account_reset_busy(new.user_id)then raise insufficient_privilege using message='A test account cannot be a staff or clinic account';end if;
 return new;
end$$;
create trigger workspace_staff_test_account_guard before insert or update of user_id on public.workspace_staff for each row execute function public._test_account_staff_guard();
create trigger clinic_portal_memberships_test_account_guard before insert or update of user_id on public.clinic_portal_memberships for each row execute function public._test_account_staff_guard();
revoke all on function public._test_account_staff_guard()from public,anon,authenticated,service_role;

-- 12. The staff Telegram sign-in step counts qa as a staff portal account (review RESET-02);
--     only staffEligible changes, the rest is 20261016233650 unchanged.
create or replace function public.staff_signin_state()returns jsonb
language plpgsql security definer set search_path=''as $$
declare u uuid:=auth.uid();sid uuid;
begin
 if auth.role()is distinct from 'authenticated'or u is null then raise insufficient_privilege;end if;
 sid:=(auth.jwt()->>'session_id')::uuid;
 return jsonb_build_object('ok',true,'required',public._staff_signin_required(),'admitted',public._staff_session_admitted(u,sid)and public._staff_signin_required(),
  'enrolled',exists(select 1 from public.telegram_auth_bindings where auth_user_id=u and kind='staff'and active),'eligible',public._staff_signin_eligible(u),
  'staffEligible',exists(select 1 from public.workspace_staff s where s.user_id=u and s.active and s.removed_at is null
   and(s.role in('admin','qa')or exists(select 1 from public.workspace_clinics c where c.id=s.clinic_id and c.active))),
  'clinicEligible',exists(select 1 from public.clinic_portal_memberships m join public.workspace_clinics c on c.id=m.clinic_id and c.active where m.user_id=u and m.active));
exception when invalid_text_representation then raise insufficient_privilege;
end$$;

revoke all on function public._test_account_operator(),public._test_account_is_staff(uuid),public._test_account_reset_busy(uuid),
 public._test_account_audit(public.workspace_staff,uuid,text,uuid,jsonb)from public,anon,authenticated,service_role;
revoke all on function public.test_account_operator_identity(),public.admin_set_test_account(uuid,boolean,text),public.test_accounts_list(),
 public.staff_test_account_flags(uuid[]),public.test_account_reset_begin(uuid,uuid),public.test_account_reset_claim(uuid),public.test_account_reset_finish(uuid,boolean,uuid)
 from public,anon,authenticated,service_role;
grant execute on function public.test_account_operator_identity(),public.admin_set_test_account(uuid,boolean,text),public.test_accounts_list(),
 public.staff_test_account_flags(uuid[]),public.test_account_reset_begin(uuid,uuid),public.test_account_reset_claim(uuid),public.test_account_reset_finish(uuid,boolean,uuid)
 to authenticated;
