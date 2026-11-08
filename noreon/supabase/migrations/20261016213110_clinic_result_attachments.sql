-- Attach a clinic lab upload to a member's visit (Q8, lead decision 17 Oct 2026).
-- Attaching moves that visit's samples that were at the lab when the file was
-- uploaded to "results received", stamped with the upload time and
-- recorded by the system. Samples still only collected are left alone, nothing is
-- rolled back, and no matching is ever inferred from file content.
-- v1 actor: a Noreon admin. The clinic-admin picker is a later, separate change.
create table public.clinic_result_attachments(
 id uuid primary key default gen_random_uuid(),
 file_id uuid not null references public.clinic_batch_files(id),
 clinic_id uuid not null references public.workspace_clinics(id),
 user_id uuid not null references public.patient_clinical_cases(user_id),
 visit_id uuid not null,
 actor_kind text not null check(actor_kind in('noreon-admin')),
 actor_id uuid not null references auth.users(id),
 submission_id uuid not null unique,
 previous_id uuid references public.clinic_result_attachments(id),
 created_at timestamptz not null default clock_timestamp(),
 foreign key(user_id,visit_id)references public.patient_care_visits(user_id,id)
);
create index clinic_result_attachments_file on public.clinic_result_attachments(file_id,created_at desc);
create index clinic_result_attachments_visit on public.clinic_result_attachments(visit_id);
alter table public.clinic_result_attachments enable row level security;
revoke all on public.clinic_result_attachments from public,anon,authenticated,service_role;
create trigger clinic_result_attachments_immutable before update or delete on public.clinic_result_attachments
 for each row execute function public._patient_visit_immutable();

-- A stage is recorded by a nurse, a doctor, or the system for an attached upload.
alter table public.patient_care_lab_stages drop constraint patient_care_lab_stages_actor_role_check;
alter table public.patient_care_lab_stages alter column actor_id drop not null;
alter table public.patient_care_lab_stages add column attachment_id uuid references public.clinic_result_attachments(id);
alter table public.patient_care_lab_stages add constraint patient_care_lab_stages_actor_role_check check(
 (actor_role in('nurse','doctor')and actor_id is not null and attachment_id is null)
 or(actor_role='system'and actor_id is null and attachment_id is not null and stage='results-received'));

-- The latest attachment row is the file's current one.
create function public._clinic_result_current(p_file uuid)returns public.clinic_result_attachments
language sql stable security definer set search_path=''as $$
 select * from public.clinic_result_attachments where file_id=p_file order by created_at desc,id desc limit 1
$$;

-- Visits a clinic's upload may be attached to: this clinic's visits with a
-- booking context and at least one current collected sample without results.
create function public._clinic_result_open_visits(p_clinic uuid)returns jsonb
language sql stable security definer set search_path=''as $$
 select coalesce(jsonb_agg(jsonb_build_object('visitId',v.id,'memberId',v.user_id,'memberName',p.display_name,'visitedAt',v.created_at,
  'atLab',x.at_lab,'collectedOnly',x.collected_only)order by v.created_at desc,v.id),'[]')
 from public.patient_care_visits v join public.profiles p on p.id=v.user_id
 cross join lateral(select
   count(*)filter(where exists(select 1 from public.patient_care_lab_stages s where s.collection_entry_id=e.id and s.stage='at-lab')
    and not exists(select 1 from public.patient_care_lab_stages s where s.collection_entry_id=e.id and s.stage='results-received'))at_lab,
   count(*)filter(where not exists(select 1 from public.patient_care_lab_stages s where s.collection_entry_id=e.id))collected_only,
   count(*)filter(where not exists(select 1 from public.patient_care_lab_stages s where s.collection_entry_id=e.id and s.stage='results-received'))open_count
  from public.patient_care_visit_entries e where e.visit_id=v.id and e.user_id=v.user_id and public._patient_lab_current_collection(e))x
 where v.clinic_id=p_clinic and v.booking_context is not null and x.open_count>0
$$;

