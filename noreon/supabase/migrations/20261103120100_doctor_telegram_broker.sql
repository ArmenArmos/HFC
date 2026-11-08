-- T1 only: dedicated password sessions; all service boundaries are explicit. Dark by default.
create table public.doctor_telegram_settings(singleton boolean primary key default true check(singleton),enabled boolean not null default false);
insert into public.doctor_telegram_settings values(true,false);
alter table public.doctor_telegram_settings enable row level security;
revoke all on public.doctor_telegram_settings from public,anon,authenticated,service_role;
create table public.doctor_telegram_connections(
 id uuid primary key default gen_random_uuid(),doctor_id uuid not null unique references auth.users(id)on delete cascade,
 binding_id uuid not null references public.telegram_auth_bindings(id),binding_generation bigint not null check(binding_generation>0),
 session_id uuid not null,generation bigint not null check(generation>0),state text not null check(state in('active','refreshing','quarantined','closed')),
 ciphertext text,key_version text,nonce text,expires_at timestamptz not null,
 lease_token uuid,lease_until timestamptz,created_at timestamptz not null default clock_timestamp(),closed_at timestamptz,
 check((state in('active','refreshing')and ciphertext is not null and key_version is not null and nonce is not null)or(state in('closed','quarantined')and ciphertext is null and key_version is null and nonce is null))
);
alter table public.doctor_telegram_connections enable row level security;
revoke all on public.doctor_telegram_connections from public,anon,authenticated,service_role;
-- No direct client policy: credential access is exclusively through the fenced functions.
create function public._doctor_telegram_service()returns void language plpgsql set search_path=''as $$begin
 if auth.role()is distinct from 'service_role'then raise insufficient_privilege;end if;
end$$;
create function public._doctor_telegram_valid(c public.doctor_telegram_connections)returns boolean language sql stable security definer set search_path=''as $$
 select c.expires_at>clock_timestamp()
 and exists(select 1 from public.telegram_auth_bindings b where b.id=c.binding_id and b.auth_user_id=c.doctor_id and b.kind='staff'and b.active and b.generation=c.binding_generation)
 and exists(select 1 from public.workspace_staff s join public.workspace_clinics k on k.id=s.clinic_id where s.user_id=c.doctor_id and s.role='doctor'and s.active and s.removed_at is null and k.active)
 and exists(select 1 from auth.sessions s where s.id=c.session_id and s.user_id=c.doctor_id and(s.not_after is null or s.not_after>clock_timestamp()))
 and public._staff_session_admitted(c.doctor_id,c.session_id)
$$;
-- Delete exactly the dedicated Auth session; browser and other staff sessions survive.
create function public._doctor_telegram_close(p_id uuid)returns void language plpgsql security definer set search_path=''as $$
declare c public.doctor_telegram_connections;
begin
 select * into c from public.doctor_telegram_connections where id=p_id for update;
 if not found then return;end if;
 update public.doctor_telegram_connections set state='closed',ciphertext=null,key_version=null,nonce=null,lease_token=null,lease_until=null,closed_at=clock_timestamp()where id=c.id;
 delete from auth.refresh_tokens where session_id=c.session_id;
 delete from auth.sessions where id=c.session_id and user_id=c.doctor_id;
end$$;
create function public.doctor_telegram_status(p_doctor uuid)returns jsonb language plpgsql security definer set search_path=''as $$
declare c public.doctor_telegram_connections;b public.telegram_auth_bindings;
begin perform public._doctor_telegram_service();
 select * into b from public.telegram_auth_bindings where auth_user_id=p_doctor and active and kind='staff';
 select * into c from public.doctor_telegram_connections where doctor_id=p_doctor;
 return jsonb_build_object('ok',true,'binding',case when b.id is null then null else jsonb_build_object('id',b.id,'generation',b.generation)end,'connection',case when c.id is null then null else to_jsonb(c)-array['ciphertext','key_version','nonce','lease_token']end,'nextGeneration',coalesce(c.generation,0)+1);
