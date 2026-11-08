-- WP-11 (quality review items 13, 32 and 46): clinic portal uploads, cleanup of retired uploads and
-- the member list for manual lab-result linking. Item 46 was checked against #272 (merged): #272
-- paginated the Members page and its search; the lab-result member picker was not changed there.
--
-- 1. Item 13: a reservation for a PDF whose fingerprint matches a file already stored in the batch is
--    refused as 'duplicate' with that file's id, whatever page the browser read. clinic_batch_command
--    is copied unchanged from 20261016054000_clinic_portal_persistence.sql except for that refusal.
--    The browser already compared fingerprints, but only against the first page of the batch.
create or replace function public.clinic_batch_command(p_command jsonb)returns jsonb language plpgsql security definer set search_path=''as $$declare p jsonb;b public.clinic_batches;m public.clinic_portal_memberships;cmd public.clinic_batch_commands;r uuid;c uuid;bid uuid;sid uuid;result jsonb;fid uuid;dup uuid;begin
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
 -- WP-11 item 13: the same PDF already stored in this batch is refused with the stored file's id.
 select id into dup from public.clinic_batch_files where batch_id=bid and state='stored'and expected_sha256=p->>'fingerprint'order by created_at,id limit 1;
 if dup is not null then return jsonb_build_object('status','rejected','submissionId',r,'reason','duplicate','fileId',dup,'noWrite',true);end if;
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

-- 2. Item 32: retired reservations are marked cleanup='pending' (clinic_batch_refresh) but nothing
--    removed their originals or completed the cleanup. The service cleanup run lists them here,
--    removes any stored object, then calls clinic_upload_cleanup, which keeps its guards (retired,
--    no active upload, object gone). An upload still marked active stays pending.
create function public.clinic_upload_cleanup_pending(p_limit integer default 100)returns jsonb
language plpgsql stable security definer set search_path=''as $$begin
 if auth.role()is distinct from 'service_role'then raise insufficient_privilege;end if;
 if p_limit is null or p_limit not between 1 and 200 then raise invalid_parameter_value;end if;
 return(select coalesce(jsonb_agg(jsonb_build_object('fileId',f.id,'bucket','clinic-originals','objectKey',f.object_key)order by f.created_at,f.id),'[]'::jsonb)
  from(select * from public.clinic_batch_files where state='retired'and cleanup='pending'and execution<>'active'order by created_at,id limit p_limit)f);
end$$;
revoke all on function public.clinic_upload_cleanup_pending(integer)from public,anon,authenticated,service_role;
grant execute on function public.clinic_upload_cleanup_pending(integer)to service_role;

-- 3. Item 46: the member list for manual linking held at most 300 members (the nearest booking per
--    member, newest first), so an older member could not be picked when AI reading failed. Same rows
--    and order as clinic_portal_lab_results, up to 1000, and 'capped' says when more exist. A separate
--    function keeps clinic_portal_lab_results' released shape (its schema allows 300).
create function public.clinic_portal_lab_members(p_clinic uuid)returns jsonb
language plpgsql security definer set search_path=''as $$
declare m public.clinic_portal_memberships;total bigint;
begin
 perform set_config('lock_timeout','1500ms',true);
 m:=public._clinic_portal_user(p_clinic);
 if not public._clinic_result_enabled()then return jsonb_build_object('version','clinic-lab-members-v1','enabled',false,'members','[]'::jsonb,'capped',false);end if;
 select count(distinct member_id)into total from public._lab_clinic_bookings(p_clinic);
 return jsonb_build_object('version','clinic-lab-members-v1','enabled',true,'capped',total>1000,
  'members',coalesce((select jsonb_agg(jsonb_build_object('memberId',x.member_id,'name',coalesce(nullif(btrim(p.display_name),''),''),'birthDate',p.birth_date,'bookingAt',x.starts_at)
    order by lower(coalesce(p.display_name,'')),x.member_id)
   from(select * from(select distinct on(member_id)member_id,starts_at from public._lab_clinic_bookings(p_clinic)order by member_id,abs(extract(epoch from starts_at-clock_timestamp())))y
    order by starts_at desc limit 1000)x
   join public.profiles p on p.id=x.member_id),'[]'));
end$$;
revoke all on function public.clinic_portal_lab_members(uuid)from public,anon,authenticated,service_role;
grant execute on function public.clinic_portal_lab_members(uuid)to authenticated;