create function public.clinic_result_attach_page(p_clinic uuid)returns jsonb
language plpgsql security definer set search_path=''as $$
declare c public.workspace_clinics;
begin
 perform set_config('lock_timeout','1500ms',true);
 perform public._clinic_portal_admin();
 select * into c from public.workspace_clinics where id=p_clinic;if not found then raise insufficient_privilege;end if;
 return jsonb_build_object('version','clinic-result-attach-v1','clinic',jsonb_build_object('id',c.id,'name',c.name),
  'files',coalesce((select jsonb_agg(jsonb_build_object('id',f.id,'name',f.name,'batchName',b.name,'uploadedAt',f.created_at,
    'attachment',(select case when a.id is null then null else jsonb_build_object('id',a.id,'memberId',a.user_id,'memberName',pr.display_name,'visitId',a.visit_id,'visitedAt',v.created_at,'attachedAt',a.created_at)end
      from public._clinic_result_current(f.id)a left join public.profiles pr on pr.id=a.user_id left join public.patient_care_visits v on v.id=a.visit_id))
    order by f.created_at desc,f.id)
   from(select f.* from public.clinic_batch_files f join public.clinic_batches b on b.id=f.batch_id where b.clinic_id=p_clinic and f.state='stored'order by f.created_at desc,f.id limit 100)f
   join public.clinic_batches b on b.id=f.batch_id),'[]'),
  'visits',public._clinic_result_open_visits(p_clinic));
end$$;

-- Command: {version:'clinic-result-attach-v1',submissionId,fileId,memberId,visitId}.
-- Only samples already at the lab when the file was uploaded can move, so a
-- resend or re-attach never marks a sample handed over later: attaching the same
-- file to its current visit again changes nothing new and is safe to resend. Attaching to a different visit is a correction: audited, and
-- stages already recorded for the earlier visit stay as they are.
create function public.clinic_result_attach_command(p_command jsonb)returns jsonb
language plpgsql security definer set search_path=''as $$
declare a uuid;sub uuid;fid uuid;m uuid;vid uuid;f public.clinic_batch_files;clinic uuid;v public.patient_care_visits;cur public.clinic_result_attachments;
 att uuid;e public.patient_care_visit_entries;atlab timestamptz;sid uuid;ids jsonb:='[]';moved int:=0;waiting int:=0;received int:=0;later int:=0;r bigint;corrected boolean:=false;
 bad constant jsonb:=jsonb_build_object('status','invalid');
