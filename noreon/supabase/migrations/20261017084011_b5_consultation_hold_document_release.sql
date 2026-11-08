-- B5 part A (dark): the member sees a neutral consultation hold, and clinic lab
-- PDFs reach the member only through an explicit, audited doctor release.
-- Lead decision Q10 A (recorded 17 Oct 2026): the previous published plan stays
-- visible during a hold; clinic PDFs are released by a separate action, never
-- together with the plan. Mixed-member PDFs are not split: the doctor must open
-- the file and confirm it holds only this member's results before releasing it.

create table public.doctor_completion_capabilities(
 singleton boolean primary key default true check(singleton),
 enabled boolean not null default false
);
insert into public.doctor_completion_capabilities(singleton,enabled)values(true,false);
alter table public.doctor_completion_capabilities enable row level security;
revoke all on public.doctor_completion_capabilities from public,anon,authenticated,service_role;
create function public._doctor_completion_enabled()returns boolean language sql stable security definer set search_path=''as $$
 select coalesce((select enabled from public.doctor_completion_capabilities where singleton),false)
$$;

-- Member status adds one neutral state. It carries no reason, note or result.
create or replace function public.patient_clinical_case_status() returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('status',case
   when c.assigned_doctor_id is null then 'awaiting_assignment'
   when public._doctor_completion_enabled() and c.review#>>'{consultation,decision}'='required' and c.review#>>'{consultation,completedAt}' is null then 'consultation_needed'
   else 'review_pending' end,'createdAt',c.created_at)
 from public.patient_clinical_cases c where c.user_id=auth.uid()
 and exists(select 1 from auth.users u where u.id=auth.uid() and u.phone_confirmed_at is not null)
$$;

-- Release history is append-only. A release counts only for the attachment it
-- names: a detach or a move to another member ends it without a new event.
create table public.patient_document_release_events(
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references public.patient_clinical_cases(user_id),
 file_id uuid not null references public.clinic_batch_files(id),
 attachment_id uuid not null references public.clinic_result_attachments(id),
 kind text not null check(kind in('released','withdrawn')),
 single_member_confirmed boolean not null default false,
 actor_id uuid not null references auth.users(id),
 submission_id uuid not null unique,
 created_at timestamptz not null default clock_timestamp(),
 check(kind<>'released'or single_member_confirmed)
);
create index patient_document_release_events_member on public.patient_document_release_events(user_id,file_id,created_at desc);
alter table public.patient_document_release_events enable row level security;
revoke all on public.patient_document_release_events from public,anon,authenticated,service_role;
create trigger patient_document_release_events_immutable before update or delete on public.patient_document_release_events
 for each row execute function public._patient_visit_immutable();

-- Member lookups of their current clinic documents.
create index if not exists clinic_result_attachments_member on public.clinic_result_attachments(user_id,file_id);

-- Every open of a member document, by the doctor or the member, is logged first.
create table public.patient_document_opens(
 id bigint generated always as identity primary key,
 user_id uuid not null references public.patient_clinical_cases(user_id),
 file_id uuid not null references public.clinic_batch_files(id),
 attachment_id uuid not null references public.clinic_result_attachments(id),
 actor_id uuid not null references auth.users(id),
 actor_kind text not null check(actor_kind in('doctor','member')),
 session_id text,
 created_at timestamptz not null default clock_timestamp()
);
create index patient_document_opens_file on public.patient_document_opens(file_id,actor_id,created_at desc);
alter table public.patient_document_opens enable row level security;
revoke all on public.patient_document_opens from public,anon,authenticated,service_role;
create trigger patient_document_opens_immutable before update or delete on public.patient_document_opens
 for each row execute function public._patient_visit_immutable();

-- A member's current clinic documents: the file's latest attachment is to this
-- member and has not been detached.
create function public._member_clinic_documents(p_user uuid)
returns table(file_id uuid,attachment_id uuid,clinic_name text,uploaded_at timestamptz,attached_at timestamptz,name text,object_id uuid,object_key text,measured_size bigint,sha256 text)
language sql stable security definer set search_path=''as $$
 select f.id,a.id,k.name,f.created_at,a.created_at,f.name,f.object_id,f.object_key,f.measured_size,f.sha256
 from public.clinic_batch_files f
 cross join lateral public._clinic_result_current(f.id)a
 join public.workspace_clinics k on k.id=a.clinic_id
 where f.state='stored'and a.id is not null and a.user_id=p_user
  and f.id in(select x.file_id from public.clinic_result_attachments x where x.user_id=p_user)
  and not exists(select 1 from public.clinic_result_detachments d where d.attachment_id=a.id)
$$;