end$$;
create function public.doctor_telegram_open(p_doctor uuid,p_binding uuid,p_binding_generation bigint,p_session uuid,p_generation bigint,p_ciphertext text,p_key_version text,p_nonce text)returns jsonb language plpgsql security definer set search_path=''as $$
declare c public.doctor_telegram_connections;candidate public.doctor_telegram_connections;session_end timestamptz;
begin perform public._doctor_telegram_service();
 if not coalesce((select enabled from public.doctor_telegram_settings where singleton),false)then return jsonb_build_object('ok',false,'code','off');end if;
 perform pg_advisory_xact_lock(hashtextextended('doctor_telegram:'||p_doctor::text,0));
 select * into c from public.doctor_telegram_connections where doctor_id=p_doctor for update;
 if p_generation is distinct from coalesce(c.generation,0)+1 then return jsonb_build_object('ok',false,'code','stale');end if;
 if coalesce(length(p_ciphertext),0)not between 1 and 16384 or coalesce(length(p_key_version),0)not between 1 and 128 or coalesce(length(p_nonce),0)not between 1 and 128 then return jsonb_build_object('ok',false,'code','invalid');end if;
 candidate.doctor_id:=p_doctor;candidate.binding_id:=p_binding;candidate.binding_generation:=p_binding_generation;candidate.session_id:=p_session;candidate.expires_at:=clock_timestamp()+interval '12 hours';
 if not public._doctor_telegram_valid(candidate)then return jsonb_build_object('ok',false,'code','not_eligible');end if;
 if c.session_id=p_session then return jsonb_build_object('ok',false,'code','session_reused');end if;
 select not_after into session_end from auth.sessions where id=p_session and user_id=p_doctor for share;
 if c.id is not null then perform public._doctor_telegram_close(c.id);end if;
 insert into public.doctor_telegram_connections(doctor_id,binding_id,binding_generation,session_id,generation,state,ciphertext,key_version,nonce,expires_at)
 values(p_doctor,p_binding,p_binding_generation,p_session,p_generation,'active',p_ciphertext,p_key_version,p_nonce,least(candidate.expires_at,coalesce(session_end,candidate.expires_at)))
 on conflict(doctor_id)do update set binding_id=excluded.binding_id,binding_generation=excluded.binding_generation,session_id=excluded.session_id,generation=excluded.generation,state='active',ciphertext=excluded.ciphertext,key_version=excluded.key_version,nonce=excluded.nonce,expires_at=excluded.expires_at,closed_at=null,lease_token=null,lease_until=null returning * into c;
 return jsonb_build_object('ok',true,'connection',to_jsonb(c));
end$$;
create function public.doctor_telegram_take_lease(p_connection uuid,p_generation bigint)returns jsonb language plpgsql security definer set search_path=''as $$
declare c public.doctor_telegram_connections;
begin perform public._doctor_telegram_service();
 if not coalesce((select enabled from public.doctor_telegram_settings where singleton),false)then return jsonb_build_object('ok',false,'code','off');end if;
 select * into c from public.doctor_telegram_connections where id=p_connection and generation=p_generation for update;
 if not found then return jsonb_build_object('ok',false,'code','closed');end if;
 if c.state in('active','refreshing')and not public._doctor_telegram_valid(c)then perform public._doctor_telegram_close(c.id);return jsonb_build_object('ok',false,'code','closed');end if;
 if c.state='refreshing'and c.lease_until<=clock_timestamp()then
 update public.doctor_telegram_connections set state='quarantined',ciphertext=null,key_version=null,nonce=null,lease_token=null,lease_until=null where id=c.id;
 return jsonb_build_object('ok',false,'code','quarantined');end if;
 if c.state not in('active','refreshing')then return jsonb_build_object('ok',false,'code',c.state);end if;
 if not public._doctor_telegram_valid(c)then perform public._doctor_telegram_close(c.id);return jsonb_build_object('ok',false,'code','closed');end if;
 if c.lease_until>clock_timestamp()then return jsonb_build_object('ok',false,'code','busy');end if;
 update public.doctor_telegram_connections set lease_token=gen_random_uuid(),lease_until=clock_timestamp()+interval '60 seconds'where id=c.id returning * into c;
 return jsonb_build_object('ok',true,'connection',to_jsonb(c));
