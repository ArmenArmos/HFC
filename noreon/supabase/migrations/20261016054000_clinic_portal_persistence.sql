-- Separate clinic membership; never grants workspace_staff/global administration.
create table public.clinic_portal_memberships(
 id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id),clinic_id uuid not null references public.workspace_clinics(id),
 display_name text not null check(length(btrim(display_name))between 1 and 180),active boolean not null default true,revision bigint not null default 1 check(revision>0),unique(user_id,clinic_id)
);
create table public.clinic_portal_capabilities(singleton boolean primary key default true check(singleton),storage_enabled boolean not null default false);
-- No activation or membership seeds. Technical capabilities are deployment operations, not clinical policy.
create table public.clinic_batches(
 id uuid primary key,clinic_id uuid not null references public.workspace_clinics(id),name text not null check(length(btrim(name))between 1 and 180),
 uploader_id uuid not null references auth.users(id),uploader_name text not null,revision bigint not null default 0,created_at timestamptz not null default clock_timestamp()
);
create table public.clinic_batch_commands(
 actor_id uuid not null references auth.users(id),submission_id uuid not null,session_id uuid not null,clinic_id uuid not null references public.workspace_clinics(id),
 batch_id uuid not null,payload jsonb not null,state text not null check(state in('committed','retired')),result jsonb not null,created_at timestamptz not null default clock_timestamp(),primary key(actor_id,submission_id)
);
create table public.clinic_batch_files(
 id uuid primary key,batch_id uuid not null references public.clinic_batches(id),logical_key uuid not null,attempt_id uuid not null unique,
 actor_id uuid not null references auth.users(id),session_id uuid not null,amr jsonb not null,jwt_expires_at timestamptz not null,
 membership_id uuid not null,membership_revision bigint not null,submission_id uuid not null,
 name text not null,mime text not null check(mime='application/pdf'),declared_size bigint not null check(declared_size between 1 and 8388608),expected_sha256 text not null check(expected_sha256~'^[a-f0-9]{64}$'),
 object_key text not null unique,object_id uuid unique,measured_size bigint,sha256 text,
 state text not null default 'reserved'check(state in('reserved','stored','retired')),cleanup text not null default 'not_required'check(cleanup in('not_required','pending','complete')),
 execution text not null default 'not_started'check(execution in('not_started','active','ended')),
 revision bigint not null default 0,created_at timestamptz not null default clock_timestamp(),unique(batch_id,logical_key),
 foreign key(actor_id,submission_id)references public.clinic_batch_commands(actor_id,submission_id),
 check(state<>'stored'or(object_id is not null and measured_size=declared_size and sha256=expected_sha256))
);
create table public.clinic_original_accesses(
 id uuid primary key default gen_random_uuid(),file_id uuid not null references public.clinic_batch_files(id),actor_id uuid not null references auth.users(id),session_id uuid not null,
 amr jsonb not null,jwt_expires_at timestamptz not null,membership_id uuid not null,membership_revision bigint not null,file_revision bigint not null,created_at timestamptz not null default clock_timestamp()
);
create table public.clinic_portal_audit(id bigint generated always as identity primary key,clinic_id uuid not null,batch_id uuid,actor_id uuid,kind text not null,detail jsonb not null,created_at timestamptz not null default clock_timestamp());
create function public._clinic_portal_immutable()returns trigger language plpgsql set search_path=''as $$begin raise exception using errcode='55000',message='Clinic history immutable';end$$;
create trigger clinic_audit_immutable before update or delete on public.clinic_portal_audit for each row execute function public._clinic_portal_immutable();
create trigger clinic_access_immutable before update or delete on public.clinic_original_accesses for each row execute function public._clinic_portal_immutable();
create function public._clinic_portal_membership_revision()returns trigger language plpgsql set search_path=''as $$begin
 if new.id<>old.id or new.user_id<>old.user_id or new.clinic_id<>old.clinic_id then raise invalid_parameter_value;end if;
 new.revision:=old.revision+1;return new;
