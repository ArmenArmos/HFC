-- Synthetic transaction against local replay only; no email or external Auth writes.
\set ON_ERROR_STOP on
begin;
create function pg_temp.recovery_reject(q text) returns void language plpgsql as $$begin begin execute q;exception when insufficient_privilege or serialization_failure or invalid_parameter_value then return;end;raise exception 'Expected recovery rejection';end$$;
do $$
declare a uuid:=gen_random_uuid();d uuid:=gen_random_uuid();n uuid:=gen_random_uuid();c uuid:=gen_random_uuid();admin_sid uuid:=gen_random_uuid();accepted_sid uuid:=gen_random_uuid();otp_sid uuid:=gen_random_uuid();password_sid uuid:=gen_random_uuid();stamp timestamptz:=clock_timestamp();r jsonb;v text;req uuid:=gen_random_uuid();op uuid;g bigint;methods jsonb;
begin
 insert into auth.users(id,email,email_confirmed_at) values(a,a||'@example.invalid',stamp),(d,d||'@example.invalid',stamp),(n,n||'@example.invalid',stamp);
 insert into public.workspace_clinics(id,name,active) values(c,'Synthetic recovery clinic',true);
 insert into public.workspace_staff(user_id,role,display_name,clinic_id,active) values(a,'admin','Recovery admin',null,true),(d,'doctor','Recovery doctor',c,true),(n,'nurse','Legacy recovery nurse',c,true);
 insert into auth.sessions(id,user_id,created_at,updated_at) values(admin_sid,a,stamp,stamp),(accepted_sid,d,stamp-interval '1 minute',stamp),(otp_sid,d,stamp+interval '1 second',stamp),(password_sid,d,stamp+interval '2 seconds',stamp);
 insert into public.real_staff_invitations(email,display_name,clinic_id,issuer_id,expected_auth_user_id,auth_user_id,status,verified_at,accepted_at,accepted_session_id) values(d||'@example.invalid','Recovery doctor',c,a,d,d,'accepted',stamp,stamp,accepted_sid);
 for methods in select value from jsonb_array_elements('[null,[],[{"method":"otp"}],[{"method":"otp"},{"method":"totp"}],[{"method":"password"},{}],[{"method":"password"},{"method":"recovery"}]]') loop
  perform set_config('request.jwt.claims',jsonb_build_object('sub',d,'role','authenticated','session_id',otp_sid,'amr',methods)::text,true);
  if public.real_clinical_staff_identity() is not null then raise exception 'Quarantined/malformed AMR gained identity';end if;
 end loop;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',d,'role','authenticated','session_id',accepted_sid,'amr',jsonb_build_array(jsonb_build_object('method','otp')))::text,true);
 if public.real_clinical_staff_identity()->>'id' is distinct from d::text then raise exception 'Accepted onboarding exemption lost';end if;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',d,'role','authenticated','session_id',password_sid,'amr',jsonb_build_array(jsonb_build_object('method','password')))::text,true);
 if public.real_clinical_staff_identity()->>'id' is distinct from d::text then raise exception 'Fresh password denied';end if;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',a,'role','authenticated','session_id',admin_sid,'amr',jsonb_build_array(jsonb_build_object('method','password')))::text,true);
 v:=public._real_staff_directory_row(d)->>'version';r:=public.real_admin_request_staff_recovery(d,v,req);op:=(r->>'id')::uuid;g:=(r->>'generation')::bigint;
 if public.real_admin_request_staff_recovery(d,v,req) is distinct from r then raise exception 'Request replay changed';end if;
 perform pg_temp.recovery_reject(format('select public.real_admin_request_staff_recovery(%L,%L,%L)',n,public._real_staff_directory_row(n)->>'version',req));
 perform pg_temp.recovery_reject(format('select public.real_admin_request_staff_recovery(%L,%L,%L)',d,v,gen_random_uuid()));
 perform set_config('request.jwt.claims','{"role":"service_role"}',true);
 r:=public.real_staff_recovery_step(op,g,'claim-dispatch');if not (r->>'claimed')::boolean then raise exception 'First dispatch not claimed';end if;
 if (public.real_staff_recovery_step(op,g,'claim-dispatch')->>'claimed')::boolean then raise exception 'Duplicate dispatch claimed';end if;
 perform public.real_staff_recovery_step(op,g,'token',repeat('a',64));perform public.real_staff_recovery_step(op,g,'accepted',null,null,'synthetic-provider');
 perform pg_temp.recovery_reject(format('select public.real_staff_recovery_step(%L,%s,%L,%L,%L)',op,g,'verify',repeat('b',64),otp_sid));
 perform public.real_staff_recovery_step(op,g,'verify',repeat('a',64),otp_sid);
 r:=public.real_staff_recovery_step(op,g,'claim-password',repeat('a',64),otp_sid);if not (r->>'claimed')::boolean then raise exception 'First password not claimed';end if;
 if (public.real_staff_recovery_step(op,g,'claim-password',repeat('a',64),otp_sid)->>'claimed')::boolean then raise exception 'Duplicate password claimed';end if;
 perform public.real_staff_recovery_step(op,g,'complete',repeat('a',64),otp_sid);perform public.real_staff_recovery_step(op,g,'complete',repeat('a',64),otp_sid);
 if (select count(*) from public.real_staff_recovery_events where recovery_id=op and kind='password_saved')<>1 then raise exception 'Duplicate password success audit';end if;
 if not exists(select 1 from public.real_staff_invitations where auth_user_id=d and accepted_at=stamp and accepted_session_id=accepted_sid and status='accepted') then raise exception 'Recovery changed invitation';end if;
 delete from auth.sessions where id=otp_sid;perform pg_temp.recovery_reject(format('select public.real_staff_recovery_context(%L,%s,%L)',op,g,otp_sid));
 perform set_config('request.jwt.claims',jsonb_build_object('sub',a,'role','authenticated','session_id',admin_sid,'amr',jsonb_build_array(jsonb_build_object('method','password')))::text,true);
 r:=public.real_admin_request_staff_recovery(n,public._real_staff_directory_row(n)->>'version',gen_random_uuid());if r->'identity'->>'role'<>'nurse' then raise exception 'Legacy nurse recovery failed';end if;
 update public.workspace_staff set active=false,removed_at=clock_timestamp() where user_id=n;
 perform pg_temp.recovery_reject(format('select public.real_staff_recovery_context(%L,%s)',r->>'id',(r->>'generation')::bigint));
 if has_table_privilege('authenticated','public.real_staff_recoveries','select') or has_function_privilege('authenticated','public.real_staff_recovery_step(uuid,bigint,text,text,uuid,text)','execute') or has_function_privilege('anon','public.real_admin_request_staff_recovery(uuid,text,uuid)','execute') then raise exception 'Recovery permissions exposed';end if;
end $$;
rollback;