end$$;
-- Each transition fences the same generation, lease token and lease deadline.
create function public.doctor_telegram_begin_refresh(p_connection uuid,p_generation bigint,p_lease uuid)returns jsonb language plpgsql security definer set search_path=''as $$
declare c public.doctor_telegram_connections;
begin perform public._doctor_telegram_service();
 select * into c from public.doctor_telegram_connections where id=p_connection and generation=p_generation and lease_token=p_lease and lease_until>clock_timestamp()and state='active'for update;
 if not found then return jsonb_build_object('ok',false,'code','stale');end if;
 if not public._doctor_telegram_valid(c)then perform public._doctor_telegram_close(c.id);return jsonb_build_object('ok',false,'code','closed');end if;
 update public.doctor_telegram_connections set state='refreshing'where id=c.id;
 return jsonb_build_object('ok',true);
end$$;
create function public.doctor_telegram_finish_refresh(p_connection uuid,p_generation bigint,p_lease uuid,p_ciphertext text,p_key_version text,p_nonce text)returns jsonb language plpgsql security definer set search_path=''as $$
declare c public.doctor_telegram_connections;
begin perform public._doctor_telegram_service();
 select * into c from public.doctor_telegram_connections where id=p_connection and generation=p_generation and lease_token=p_lease and lease_until>clock_timestamp()and state='refreshing'for update;
 if not found then return jsonb_build_object('ok',false,'code','stale');end if;
 if not public._doctor_telegram_valid(c)then perform public._doctor_telegram_close(c.id);return jsonb_build_object('ok',false,'code','closed');end if;
 if coalesce(length(p_ciphertext),0)not between 1 and 16384 or coalesce(length(p_key_version),0)not between 1 and 128 or coalesce(length(p_nonce),0)not between 1 and 128 or(p_nonce=c.nonce and p_key_version=c.key_version)then return jsonb_build_object('ok',false,'code','invalid');end if;
 update public.doctor_telegram_connections set state='active',ciphertext=p_ciphertext,key_version=p_key_version,nonce=p_nonce where id=c.id;
 return jsonb_build_object('ok',true);
end$$;
create function public.doctor_telegram_quarantine(p_connection uuid,p_generation bigint,p_lease uuid)returns jsonb language plpgsql security definer set search_path=''as $$
declare n integer;
begin perform public._doctor_telegram_service();
 update public.doctor_telegram_connections set state='quarantined',ciphertext=null,key_version=null,nonce=null,lease_token=null,lease_until=null
 where id=p_connection and generation=p_generation and lease_token=p_lease and lease_until>clock_timestamp()and state in('active','refreshing');
 get diagnostics n=row_count;return jsonb_build_object('ok',n=1);
end$$;
create function public.doctor_telegram_action_admit(p_connection uuid,p_generation bigint,p_lease uuid)returns jsonb language plpgsql security definer set search_path=''as $$
declare c public.doctor_telegram_connections;
begin perform public._doctor_telegram_service();
 if not coalesce((select enabled from public.doctor_telegram_settings where singleton),false)then return jsonb_build_object('ok',false,'code','off');end if;
 select * into c from public.doctor_telegram_connections where id=p_connection and generation=p_generation and lease_token=p_lease and lease_until>clock_timestamp()and state='active'for update;
 if not found then return jsonb_build_object('ok',false,'code','stale');end if;
 if not public._doctor_telegram_valid(c)then perform public._doctor_telegram_close(c.id);return jsonb_build_object('ok',false,'code','closed');end if;
 return jsonb_build_object('ok',true);
end$$;
create function public.doctor_telegram_release_lease(p_connection uuid,p_generation bigint,p_lease uuid)returns jsonb language plpgsql security definer set search_path=''as $$
declare n integer;
begin perform public._doctor_telegram_service();
 update public.doctor_telegram_connections set lease_token=null,lease_until=null where id=p_connection and generation=p_generation and lease_token=p_lease and lease_until>clock_timestamp()and state='active';
 get diagnostics n=row_count;return jsonb_build_object('ok',n=1);