end$$;
create trigger clinic_membership_revision before update on public.clinic_portal_memberships for each row execute function public._clinic_portal_membership_revision();

create function public._clinic_portal_live(c uuid,a uuid,s uuid,amr jsonb,expires timestamptz,mid uuid default null,mrev bigint default null)returns public.clinic_portal_memberships
language plpgsql security definer set search_path=''as $$declare m public.clinic_portal_memberships;begin
 if c is null or a is null or s is null or expires is null or expires<=clock_timestamp()or not public._real_staff_amr_allowed(amr)then raise insufficient_privilege;end if;
 perform 1 from auth.users where id=a and(banned_until is null or banned_until<=clock_timestamp())for share nowait;if not found then raise insufficient_privilege;end if;
 perform 1 from auth.sessions where id=s and user_id=a and(not_after is null or not_after>clock_timestamp())for share nowait;if not found then raise insufficient_privilege;end if;
 perform 1 from public.workspace_clinics where id=c and active for share nowait;if not found then raise insufficient_privilege;end if;
 select * into m from public.clinic_portal_memberships where user_id=a and clinic_id=c for share nowait;
 if not found or not m.active or(mid is not null and(m.id<>mid or m.revision<>mrev))or expires<=clock_timestamp()then raise insufficient_privilege;end if;
 return m;
end$$;
create function public._clinic_portal_user(c uuid)returns public.clinic_portal_memberships language plpgsql security definer set search_path=''as $$begin
 if auth.role()is distinct from 'authenticated'then raise insufficient_privilege;end if;
 return public._clinic_portal_live(c,auth.uid(),(auth.jwt()->>'session_id')::uuid,auth.jwt()->'amr',to_timestamp((auth.jwt()->>'exp')::double precision));
exception when invalid_text_representation or numeric_value_out_of_range then raise insufficient_privilege;
end$$;
create function public.clinic_portal_identity(p_clinic_id uuid default null)returns jsonb language plpgsql security definer set search_path=''as $$declare m public.clinic_portal_memberships;cs jsonb;cid uuid;begin
 if p_clinic_id is null then
 select jsonb_agg(jsonb_build_object('id',x.clinic_id,'name',c.name)order by x.clinic_id)into cs from public.clinic_portal_memberships x join public.workspace_clinics c on c.id=x.clinic_id and c.active where x.user_id=auth.uid()and x.active;
 if cs is null then raise insufficient_privilege;end if;
 for cid in select(value->>'id')::uuid from jsonb_array_elements(cs)loop perform public._clinic_portal_user(cid);end loop;
 if jsonb_array_length(cs)>1 then return jsonb_build_object('status','selection-required','clinics',cs);end if;
 p_clinic_id:=(cs->0->>'id')::uuid;
 end if;
 m:=public._clinic_portal_user(p_clinic_id);
 return jsonb_build_object('status','ready','identity',jsonb_build_object('version','clinic-portal-v1','userId',m.user_id,'membershipId',m.id,'membershipRevision',m.revision,'clinicId',m.clinic_id,'clinicName',(select name from public.workspace_clinics where id=m.clinic_id),'displayName',m.display_name,'capability','clinic_admin'));
end$$;
create function public._clinic_portal_batch_json(b public.clinic_batches)returns jsonb language sql immutable set search_path=''as $$select jsonb_build_object('id',b.id,'clinicId',b.clinic_id,'name',b.name,'revision',b.revision,'createdAt',b.created_at,'uploaderName',b.uploader_name)$$;
create function public._clinic_portal_file_json(f public.clinic_batch_files)returns jsonb language sql immutable set search_path=''as $$select jsonb_build_object(
 'id',f.id,'logicalKey',f.logical_key,'name',f.name,'mime',f.mime,'declaredSizeBytes',f.declared_size,'sizeBytes',f.measured_size,'checksum',f.sha256,'revision',f.revision,'createdAt',f.created_at,
 'upload',jsonb_build_object('status',case when f.state='retired'then'rejected'else f.state end,'attemptId',f.attempt_id,'possibleDuplicate',false,'cleanup',f.cleanup),
 'processing',jsonb_build_object('status',case when f.state='stored'then'unavailable'else'not_started'end,'sequence',0,'segments',0,'unresolvedRegions',0),
 'association',jsonb_build_object('status','not_started','associatedCount',0,'unmatchedCount',0),'correction',jsonb_build_object('pendingCount',0),'release',jsonb_build_object('hiddenCount',0,'releasedCount',0))$$;
