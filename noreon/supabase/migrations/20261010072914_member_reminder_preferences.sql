-- Reminder preferences belong to the member, separate from clinical plans.
create table public.patient_reminder_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  revision integer not null default 0 check (revision >= 0),
  preferences jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.patient_reminder_preferences enable row level security;
create policy own_reminder_preferences on public.patient_reminder_preferences
  for select to authenticated using ((select auth.uid()) = user_id);
revoke all on public.patient_reminder_preferences from anon, authenticated;
grant select on public.patient_reminder_preferences to authenticated;

create function public.save_patient_reminder_preferences(p_preferences jsonb, p_expected_revision integer)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid();
  v_revision integer;
  v_times jsonb;
  v_item jsonb;
  v_keys integer;
begin
  if v_user is null then raise exception 'unauthorized'; end if;
  if p_expected_revision is null or p_expected_revision < 0 or p_expected_revision >= 2147483647
     or p_preferences is null or jsonb_typeof(p_preferences) <> 'object' then raise exception 'invalid'; end if;
  select count(*) into v_keys from jsonb_object_keys(p_preferences);
  if v_keys <> 6 or not (p_preferences ?& array['medicationEnabled','medicationOffsetMinutes','bpEnabled','bpTimes','quietStart','quietEnd'])
     or jsonb_typeof(p_preferences->'medicationEnabled') <> 'boolean'
     or jsonb_typeof(p_preferences->'bpEnabled') <> 'boolean'
     or jsonb_typeof(p_preferences->'medicationOffsetMinutes') <> 'number'
     or (p_preferences->>'medicationOffsetMinutes')::numeric not in (-15,0,15)
     or jsonb_typeof(p_preferences->'quietStart') <> 'string'
     or jsonb_typeof(p_preferences->'quietEnd') <> 'string'
     or (p_preferences->>'quietStart') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
     or (p_preferences->>'quietEnd') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
     or jsonb_typeof(p_preferences->'bpTimes') <> 'array' then raise exception 'invalid'; end if;
  v_times := p_preferences->'bpTimes';
  if jsonb_array_length(v_times) not between 1 and 4 then raise exception 'invalid'; end if;
  for v_item in select value from jsonb_array_elements(v_times) loop
    if jsonb_typeof(v_item) <> 'string' or (v_item #>> '{}') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then raise exception 'invalid'; end if;
  end loop;
  if (select count(distinct value) from jsonb_array_elements(v_times)) <> jsonb_array_length(v_times) then raise exception 'invalid'; end if;
  -- Serialize first inserts and later revisions for the same owner.
  perform pg_advisory_xact_lock(hashtextextended(v_user::text, 51981));
  select revision into v_revision from public.patient_reminder_preferences where user_id=v_user for update;
  if not found then
    if p_expected_revision <> 0 then return -1; end if;
    insert into public.patient_reminder_preferences(user_id, revision, preferences) values(v_user,1,p_preferences);
    return 1;
  end if;
  if v_revision <> p_expected_revision then return -1; end if;
  update public.patient_reminder_preferences set preferences=p_preferences,revision=revision+1,updated_at=now() where user_id=v_user returning revision into v_revision;
  return v_revision;
end $$;
revoke all on function public.save_patient_reminder_preferences(jsonb,integer) from public,anon;
grant execute on function public.save_patient_reminder_preferences(jsonb,integer) to authenticated;