end$$;
create function public.doctor_telegram_close(p_connection uuid,p_generation bigint,p_lease uuid)returns jsonb language plpgsql security definer set search_path=''as $$
begin perform public._doctor_telegram_service();
 perform 1 from public.doctor_telegram_connections where id=p_connection and generation=p_generation and lease_token=p_lease and lease_until>clock_timestamp()for update;
 if not found then return jsonb_build_object('ok',false,'code','stale');end if;
 perform public._doctor_telegram_close(p_connection);return jsonb_build_object('ok',true);
end$$;
create function public.doctor_telegram_disconnect(p_doctor uuid)returns jsonb language plpgsql security definer set search_path=''as $$
declare c public.doctor_telegram_connections;
begin perform public._doctor_telegram_service();
 perform pg_advisory_xact_lock(hashtextextended('doctor_telegram:'||p_doctor::text,0));
 select * into c from public.doctor_telegram_connections where doctor_id=p_doctor for update;
 if found then perform public._doctor_telegram_close(c.id);end if;
 return jsonb_build_object('ok',true);
end$$;
create function public.doctor_telegram_sweep()returns jsonb language plpgsql security definer set search_path=''as $$
declare c public.doctor_telegram_connections;n integer:=0;
begin perform public._doctor_telegram_service();
 for c in select * from public.doctor_telegram_connections where state<>'closed'order by id for update skip locked loop
  if not public._doctor_telegram_valid(c)then perform public._doctor_telegram_close(c.id);n:=n+1;
  elsif c.state='refreshing'and c.lease_until<=clock_timestamp()then
   update public.doctor_telegram_connections set state='quarantined',ciphertext=null,key_version=null,nonce=null,lease_token=null,lease_until=null where id=c.id;n:=n+1;
  end if;
 end loop;
 return jsonb_build_object('ok',true,'count',n);
end$$;
-- Lifecycle hooks also cover existing management/recovery flows that revoke bindings or sessions.
create function public._doctor_telegram_lifecycle()returns trigger language plpgsql security definer set search_path=''as $$
declare c public.doctor_telegram_connections;actor uuid;
begin
 if tg_table_schema='auth'and tg_table_name='users'then
  if new.encrypted_password is not distinct from old.encrypted_password then return null;end if;actor:=old.id;
 elsif tg_table_name='telegram_auth_bindings'then
  if tg_op='UPDATE'and new.active and new.kind='staff'and new.auth_user_id=old.auth_user_id and new.generation=old.generation then return null;end if;
  for c in select * from public.doctor_telegram_connections where binding_id=old.id and state<>'closed'for update loop perform public._doctor_telegram_close(c.id);end loop;return null;
 elsif tg_table_name='workspace_staff'then
  if tg_op='UPDATE'and new.active and new.role='doctor'and new.removed_at is null and new.clinic_id=old.clinic_id then return null;end if;actor:=old.user_id;
 elsif tg_table_name='workspace_clinics'then
  if tg_op='UPDATE'and new.active then return null;end if;
  for c in select d.*from public.doctor_telegram_connections d join public.workspace_staff s on s.user_id=d.doctor_id where s.clinic_id=old.id and d.state<>'closed'for update of d loop perform public._doctor_telegram_close(c.id);end loop;return null;
 end if;
 for c in select * from public.doctor_telegram_connections where doctor_id=actor and state<>'closed'for update loop perform public._doctor_telegram_close(c.id);end loop;return null;
end$$;
create trigger doctor_telegram_password_changed after update of encrypted_password on auth.users for each row execute function public._doctor_telegram_lifecycle();
create trigger doctor_telegram_binding_changed after update or delete on public.telegram_auth_bindings for each row execute function public._doctor_telegram_lifecycle();
create trigger doctor_telegram_staff_changed after update or delete on public.workspace_staff for each row execute function public._doctor_telegram_lifecycle();
create trigger doctor_telegram_clinic_changed after update or delete on public.workspace_clinics for each row execute function public._doctor_telegram_lifecycle();

alter table public.channel_inbox add column doctor_telegram_route text check(doctor_telegram_route in('legacy','staff')),
 add column doctor_telegram_connection uuid,add column doctor_telegram_generation bigint;