create function public.clinic_batches_page(p_clinic_id uuid,p_cursor text default null,p_limit integer default 50)returns jsonb language plpgsql security definer set search_path=''as $$declare rows jsonb;nextid uuid;afterid uuid:=p_cursor::uuid;begin
 perform public._clinic_portal_user(p_clinic_id);if p_limit is null or p_limit not between 1 and 100 then raise invalid_parameter_value;end if;
 select coalesce(jsonb_agg(public._clinic_portal_batch_json(b)||jsonb_build_object('fileCount',(select count(*)from public.clinic_batch_files f where f.batch_id=b.id),'attentionCount',(select count(*)from public.clinic_batch_files f where f.batch_id=b.id and f.state<>'stored'))order by b.id),'[]')into rows from(select * from public.clinic_batches where clinic_id=p_clinic_id and(afterid is null or id>afterid)order by id limit p_limit)b;
 if jsonb_array_length(rows)=p_limit then select id into nextid from public.clinic_batches where clinic_id=p_clinic_id and id>(rows->(p_limit-1)->>'id')::uuid limit 1;end if;
 return jsonb_build_object('version','clinic-batches-page-v1','clinicId',p_clinic_id,'batches',rows,'nextCursor',case when nextid is not null then rows->(p_limit-1)->>'id'end);
end$$;
create function public.clinic_batch_read(p_clinic_id uuid,p_batch_id uuid,p_cursor text default null,p_limit integer default 50)returns jsonb language plpgsql security definer set search_path=''as $$declare b public.clinic_batches;rows jsonb;nextid uuid;afterid uuid:=p_cursor::uuid;enabled boolean;begin
 select * into b from public.clinic_batches where id=p_batch_id and clinic_id=p_clinic_id for share nowait;
 if not found then raise insufficient_privilege;end if;perform public._clinic_portal_user(p_clinic_id);
 if p_limit is null or p_limit not between 1 and 100 then raise invalid_parameter_value;end if;
 select coalesce(jsonb_agg(public._clinic_portal_file_json(f)||jsonb_build_object('recoveryCommand',case when f.state='reserved'and f.actor_id=auth.uid()then(select payload from public.clinic_batch_commands cmd where cmd.actor_id=f.actor_id and cmd.submission_id=f.submission_id)else null end)order by f.id),'[]')into rows from(select * from public.clinic_batch_files where batch_id=b.id and(afterid is null or id>afterid)order by id limit p_limit)f;
 if jsonb_array_length(rows)=p_limit then select id into nextid from public.clinic_batch_files where batch_id=b.id and id>(rows->(p_limit-1)->>'id')::uuid limit 1;end if;
 select storage_enabled into enabled from public.clinic_portal_capabilities where singleton;
 return jsonb_build_object('version','clinic-batch-v1','batch',public._clinic_portal_batch_json(b),'files',rows,'nextCursor',case when nextid is not null then rows->(p_limit-1)->>'id'end,
 'limits',jsonb_build_object('maxFiles',100,'maxFileBytes',8388608),'capabilities',jsonb_build_object('upload',coalesce(enabled,false),'processing',false,'association',false,'correction',false,'sourceRelease',false));
