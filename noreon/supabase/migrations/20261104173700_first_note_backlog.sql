-- P0-04 part 2. Administrative backlog review is separate from first-note approval.
-- STAMP is replaced by the integrator before replay/merge.
create table public.first_note_backlog_closures(
 member_id uuid primary key references public.patient_clinical_cases(user_id),
 closed_by uuid not null references auth.users(id),
 closed_at timestamptz not null default clock_timestamp(),
 reason text not null check(length(btrim(reason)) between 1 and 500)
);
alter table public.first_note_backlog_closures enable row level security;
revoke all on public.first_note_backlog_closures from public,anon,authenticated,service_role;

-- Doctors retain their assigned-member scope. Admins can also see and review unassigned backlog.
create function public._first_note_queue_viewer()returns text
language plpgsql stable security definer set search_path=''as $$
declare r text;
begin
 select s.role into r from public.workspace_staff s
 where s.user_id=auth.uid()and s.active and s.removed_at is null
  and(s.role='admin'or(s.role='doctor'and exists(select 1 from public.workspace_clinics k where k.id=s.clinic_id and k.active)));
 if r is null or not public._real_staff_managed_session_allowed(auth.uid())then
  raise insufficient_privilege using message='Active doctor or administrator required';end if;
 return r;
end$$;

-- Same case -> staff -> clinic lock order as approval. Recheck authorization under those locks.
create function public._first_note_backlog_authorize(p_member uuid)returns void
language plpgsql volatile security definer set search_path=''as $$
declare r text;
begin
 perform 1 from public.patient_clinical_cases where user_id=p_member for update;
 if not found then raise insufficient_privilege using message='Member access required';end if;
 perform 1 from public.workspace_staff where user_id=auth.uid()for share;
 perform 1 from public.workspace_clinics where id=(select clinic_id from public.workspace_staff where user_id=auth.uid())for share;
 r:=public._first_note_queue_viewer();
 if r='doctor'then perform public._first_note_doctor(p_member);end if;
end$$;

create function public.doctor_first_note_backlog_close(p_member uuid,p_reason text)returns jsonb
language plpgsql volatile security definer set search_path=''as $$
declare a public.patient_assessments;h int;reason text;
begin
 perform set_config('lock_timeout','1500ms',true);
 perform public._first_note_backlog_authorize(p_member);
 reason:=btrim(regexp_replace(coalesce(p_reason,''),'^[[:space:]]+|[[:space:]]+$','','g'));
 if length(reason)not between 1 and 500 then return jsonb_build_object('status','invalid');end if;
 if not public._first_note_enabled()then return jsonb_build_object('status','disabled');end if;
 if exists(select 1 from public.member_first_notes where user_id=p_member)then return jsonb_build_object('status','already');end if;
 select * into a from public.patient_assessments where user_id=p_member for share;
 select due_hours into h from public.member_first_note_settings where singleton;
 if a.completed_at is null or a.completed_at+make_interval(hours=>h)>=clock_timestamp()then return jsonb_build_object('status','not-overdue');end if;
 if a.urgent_rule is not null then return jsonb_build_object('status','urgent');end if;
 if exists(select 1 from public.patient_care_plans where user_id=p_member and active)then return jsonb_build_object('status','plan-active');end if;
 insert into public.first_note_backlog_closures(member_id,closed_by,reason)values(p_member,auth.uid(),reason)
  on conflict(member_id)do nothing;
 if found then
  -- Same audit source and ID-only object style as doctor_first_note_card_approve.
  perform public._access_audit_record(p_member,'doctor_decisions','first-note:'||p_member::text||':backlog-closed');
 end if;
 return jsonb_build_object('status','closed');
exception when lock_not_available then return jsonb_build_object('status','unavailable');
end$$;

create function public.doctor_first_note_backlog_reopen(p_member uuid)returns jsonb
language plpgsql volatile security definer set search_path=''as $$
begin
 perform set_config('lock_timeout','1500ms',true);
 perform public._first_note_backlog_authorize(p_member);
 delete from public.first_note_backlog_closures where member_id=p_member;
 if found then perform public._access_audit_record(p_member,'doctor_decisions','first-note:'||p_member::text||':backlog-reopened');end if;
 return jsonb_build_object('status','reopened');
exception when lock_not_available then return jsonb_build_object('status','unavailable');
end$$;