create or replace function public.channel_inbox_process(p_id uuid,p_doctor_telegram_enabled boolean)returns jsonb
language plpgsql security definer set search_path=''as $$
declare r public.channel_inbox;c public.doctor_telegram_connections;nb public.telegram_auth_bindings;ns public.telegram_channel_settings;
begin
 if auth.role()is distinct from 'service_role'then raise insufficient_privilege;end if;
 perform set_config('lock_timeout','3s',true);
 select * into r from public.channel_inbox where id=p_id for update;
 if not found or r.status<>'processing'then return jsonb_build_object('ok',false,'code','not_leased');end if;
 -- Freeze even the legacy decision before executing either path. Retries never change identity.
 if r.doctor_telegram_route is null then
  -- Captured nurse input and captured member endpoints keep their captured identity checks and never take the staff route,
  -- whatever the principal has become since the commit (promotion to doctor, replaced binding).
  if p_doctor_telegram_enabled is true and r.kind in('text','callback')and r.nurse_binding_id is null and not r.nurse_at_commit and r.endpoint_id is null
   and coalesce((select enabled from public.doctor_telegram_settings where singleton),false)then
   select d.*into c from public.doctor_telegram_connections d join public.telegram_auth_bindings b on b.id=d.binding_id
   where b.principal_ref=r.principal_ref and b.active and b.kind='staff'and b.generation=d.binding_generation
   and d.state in('active','refreshing')and public._doctor_telegram_valid(d);
  end if;
  update public.channel_inbox set doctor_telegram_route=case when c.id is null then 'legacy'else 'staff'end,
   doctor_telegram_connection=c.id,doctor_telegram_generation=c.generation where id=r.id returning *into r;
 end if;
 if r.doctor_telegram_route='staff'then
  select *into c from public.doctor_telegram_connections where id=r.doctor_telegram_connection;
  return jsonb_build_object('ok',true,'staff',jsonb_build_object('inboxId',r.id,'doctorId',c.doctor_id,'connectionId',r.doctor_telegram_connection,'generation',r.doctor_telegram_generation,
   'closed',not coalesce((p_doctor_telegram_enabled is true and coalesce((select enabled from public.doctor_telegram_settings where singleton),false)and c.generation=r.doctor_telegram_generation and c.state in('active','refreshing')and public._doctor_telegram_valid(c)),false),
   'chatId',r.payload->'chatId','messageId',r.payload->'messageId','callbackId',r.payload->>'callbackId'));
 end if;
 begin
  -- Captured staff input is never reinterpreted under a replacement member.
  -- This entry point is also used when the nurse environment gate is off.
  if r.nurse_binding_id is not null then
   select * into nb from public.telegram_auth_bindings where id=r.nurse_binding_id for share;
   select * into ns from public.telegram_channel_settings where singleton;
   if nb.id is null or not nb.active or nb.revoked_at is not null or nb.kind<>'staff'
    or nb.generation is distinct from r.nurse_binding_generation or nb.principal_ref is distinct from r.principal_ref
    or nb.account_ref is distinct from public._telegram_account_ref(ns)or nb.address is distinct from r.payload->>'chatId'then
    update public.telegram_nurse_dialogs set pending_inbox=null,question_version=question_version+1,question_key='idle',expected_mode='none',task_id=null,task_revision=null,prompt_message_id=null,expires_at=clock_timestamp()where pending_inbox=r.id;
    return public._channel_inbox_finish(r.id,'done','nurse_access');
   end if;
   if r.nurse_at_commit and r.kind not in('link','contact','rejected')then
    perform public._telegram_bot_next_step(r);
    return public._channel_inbox_finish(r.id,'done','principal_not_linked');
   end if;
  end if;
  if r.kind='text'then
   if public._zoe_chat_actions_on()and public._channel_text_is_menu(r.payload->>'text')then return public._channel_inbox_receive_menu(r);end if;
   return public._channel_inbox_receive_text(r);
  elsif r.kind='media'then return public._channel_inbox_receive_media(r);
  elsif r.kind='redo'then return public._channel_inbox_receive_redo(r);
  elsif r.kind='link'then return public._telegram_auth_start(r);
  elsif r.kind='contact'then return public._telegram_auth_contact(r);
  elsif r.kind='callback'then return public._channel_inbox_receive_callback(r);
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


