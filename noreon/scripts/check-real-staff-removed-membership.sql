\set ON_ERROR_STOP on
begin;
-- Ordinary password sign-in fixtures carry a live session and explicit AMR.
-- This helper only selects claims; it never creates/resurrects a session.
create function pg_temp.password_actor(p_id uuid) returns text language plpgsql as $password$begin
 perform set_config('request.jwt.claim.sub',p_id::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',p_id,'role','authenticated','session_id',p_id,'amr',jsonb_build_array(jsonb_build_object('method','password')))::text,true);
 return p_id::text;end$password$;

create function pg_temp.reject_staff_change(q text,expected text) returns void language plpgsql as $$begin
 begin execute q;exception when others then if sqlerrm like '%'||expected||'%' then return;end if;raise;end;
 raise exception 'Expected rejection: %',q;
end $$;
do $$
declare a uuid:=gen_random_uuid();d uuid:=gen_random_uuid();c uuid:=gen_random_uuid();c2 uuid:=gen_random_uuid();r jsonb;saved jsonb;req uuid:=gen_random_uuid();v text;
begin
 insert into auth.users(id,email) values(a,a||'@example.invalid'),(d,d||'@example.invalid');
 insert into public.workspace_clinics(id,name) values(c,'Removed membership fixture'),(c2,'Other inactive clinic');
 insert into public.workspace_staff(user_id,role,display_name,clinic_id) values(a,'admin','Admin',null),(d,'doctor','Legacy doctor',c);
 insert into auth.sessions(id,user_id,created_at,updated_at) select x,x,clock_timestamp(),clock_timestamp() from unnest(array[a,d]) x;
 perform pg_temp.password_actor(a);perform set_config('request.jwt.claim.role','authenticated',true);
 r:=(select x from jsonb_array_elements(public.real_admin_staff()) x where x->>'id'=d::text);v:=r->>'version';
 saved:=public.real_admin_remove_staff(d,v,req);
 if saved->>'status'<>'revoked' or (saved->>'active')::boolean then raise exception 'Removed legacy membership still appears current';end if;
 if public.real_admin_remove_staff(d,v,req) is distinct from saved then raise exception 'Removal receipt changed on replay';end if;
 r:=(select x from jsonb_array_elements(public.real_admin_staff()) x where x->>'id'=d::text);
 if r is distinct from saved then raise exception 'Removed membership directory differs from saved result';end if;
 if not exists(select 1 from public.workspace_staff where user_id=d and removed_at is not null and not active) then raise exception 'Removal marker absent';end if;
 perform pg_temp.reject_staff_change(format('select public.real_admin_update_staff(%L,%L,%L,%L,%L)',d,r->>'version','Must not edit',c,gen_random_uuid()),'already removed');
 perform pg_temp.reject_staff_change(format('select public.real_admin_remove_staff(%L,%L,%L)',d,r->>'version',gen_random_uuid()),'already removed');
 if (select count(*) from public.real_staff_admin_events where request_id=req)<>1 then raise exception 'Removal replay duplicated audit';end if;
end $$;
rollback;