end$$;
-- Canonical UUIDs prevent alternate textual encodings from escaping the request namespace.
create function public._clinic_portal_command(p jsonb)returns jsonb language plpgsql immutable set search_path=''as $$declare keys text[];k text;begin
 if jsonb_typeof(p)is distinct from 'object'or p->>'version'is distinct from 'clinic-command-v1'then raise invalid_parameter_value;end if;
 if p->>'op'='create-batch'then keys:=array['version','op','submissionId','clinicId','batchId','name'];
 elsif p->>'op'='reserve-upload'then keys:=array['version','op','submissionId','clinicId','batchId','name','revision','logicalKey','fileId','attemptId','mime','declaredSizeBytes','fingerprint'];else raise invalid_parameter_value;end if;
 if p-keys<>'{}'::jsonb or not p?&keys or jsonb_typeof(p->'name')<>'string'or length(btrim(p->>'name'))not between 1 and 180 then raise invalid_parameter_value;end if;
 foreach k in array array['submissionId','clinicId','batchId']loop if p->>k is null then raise invalid_parameter_value;end if;p:=jsonb_set(p,array[k],to_jsonb((p->>k)::uuid::text));end loop;
 if p->>'op'='reserve-upload'then
 foreach k in array array['logicalKey','fileId','attemptId']loop if p->>k is null then raise invalid_parameter_value;end if;p:=jsonb_set(p,array[k],to_jsonb((p->>k)::uuid::text));end loop;
 if p->>'mime'is distinct from 'application/pdf'or jsonb_typeof(p->'fingerprint')<>'string'or p->>'fingerprint'!~'^[a-f0-9]{64}$'or jsonb_typeof(p->'revision')<>'number'or p->>'revision'!~'^[0-9]+$'or(p->>'revision')::bigint>9007199254740991 or jsonb_typeof(p->'declaredSizeBytes')<>'number'or p->>'declaredSizeBytes'!~'^[0-9]+$'or(p->>'declaredSizeBytes')::bigint not between 1 and 8388608 then raise invalid_parameter_value;end if;
 end if;return p;
end$$;
create function public._clinic_portal_command_lock(a uuid,r uuid)returns void language plpgsql set search_path=''as $$begin
 if a is null or r is null then raise insufficient_privilege;end if;
 if not pg_try_advisory_xact_lock(hashtextextended(a::text||':'||r::text,53000))then raise lock_not_available;end if;