-- Old callers are explicitly dark; the runtime supplies its server environment switch to the new overload.
create or replace function public.channel_inbox_process(p_id uuid)returns jsonb language sql security definer set search_path=''as $$select public.channel_inbox_process(p_id,false)$$;
create function public.doctor_telegram_inbox_done(p_id uuid,p_connection uuid,p_generation bigint,p_result text)returns jsonb language plpgsql security definer set search_path=''as $$
declare n integer;
begin perform public._doctor_telegram_service();
 if coalesce(p_result,'')not in('connected','closed','unavailable','failed')then return jsonb_build_object('ok',false);end if;
 update public.channel_inbox set status='done',result='staff_'||p_result,processed_at=clock_timestamp(),lease_until=null,payload=payload-'text'-'phone'
 where id=p_id and status='processing'and doctor_telegram_route='staff'and doctor_telegram_connection=p_connection and doctor_telegram_generation=p_generation;
 get diagnostics n=row_count;return jsonb_build_object('ok',n=1);
end$$;
-- Cleanup a server-held pending dedicated session after a failed connection attempt.
-- The same per-doctor lock as open serializes a lost open response against cleanup.
create function public.doctor_telegram_abandon(p_doctor uuid,p_session uuid)returns jsonb language plpgsql security definer set search_path=''as $$
begin perform public._doctor_telegram_service();
 perform pg_advisory_xact_lock(hashtextextended('doctor_telegram:'||p_doctor::text,0));
 perform 1 from public.doctor_telegram_connections where doctor_id=p_doctor and session_id=p_session and state<>'closed'for update;
 if found then return jsonb_build_object('ok',true,'connected',true);end if;
 delete from auth.refresh_tokens r using auth.sessions s where r.session_id=p_session and s.id=r.session_id and s.user_id=p_doctor;
 delete from auth.sessions where id=p_session and user_id=p_doctor;
 return jsonb_build_object('ok',true,'connected',false);
end$$;
-- New functions have no PUBLIC execute, including internal helpers. Only named broker entrypoints are granted.
do $$declare f record;begin
 for f in select p.oid::regprocedure signature,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'and(p.proname like 'doctor_telegram_%'or p.proname like '_doctor_telegram_%')loop
  execute format('revoke all on function %s from public,anon,authenticated,service_role',f.signature);
  if f.proname like 'doctor_telegram_%'then execute format('grant execute on function %s to service_role',f.signature);end if;
 end loop;
end$$;
revoke all on function public.channel_inbox_process(uuid,boolean)from public,anon,authenticated;
grant execute on function public.channel_inbox_process(uuid,boolean)to service_role;
-- Mark an attempted response before touching Telegram. An uncertain send is never sent twice.
alter table public.channel_inbox add column doctor_telegram_response_attempted_at timestamptz;
create function public.doctor_telegram_inbox_claim(p_id uuid,p_connection uuid,p_generation bigint)returns jsonb language plpgsql security definer set search_path=''as $$
declare n integer;
begin perform public._doctor_telegram_service();
 update public.channel_inbox set doctor_telegram_response_attempted_at=clock_timestamp()
 where id=p_id and status='processing'and doctor_telegram_route='staff'and doctor_telegram_connection=p_connection and doctor_telegram_generation=p_generation and doctor_telegram_response_attempted_at is null;
 get diagnostics n=row_count;
 if n=0 then update public.channel_inbox set status='done',result='staff_response_unknown',processed_at=clock_timestamp(),lease_until=null,payload=payload-'text'-'phone' where id=p_id and status='processing'and doctor_telegram_route='staff'and doctor_telegram_connection=p_connection and doctor_telegram_generation=p_generation and doctor_telegram_response_attempted_at is not null;end if;
 return jsonb_build_object('ok',n=1);
end$$;
revoke all on function public.doctor_telegram_inbox_claim(uuid,uuid,bigint)from public,anon,authenticated;
grant execute on function public.doctor_telegram_inbox_claim(uuid,uuid,bigint)to service_role;
