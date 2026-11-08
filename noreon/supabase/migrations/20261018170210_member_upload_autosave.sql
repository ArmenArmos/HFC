-- Member uploads: values the reader found are saved automatically (Khikar, 18 Oct 18:26, after his live
-- test of #278: "Do I have to press save? Can it be automatic? People will get confused.").
--
-- Changes the #278 design (20261018120200_member_upload_ai.sql), where nothing was saved until the member
-- confirmed every value. Now, by owner decision:
--  - When a reading finishes and the sheet is the member's (identity 'match' or 'unknown'), every value is
--    kept as "read by AI, not confirmed by you" (member_status stays 'pending'), and values of a charted
--    measure are added to member_reported_values with source 'ai_read'.
--  - When the name or date of birth clearly differs ('mismatch'), nothing is saved until the member answers
--    "Is this yours?": 'mine' saves as above, 'not_mine' removes every value.
--  - The member can edit afterwards: a correction keeps the AI reading and sets source 'member_corrected';
--    a removal deletes the charted value. Every edit is logged (member_upload_ai_edits).
-- Member-reported values feed no clinical rule. The doctor's view shows each value's provenance.
-- The whole-reading confirmation (member_upload_ai_confirm) is replaced by the functions below and dropped.

-- 1. Sources ------------------------------------------------------------------------------------------------------
alter table public.member_reported_values drop constraint member_reported_values_source_check;
alter table public.member_reported_values add constraint member_reported_values_source_check check(source in('member-reported','ai_confirmed','ai_read','member_corrected'));
alter table public.member_reported_values drop constraint member_reported_values_ai_link;
alter table public.member_reported_values add constraint member_reported_values_ai_link check((source='member-reported')=(ai_value_id is null));

-- 2. A member's answers may change: a correction can be corrected again; a removal is final -----------------------
create or replace function public._member_upload_ai_values_guard()returns trigger language plpgsql set search_path=''as $$
begin
 if tg_op='DELETE'then raise exception using errcode='55000',message='AI-read values are kept';end if;
 if tg_op='INSERT'then
  if new.member_status<>'pending'or new.member_value is not null or new.member_reviewed_at is not null then
   raise exception using errcode='42501',message='AI-read values start pending';end if;
  return new;
 end if;
 if(new.id,new.job_id,new.member_id,new.document_id,new.seq,new.source,new.test_name,new.catalogue_ref,new.value_text,new.value,new.unit,new.ref_low,new.ref_high,new.ref_text,
   new.lab_flag,new.collected_on,new.lab_name,new.page,new.snippet,new.checks,new.attention,new.attention_rule,new.measure,new.measure_unit,new.created_at)
  is distinct from(old.id,old.job_id,old.member_id,old.document_id,old.seq,old.source,old.test_name,old.catalogue_ref,old.value_text,old.value,old.unit,old.ref_low,old.ref_high,old.ref_text,
   old.lab_flag,old.collected_on,old.lab_name,old.page,old.snippet,old.checks,old.attention,old.attention_rule,old.measure,old.measure_unit,old.created_at)then
  raise exception using errcode='55000',message='The AI reading is kept as it was';end if;
 if old.member_status='rejected'then raise exception using errcode='55000',message='A removed value stays removed';end if;
 if new.member_status='pending'and old.member_status<>'pending'then raise exception using errcode='55000',message='A member answer is not undone';end if;
 if new.member_status<>'pending'and(auth.uid()is null or auth.uid()is distinct from new.member_id)then
  raise exception using errcode='42501',message='Only the member answers for their upload';end if;
 return new;
end$$;

-- 3. Edit log (append-only) ------------------------------------------------------------------------------------------
create table public.member_upload_ai_edits(
 id bigint generated always as identity primary key,
 submission_id uuid not null,
 job_id uuid not null references public.lab_ai_jobs(id),
 value_id uuid not null references public.member_upload_ai_values(id),
 member_id uuid not null references auth.users(id),
 action text not null check(action in('correct','remove')),
 before jsonb not null,
 after jsonb not null,
 created_at timestamptz not null default clock_timestamp(),
 unique(submission_id,value_id)
);
create index member_upload_ai_edits_job on public.member_upload_ai_edits(job_id,created_at);
create trigger member_upload_ai_edits_immutable before update or delete on public.member_upload_ai_edits for each row execute function public._audit_immutable();
alter table public.member_upload_ai_edits enable row level security;
revoke all on public.member_upload_ai_edits from public,anon,authenticated,service_role;

-- 4. Save a reading: every value kept, charted measures added (source ai_read), one record per reading -----------
-- The date is the value's own, else the sheet's sample date, else the date the member gave for the file; a
-- charted value with no date, out of range or over the 500-value limit is kept but not charted.
create function public._member_upload_ai_save(p_job uuid,p_answer text,p_submission uuid)returns jsonb
language plpgsql security definer set search_path=''as $$
declare j public.lab_ai_jobs;md public.member_reported_documents;v public.member_upload_ai_values;sample date;day date;saved int:=0;charted int:=0;
begin
 select * into j from public.lab_ai_jobs where id=p_job and kind='member_upload'for update;
 select * into md from public.member_reported_documents where id=j.member_document_id;
 begin sample:=(j.identity->>'sampleDate')::date;exception when others then sample:=null;end;
 for v in select * from public.member_upload_ai_values where job_id=j.id and member_status<>'rejected'order by seq loop
  saved:=saved+1;
  day:=coalesce(v.collected_on,sample,md.result_date);
  if v.measure is not null and v.value is not null and day is not null then
   begin
    insert into public.member_reported_values(user_id,source,ai_value_id,measure,value,value2,unit,measured_on)
     values(j.member_id,'ai_read',v.id,v.measure,v.value,null,v.measure_unit,day);
    charted:=charted+1;
   exception when check_violation or unique_violation then null;
   end;
  end if;
 end loop;
 insert into public.member_upload_ai_confirmations(job_id,member_id,submission_id,identity_status,identity_answer,measured_on,values_saved,values_charted)
  values(j.id,j.member_id,coalesce(p_submission,gen_random_uuid()),j.identity_status,p_answer,null,saved,charted);
 return jsonb_build_object('saved',saved,'charted',charted);
end$$;

-- When a member reading finishes on the member's own sheet, save it. Runs in the worker's finish transaction.
create function public._lab_ai_member_upload_autosave()returns trigger language plpgsql security definer set search_path=''as $$
begin
 if new.identity_status in('match','unknown')and exists(select 1 from public.member_upload_ai_values where job_id=new.id)
  and not exists(select 1 from public.member_upload_ai_confirmations where job_id=new.id)then
  perform public._member_upload_ai_save(new.id,null,null);
 end if;
 return null;
end$$;
create trigger lab_ai_jobs_member_upload_autosave after update of state on public.lab_ai_jobs for each row
 when(new.kind='member_upload'and new.state='done'and old.state is distinct from 'done')execute function public._lab_ai_member_upload_autosave();

-- Readings that finished under #278 and were never confirmed are saved now, as if they had just finished
-- (Codex F1). A mismatch still waits for the member; answered readings are left as they are.
create function public._member_upload_ai_backfill()returns integer language plpgsql security definer set search_path=''as $$
declare j record;n int:=0;
begin
 for j in select x.id from public.lab_ai_jobs x join public.member_reported_documents d on d.id=x.member_document_id
  where x.kind='member_upload'and x.state='done'and x.identity_status in('match','unknown')and d.deleted_at is null
   and exists(select 1 from public.member_upload_ai_values v where v.job_id=x.id)
   and not exists(select 1 from public.member_upload_ai_confirmations c where c.job_id=x.id)loop
  perform public._member_upload_ai_save(j.id,null,null);n:=n+1;
 end loop;
 return n;
end$$;
select public._member_upload_ai_backfill();

-- 5. Member: "Is this yours?" after a mismatch ------------------------------------------------------------------------
create function public.member_upload_ai_identity(p_command jsonb)returns jsonb
language plpgsql security definer set search_path=''as $$
declare uid uuid:=auth.uid();sub uuid;jid uuid;ans text;j public.lab_ai_jobs;prior public.member_upload_ai_confirmations;md public.member_reported_documents;r jsonb;
begin
 perform set_config('lock_timeout','1500ms',true);
 if uid is null then raise insufficient_privilege;end if;
 if jsonb_typeof(p_command)is distinct from 'object'or p_command-array['version','submissionId','jobId','answer']<>'{}'or not(p_command?&array['version','submissionId','jobId','answer'])
  or p_command->>'version'is distinct from 'member-upload-identity-v1'or p_command->>'answer'not in('mine','not_mine')then return jsonb_build_object('status','invalid');end if;
 begin sub:=(p_command->>'submissionId')::uuid;jid:=(p_command->>'jobId')::uuid;exception when invalid_text_representation then return jsonb_build_object('status','invalid');end;
 ans:=p_command->>'answer';
 if not public._lab_ai_member_upload_enabled()then return jsonb_build_object('status','disabled');end if;
 select * into prior from public.member_upload_ai_confirmations where submission_id=sub;
 if found then
  if prior.job_id<>jid or prior.member_id<>uid then return jsonb_build_object('status','stale');end if;
  return jsonb_build_object('status','saved','replayed',true,'saved',prior.values_saved,'charted',prior.values_charted);
 end if;
 select * into j from public.lab_ai_jobs where id=jid and kind='member_upload'and member_id=uid for update;
 if not found then return jsonb_build_object('status','stale');end if;
 select * into md from public.member_reported_documents where id=j.member_document_id;
 if j.state<>'done'or md.deleted_at is not null or j.identity_status is distinct from 'mismatch'then return jsonb_build_object('status','stale');end if;
 if exists(select 1 from public.member_upload_ai_confirmations where job_id=j.id)then return jsonb_build_object('status','unchanged');end if;
 if ans='not_mine'then
  update public.member_upload_ai_values set member_status='rejected',member_reviewed_at=clock_timestamp()where job_id=j.id and member_status='pending';
  insert into public.member_upload_ai_confirmations(job_id,member_id,submission_id,identity_status,identity_answer,measured_on,values_saved,values_charted)
   values(j.id,uid,sub,j.identity_status,'not_mine',null,0,0);
  return jsonb_build_object('status','saved','replayed',false,'saved',0,'charted',0);
 end if;
 r:=public._member_upload_ai_save(j.id,'mine',sub);
 return jsonb_build_object('status','saved','replayed',false,'saved',(r->>'saved')::int,'charted',(r->>'charted')::int);
exception when lock_not_available then return jsonb_build_object('status','unavailable');
end$$;

-- 6. Member: correct or remove saved values -------------------------------------------------------------------------
-- Only after the reading was saved (and not answered "not mine"). A correction keeps the AI reading and updates
-- or adds the charted value as 'member_corrected'; a removal deletes it. measuredOn dates a corrected value that
-- has no date of its own. Resending the same submission returns its recorded outcome.
create function public.member_upload_ai_edit(p_command jsonb)returns jsonb
language plpgsql security definer set search_path=''as $$
declare uid uuid:=auth.uid();sub uuid;jid uuid;day date;sample date;j public.lab_ai_jobs;md public.member_reported_documents;c public.member_upload_ai_confirmations;
 x jsonb;v public.member_upload_ai_values;nv numeric;before_v jsonb;rv public.member_reported_values;n int:=0;
begin
 perform set_config('lock_timeout','1500ms',true);
 if uid is null then raise insufficient_privilege;end if;
 if jsonb_typeof(p_command)is distinct from 'object'or p_command-array['version','submissionId','jobId','measuredOn','edits']<>'{}'
  or not(p_command?&array['version','submissionId','jobId','edits'])or p_command->>'version'is distinct from 'member-upload-edit-v1'
  or jsonb_typeof(p_command->'edits')is distinct from 'array'or jsonb_array_length(p_command->'edits')not between 1 and 200 then return jsonb_build_object('status','invalid');end if;
 begin sub:=(p_command->>'submissionId')::uuid;jid:=(p_command->>'jobId')::uuid;day:=(p_command->>'measuredOn')::date;
 exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow then return jsonb_build_object('status','invalid');end;
 if day is not null and(day<date '1950-01-01'or day>(clock_timestamp()at time zone 'Asia/Yerevan')::date)then return jsonb_build_object('status','invalid');end if;
 if not public._lab_ai_member_upload_enabled()then return jsonb_build_object('status','disabled');end if;
 if exists(select 1 from public.member_upload_ai_edits where submission_id=sub)then
  if exists(select 1 from public.member_upload_ai_edits where submission_id=sub and(job_id<>jid or member_id<>uid))then return jsonb_build_object('status','stale');end if;
  return jsonb_build_object('status','saved','replayed',true);
 end if;
 select * into j from public.lab_ai_jobs where id=jid and kind='member_upload'and member_id=uid for update;
 if not found then return jsonb_build_object('status','stale');end if;
 select * into md from public.member_reported_documents where id=j.member_document_id;
 select * into c from public.member_upload_ai_confirmations where job_id=j.id;
 if j.state<>'done'or md.deleted_at is not null or c.job_id is null or c.identity_answer is not distinct from 'not_mine'then return jsonb_build_object('status','stale');end if;
 begin sample:=(j.identity->>'sampleDate')::date;exception when others then sample:=null;end;
 begin
  for x in select * from jsonb_array_elements(p_command->'edits')loop
   if jsonb_typeof(x)<>'object'or x-array['valueId','action','value']<>'{}'or x->>'action'not in('correct','remove')
    or(x->>'action'='correct')<>(x ? 'value')or(x ? 'value'and jsonb_typeof(x->'value')<>'number')then raise invalid_parameter_value;end if;
   select * into v from public.member_upload_ai_values where id=(x->>'valueId')::uuid and job_id=j.id for update;
   if not found or v.member_status='rejected'then raise invalid_parameter_value;end if;
   select * into rv from public.member_reported_values where ai_value_id=v.id;
   before_v:=jsonb_build_object('memberStatus',v.member_status,'memberValue',v.member_value,'charted',rv.id is not null,'chartedValue',rv.value,'source',rv.source);
   if x->>'action'='remove'then
    update public.member_upload_ai_values set member_status='rejected',member_value=null,member_reviewed_at=clock_timestamp()where id=v.id;
    delete from public.member_reported_values where ai_value_id=v.id;
    rv:=null;
   else
    nv:=(x->>'value')::numeric;
    if nv<=-1e9 or nv>=1e9 then raise invalid_parameter_value;end if;
    update public.member_upload_ai_values set member_status='corrected',member_value=nv,member_reviewed_at=clock_timestamp()where id=v.id;
    if rv.id is not null then
     update public.member_reported_values set value=nv,source='member_corrected'where id=rv.id returning * into rv;
    elsif v.measure is not null and coalesce(v.collected_on,sample,md.result_date,day)is not null then
     insert into public.member_reported_values(user_id,source,ai_value_id,measure,value,value2,unit,measured_on)
      values(uid,'member_corrected',v.id,v.measure,nv,null,v.measure_unit,coalesce(v.collected_on,sample,md.result_date,day))returning * into rv;
    end if;
   end if;
   insert into public.member_upload_ai_edits(submission_id,job_id,value_id,member_id,action,before,after)
    values(sub,j.id,v.id,uid,x->>'action',before_v,jsonb_build_object('memberStatus',case x->>'action'when 'remove'then 'rejected'else 'corrected'end,'memberValue',nv,
     'charted',rv.id is not null,'chartedValue',rv.value,'source',rv.source));
   n:=n+1;nv:=null;
  end loop;
 exception when check_violation or invalid_parameter_value or invalid_text_representation or numeric_value_out_of_range or unique_violation then
  return jsonb_build_object('status','invalid');
 end;
 return jsonb_build_object('status','saved','replayed',false,'edited',n);
exception when lock_not_available then return jsonb_build_object('status','unavailable');
end$$;

-- 7. Member read: each value's chart state and source --------------------------------------------------------------
create or replace function public.member_upload_ai_read(p_document uuid)returns jsonb
language plpgsql stable security definer set search_path=''as $$
declare d public.member_reported_documents;j public.lab_ai_jobs;
begin
 if auth.uid()is null then raise insufficient_privilege;end if;
 if not public._lab_ai_member_upload_enabled()then return jsonb_build_object('version','member-upload-ai-read-v1','enabled',false);end if;
 select * into d from public.member_reported_documents where id=p_document and user_id=auth.uid()and deleted_at is null;
 if not found then return jsonb_build_object('version','member-upload-ai-read-v1','enabled',true,'found',false);end if;
 select * into j from public.lab_ai_jobs where kind='member_upload'and member_document_id=d.id;
 return jsonb_build_object('version','member-upload-ai-read-v1','enabled',true,'found',true,'documentId',d.id,'fileName',d.file_name,'resultDate',d.result_date,
  'job',case when j.id is null then null else public._member_upload_ai_job_json(j)end,
  'values',coalesce((select jsonb_agg(jsonb_build_object('valueId',v.id,'seq',v.seq,'testName',v.test_name,'catalogueRef',v.catalogue_ref,'valueText',v.value_text,'value',v.value,'unit',v.unit,
    'collectedOn',v.collected_on,'measure',v.measure,'measureUnit',v.measure_unit,'checks',to_jsonb(v.checks),'memberStatus',v.member_status,'memberValue',v.member_value,
    'chartedSource',(select r.source from public.member_reported_values r where r.ai_value_id=v.id))order by v.seq)
   from public.member_upload_ai_values v where v.job_id=j.id),'[]'));
end$$;

-- 8. Removing an AI-read value from "Values you added" is the same audited removal as in Edit (Codex F2):
--    the AI value becomes 'rejected' (final), the removal is logged, and the charted row goes. Hand-entered
--    values are deleted as before.
create or replace function public.member_reported_value_remove(p_id uuid)returns boolean
language plpgsql security definer set search_path=''as $$
declare r public.member_reported_values;v public.member_upload_ai_values;
begin
 if auth.uid() is null then raise insufficient_privilege;end if;
 -- Same lock order as member_upload_ai_edit: the reading's job, then the AI value, then the chart row (Codex F3).
 select * into r from public.member_reported_values where id=p_id and user_id=auth.uid();
 if not found then return false;end if;
 if r.ai_value_id is not null then
  perform 1 from public.lab_ai_jobs j where j.id=(select x.job_id from public.member_upload_ai_values x where x.id=r.ai_value_id)for update;
  select * into v from public.member_upload_ai_values where id=r.ai_value_id for update;
 end if;
 select * into r from public.member_reported_values where id=p_id and user_id=auth.uid()for update;
 if not found then return false;end if;
 if r.ai_value_id is not null then
  if v.member_status<>'rejected'then
   update public.member_upload_ai_values set member_status='rejected',member_value=null,member_reviewed_at=clock_timestamp()where id=v.id;
   insert into public.member_upload_ai_edits(submission_id,job_id,value_id,member_id,action,before,after)
    values(gen_random_uuid(),v.job_id,v.id,auth.uid(),'remove',
     jsonb_build_object('memberStatus',v.member_status,'memberValue',v.member_value,'charted',true,'chartedValue',r.value,'source',r.source),
     jsonb_build_object('memberStatus','rejected','memberValue',null,'charted',false,'chartedValue',null,'source',null,'via','values_list'));
  end if;
 end if;
 delete from public.member_reported_values where id=r.id;
 return true;
end$$;

-- 9. Grants; the whole-reading confirmation is gone ---------------------------------------------------------------
drop function public.member_upload_ai_confirm(jsonb);
revoke all on function public._member_upload_ai_save(uuid,text,uuid),public._lab_ai_member_upload_autosave(),public._member_upload_ai_backfill(),public.member_upload_ai_identity(jsonb),public.member_upload_ai_edit(jsonb)
 from public,anon,authenticated,service_role;
grant execute on function public.member_upload_ai_identity(jsonb),public.member_upload_ai_edit(jsonb)to authenticated;