end$$;
create function public.clinic_batch_command(p_command jsonb)returns jsonb language plpgsql security definer set search_path=''as $$declare p jsonb;b public.clinic_batches;m public.clinic_portal_memberships;cmd public.clinic_batch_commands;r uuid;c uuid;bid uuid;sid uuid;result jsonb;fid uuid;begin
 p:=public._clinic_portal_command(p_command);r:=(p->>'submissionId')::uuid;c:=(p->>'clinicId')::uuid;bid:=(p->>'batchId')::uuid;sid:=(auth.jwt()->>'session_id')::uuid;
 perform public._clinic_portal_command_lock(auth.uid(),r);
 select * into b from public.clinic_batches where id=bid for update nowait;
 if b.id is not null and b.clinic_id<>c then raise insufficient_privilege;end if;m:=public._clinic_portal_user(c);
 select * into cmd from public.clinic_batch_commands where actor_id=auth.uid()and submission_id=r;
 if found then
 if cmd.payload<>p then return jsonb_build_object('status','rejected','submissionId',r,'reason','conflict','noWrite',true);end if;
 if cmd.state='retired'then return jsonb_build_object('status','rejected','submissionId',r,'reason','unavailable','noWrite',true);end if;return cmd.result;
 end if;
 if p->>'op'='create-batch'then
 if b.id is not null then return jsonb_build_object('status','rejected','submissionId',r,'reason','conflict','noWrite',true);end if;
 insert into public.clinic_batches(id,clinic_id,name,uploader_id,uploader_name)values(bid,c,p->>'name',auth.uid(),m.display_name)returning * into b;
 else
 if b.id is null then raise insufficient_privilege;end if;
 if b.revision<>(p->>'revision')::bigint then return jsonb_build_object('status','stale');end if;
 if not coalesce((select storage_enabled from public.clinic_portal_capabilities where singleton),false)then return jsonb_build_object('status','rejected','submissionId',r,'reason','unavailable','noWrite',true);end if;
 if(select count(*)from public.clinic_batch_files where batch_id=bid)>=100 or(select coalesce(sum(declared_size),0)from public.clinic_batch_files where batch_id=bid)+(p->>'declaredSizeBytes')::bigint>67108864 then return jsonb_build_object('status','rejected','submissionId',r,'reason','batch_full','noWrite',true);end if;
 if exists(select 1 from public.clinic_batch_files where id=(p->>'fileId')::uuid or attempt_id=(p->>'attemptId')::uuid or(batch_id=bid and logical_key=(p->>'logicalKey')::uuid))then return jsonb_build_object('status','rejected','submissionId',r,'reason','conflict','noWrite',true);end if;
 update public.clinic_batches set revision=revision+1 where id=bid returning * into b;
 end if;
 result:=jsonb_build_object('status','committed','submissionId',r,'batchId',bid,'revision',b.revision);
 insert into public.clinic_batch_commands(actor_id,submission_id,session_id,clinic_id,batch_id,payload,state,result)values(auth.uid(),r,sid,c,bid,p,'committed',result);
 if p->>'op'='reserve-upload'then
 fid:=(p->>'fileId')::uuid;
 insert into public.clinic_batch_files(id,batch_id,logical_key,attempt_id,actor_id,session_id,amr,jwt_expires_at,membership_id,membership_revision,submission_id,name,mime,declared_size,expected_sha256,object_key)
 values(fid,bid,(p->>'logicalKey')::uuid,(p->>'attemptId')::uuid,auth.uid(),sid,auth.jwt()->'amr',to_timestamp((auth.jwt()->>'exp')::double precision),m.id,m.revision,r,p->>'name',p->>'mime',(p->>'declaredSizeBytes')::bigint,p->>'fingerprint',c::text||'/'||fid::text||'/'||(p->>'attemptId')||'.pdf');
 end if;
 insert into public.clinic_portal_audit(clinic_id,batch_id,actor_id,kind,detail)values(c,bid,auth.uid(),p->>'op',jsonb_build_object('submissionId',r));return result;
exception when invalid_parameter_value or invalid_text_representation or numeric_value_out_of_range then return jsonb_build_object('status','rejected','submissionId',coalesce(r,'00000000-0000-0000-0000-000000000000'::uuid),'reason','invalid','noWrite',true);
 when insufficient_privilege then return jsonb_build_object('status','access');
end$$;
create function public.clinic_batch_refresh(p_clinic_id uuid,p_batch_id uuid,p_command jsonb)returns jsonb language plpgsql security definer set search_path=''as $$declare p jsonb;r uuid;b public.clinic_batches;cmd public.clinic_batch_commands;f public.clinic_batch_files;receipt jsonb;snapshot jsonb;begin
 p:=public._clinic_portal_command(p_command);r:=(p->>'submissionId')::uuid;
 if(p->>'clinicId')::uuid<>p_clinic_id or(p->>'batchId')::uuid<>p_batch_id then raise invalid_parameter_value;end if;
 perform public._clinic_portal_command_lock(auth.uid(),r);
 select * into b from public.clinic_batches where id=p_batch_id for update nowait;
 if b.id is not null and b.clinic_id<>p_clinic_id then raise insufficient_privilege;end if;
 perform public._clinic_portal_user(p_clinic_id);
 select * into cmd from public.clinic_batch_commands where actor_id=auth.uid()and submission_id=r;
 if found then
 if cmd.payload<>p then raise invalid_parameter_value using message='request_conflict';end if;
 if p->>'op'='reserve-upload'and cmd.state='committed'then
 select * into f from public.clinic_batch_files where actor_id=auth.uid()and submission_id=r for update nowait;
 if f.state='reserved'then
 update public.clinic_batch_files set state='retired',cleanup='pending',revision=revision+1 where id=f.id;
 update public.clinic_batches set revision=revision+1 where id=b.id returning * into b;
 update public.clinic_batch_commands set state='retired'where actor_id=auth.uid()and submission_id=r;cmd.state:='retired';
 insert into public.clinic_portal_audit(clinic_id,batch_id,actor_id,kind,detail)values(p_clinic_id,p_batch_id,auth.uid(),'upload-retired',jsonb_build_object('fileId',f.id,'submissionId',r));
 end if;
 end if;
 else
 insert into public.clinic_batch_commands(actor_id,submission_id,session_id,clinic_id,batch_id,payload,state,result)values(auth.uid(),r,(auth.jwt()->>'session_id')::uuid,p_clinic_id,p_batch_id,p,'retired','{}');cmd.state:='retired';
 insert into public.clinic_portal_audit(clinic_id,batch_id,actor_id,kind,detail)values(p_clinic_id,p_batch_id,auth.uid(),'command-retired',jsonb_build_object('submissionId',r));
 end if;
 if b.id is not null then snapshot:=public.clinic_batch_read(p_clinic_id,p_batch_id,null,100);end if;
 receipt:=case when cmd.state='committed'then cmd.result else jsonb_build_object('status','retired','submissionId',r,'serialized',true)end;
 return jsonb_build_object('status','loaded','snapshot',snapshot,'receipt',receipt);