begin
 perform set_config('lock_timeout','1500ms',true);
 if jsonb_typeof(p_command)is distinct from 'object'or p_command-array['version','submissionId','fileId','memberId','visitId']<>'{}'
  or not(p_command?&array['version','submissionId','fileId','memberId','visitId'])or p_command->>'version'is distinct from 'clinic-result-attach-v1'then return bad;end if;
 begin sub:=(p_command->>'submissionId')::uuid;fid:=(p_command->>'fileId')::uuid;m:=(p_command->>'memberId')::uuid;vid:=(p_command->>'visitId')::uuid;
 exception when invalid_text_representation then return bad;end;
 a:=public._clinic_portal_admin();
 perform pg_advisory_xact_lock(hashtextextended('clinic-result-attach:'||fid::text,0));
 select * into cur from public.clinic_result_attachments where submission_id=sub;
 if found then
  if cur.file_id<>fid or cur.user_id<>m or cur.visit_id<>vid or cur.actor_id<>a then return jsonb_build_object('status','stale');end if;
 end if;
 select f2.* into f from public.clinic_batch_files f2 where f2.id=fid and f2.state='stored'for share nowait;if not found then return bad;end if;
 select b.clinic_id into clinic from public.clinic_batches b where b.id=f.batch_id;
 select * into v from public.patient_care_visits where id=vid and user_id=m and clinic_id=clinic and booking_context is not null;
 -- An upload made before the visit cannot hold that visit's results.
 if not found or f.created_at<v.created_at then return bad;end if;
 perform 1 from public.patient_clinical_cases where user_id=m for update nowait;
 cur:=public._clinic_result_current(fid);
 if cur.id is not null and cur.user_id=m and cur.visit_id=vid then att:=cur.id;
 else
  corrected:=cur.id is not null;
  insert into public.clinic_result_attachments(file_id,clinic_id,user_id,visit_id,actor_kind,actor_id,submission_id,previous_id)
   values(fid,clinic,m,vid,'noreon-admin',a,sub,cur.id)returning id into att;
  insert into public.clinic_portal_audit(clinic_id,batch_id,actor_id,kind,detail)values(clinic,f.batch_id,a,case when corrected then 'result-reattached'else 'result-attached'end,
   jsonb_build_object('attachmentId',att,'fileId',fid,'memberId',m,'visitId',vid,'previousAttachmentId',cur.id,'previousMemberId',cur.user_id,'previousVisitId',cur.visit_id));
 end if;
 for e in select x.* from public.patient_care_visit_entries x where x.visit_id=vid and x.user_id=m and public._patient_lab_current_collection(x)order by x.recorded_at,x.position loop
  if exists(select 1 from public.patient_care_lab_stages s where s.collection_entry_id=e.id and s.stage='results-received')then received:=received+1;continue;end if;
  select occurred_at into atlab from public.patient_care_lab_stages s where s.collection_entry_id=e.id and s.stage='at-lab';
  if not found then waiting:=waiting+1;continue;end if;
  if atlab>f.created_at then later:=later+1;continue;end if;
  insert into public.patient_care_lab_stages(user_id,collection_entry_id,stage,submission_id,occurred_at,actor_id,actor_name,actor_role,clinic_id,attachment_id)
   values(m,e.id,'results-received',gen_random_uuid(),f.created_at,null,'Clinic upload','system',clinic,att)returning id into sid;
  ids:=ids||to_jsonb(sid);moved:=moved+1;
 end loop;
 if moved>0 then
  update public.patient_clinical_cases set revision=revision+1,updated_at=clock_timestamp()where user_id=m returning revision into r;
  insert into public.patient_clinical_case_events(user_id,revision,kind,actor_id,detail)
   values(m,r,'care-evidence',a,jsonb_build_object('actor','system','attachmentId',att,'fileId',fid,'labStageIds',ids,'requestedBy',a));
 end if;
 return jsonb_build_object('status','saved','attachmentId',att,'corrected',corrected,'moved',moved,'waitingForLab',waiting,'atLabAfterUpload',later,'alreadyReceived',received);
exception when insufficient_privilege then return jsonb_build_object('status','access');
 when lock_not_available or query_canceled or deadlock_detected then return jsonb_build_object('status','unavailable');
 when unique_violation then return jsonb_build_object('status','stale');
end$$;

-- Per-file status for the clinic portal: an upload attached to a member's visit
-- reads as associated. Only the status and count change; no member data is added
-- to the clinic's view.
create or replace function public._clinic_portal_file_json(f public.clinic_batch_files)returns jsonb language sql stable set search_path=''as $$select jsonb_build_object(
 'id',f.id,'logicalKey',f.logical_key,'name',f.name,'mime',f.mime,'declaredSizeBytes',f.declared_size,'sizeBytes',f.measured_size,'checksum',f.sha256,'revision',f.revision,'createdAt',f.created_at,
 'upload',jsonb_build_object('status',case when f.state='retired'then'rejected'else f.state end,'attemptId',f.attempt_id,'possibleDuplicate',false,'cleanup',f.cleanup),
 'processing',jsonb_build_object('status',case when f.state='stored'then'unavailable'else'not_started'end,'sequence',0,'segments',0,'unresolvedRegions',0),
 'association',case when f.state='stored'and exists(select 1 from public.clinic_result_attachments a where a.file_id=f.id)
   then jsonb_build_object('status','associated','associatedCount',1,'unmatchedCount',0)
   else jsonb_build_object('status','not_started','associatedCount',0,'unmatchedCount',0)end,
 'correction',jsonb_build_object('pendingCount',0),'release',jsonb_build_object('hiddenCount',0,'releasedCount',0))$$;

revoke all on function public._clinic_result_current(uuid),public._clinic_result_open_visits(uuid),public.clinic_result_attach_page(uuid),
 public.clinic_result_attach_command(jsonb)from public,anon,authenticated,service_role;
grant execute on function public.clinic_result_attach_page(uuid),public.clinic_result_attach_command(jsonb)to authenticated;
