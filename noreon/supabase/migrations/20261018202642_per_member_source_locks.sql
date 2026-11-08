-- Per-member clinical source locks (quality review 2026-10-18 item 3, fE-1/aE-1).
--
-- Until now the readers that freeze a member's clinical evidence (publish, every booking
-- command, test requests, conversation commands and claims, the visit booking context) took
-- `lock table ... in share mode nowait` on up to nine tables. SHARE conflicts with every
-- INSERT/UPDATE/DELETE on those tables, so any member's profile save or reading made every
-- other member's booking command fail with 55P03, and a publish held up writes for everyone.
--
-- The evidence is per member (patient_clinical_evidence reads only that member's rows), so the
-- lock now is too. Each (source table, member) pair has an advisory key:
--   readers take the key SHARED with try (no wait), raising lock_not_available like `nowait`;
--   writers take the key EXCLUSIVE from a BEFORE ROW trigger, waiting like a ROW EXCLUSIVE
--   writer waits for SHARE.
-- Readers still coexist, a reader still fails fast while a writer of that member is in flight,
-- and a writer still waits for a reader of that member; nothing waits across members. Writers
-- of the same member and table now queue behind each other (they used to run side by side),
-- which is brief and only within one member. The trigger catches inserts, so a new row cannot
-- slip past a frozen reader (no phantom). Triggers are ENABLE ALWAYS so replica-mode sessions
-- (fixtures, repair scripts) keep the protocol. TRUNCATE is not covered; no runtime path truncates
-- these tables, and a truncate still waits for readers' row and table access locks.
-- A function that writes several source tables of one member must keep the order existing writers
-- use (save_patient_profile: profiles, consents, assessments; patient_staff_visit_command: visits,
-- measurements, entries); writing two of them in the opposite order can deadlock (40P01). Backfills over every member: `set local noreon.bulk_source_write='on'`.
--
-- workspace_staff and workspace_clinics are not per member; they keep one key per table with the
-- same shared/exclusive protocol, so only staff and clinic admin writes contend with readers, as
-- before, and member writes never do.

create function public._member_source_key(p_source text,p_member uuid)returns bigint
language sql immutable set search_path=''as $$
 select pg_catalog.hashtextextended('member-source:'||p_source||':'||coalesce(p_member::text,'*'),0)
$$;

-- Reader side: the per-member equivalent of `lock table <p_sources> in share mode nowait`.
create function public._freeze_member_sources(p_member uuid,p_sources text[])returns void
language plpgsql security definer set search_path=''as $$
declare t text;
begin
 foreach t in array p_sources loop
  if not pg_catalog.pg_try_advisory_xact_lock_shared(public._member_source_key(t,case when t in('workspace_staff','workspace_clinics')then null else p_member end))then
   raise exception using errcode='lock_not_available',message='Clinical sources are changing';
  end if;
 end loop;
end$$;

-- Writer side: every row written to a source table takes its member's key exclusively.
create function public._member_source_write_lock()returns trigger
language plpgsql security definer set search_path=''as $$
declare k text:=case when tg_table_name='profiles'then 'id'else 'user_id'end;o uuid;n uuid;
begin
 -- Bulk maintenance (a backfill over every member) would need one lock per member and exhaust the
 -- lock table; such a migration runs `set local noreon.bulk_source_write='on'` and skips the keys.
 if current_setting('noreon.bulk_source_write',true)='on'then return case when tg_op='DELETE'then old else new end;end if;
 if tg_table_name in('workspace_staff','workspace_clinics')then
  perform pg_catalog.pg_advisory_xact_lock(public._member_source_key(tg_table_name,null));
  return case when tg_op='DELETE'then old else new end;
 end if;
 if tg_op<>'INSERT'then o:=(to_jsonb(old)->>k)::uuid;end if;
 if tg_op<>'DELETE'then n:=(to_jsonb(new)->>k)::uuid;end if;
 -- An owner change locks both members in uuid order, so two opposite transfers cannot deadlock.
 if o is not null and n is not null and o>n then perform pg_catalog.pg_advisory_xact_lock(public._member_source_key(tg_table_name,n));end if;
 if o is not null then perform pg_catalog.pg_advisory_xact_lock(public._member_source_key(tg_table_name,o));end if;
 if n is not null and n is distinct from o then perform pg_catalog.pg_advisory_xact_lock(public._member_source_key(tg_table_name,n));end if;
 return case when tg_op='DELETE'then old else new end;
end$$;

do $$declare t text;begin
 foreach t in array array['profiles','patient_consents','patient_assessments','patient_measurements','patient_reports',
  'patient_care_visits','patient_care_visit_entries','workspace_staff','workspace_clinics'] loop
  execute format('create trigger member_source_write_lock before insert or update or delete on public.%I for each row execute function public._member_source_write_lock()',t);
  execute format('alter table public.%I enable always trigger member_source_write_lock',t);
 end loop;
end$$;

-- Same as 20261016035421 except the table freeze is per member.
create or replace function public.lock_patient_clinical_sources(p_user_id uuid)returns void
language plpgsql security definer set search_path=''as $$
begin
 perform 1 from auth.users where id=p_user_id and phone is not null and phone_confirmed_at is not null for share nowait;
 if not found then raise insufficient_privilege using message='Verified member required';end if;
 perform 1 from public.patient_message_preferences where user_id=p_user_id for share nowait;
 perform public._freeze_member_sources(p_user_id,array['profiles','patient_consents','patient_assessments','patient_measurements','patient_reports',
  'workspace_staff','workspace_clinics','patient_care_visits','patient_care_visit_entries']);
end$$;

-- Same as 20261016162000 except the table freeze is per member.
create or replace function public._conversation_source(m uuid)returns text language plpgsql security definer set search_path=''as $$begin
 perform public._freeze_member_sources(m,array['profiles','patient_consents','patient_assessments','patient_measurements','patient_reports','patient_care_visits','patient_care_visit_entries']);
 return public.patient_clinical_evidence(m)->>'token';
end$$;

-- Same as 20261016035421 except the table freeze is per member. Caller owns case/authority locks.
-- Protect requirements against source INSERTs as well as updates; these three tables are never
-- written by a visit command.
create or replace function public._patient_visit_booking(p_member uuid,p_appointment uuid default null)returns jsonb
language plpgsql security definer set search_path=''as $$
declare a public.booking_appointments;r public.booking_manual_reservations;n public.booking_scheduling_notices;v public.booking_appointment_versions;s public.booking_program_seals;tests jsonb;
begin
 perform public._freeze_member_sources(p_member,array['profiles','patient_assessments','patient_consents']);
 for a in select * from public.booking_appointments where member_id=p_member and current_reservation_id is not null and(p_appointment is null or id=p_appointment)order by created_at desc,id for share nowait loop
  select * into r from public.booking_manual_reservations where id=a.current_reservation_id and appointment_id=a.id and member_id=p_member for share nowait;
  if not found then continue;end if;
  select * into n from public.booking_scheduling_notices where appointment_id=a.id and reservation_id=r.id and state='accepted'order by appointment_revision desc limit 1 for share nowait;
  if not found then continue;end if;
  select * into v from public.booking_appointment_versions where appointment_id=a.id and notice_id=n.id and program_id=n.program_id and proposed_arrangement=a.current_arrangement for share nowait;
  if not found then continue;end if;
  select * into s from public.booking_program_seals where id=v.program_id and member_id=p_member for share nowait;
  if not found then continue;end if;
  if s.requirements_token is distinct from public.patient_test_context(p_member)->>'requirementsToken'then
   return jsonb_build_object('availability','stale','context',null);
  end if;
  select jsonb_agg(jsonb_build_object('id',i->>'id','title',i->>'title','method',i->>'method')order by ord)into tests
   from jsonb_array_elements(s.program->'items')with ordinality as items(i,ord)
   where i->>'method'in('lab','clinic')and(a.current_arrangement->'coveredTestIds')? (i->>'id');
  if tests is null then return jsonb_build_object('availability','unavailable','context',null);end if;
  return jsonb_build_object('availability','available','context',jsonb_build_object('version','booking-visit-context-v1','appointmentId',a.id,'acceptedRevision',v.revision,'tests',tests));
 end loop;
 return jsonb_build_object('availability','unlinked','context',null);
end$$;

revoke all on function public._member_source_key(text,uuid),public._freeze_member_sources(uuid,text[]),public._member_source_write_lock()
 from public,anon,authenticated,service_role;

-- Item 45 (aB-9): the member booking read tops up every active clinic's slots. It used to lock each
-- schedule FOR UPDATE before the "already generated today" shortcut, so every portal read queued
-- behind any clinic admin save or another reader's generation. Unforced runs now check freshness
-- without a lock and skip a schedule another transaction is already generating (it is being done);
-- forced runs (admin saves) still wait. Body otherwise the same as 20261017111652.
create or replace function public._clinic_schedule_generate(c uuid,p_force boolean)returns integer
language plpgsql security definer set search_path=''as $$
declare s public.clinic_schedules;cl public.workspace_clinics;ver text;today date:=(clock_timestamp()at time zone 'Asia/Yerevan')::date;
 d date;h public.clinic_schedule_hours;m integer;om integer;cm integer;st timestamptz;en timestamptz;k text;ref text;oid uuid;follow jsonb;keys text[]:='{}';n integer:=0;held bigint;
begin
 if not p_force then
  select * into s from public.clinic_schedules where clinic_id=c;
  if not found then return 0;end if;
  select * into cl from public.workspace_clinics where id=c;
  ver:='clinic-hours-'||left(md5(array_to_string(s.covered_test_ids,',')||'|'||array_to_string(s.follow_up_test_ids,',')||'|'||s.preparation||'|'||coalesce(cl.address,'')),16);
  if s.generated_on=today and s.generated_version=ver then return 0;end if;
  select * into s from public.clinic_schedules where clinic_id=c for update skip locked;
  if not found then return 0;end if;
 else
  select * into s from public.clinic_schedules where clinic_id=c for update;
  if not found then return 0;end if;
 end if;
 select * into cl from public.workspace_clinics where id=c;
 -- The offer version follows what the member sees (tests, preparation, address), not the hours (review F-06).
 ver:='clinic-hours-'||left(md5(array_to_string(s.covered_test_ids,',')||'|'||array_to_string(s.follow_up_test_ids,',')||'|'||s.preparation||'|'||coalesce(cl.address,'')),16);
 if not p_force and s.generated_on=today and s.generated_version=ver then return 0;end if;
 if s.active and cl.active and public._clinic_scheduling_enabled()and nullif(btrim(cl.address),'')is not null then
  select coalesce(jsonb_agg(jsonb_build_object('testId',x,'owner','Noreon care team','action','Noreon arranges this test separately.','reference','clinic-hours')order by x),'[]'::jsonb)
   into follow from unnest(s.follow_up_test_ids)x;
  for d in select g::date from generate_series(today,today+27,interval '1 day')g loop
   for h in select * from public.clinic_schedule_hours where clinic_id=c and weekday=extract(isodow from d)loop
    om:=extract(hour from h.opens)::integer*60+extract(minute from h.opens)::integer;
    cm:=extract(hour from h.closes)::integer*60+extract(minute from h.closes)::integer;
    m:=om;
    while m+s.slot_minutes<=cm loop
     st:=(d+make_time(m/60,m%60,0))at time zone 'Asia/Yerevan';en:=st+make_interval(mins=>s.slot_minutes);m:=m+s.slot_minutes;
     if st<=clock_timestamp()then continue;end if;
     k:=encode(extensions.digest('clinic-hours:'||c::text||':'||extract(epoch from st)::bigint::text||':'||s.slot_minutes::text,'sha256'),'hex');
     ref:=c::text||'@'||to_char(st at time zone 'UTC','YYYY-MM-DD"T"HH24:MI"Z"')||'/'||s.slot_minutes;
     -- Visits held on an overlapping earlier slot (for example before a visit-length change) use up
     -- this time's capacity (review F-06).
     select count(distinct r.appointment_id)into held from public.booking_manual_reservations r join public.booking_manual_capacity p on p.key=r.capacity_key
      where r.state='held'and p.clinic_id=c and p.source='clinic-hours'and p.key<>k and p.starts_at<en and p.ends_at>st;
     if s.capacity-held<1 then continue;end if;
     keys:=keys||k;
     insert into public.booking_manual_capacity(key,source,reference,clinic_id,starts_at,ends_at,capacity,valid_until,created_by)
      values(k,'clinic-hours',ref,c,st,en,s.capacity-held,st,s.updated_by)
      on conflict(key)do update set capacity=excluded.capacity,valid_until=excluded.valid_until where public.booking_manual_capacity.source='clinic-hours';
     -- Deterministic offer id per slot, shaped as an RFC 4122 version-5 UUID (the app validates the version and variant).
     oid:=(substr(md5(k),1,8)||'-'||substr(md5(k),9,4)||'-5'||substr(md5(k),14,3)||'-a'||substr(md5(k),18,3)||'-'||substr(md5(k),21,12))::uuid;
     if not exists(select 1 from public.booking_offer_snapshots where id=oid and version=ver)then
      update public.booking_offer_snapshots set superseded_at=clock_timestamp()where capacity_key=k and superseded_at is null;
      insert into public.booking_offer_snapshots(id,version,capacity_key,offer,created_by)values(oid,ver,k,jsonb_build_object(
       'id',oid,'version',ver,'source','clinic-hours','clinicId',c,'mode','clinic','startsAt',st,'endsAt',en,'timezone','Asia/Yerevan','clinicAddress',cl.address,
       'preparation',s.preparation,'preparationVersion',ver,'coveredTestIds',to_jsonb(s.covered_test_ids),'followUps',follow,
       'reservationContract',jsonb_build_object('version','clinic-hours-v1','reference',ref)),s.updated_by);
     end if;
     n:=n+1;
    end loop;
   end loop;
  end loop;
 end if;
 update public.booking_manual_capacity set valid_until=clock_timestamp()
  where clinic_id=c and source='clinic-hours'and starts_at>clock_timestamp()and valid_until>clock_timestamp()and not(key=any(keys));
 update public.clinic_schedules set generated_on=today,generated_version=ver where clinic_id=c;
 return n;
end$$;
