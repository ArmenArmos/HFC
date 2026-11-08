-- Member-reported history (Armen, 17 Oct): earlier lab PDFs or photos and hand-entered
-- key values. Everything here is "from the member, not verified": it is stored apart
-- from clinic results, never feeds a clinical rule, and nothing reads values from files.
-- Readers: the member, the assigned active doctor, and active administrators.

create function public._member_history_reader(p_user uuid)returns boolean
language sql stable security definer set search_path=''as $$
 select auth.uid() is not null and(
  auth.uid()=p_user
  or exists(select 1 from public.patient_clinical_cases c
   join public.workspace_staff s on s.user_id=c.assigned_doctor_id and s.role='doctor'and s.active
   join public.workspace_clinics k on k.id=s.clinic_id and k.active
   where c.user_id=p_user and c.assigned_doctor_id=auth.uid())
  or exists(select 1 from public.workspace_staff s where s.user_id=auth.uid() and s.role='admin'and s.active));
$$;
revoke all on function public._member_history_reader(uuid)from public,anon;
grant execute on function public._member_history_reader(uuid)to authenticated;

create table public.member_reported_documents(
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id)on delete cascade,
 source text not null default 'member-reported'check(source='member-reported'),
 object_path text not null unique check(split_part(object_path,'/',1)=user_id::text and object_path!~'\.\.'),
 file_name text not null check(length(btrim(file_name))between 1 and 200),
 mime text not null check(mime in('application/pdf','image/jpeg','image/png')),
 size_bytes integer not null check(size_bytes between 1 and 4194304),
 sha256 text not null check(sha256~'^[a-f0-9]{64}$'),
 result_date date check(result_date between date '1950-01-01' and date '2100-01-01'),
 created_at timestamptz not null default now(),
 deleted_at timestamptz
);
create unique index member_reported_documents_once on public.member_reported_documents(user_id,sha256)where deleted_at is null;
create index member_reported_documents_member on public.member_reported_documents(user_id,created_at desc);
alter table public.member_reported_documents enable row level security;
revoke all on public.member_reported_documents from public,anon,authenticated;
grant select on public.member_reported_documents to authenticated;
-- Writes come only from the server after it checked the file (service role) or via remove below.
create policy member_reported_documents_read on public.member_reported_documents for select to authenticated
 using(deleted_at is null and(select public._member_history_reader(user_id)));

create table public.member_reported_values(
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id)on delete cascade,
 source text not null default 'member-reported'check(source='member-reported'),
 measure text not null check(measure in('bp','total_cholesterol','ldl_c','hba1c','fasting_glucose','weight','waist')),
 value numeric(6,2)not null,
 value2 numeric(6,2),
 unit text not null,
 measured_on date not null check(measured_on>=date '1950-01-01'),
 created_at timestamptz not null default now(),
 -- Plausible bounds; the questionnaire's where it has them (BP, weight, waist, HbA1c).
 check(case measure
  when 'bp' then unit='mmHg'and value2 is not null and value=trunc(value)and value2=trunc(value2)and value between 60 and 300 and value2 between 30 and 200 and value2<value
  when 'total_cholesterol' then value2 is null and((unit='mmol/L'and value between 1 and 20)or(unit='mg/dL'and value between 40 and 775))
  when 'ldl_c' then value2 is null and((unit='mmol/L'and value between 0.2 and 15)or(unit='mg/dL'and value between 8 and 580))
  when 'hba1c' then value2 is null and unit='%'and value between 3 and 20
  when 'fasting_glucose' then value2 is null and((unit='mmol/L'and value between 1.5 and 35)or(unit='mg/dL'and value between 27 and 630))
  when 'weight' then value2 is null and unit='kg'and value between 30 and 300
  when 'waist' then value2 is null and unit='cm'and value between 40 and 200
 end)
);
create index member_reported_values_member on public.member_reported_values(user_id,measure,measured_on);
alter table public.member_reported_values enable row level security;
revoke all on public.member_reported_values from public,anon,authenticated;
grant select on public.member_reported_values to authenticated;
create policy member_reported_values_read on public.member_reported_values for select to authenticated
 using((select public._member_history_reader(user_id)));
-- Browser roles hold no write privilege on any table: members write through member_reported_value_add/remove below.

