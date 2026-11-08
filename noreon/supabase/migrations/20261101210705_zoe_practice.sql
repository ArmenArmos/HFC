-- Fictional practice only. No foreign key or write to any member conversation or clinical table.
create table public.zoe_practice_sessions(
 id uuid primary key default gen_random_uuid(), author uuid not null references auth.users(id),
 patient_id text not null check(patient_id in('practice-ldl-well','practice-ldl-aches','practice-post-mi','practice-hy-worried','practice-new-ldl')),
 state jsonb not null check(jsonb_typeof(state)='object' and octet_length(state::text)<=2000000),
 version integer not null default 0, turn_versions jsonb not null default '{}', reservations jsonb not null default '[]',
 lease uuid, lease_until timestamptz, created_at timestamptz not null default now()
);
create table public.zoe_practice_marks(
 id uuid primary key default gen_random_uuid(), session_id uuid not null references public.zoe_practice_sessions(id),
 author uuid not null references auth.users(id), turn_id uuid not null, rating text not null check(rating in('good','wrong')),
 reason text not null default '' check(length(reason)<=2000), correction text not null default '' check(length(correction)<=4000),
 snapshot jsonb not null, updated_at timestamptz not null default now(), check(rating<>'wrong'or(reason in('unsafe','too_alarming','too_cautious','wrong_fact','wrong_tone','other')and length(btrim(correction))>0)), created_at timestamptz not null default now(), unique(session_id,author,turn_id)
);
alter table public.zoe_practice_sessions enable row level security;
alter table public.zoe_practice_marks enable row level security;
revoke all on public.zoe_practice_sessions,public.zoe_practice_marks from public,anon,authenticated,service_role;
grant select on public.zoe_practice_sessions,public.zoe_practice_marks to authenticated;
create policy practice_sessions_read on public.zoe_practice_sessions for select to authenticated using(coalesce(public.real_clinical_staff_identity()->>'role' in('doctor','admin'),false));
create policy practice_marks_read on public.zoe_practice_marks for select to authenticated using(coalesce(public.real_clinical_staff_identity()->>'role' in('doctor','admin'),false));
-- Mutation grants are deliberately absent: browser-supplied state must never become an attributed Zoe reply.
create policy practice_sessions_insert on public.zoe_practice_sessions for insert to authenticated with check(author=auth.uid() and coalesce(public.real_clinical_staff_identity()->>'role' in('doctor','admin'),false));
create policy practice_sessions_update on public.zoe_practice_sessions for update to authenticated using(author=auth.uid() and coalesce(public.real_clinical_staff_identity()->>'role' in('doctor','admin'),false))with check(author=auth.uid() and coalesce(public.real_clinical_staff_identity()->>'role' in('doctor','admin'),false));
create policy practice_marks_insert on public.zoe_practice_marks for insert to authenticated with check(author=auth.uid() and coalesce(public.real_clinical_staff_identity()->>'role' in('doctor','admin'),false));
create policy practice_marks_update on public.zoe_practice_marks for update to authenticated using(author=auth.uid() and coalesce(public.real_clinical_staff_identity()->>'role' in('doctor','admin'),false))with check(author=auth.uid() and coalesce(public.real_clinical_staff_identity()->>'role' in('doctor','admin'),false));
create function public.zoe_practice_mutate(p_author uuid,p_operation text,p_input jsonb)returns jsonb
language plpgsql security definer set search_path='' as $$
declare s public.zoe_practice_sessions; m public.zoe_practice_marks; token uuid; today text:=to_char(now() at time zone 'UTC','YYYY-MM-DD'); used integer; all_used integer; snap jsonb; ix integer;
begin
 if auth.role()is distinct from 'service_role' then raise insufficient_privilege using message='Practice server required';end if;
 if not exists(select 1 from public.workspace_staff w left join public.workspace_clinics c on c.id=w.clinic_id where w.user_id=p_author and w.active and w.removed_at is null and w.role in('doctor','admin')and(w.role='admin'or c.active))then return jsonb_build_object('ok',false,'code','access');end if;
 if p_operation='create' then
  insert into public.zoe_practice_sessions(author,patient_id,state)values(p_author,p_input->>'patientId',p_input->'state')returning * into s;
  return jsonb_build_object('ok',true,'session',jsonb_build_object('id',s.id,'version',s.version,'state',s.state));
 end if;
 -- Global lock precedes the session lock on reservation, serializing every daily-cap decision.
 if p_operation='reserve' then perform pg_advisory_xact_lock(734191260);end if;
 select * into s from public.zoe_practice_sessions where id=(p_input->>'sessionId')::uuid for update;
 if not found or s.author<>p_author then return jsonb_build_object('ok',false,'code','access');end if;
 if p_operation='mark' then
  select ordinal-1 into ix from jsonb_array_elements(s.state->'turns')with ordinality t(value,ordinal)where value->>'id'=p_input->>'turnId';
  if ix is null then return jsonb_build_object('ok',false,'code','turn_missing');end if;
  -- Derive immutable attribution and transcript prefix from stored server state, never client JSON.
  snap:=jsonb_build_object('version',1,'patientId',s.patient_id,'minute',s.state->'turns'->ix->'at','record',s.state->'turns'->ix->'record','edits',(select coalesce(jsonb_agg(e),'[]'::jsonb)from jsonb_array_elements(s.state->'edits')e where (e->>'at')::integer<(s.state->'turns'->ix->>'at')::integer),'turns',(select jsonb_agg(value order by ordinal)from jsonb_array_elements(s.state->'turns')with ordinality t(value,ordinal)where ordinal<=ix+1),
   'markedTurn',s.state->'turns'->ix,'configVersion',s.turn_versions->(p_input->>'turnId'));
  insert into public.zoe_practice_marks(session_id,author,turn_id,rating,reason,correction,snapshot)values(s.id,p_author,(p_input->>'turnId')::uuid,p_input->>'rating',coalesce(p_input->>'reason',''),coalesce(p_input->>'correction',''),snap)on conflict(session_id,author,turn_id)do update set rating=excluded.rating,reason=excluded.reason,correction=excluded.correction,updated_at=now() returning * into m;
  return jsonb_build_object('ok',true,'mark',to_jsonb(m));
 end if;
 if p_input->>'expectedVersion' is null then return jsonb_build_object('ok',false,'code','invalid');end if;
 if s.version<>(p_input->>'expectedVersion')::integer then return jsonb_build_object('ok',false,'code','conflict','session',jsonb_build_object('id',s.id,'version',s.version,'state',s.state));end if;
 if p_operation in('finish','release')then
  if s.lease is null or s.lease is distinct from (p_input->>'token')::uuid then return jsonb_build_object('ok',false,'code','conflict');end if;
  update public.zoe_practice_sessions set state=case when p_operation='finish' then p_input->'state' else state end,
   version=version+case when p_operation='finish' then 1 else 0 end,turn_versions=case when p_operation='finish' then turn_versions||jsonb_build_object(p_input->'state'->'turns'->-1->>'id',p_input->>'configVersion') else turn_versions end,lease=null,lease_until=null where id=s.id returning * into s;
 elsif s.lease_until>now() then return jsonb_build_object('ok',false,'code','busy');
 elsif p_operation='reserve' then
  select count(*),count(*)filter(where q.author=p_author)into all_used,used from public.zoe_practice_sessions q cross join lateral jsonb_array_elements_text(q.reservations)r(day)where day=today;
  if used>=least(60,greatest(0,coalesce((p_input->>'doctorLimit')::integer,60)))or all_used>=least(300,greatest(0,coalesce((p_input->>'globalLimit')::integer,300)))then return jsonb_build_object('ok',false,'code','daily_limit');end if;
  token:=gen_random_uuid();
  update public.zoe_practice_sessions set reservations=reservations||jsonb_build_array(today),lease=token,lease_until=now()+interval '5 minutes' where id=s.id returning * into s;
 elsif p_operation='reset' then
  insert into public.zoe_practice_sessions(author,patient_id,state)values(p_author,s.patient_id,p_input->'state')returning * into s;
 elsif p_operation='replace' then
  update public.zoe_practice_sessions set state=p_input->'state',version=version+1,lease=null,lease_until=null where id=s.id returning * into s;
 else return jsonb_build_object('ok',false,'code','invalid');end if;
 return jsonb_build_object('ok',true,'token',token,'session',jsonb_build_object('id',s.id,'version',s.version,'state',s.state));
end$$;
revoke all on function public.zoe_practice_mutate(uuid,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.zoe_practice_mutate(uuid,text,jsonb) to service_role;