-- Latest release event for this file's current attachment, if any.
create function public._member_document_release(p_user uuid,p_file uuid,p_attachment uuid)returns public.patient_document_release_events
language sql stable security definer set search_path=''as $$
 select * from public.patient_document_release_events where user_id=p_user and file_id=p_file and attachment_id=p_attachment
 order by created_at desc,id desc limit 1
$$;

create function public._assigned_active_doctor(p_user uuid)returns uuid
language plpgsql stable security definer set search_path=''as $$
begin
 if auth.uid() is null or not exists(select 1 from public.patient_clinical_cases c where c.user_id=p_user and c.assigned_doctor_id=auth.uid())
  or not exists(select 1 from public.workspace_staff s join public.workspace_clinics k on k.id=s.clinic_id where s.user_id=auth.uid() and s.role='doctor'and s.active and k.active)
 then raise insufficient_privilege using message='Assigned active doctor required';end if;
 return auth.uid();
end$$;

create function public.doctor_member_documents(p_user_id uuid)returns jsonb
language plpgsql stable security definer set search_path=''as $$
declare d uuid;
begin
 d:=public._assigned_active_doctor(p_user_id);
 if not public._doctor_completion_enabled()then return jsonb_build_object('version','member-documents-v1','enabled',false,'documents','[]'::jsonb);end if;
 return jsonb_build_object('version','member-documents-v1','enabled',true,'documents',coalesce((select jsonb_agg(jsonb_build_object(
   'fileId',m.file_id,'name',m.name,'clinic',m.clinic_name,'uploadedAt',m.uploaded_at,'attachedAt',m.attached_at,
   'released',coalesce(r.kind='released',false),'releasedAt',case when r.kind='released'then r.created_at end,
   'openedByYou',exists(select 1 from public.patient_document_opens o where o.file_id=m.file_id and o.attachment_id=m.attachment_id and o.actor_id=d and o.actor_kind='doctor'))
  order by m.uploaded_at desc,m.file_id)
  from public._member_clinic_documents(p_user_id)m left join lateral public._member_document_release(p_user_id,m.file_id,m.attachment_id)r on true),'[]'));
end$$;

-- Audited doctor open. The location goes to the server route only.
create function public.doctor_member_document_open(p_user_id uuid,p_file uuid)returns jsonb
language plpgsql security definer set search_path=''as $$
declare d uuid;m record;
begin
 d:=public._assigned_active_doctor(p_user_id);
 if not public._doctor_completion_enabled()then raise insufficient_privilege;end if;
 select * into m from public._member_clinic_documents(p_user_id)x where x.file_id=p_file;
 if not found then raise insufficient_privilege;end if;
 perform 1 from storage.objects where id=m.object_id and bucket_id='clinic-originals'and name=m.object_key and(metadata->>'size')::bigint=m.measured_size;
 if not found then raise insufficient_privilege;end if;
 insert into public.patient_document_opens(user_id,file_id,attachment_id,actor_id,actor_kind,session_id)values(p_user_id,p_file,m.attachment_id,d,'doctor',auth.jwt()->>'session_id');
 return jsonb_build_object('fileId',p_file,'bucket','clinic-originals','objectKey',m.object_key,'sha256',m.sha256,'sizeBytes',m.measured_size);
end$$;

-- Command: {version:'member-document-v1',submissionId,memberId,fileId,action:'release'|'withdraw',singleMemberConfirmed}.
-- Releasing needs the doctor's own open of the current attachment and an explicit
-- confirmation that the file holds only this member's results. Resending the
-- same submission returns its recorded outcome.
create function public.doctor_member_document_command(p_command jsonb)returns jsonb
language plpgsql security definer set search_path=''as $$
declare d uuid;sub uuid;m uuid;fid uuid;act text;want text;doc record;cur public.patient_document_release_events;prior public.patient_document_release_events;
 bad constant jsonb:=jsonb_build_object('status','invalid');