end$$;
-- Service-only helper. It resolves immutable principal, never a supplied actor.
create function public._clinic_portal_file_lock(p_file uuid,original_authority boolean)returns public.clinic_batch_files language plpgsql security definer set search_path=''as $$declare f public.clinic_batch_files;c uuid;begin
 select * into f from public.clinic_batch_files where id=p_file;if not found then raise insufficient_privilege;end if;
 perform public._clinic_portal_command_lock(f.actor_id,f.submission_id);
 select clinic_id into c from public.clinic_batches where id=f.batch_id for update nowait;
 select * into f from public.clinic_batch_files where id=p_file for update nowait;
 if original_authority then perform public._clinic_portal_live(c,f.actor_id,f.session_id,f.amr,f.jwt_expires_at,f.membership_id,f.membership_revision);end if;
 return f;
end$$;
create function public.clinic_upload_target(p_file uuid,p_actor uuid,p_session uuid)returns jsonb language plpgsql security definer set search_path=''as $$declare f public.clinic_batch_files;begin
 if auth.role()is distinct from 'service_role'then raise insufficient_privilege;end if;
 f:=public._clinic_portal_file_lock(p_file,true);
 if p_actor is distinct from f.actor_id or p_session is distinct from f.session_id then raise insufficient_privilege;end if;
 if f.state<>'reserved'or f.execution<>'not_started'or not coalesce((select storage_enabled from public.clinic_portal_capabilities where singleton),false)then raise object_not_in_prerequisite_state;end if;
 update public.clinic_batch_files set execution='active'where id=f.id;
 return jsonb_build_object('fileId',f.id,'attemptId',f.attempt_id,'executionId',f.attempt_id,'actorId',f.actor_id,'sessionId',f.session_id,'bucket','clinic-originals','objectKey',f.object_key,'expectedSha256',f.expected_sha256,'expectedSizeBytes',f.declared_size);
