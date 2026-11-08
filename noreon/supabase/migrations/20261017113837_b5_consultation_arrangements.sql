-- B5 follow-up (dark, same switch): a Noreon admin arranges the consultation a
-- doctor asked for (lead decision 17 Oct 2026). An arrangement belongs to one
-- hold, identified by the time the doctor prepared the current review: editing
-- the decision note keeps the arrangement, and a new review (which resets the
-- decision) needs a new one. History is append-only; the latest row is current.

create table public.patient_consultation_arrangements(
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references public.patient_clinical_cases(user_id),
 hold_since timestamptz not null,
 scheduled_at timestamptz not null,
 channel text not null check(channel in('clinic','phone')),
 clinic_id uuid references public.workspace_clinics(id),
 actor_id uuid not null references auth.users(id),
 submission_id uuid not null unique,
 created_at timestamptz not null default clock_timestamp(),
 check((channel='clinic')=(clinic_id is not null))
);
create index patient_consultation_arrangements_hold on public.patient_consultation_arrangements(user_id,hold_since,created_at desc);
alter table public.patient_consultation_arrangements enable row level security;
revoke all on public.patient_consultation_arrangements from public,anon,authenticated,service_role;
create trigger patient_consultation_arrangements_immutable before update or delete on public.patient_consultation_arrangements
 for each row execute function public._patient_visit_immutable();