begin
 perform set_config('lock_timeout','1500ms',true);
 if jsonb_typeof(p_command)is distinct from 'object'or p_command-array['version','submissionId','memberId','fileId','action','singleMemberConfirmed']<>'{}'
  or not(p_command?&array['version','submissionId','memberId','fileId','action'])or p_command->>'version'is distinct from 'member-document-v1'
  or p_command->>'action'not in('release','withdraw')then return bad;end if;
 begin sub:=(p_command->>'submissionId')::uuid;m:=(p_command->>'memberId')::uuid;fid:=(p_command->>'fileId')::uuid;
 exception when invalid_text_representation then return bad;end;
 act:=p_command->>'action';
 if act='release'then want:='released';else want:='withdrawn';end if;
 d:=public._assigned_active_doctor(m);
 if not public._doctor_completion_enabled()then return jsonb_build_object('status','disabled');end if;
 -- Attach, detach and move serialise on the case row; so does release.
 perform 1 from public.patient_clinical_cases where user_id=m for update nowait;
 select * into prior from public.patient_document_release_events where submission_id=sub;
 if found then
  if prior.user_id<>m or prior.file_id<>fid or prior.actor_id<>d or prior.kind<>want then return jsonb_build_object('status','stale');end if;
  return jsonb_build_object('status',prior.kind);
 end if;
 select * into doc from public._member_clinic_documents(m)x where x.file_id=fid;
 if not found then return jsonb_build_object('status','stale');end if;
 cur:=public._member_document_release(m,fid,doc.attachment_id);
 if act='release'then
  if cur.kind='released'then return jsonb_build_object('status','unchanged');end if;
  if p_command->'singleMemberConfirmed'is distinct from 'true'::jsonb then return jsonb_build_object('status','confirm-required');end if;
  if not exists(select 1 from public.patient_document_opens o where o.file_id=fid and o.attachment_id=doc.attachment_id and o.actor_id=d and o.actor_kind='doctor')then return jsonb_build_object('status','open-first');end if;
  insert into public.patient_document_release_events(user_id,file_id,attachment_id,kind,single_member_confirmed,actor_id,submission_id)values(m,fid,doc.attachment_id,'released',true,d,sub);
  return jsonb_build_object('status','released');
 end if;
 if cur.kind is distinct from 'released'then return jsonb_build_object('status','unchanged');end if;
 insert into public.patient_document_release_events(user_id,file_id,attachment_id,kind,actor_id,submission_id)values(m,fid,doc.attachment_id,'withdrawn',d,sub);
 return jsonb_build_object('status','withdrawn');
end$$;

-- Member: own released documents only. Labelled by clinic and date, never by the
-- clinic's own file name.
create function public.patient_released_documents()returns jsonb
language sql stable security definer set search_path=''as $$
 select jsonb_build_object('version','released-documents-v1','documents',case when not public._doctor_completion_enabled()
  or not exists(select 1 from auth.users u where u.id=auth.uid() and u.phone_confirmed_at is not null)then '[]'::jsonb else
  coalesce((select jsonb_agg(jsonb_build_object('fileId',m.file_id,'clinic',m.clinic_name,'uploadedAt',m.uploaded_at,'releasedAt',r.created_at)order by m.uploaded_at desc,m.file_id)
   from public._member_clinic_documents(auth.uid())m cross join lateral public._member_document_release(auth.uid(),m.file_id,m.attachment_id)r
   where r.kind='released'),'[]')end)
$$;

create function public.patient_released_document_open(p_file uuid)returns jsonb
language plpgsql security definer set search_path=''as $$
declare u uuid:=auth.uid();m record;r public.patient_document_release_events;
begin
 if u is null or not public._doctor_completion_enabled()or not exists(select 1 from auth.users x where x.id=u and x.phone_confirmed_at is not null)then raise insufficient_privilege;end if;
 select * into m from public._member_clinic_documents(u)x where x.file_id=p_file;
 if not found then raise insufficient_privilege;end if;
 r:=public._member_document_release(u,p_file,m.attachment_id);
 if r.kind is distinct from 'released'then raise insufficient_privilege;end if;
 perform 1 from storage.objects where id=m.object_id and bucket_id='clinic-originals'and name=m.object_key and(metadata->>'size')::bigint=m.measured_size;
 if not found then raise insufficient_privilege;end if;
 insert into public.patient_document_opens(user_id,file_id,attachment_id,actor_id,actor_kind,session_id)values(u,p_file,m.attachment_id,u,'member',auth.jwt()->>'session_id');
 return jsonb_build_object('fileId',p_file,'bucket','clinic-originals','objectKey',m.object_key,'sha256',m.sha256,'sizeBytes',m.measured_size);
end$$;

revoke all on function public._doctor_completion_enabled(),public._member_clinic_documents(uuid),public._member_document_release(uuid,uuid,uuid),public._assigned_active_doctor(uuid),
 public.doctor_member_documents(uuid),public.doctor_member_document_open(uuid,uuid),public.doctor_member_document_command(jsonb),
 public.patient_released_documents(),public.patient_released_document_open(uuid)from public,anon,authenticated,service_role;
grant execute on function public.doctor_member_documents(uuid),public.doctor_member_document_open(uuid,uuid),public.doctor_member_document_command(jsonb),
 public.patient_released_documents(),public.patient_released_document_open(uuid)to authenticated;