end$$;
create function public.clinic_upload_finalize(p_file uuid,p_object uuid,p_sha256 text,p_size bigint)returns jsonb language plpgsql security definer set search_path=''as $$declare f public.clinic_batch_files;rev bigint;begin
 if auth.role()is distinct from 'service_role'then raise insufficient_privilege;end if;
 f:=public._clinic_portal_file_lock(p_file,true);
 if p_object is null or p_sha256 is distinct from f.expected_sha256 or p_size is distinct from f.declared_size then raise invalid_parameter_value;end if;
 if f.state='retired'or(f.state='reserved'and f.execution<>'active')then raise object_not_in_prerequisite_state;end if;
 perform 1 from storage.objects where id=p_object and bucket_id='clinic-originals'and name=f.object_key and(metadata->>'size')::bigint=p_size for share nowait;if not found then raise invalid_parameter_value;end if;
 if f.state='stored'then
 if f.object_id<>p_object then raise invalid_parameter_value;end if;
 return jsonb_build_object('status','stored','fileId',f.id,'revision',(select revision from public.clinic_batches where id=f.batch_id));
 end if;
 update public.clinic_batch_files set object_id=p_object,measured_size=p_size,sha256=p_sha256,state='stored',execution='ended',revision=revision+1 where id=f.id;
 update public.clinic_batches set revision=revision+1 where id=f.batch_id returning revision into rev;
 update public.clinic_batch_commands set result=jsonb_build_object('status','committed','submissionId',f.submission_id,'batchId',f.batch_id,'revision',rev)where actor_id=f.actor_id and submission_id=f.submission_id;
 insert into public.clinic_portal_audit(clinic_id,batch_id,actor_id,kind,detail)select clinic_id,f.batch_id,f.actor_id,'upload-stored',jsonb_build_object('fileId',f.id,'objectId',p_object,'sha256',p_sha256,'sizeBytes',p_size)from public.clinic_batches where id=f.batch_id;
 return jsonb_build_object('status','stored','fileId',f.id,'revision',rev);
end$$;
-- A rejected network promise is NOT an ended external operation. Only conclusive
-- no-invocation or a positively acknowledged exact Storage write may close it.
create function public.clinic_upload_execution_end(p_file uuid,p_attempt uuid,p_outcome jsonb)returns jsonb language plpgsql security definer set search_path=''as $$declare f public.clinic_batch_files;begin
 if auth.role()is distinct from 'service_role'then raise insufficient_privilege;end if;
 f:=public._clinic_portal_file_lock(p_file,false);
 if p_attempt is distinct from f.attempt_id or f.execution<>'active'then raise object_not_in_prerequisite_state;end if;
 if p_outcome=jsonb_build_object('kind','not_invoked')then null;
 elsif p_outcome->>'kind'='storage_completed'and p_outcome-array['kind','objectId']='{}'::jsonb and p_outcome?&array['kind','objectId']then
 perform 1 from storage.objects where id=(p_outcome->>'objectId')::uuid and bucket_id='clinic-originals'and name=f.object_key for share nowait;if not found then raise invalid_parameter_value;end if;
 else raise invalid_parameter_value;end if;
 update public.clinic_batch_files set execution='ended'where id=f.id;
 insert into public.clinic_portal_audit(clinic_id,batch_id,actor_id,kind,detail)select clinic_id,f.batch_id,f.actor_id,'upload-execution-ended',jsonb_build_object('fileId',f.id,'attemptId',p_attempt,'proof',p_outcome)from public.clinic_batches where id=f.batch_id;
 return jsonb_build_object('status','ended');
end$$;
create function public.clinic_upload_cleanup(p_file uuid)returns jsonb language plpgsql security definer set search_path=''as $$declare f public.clinic_batch_files;begin
 if auth.role()is distinct from 'service_role'then raise insufficient_privilege;end if;
 f:=public._clinic_portal_file_lock(p_file,false);
 if f.state<>'retired'or f.execution='active'then raise object_not_in_prerequisite_state;end if;
 if exists(select 1 from storage.objects where bucket_id='clinic-originals'and name=f.object_key)then raise object_not_in_prerequisite_state;end if;
 update public.clinic_batch_files set cleanup='complete',revision=revision+1 where id=f.id;
 update public.clinic_batches set revision=revision+1 where id=f.batch_id;
 insert into public.clinic_portal_audit(clinic_id,batch_id,actor_id,kind,detail)select clinic_id,f.batch_id,f.actor_id,'upload-cleanup-complete',jsonb_build_object('fileId',f.id)from public.clinic_batches where id=f.batch_id;
 return jsonb_build_object('status','complete');