-- The current hold's decision time, or null when there is no open hold.
create function public._consultation_hold_since(c public.patient_clinical_cases)returns timestamptz
language sql stable security definer set search_path=''as $$
 select case when public._doctor_completion_enabled() and c.assigned_doctor_id is not null
  and c.review#>>'{consultation,decision}'='required' and c.review#>>'{consultation,completedAt}' is null
  then coalesce((c.review->>'preparedAt')::timestamptz,(c.review#>>'{consultation,at}')::timestamptz,c.created_at) end
$$;
create function public._consultation_arrangement(p_user uuid,p_since timestamptz)returns public.patient_consultation_arrangements
language sql stable security definer set search_path=''as $$
 select * from public.patient_consultation_arrangements where user_id=p_user and hold_since=p_since order by created_at desc,id desc limit 1
$$;

-- Member status: the arranged time and channel are added to the neutral hold.
create or replace function public.patient_clinical_case_status() returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('status',case
   when c.assigned_doctor_id is null then 'awaiting_assignment'
   when public._consultation_hold_since(c) is not null then 'consultation_needed'
   else 'review_pending' end,'createdAt',c.created_at)
  ||case when a.id is null then '{}'::jsonb else jsonb_build_object('consultation',jsonb_build_object('scheduledAt',a.scheduled_at,'channel',a.channel,'clinic',k.name))end
 from public.patient_clinical_cases c
 left join lateral public._consultation_arrangement(c.user_id,public._consultation_hold_since(c))a on true
 left join public.workspace_clinics k on k.id=a.clinic_id
 where c.user_id=auth.uid()
 and exists(select 1 from auth.users u where u.id=auth.uid() and u.phone_confirmed_at is not null)
$$;

-- Admin queue: every open hold, unarranged first. No clinical reason or note.
-- Volatile: the admin guard takes a share lock, which PostgREST refuses in the
-- read-only transaction it uses for stable functions.
create function public.admin_consultations_to_arrange()returns jsonb
language plpgsql security definer set search_path=''as $$
begin
 perform public._real_staff_require_admin();
 if not public._doctor_completion_enabled()then return jsonb_build_object('version','consultation-queue-v1','enabled',false,'cases','[]'::jsonb,'clinics','[]'::jsonb);end if;
 return jsonb_build_object('version','consultation-queue-v1','enabled',true,
  'cases',coalesce((select jsonb_agg(jsonb_build_object('memberId',q.user_id,'memberName',q.member_name,'doctorName',q.doctor_name,'since',q.since,
    'arrangement',case when q.aid is null then null else jsonb_build_object('scheduledAt',q.scheduled_at,'channel',q.channel,'clinic',q.clinic_name,'arrangedAt',q.arranged_at,'arrangedBy',q.arranged_by)end)
   order by q.aid is not null,q.since,q.user_id)
   from(select c.user_id,p.display_name member_name,d.display_name doctor_name,public._consultation_hold_since(c)since,
     a.id aid,a.scheduled_at,a.channel,k.name clinic_name,a.created_at arranged_at,s.display_name arranged_by
    from public.patient_clinical_cases c
    left join public.profiles p on p.id=c.user_id
    left join public.workspace_staff d on d.user_id=c.assigned_doctor_id
    left join lateral public._consultation_arrangement(c.user_id,public._consultation_hold_since(c))a on true
    left join public.workspace_clinics k on k.id=a.clinic_id
    left join public.workspace_staff s on s.user_id=a.actor_id
    where public._consultation_hold_since(c) is not null)q),'[]'),
  'clinics',coalesce((select jsonb_agg(jsonb_build_object('id',k.id,'name',k.name)order by k.name,k.id)from public.workspace_clinics k where k.active),'[]'));
end$$;

-- Command: {version:'consultation-arrange-v1',submissionId,memberId,since,previous,scheduledAt,channel,clinicId?}.
-- `since` names the hold and `previous` the arrangement time the admin saw (or
-- null); if either changed, the command returns stale instead of overwriting.
create function public.admin_consultation_arrange_command(p_command jsonb)returns jsonb
language plpgsql security definer set search_path=''as $$
declare a uuid;sub uuid;m uuid;since timestamptz;previous timestamptz;cur public.patient_consultation_arrangements;sched timestamptz;ch text;clinic uuid;c public.patient_clinical_cases;prior public.patient_consultation_arrangements;
 bad constant jsonb:=jsonb_build_object('status','invalid');
begin
 perform set_config('lock_timeout','1500ms',true);
 a:=public._real_staff_require_admin();
 if not public._doctor_completion_enabled()then return jsonb_build_object('status','disabled');end if;
 if jsonb_typeof(p_command)is distinct from 'object'or p_command-array['version','submissionId','memberId','since','previous','scheduledAt','channel','clinicId']<>'{}'
  or not(p_command?&array['version','submissionId','memberId','since','previous','scheduledAt','channel'])or p_command->>'version'is distinct from 'consultation-arrange-v1'then return bad;end if;
 begin
  sub:=(p_command->>'submissionId')::uuid;m:=(p_command->>'memberId')::uuid;since:=(p_command->>'since')::timestamptz;sched:=(p_command->>'scheduledAt')::timestamptz;
  clinic:=nullif(p_command->>'clinicId','')::uuid;previous:=(p_command->>'previous')::timestamptz;
 exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow then return bad;end;
 ch:=p_command->>'channel';
 if ch is null or ch not in('clinic','phone')or(ch='clinic')<>(clinic is not null)then return bad;end if;
 select * into prior from public.patient_consultation_arrangements where submission_id=sub;
 if found then
  if prior.user_id<>m or prior.actor_id<>a or prior.scheduled_at<>sched or prior.channel<>ch or prior.clinic_id is distinct from clinic then return jsonb_build_object('status','stale');end if;
  return jsonb_build_object('status','arranged');
 end if;
 if sched<=clock_timestamp()or sched>clock_timestamp()+interval '180 days'then return jsonb_build_object('status','invalid-time');end if;
 if clinic is not null and not exists(select 1 from public.workspace_clinics where id=clinic and active)then return bad;end if;
 select * into c from public.patient_clinical_cases where user_id=m for update nowait;
 if not found or public._consultation_hold_since(c) is distinct from since then return jsonb_build_object('status','stale');end if;
 cur:=public._consultation_arrangement(m,since);
 if cur.created_at is distinct from previous then return jsonb_build_object('status','stale');end if;
 insert into public.patient_consultation_arrangements(user_id,hold_since,scheduled_at,channel,clinic_id,actor_id,submission_id)values(m,since,sched,ch,clinic,a,sub);
 return jsonb_build_object('status','arranged');
end$$;

revoke all on function public._consultation_hold_since(public.patient_clinical_cases),public._consultation_arrangement(uuid,timestamptz),
 public.admin_consultations_to_arrange(),public.admin_consultation_arrange_command(jsonb)from public,anon,authenticated,service_role;
grant execute on function public.admin_consultations_to_arrange(),public.admin_consultation_arrange_command(jsonb)to authenticated;
