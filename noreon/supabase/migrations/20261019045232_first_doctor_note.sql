-- First doctor note: "what I see and what comes next" (product review rec. 5, Khikar 19 Oct 01:25).
--
-- After the member finishes the health questionnaire, the assigned doctor gets a one-paragraph note to
-- approve, due within member_first_note_settings.due_hours (24) of completion. The text is prepared by code
-- from the rules engine's own findings (closed vocabulary, as lib/ai-plan does for member text); no model
-- writes member-facing words. The doctor may edit it; nothing reaches the member until the doctor approves.
-- Once approved it shows on the member's Home until a care plan is published, so there is no silent gap
-- between the questionnaire and the results.
--
-- One note per member, written once (insert only), by the signed-in assigned active doctor. Not for urgent
-- questionnaires (the urgent route leads) and not once a plan is active. Off by default.

-- 1. Switch -----------------------------------------------------------------------------------------------
create table public.member_first_note_settings(
 singleton boolean primary key default true check(singleton),
 enabled boolean not null default false,
 due_hours smallint not null default 24 check(due_hours between 1 and 168),
 updated_at timestamptz not null default clock_timestamp()
);
insert into public.member_first_note_settings(singleton)values(true);
create trigger member_first_note_settings_config_audit after insert or update or delete on public.member_first_note_settings
 for each row execute function public._config_audit_row('singleton','updated_at');
create function public._first_note_enabled()returns boolean language sql stable security definer set search_path=''as $$
 select coalesce((select enabled from public.member_first_note_settings where singleton),false)
$$;

-- 2. Notes ------------------------------------------------------------------------------------------------
create table public.member_first_notes(
 user_id uuid primary key references public.patient_clinical_cases(user_id),
 doctor_id uuid not null references auth.users(id),
 submission_id uuid not null unique,
 text_en text not null check(length(text_en)between 1 and 1500),
 text_hy text not null check(length(text_hy)between 1 and 2000),
 builder_version text not null check(builder_version ~ '^[a-z0-9.-]{1,40}$'),
 -- Rules engine ids the prepared text drew on, for the doctor and the audit; never shown to the member.
 sources text[]not null default '{}'check(cardinality(sources)<=20),
 edited boolean not null,
 assessment_completed_at timestamptz not null,
 approved_at timestamptz not null default clock_timestamp()
);
create trigger member_first_notes_immutable before update or delete on public.member_first_notes for each row execute function public._patient_visit_immutable();
alter table public.member_first_note_settings enable row level security;
alter table public.member_first_notes enable row level security;
revoke all on public.member_first_note_settings,public.member_first_notes from public,anon,authenticated,service_role;

-- 3. Doctor: state for one member ------------------------------------------------------------------------
-- The assigned active doctor in a managed staff session (an invited doctor whose session is not admitted, for
-- example awaiting the required Telegram step, is refused: Astra FN-01).
create function public._first_note_doctor(p_user uuid)returns uuid language plpgsql stable security definer set search_path=''as $$
declare d uuid:=public._assigned_active_doctor(p_user);
begin
 if not public._real_staff_managed_session_allowed(d)then raise insufficient_privilege using message='Admitted staff session required';end if;
 return d;
end$$;
create function public._first_note_json(n public.member_first_notes)returns jsonb language sql stable security definer set search_path=''as $$
 select case when n.user_id is null then null else jsonb_build_object('textEn',n.text_en,'textHy',n.text_hy,'edited',n.edited,'approvedAt',n.approved_at,
  'byYou',n.doctor_id=auth.uid(),'doctorName',(select s.display_name from public.workspace_staff s where s.user_id=n.doctor_id))end
$$;
create function public.doctor_first_note_read(p_user_id uuid)returns jsonb
language plpgsql stable security definer set search_path=''as $$
declare a public.patient_assessments;n public.member_first_notes;h int;
begin
 perform public._first_note_doctor(p_user_id);
 if not public._first_note_enabled()then return jsonb_build_object('version','first-note-v1','enabled',false);end if;
 select * into a from public.patient_assessments where user_id=p_user_id;
 select * into n from public.member_first_notes where user_id=p_user_id;
 select due_hours into h from public.member_first_note_settings where singleton;
 return jsonb_build_object('version','first-note-v1','enabled',true,
  'completedAt',a.completed_at,'dueAt',a.completed_at+make_interval(hours=>h),'urgent',a.urgent_rule is not null,
  'planActive',exists(select 1 from public.patient_care_plans p where p.user_id=p_user_id and p.active),
  'note',public._first_note_json(n));
end$$;