-- Both approval entry points insert here while holding the case lock. Do not copy or change their
-- permission checks. If approval rolls back, the closure deletion rolls back with it.
create function public._first_note_backlog_approved()returns trigger
language plpgsql volatile security definer set search_path=''as $$
begin
 delete from public.first_note_backlog_closures where member_id=new.user_id;
 return new;
end$$;
create trigger member_first_notes_clear_backlog after insert on public.member_first_notes
 for each row execute function public._first_note_backlog_approved();

create or replace function public.doctor_first_note_queue()returns jsonb
language plpgsql volatile security definer set search_path=''as $$
declare h int;r text;result jsonb;
begin
 r:=public._first_note_queue_viewer();
 if not public._first_note_enabled()then return jsonb_build_object('version','first-note-queue-v1','enabled',false,'items','[]'::jsonb,'closed','[]'::jsonb);end if;
 select due_hours into h from public.member_first_note_settings where singleton;
 select jsonb_build_object('version','first-note-queue-v1','enabled',true,
 'items',coalesce((select jsonb_agg(jsonb_build_object('memberId',c.user_id,
   'memberName',(select p.display_name from public.profiles p where p.id=c.user_id),
   'doctorName',(select s.display_name from public.workspace_staff s where s.user_id=c.assigned_doctor_id),
   'completedAt',a.completed_at,'dueAt',a.completed_at+make_interval(hours=>h))order by a.completed_at,c.user_id)
  from public.patient_clinical_cases c join public.patient_assessments a on a.user_id=c.user_id
  where(r='admin'or c.assigned_doctor_id=auth.uid())and a.completed_at is not null and a.urgent_rule is null
   and not exists(select 1 from public.member_first_notes n where n.user_id=c.user_id)
   and not exists(select 1 from public.first_note_backlog_closures b where b.member_id=c.user_id)
   and not exists(select 1 from public.patient_care_plans p where p.user_id=c.user_id and p.active)),'[]'::jsonb),
 'closed',coalesce((select jsonb_agg(jsonb_build_object('memberId',c.user_id,
   'memberName',(select p.display_name from public.profiles p where p.id=c.user_id),
   'doctorName',(select s.display_name from public.workspace_staff s where s.user_id=c.assigned_doctor_id),
   'closedByName',(select s.display_name from public.workspace_staff s where s.user_id=b.closed_by),
   'closedAt',b.closed_at,'reason',b.reason)order by b.closed_at desc,c.user_id)
  from public.first_note_backlog_closures b join public.patient_clinical_cases c on c.user_id=b.member_id
  where(r='admin'or c.assigned_doctor_id=auth.uid())
   and not exists(select 1 from public.member_first_notes n where n.user_id=c.user_id)),'[]'::jsonb))into result;
 -- Details, including reasons, are audited atomically; counts remain free of audit writes.
 perform public._access_audit_record((x->>'memberId')::uuid,'doctor_inbox','first_notes')
  from jsonb_array_elements((result->'items')||(result->'closed'))x;
 return result;
end$$;

create or replace function public.doctor_first_note_queue_count()returns jsonb
language plpgsql stable security definer set search_path=''as $$
declare r text;
begin
 r:=public._first_note_queue_viewer();
 if not public._first_note_enabled()then return jsonb_build_object('version','first-note-queue-count-v1','enabled',false,'count',0);end if;
 return jsonb_build_object('version','first-note-queue-count-v1','enabled',true,'count',(
  select count(*)from public.patient_clinical_cases c join public.patient_assessments a on a.user_id=c.user_id
  where(r='admin'or c.assigned_doctor_id=auth.uid())and a.completed_at is not null and a.urgent_rule is null
   and not exists(select 1 from public.member_first_notes n where n.user_id=c.user_id)
   and not exists(select 1 from public.first_note_backlog_closures b where b.member_id=c.user_id)
   and not exists(select 1 from public.patient_care_plans p where p.user_id=c.user_id and p.active)));
end$$;

revoke all on function public._first_note_queue_viewer(),public._first_note_backlog_authorize(uuid),public._first_note_backlog_approved(),
 public.doctor_first_note_backlog_close(uuid,text),public.doctor_first_note_backlog_reopen(uuid)from public,anon,authenticated,service_role;
grant execute on function public.doctor_first_note_backlog_close(uuid,text),public.doctor_first_note_backlog_reopen(uuid)to authenticated;
