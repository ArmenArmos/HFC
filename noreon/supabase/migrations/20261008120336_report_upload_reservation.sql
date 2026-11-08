alter table public.patient_reports add column storage_purged_at timestamptz;
create function public.reserve_report_upload(p_owner uuid,p_name text,p_mime text,p_size integer,p_consent text) returns uuid
language plpgsql security definer set search_path=public as $$
declare new_id uuid:=gen_random_uuid(); used integer;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_owner::text,78612));
 select count(*) into used from public.patient_reports where user_id=p_owner and created_at>now()-interval '24 hours';
 if used>=10 then raise exception 'daily_limit'; end if;
 if length(p_name)>180 or length(p_consent)>100 then raise exception 'invalid'; end if;
 insert into public.patient_reports(id,user_id,object_path,file_name,mime,size_bytes,consent_version)
 values(new_id,p_owner,p_owner::text||'/'||new_id::text||'/original',p_name,p_mime,p_size,p_consent);
 return new_id;
end $$;
revoke all on function public.reserve_report_upload(uuid,text,text,integer,text) from public,anon,authenticated;
grant execute on function public.reserve_report_upload(uuid,text,text,integer,text) to service_role;