-- 4. Doctor: approve (once). Resending the same submission returns its outcome. -------------------------------
create function public.doctor_first_note_approve(p_command jsonb)returns jsonb
language plpgsql security definer set search_path=''as $$
declare d uuid;m uuid;sub uuid;a public.patient_assessments;prior public.member_first_notes;en text;hy text;src text[];
begin
 perform set_config('lock_timeout','1500ms',true);
 if jsonb_typeof(p_command)is distinct from 'object'or p_command-array['version','memberId','submissionId','textEn','textHy','builderVersion','sources','edited']<>'{}'
  or not(p_command?&array['version','memberId','submissionId','textEn','textHy','builderVersion','sources','edited'])or p_command->>'version'is distinct from 'first-note-v1'
  or jsonb_typeof(p_command->'edited')<>'boolean'or jsonb_typeof(p_command->'sources')<>'array'or jsonb_array_length(p_command->'sources')>20
  or exists(select 1 from jsonb_array_elements(p_command->'sources')x where jsonb_typeof(x)<>'string'or x#>>'{}'!~'^[A-Za-z0-9_.:-]{1,40}$')
  or coalesce(p_command->>'builderVersion','')!~'^[a-z0-9.-]{1,40}$'then return jsonb_build_object('status','invalid');end if;
 begin m:=(p_command->>'memberId')::uuid;sub:=(p_command->>'submissionId')::uuid;exception when invalid_text_representation then return jsonb_build_object('status','invalid');end;
 -- Control and direction characters out, spaces collapsed within lines.
 en:=btrim(regexp_replace(regexp_replace(coalesce(p_command->>'textEn',''),'[\u0000-\u0009\u000b-\u001f\u007f​-‏‪-‮⁦-⁩]',' ','g'),'[ ]+',' ','g'));
 hy:=btrim(regexp_replace(regexp_replace(coalesce(p_command->>'textHy',''),'[\u0000-\u0009\u000b-\u001f\u007f​-‏‪-‮⁦-⁩]',' ','g'),'[ ]+',' ','g'));
 if length(en)not between 1 and 1500 or length(hy)not between 1 and 2000 then return jsonb_build_object('status','invalid');end if;
 select array_agg(x)into src from jsonb_array_elements_text(p_command->'sources')x;
 -- Lock the case first, then check the assignment and the doctor against what is committed now, and hold the
 -- doctor's staff and clinic rows until the insert, so a reassignment or deactivation cannot slip in between (Astra FN-02).
 perform 1 from public.patient_clinical_cases where user_id=m for update;
 perform 1 from public.workspace_staff where user_id=auth.uid()for share;
 perform 1 from public.workspace_clinics k where k.id=(select clinic_id from public.workspace_staff where user_id=auth.uid())for share;
 d:=public._first_note_doctor(m);
 if not public._first_note_enabled()then return jsonb_build_object('status','disabled');end if;
 select * into prior from public.member_first_notes where submission_id=sub;
 if found then return case when prior.user_id=m and prior.doctor_id=d then jsonb_build_object('status','approved','replayed',true)else jsonb_build_object('status','stale')end;end if;
 if exists(select 1 from public.member_first_notes where user_id=m)then return jsonb_build_object('status','already');end if;
 select * into a from public.patient_assessments where user_id=m;
 if a.completed_at is null then return jsonb_build_object('status','not-ready');end if;
 if a.urgent_rule is not null then return jsonb_build_object('status','urgent');end if;
 if exists(select 1 from public.patient_care_plans p where p.user_id=m and p.active)then return jsonb_build_object('status','plan-active');end if;
 insert into public.member_first_notes(user_id,doctor_id,submission_id,text_en,text_hy,builder_version,sources,edited,assessment_completed_at)
  values(m,d,sub,en,hy,p_command->>'builderVersion',coalesce(src,'{}'),(p_command->>'edited')::boolean,a.completed_at);
 return jsonb_build_object('status','approved','replayed',false);
exception when lock_not_available then return jsonb_build_object('status','unavailable');
end$$;

-- 5. Doctor: notes due (completed questionnaire, not urgent, no note, no active plan) ----------------------------
create function public.doctor_first_note_queue()returns jsonb
language plpgsql stable security definer set search_path=''as $$
declare h int;
begin
 if auth.uid()is null or not exists(select 1 from public.workspace_staff s join public.workspace_clinics k on k.id=s.clinic_id where s.user_id=auth.uid()and s.role='doctor'and s.active and k.active)
  or not public._real_staff_managed_session_allowed(auth.uid())then
  raise insufficient_privilege using message='Active doctor required';end if;
 if not public._first_note_enabled()then return jsonb_build_object('version','first-note-queue-v1','enabled',false,'items','[]'::jsonb);end if;
 select due_hours into h from public.member_first_note_settings where singleton;
 return jsonb_build_object('version','first-note-queue-v1','enabled',true,'items',coalesce((select jsonb_agg(jsonb_build_object('memberId',c.user_id,
   'memberName',(select p.display_name from public.profiles p where p.id=c.user_id),'completedAt',a.completed_at,'dueAt',a.completed_at+make_interval(hours=>h))order by a.completed_at)
  from public.patient_clinical_cases c join public.patient_assessments a on a.user_id=c.user_id
  where c.assigned_doctor_id=auth.uid()and a.completed_at is not null and a.urgent_rule is null
   and not exists(select 1 from public.member_first_notes n where n.user_id=c.user_id)
   and not exists(select 1 from public.patient_care_plans p where p.user_id=c.user_id and p.active)),'[]'));
end$$;

-- 6. Member: the approved note, until a plan is active ----------------------------------------------------------
create function public.patient_first_note()returns jsonb
language sql stable security definer set search_path=''as $$
 select case when auth.uid()is null or not public._first_note_enabled()
   or exists(select 1 from public.patient_care_plans p where p.user_id=auth.uid()and p.active)then null
  else(select jsonb_build_object('textEn',n.text_en,'textHy',n.text_hy,'approvedAt',n.approved_at,
    'doctorName',(select s.display_name from public.workspace_staff s where s.user_id=n.doctor_id))
   from public.member_first_notes n where n.user_id=auth.uid())end
$$;

-- 7. Grants: functions only ----------------------------------------------------------------------------------
revoke all on function public._first_note_enabled(),public._first_note_doctor(uuid),public._first_note_json(public.member_first_notes),public.doctor_first_note_read(uuid),
 public.doctor_first_note_approve(jsonb),public.doctor_first_note_queue(),public.patient_first_note()from public,anon,authenticated,service_role;
grant execute on function public.doctor_first_note_read(uuid),public.doctor_first_note_approve(jsonb),public.doctor_first_note_queue(),public.patient_first_note()to authenticated;