end$$;
create function public.clinic_original_access(p_file uuid)returns jsonb language plpgsql security definer set search_path=''as $$declare f public.clinic_batch_files;m public.clinic_portal_memberships;c uuid;ticket uuid;begin
 select * into f from public.clinic_batch_files where id=p_file;if not found then raise insufficient_privilege;end if;
 select clinic_id into c from public.clinic_batches where id=f.batch_id for share nowait;
 select * into f from public.clinic_batch_files where id=p_file for share nowait;
 m:=public._clinic_portal_user(c);if f.state<>'stored'then raise insufficient_privilege;end if;
 insert into public.clinic_original_accesses(file_id,actor_id,session_id,amr,jwt_expires_at,membership_id,membership_revision,file_revision)values(f.id,auth.uid(),(auth.jwt()->>'session_id')::uuid,auth.jwt()->'amr',to_timestamp((auth.jwt()->>'exp')::double precision),m.id,m.revision,f.revision)returning id into ticket;
 return jsonb_build_object('accessId',ticket,'fileId',f.id);
end$$;
create function public.clinic_original_target(p_access uuid)returns jsonb language plpgsql security definer set search_path=''as $$declare a public.clinic_original_accesses;f public.clinic_batch_files;c uuid;begin
 if auth.role()is distinct from 'service_role'then raise insufficient_privilege;end if;
 select * into a from public.clinic_original_accesses where id=p_access;if not found then raise insufficient_privilege;end if;
 select * into f from public.clinic_batch_files where id=a.file_id;
 select clinic_id into c from public.clinic_batches where id=f.batch_id for share nowait;
 select * into f from public.clinic_batch_files where id=a.file_id for share nowait;
 perform public._clinic_portal_live(c,a.actor_id,a.session_id,a.amr,a.jwt_expires_at,a.membership_id,a.membership_revision);
 if f.state<>'stored'or f.revision<>a.file_revision then raise insufficient_privilege;end if;
 perform 1 from storage.objects where id=f.object_id and bucket_id='clinic-originals'and name=f.object_key and(metadata->>'size')::bigint=f.measured_size for share nowait;if not found then raise insufficient_privilege;end if;
 return jsonb_build_object('fileId',f.id,'actorId',a.actor_id,'sessionId',a.session_id,'bucket','clinic-originals','objectKey',f.object_key,'objectId',f.object_id,'sha256',f.sha256,'sizeBytes',f.measured_size);
end$$;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)values('clinic-originals','clinic-originals',false,8388608,array['application/pdf']);
-- No direct API table access; all authorization is in the narrow RPCs.
do $$declare t text;r record;begin
 foreach t in array array['clinic_portal_memberships','clinic_portal_capabilities','clinic_batches','clinic_batch_commands','clinic_batch_files','clinic_original_accesses','clinic_portal_audit']loop
 execute format('alter table public.%I enable row level security',t);execute format('revoke all on public.%I from public,anon,authenticated,service_role',t);
 end loop;
 for r in select p.oid::regprocedure sig from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'and(p.proname like '\_clinic\_portal\_%'escape'\'or p.proname in('clinic_portal_identity','clinic_batches_page','clinic_batch_read','clinic_batch_command','clinic_batch_refresh','clinic_upload_target','clinic_upload_finalize','clinic_upload_execution_end','clinic_upload_cleanup','clinic_original_access','clinic_original_target'))loop
 execute format('revoke all on function %s from public,anon,authenticated,service_role',r.sig);
 end loop;
end$$;
grant execute on function public.clinic_portal_identity(uuid),public.clinic_batches_page(uuid,text,integer),public.clinic_batch_read(uuid,uuid,text,integer),public.clinic_batch_command(jsonb),public.clinic_batch_refresh(uuid,uuid,jsonb),public.clinic_original_access(uuid)to authenticated;
grant execute on function public.clinic_upload_target(uuid,uuid,uuid),public.clinic_upload_finalize(uuid,uuid,text,bigint),public.clinic_upload_execution_end(uuid,uuid,jsonb),public.clinic_upload_cleanup(uuid),public.clinic_original_target(uuid)to service_role;
-- Supabase default privileges include identity sequences; table RLS does not protect setval.
revoke all on sequence public.clinic_portal_audit_id_seq from public,anon,authenticated,service_role;