-- Not in the future (Yerevan date), and at most 500 values per member.
create function public._member_reported_values_guard()returns trigger
language plpgsql security definer set search_path=''as $$
begin
 if new.measured_on>(now() at time zone 'Asia/Yerevan')::date then raise check_violation using message='measured_on is in the future';end if;
 perform pg_advisory_xact_lock(hashtextextended('member-reported-values:'||new.user_id::text,0));
 if(select count(*)from public.member_reported_values where user_id=new.user_id)>=500 then raise check_violation using message='member_reported_values limit';end if;
 return new;
end$$;
create trigger member_reported_values_guard before insert on public.member_reported_values for each row execute function public._member_reported_values_guard();

-- At most 50 kept documents per member.
create function public._member_reported_documents_guard()returns trigger
language plpgsql security definer set search_path=''as $$
begin
 perform pg_advisory_xact_lock(hashtextextended('member-reported-documents:'||new.user_id::text,0));
 if(select count(*)from public.member_reported_documents where user_id=new.user_id and deleted_at is null)>=50 then raise check_violation using message='member_reported_documents limit';end if;
 if new.result_date>(now() at time zone 'Asia/Yerevan')::date then raise check_violation using message='result_date is in the future';end if;
 return new;
end$$;
create trigger member_reported_documents_guard before insert on public.member_reported_documents for each row execute function public._member_reported_documents_guard();

create function public.member_reported_value_add(p_measure text,p_value numeric,p_value2 numeric,p_unit text,p_measured_on date)returns uuid
language plpgsql security definer set search_path=''as $$
declare v uuid;
begin
 if auth.uid() is null then raise insufficient_privilege;end if;
 insert into public.member_reported_values(user_id,measure,value,value2,unit,measured_on)
  values(auth.uid(),p_measure,p_value,p_value2,p_unit,p_measured_on)returning id into v;
 return v;
end$$;
create function public.member_reported_value_remove(p_id uuid)returns boolean
language plpgsql security definer set search_path=''as $$
begin
 if auth.uid() is null then raise insufficient_privilege;end if;
 delete from public.member_reported_values where id=p_id and user_id=auth.uid();
 return found;
end$$;
revoke all on function public.member_reported_value_add(text,numeric,numeric,text,date),public.member_reported_value_remove(uuid)from public,anon;
grant execute on function public.member_reported_value_add(text,numeric,numeric,text,date),public.member_reported_value_remove(uuid)to authenticated;

-- The member removes their own document. Returns the storage path so the server can delete the bytes.
create function public.member_reported_document_remove(p_id uuid)returns text
language plpgsql security definer set search_path=''as $$
declare p text;
begin
 if auth.uid() is null then raise insufficient_privilege;end if;
 update public.member_reported_documents set deleted_at=now()where id=p_id and user_id=auth.uid() and deleted_at is null returning object_path into p;
 return p;
end$$;
revoke all on function public.member_reported_document_remove(uuid)from public,anon;
grant execute on function public.member_reported_document_remove(uuid)to authenticated;

-- Private bucket. No storage policy for members or staff: the server serves bytes after an RLS read of the row.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
 values('member-history','member-history',false,4194304,array['application/pdf','image/jpeg','image/png']);

-- The signed-in member's own clinic-measured values, for the progress charts:
-- blood pressure, weight and waist recorded by a nurse at a visit (staff-entered).
create function public.member_clinic_measurements()returns jsonb
language sql stable security definer set search_path=''as $$
 select jsonb_build_object(
  'bp',coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'systolic',m.systolic,'diastolic',m.diastolic,'at',m.measured_at)order by m.measured_at)
   from public.patient_measurements m where m.user_id=auth.uid()
   and exists(select 1 from public.patient_care_visit_entries e where e.measurement_id=m.id and e.user_id=m.user_id)),'[]'::jsonb),
  'observations',coalesce((select jsonb_agg(jsonb_build_object('field',e.payload->>'field','value',(e.payload->>'value')::numeric,'unit',e.payload->>'unit','at',e.observed_instant)order by e.observed_instant)
   from public.patient_care_visit_entries e where e.user_id=auth.uid()
   and e.payload->>'kind'='observation'and e.payload->>'state'='known'and e.payload->>'field'in('weight','waist')),'[]'::jsonb));
$$;
revoke all on function public.member_clinic_measurements()from public,anon;
grant execute on function public.member_clinic_measurements()to authenticated;
