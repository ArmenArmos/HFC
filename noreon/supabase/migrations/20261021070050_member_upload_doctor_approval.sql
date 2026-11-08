-- Member uploads: the assigned doctor approves AI-read values before the member sees them
-- (Armen, clinical lead, 20 Oct 2026; LEAD_DECISIONS "20 Oct 22:15").
--
-- Changes the #278 / autosave design (20261018120200, 20261018170210), where values read from a member's own
-- earlier result were shown to the member as soon as the reading finished:
--  - The reading, the member's "Is this yours?" answer and the automatic save stay as they are. The saved values
--    (member_reported_values rows with an ai_value_id) are now hidden from the member by RLS until the assigned
--    doctor approves that reading. The doctor and administrators still read them, labelled by provenance.
--  - The assigned active doctor, in an admitted staff session and with care access, approves one reading: every
--    value is kept, corrected or removed, and a short interpretation in plain words (hy, en) is written for the
--    member. The approval is append-only (who, when, what changed against the AI reading and the previous
--    approval); approving again makes a new version. Charted values take the approved value (source
--    'doctor_approved'); removed values leave the member's charts.
--  - The member sees approved values and the interpretation, marked as checked by their doctor
--    (member_upload_results). Before approval the member sees the file and "Waiting for your doctor to check".
--  - Member corrections of AI-read values are closed while approval is required, and on any approved reading in
--    either mode: the doctor's value stands (Astra R-01).
--
-- One switch falls back to the previous behaviour: lab_ai_capabilities.member_upload_doctor_approval (default true).
-- With it off, saved values of readings nobody approved show to the member at once, as before, and the member may
-- correct them. Approvals already made stay in force in both modes, so switching back and forth never shows a
-- number the doctor did not approve on an approved reading.
-- Nothing here feeds a clinical rule. No value or text is written to any log.

-- 1. Switch ---------------------------------------------------------------------------------------------------
alter table public.lab_ai_capabilities add column member_upload_doctor_approval boolean not null default true;
create function public._member_upload_approval_required()returns boolean language sql stable security definer set search_path=''as $$
 select coalesce((select member_upload_doctor_approval from public.lab_ai_capabilities where singleton),true)
$$;

-- 2. Approvals (append-only) ---------------------------------------------------------------------------------
create table public.member_upload_doctor_approvals(
 id uuid primary key default gen_random_uuid(),
 job_id uuid not null references public.lab_ai_jobs(id),
 member_id uuid not null references auth.users(id),
 document_id uuid not null references public.member_reported_documents(id),
 doctor_id uuid not null references auth.users(id),
 submission_id uuid not null unique,
 version smallint not null check(version between 1 and 100),
 interpretation_hy text not null check(length(interpretation_hy)between 1 and 2000),
 interpretation_en text not null check(length(interpretation_en)between 1 and 1500),
 -- Whether the doctor changed the prepared draft (reported by the app), and what changed against the AI reading
 -- and the previous version: [{valueId,action,ai,before,after}] plus the interpretation flag.
 interpretation_edited boolean not null,
 changes jsonb not null check(jsonb_typeof(changes)='object'),
 created_at timestamptz not null default clock_timestamp(),
 unique(job_id,version)
);
create index member_upload_doctor_approvals_member on public.member_upload_doctor_approvals(member_id,job_id,version desc);
create trigger member_upload_doctor_approvals_immutable before update or delete on public.member_upload_doctor_approvals for each row execute function public._audit_immutable();

create table public.member_upload_approved_values(
 approval_id uuid not null references public.member_upload_doctor_approvals(id),
 value_id uuid not null references public.member_upload_ai_values(id),
 job_id uuid not null references public.lab_ai_jobs(id),
 action text not null check(action in('kept','corrected','removed')),
 value numeric check(value is null or(value>-1e9 and value<1e9)),
 primary key(approval_id,value_id),
 check(action<>'corrected'or value is not null),
 check(action<>'removed'or value is null)
);
create index member_upload_approved_values_value on public.member_upload_approved_values(value_id);
create trigger member_upload_approved_values_immutable before update or delete on public.member_upload_approved_values for each row execute function public._audit_immutable();

alter table public.member_upload_doctor_approvals enable row level security;
alter table public.member_upload_approved_values enable row level security;
revoke all on public.member_upload_doctor_approvals,public.member_upload_approved_values from public,anon,authenticated,service_role;

create function public._member_upload_current_approval(p_job uuid)returns public.member_upload_doctor_approvals
language sql stable security definer set search_path=''as $$
 select * from public.member_upload_doctor_approvals where job_id=p_job order by version desc limit 1
$$;

-- 3. What the member sees of their saved values ----------------------------------------------------------------
-- A charted value read from an upload shows to the member only as the doctor-approved row (source
-- 'doctor_approved') that the reading's current approval keeps, or, when approval is not required, as before.
-- Hand-entered values are as before. Direct table reads are the member's own only (20261020195207); staff read
-- every row, with its source, through staff_member_history.
create function public._member_upload_value_member_visible(p_value uuid,p_source text)returns boolean
language sql stable security definer set search_path=''as $$
 select not public._member_upload_approval_required()or(p_source='doctor_approved'and exists(select 1 from public.member_upload_ai_values v
  join public.member_upload_approved_values a on a.value_id=v.id and a.action<>'removed'
  where v.id=p_value and a.approval_id=(public._member_upload_current_approval(v.job_id)).id))
$$;
alter table public.member_reported_values drop constraint member_reported_values_source_check;
alter table public.member_reported_values add constraint member_reported_values_source_check check(source in('member-reported','ai_confirmed','ai_read','member_corrected','doctor_approved'));
alter policy member_reported_values_read on public.member_reported_values
 using(user_id=(select auth.uid())and(ai_value_id is null or public._member_upload_value_member_visible(ai_value_id,source)));

-- The reading's state for the member: not required, waiting for the doctor, or approved (and when).
create or replace function public._member_upload_ai_job_json(j public.lab_ai_jobs)returns jsonb language sql stable security definer set search_path=''as $$
 select jsonb_build_object('jobId',j.id,'state',j.state,'outcome',j.outcome,'createdAt',j.created_at,'finishedAt',j.finished_at,'identityStatus',j.identity_status,
  'sampleDate',j.identity->>'sampleDate',
  'confirmation',(select jsonb_build_object('identityAnswer',c.identity_answer,'valuesSaved',c.values_saved,'valuesCharted',c.values_charted,'measuredOn',c.measured_on,'at',c.created_at)
   from public.member_upload_ai_confirmations c where c.job_id=j.id),
  'valueCount',(select count(*)from public.member_upload_ai_values v where v.job_id=j.id),
  'review',(select case when a.id is not null then jsonb_build_object('state','approved','approvedAt',a.created_at)
   when public._member_upload_approval_required()then jsonb_build_object('state','waiting','approvedAt',null)
   else jsonb_build_object('state','not_required','approvedAt',null)end
   from(select(public._member_upload_current_approval(j.id)).*)a))
$$;

-- The member's own reading: while approval is required, values only once approved, and then the approved ones.
create or replace function public.member_upload_ai_read(p_document uuid)returns jsonb
language plpgsql stable security definer set search_path=''as $$
declare d public.member_reported_documents;j public.lab_ai_jobs;a public.member_upload_doctor_approvals;req boolean;
begin
 if auth.uid()is null then raise insufficient_privilege;end if;
 if not public._lab_ai_member_upload_enabled()then return jsonb_build_object('version','member-upload-ai-read-v1','enabled',false);end if;
 select * into d from public.member_reported_documents where id=p_document and user_id=auth.uid()and deleted_at is null;
 if not found then return jsonb_build_object('version','member-upload-ai-read-v1','enabled',true,'found',false);end if;
 select * into j from public.lab_ai_jobs where kind='member_upload'and member_document_id=d.id;
 req:=public._member_upload_approval_required();
 if j.id is not null then a:=public._member_upload_current_approval(j.id);end if;
 return jsonb_build_object('version','member-upload-ai-read-v1','enabled',true,'found',true,'documentId',d.id,'fileName',d.file_name,'resultDate',d.result_date,
  'job',case when j.id is null then null else public._member_upload_ai_job_json(j)end,
  'values',case when req and a.id is null then '[]'::jsonb else coalesce((select jsonb_agg(jsonb_build_object('valueId',v.id,'seq',v.seq,'testName',v.test_name,'catalogueRef',v.catalogue_ref,
    'valueText',case when av.action='corrected'then av.value::text else v.value_text end,'value',case when av.action='corrected'then av.value else v.value end,'unit',v.unit,
    'collectedOn',v.collected_on,'measure',v.measure,'measureUnit',v.measure_unit,'checks',to_jsonb(v.checks),'memberStatus',v.member_status,
    'memberValue',case when a.id is null then v.member_value end,
    'chartedSource',(select r.source from public.member_reported_values r where r.ai_value_id=v.id))order by v.seq)
   from public.member_upload_ai_values v left join public.member_upload_approved_values av on av.approval_id=a.id and av.value_id=v.id
   where v.job_id=j.id and(a.id is null or(av.action in('kept','corrected')and v.member_status<>'rejected'))),'[]')end);
end$$;

-- 4. Member corrections close while approval is required, and on an approved reading in either mode (Astra R-01)
--    (body otherwise unchanged from 20261018170210) -----------------------------------------------------------------
create or replace function public.member_upload_ai_edit(p_command jsonb)returns jsonb
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
 if not public._lab_ai_member_upload_enabled()or public._member_upload_approval_required()then return jsonb_build_object('status','disabled');end if;
 if exists(select 1 from public.member_upload_ai_edits where submission_id=sub)then
  if exists(select 1 from public.member_upload_ai_edits where submission_id=sub and(job_id<>jid or member_id<>uid))then return jsonb_build_object('status','stale');end if;
  return jsonb_build_object('status','saved','replayed',true);
 end if;
 select * into j from public.lab_ai_jobs where id=jid and kind='member_upload'and member_id=uid for update;
 if not found then return jsonb_build_object('status','stale');end if;
 select * into md from public.member_reported_documents where id=j.member_document_id;
 select * into c from public.member_upload_ai_confirmations where job_id=j.id;
 if j.state<>'done'or md.deleted_at is not null or c.job_id is null or c.identity_answer is not distinct from 'not_mine'then return jsonb_build_object('status','stale');end if;
 if exists(select 1 from public.member_upload_doctor_approvals a where a.job_id=j.id)then return jsonb_build_object('status','disabled');end if;
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


-- 5. Doctor: approve one reading -------------------------------------------------------------------------------
-- Command: {version:'member-upload-approve-v1', submissionId, memberId, jobId, basedOn (the version the doctor saw,
-- null for none), values:[{valueId, action:'keep'|'correct'|'remove', value?}] covering every value the member has not
-- removed, once each, interpretationHy, interpretationEn, interpretationEdited}. Only the assigned active doctor with
-- care access, in an admitted staff session; administrators, other doctors, nurses and members are refused (42501).
-- Statuses: approved, invalid, stale (changed since the doctor read it, or another submission), not-ready (still
-- reading, removed, waiting for the member's identity answer, or not the member's), disabled, unavailable.
create function public.doctor_member_upload_approve(p_command jsonb)returns jsonb
language plpgsql security definer set search_path=''as $$
declare d uuid;m uuid;sub uuid;jid uuid;based int;j public.lab_ai_jobs;md public.member_reported_documents;c public.member_upload_ai_confirmations;
 prior public.member_upload_doctor_approvals;cur public.member_upload_doctor_approvals;ap uuid:=gen_random_uuid();ver int;hy text;en text;sample date;day date;
 x jsonb;v public.member_upload_ai_values;act text;stored text;nv numeric;shown numeric;prev public.member_upload_approved_values;
 rows jsonb:='[]';changes jsonb:='[]';total int;listed int;
begin
 perform set_config('lock_timeout','1500ms',true);
 if jsonb_typeof(p_command)is distinct from 'object'
  or p_command-array['version','submissionId','memberId','jobId','basedOn','values','interpretationHy','interpretationEn','interpretationEdited']<>'{}'
  or not(p_command?&array['version','submissionId','memberId','jobId','basedOn','values','interpretationHy','interpretationEn','interpretationEdited'])
  or p_command->>'version'is distinct from 'member-upload-approve-v1'or jsonb_typeof(p_command->'values')is distinct from 'array'
  or jsonb_array_length(p_command->'values')>200 or jsonb_typeof(p_command->'interpretationEdited')is distinct from 'boolean'
  or jsonb_typeof(p_command->'basedOn')not in('number','null')then return jsonb_build_object('status','invalid');end if;
 begin m:=(p_command->>'memberId')::uuid;sub:=(p_command->>'submissionId')::uuid;jid:=(p_command->>'jobId')::uuid;based:=(p_command->>'basedOn')::int;
 exception when invalid_text_representation or numeric_value_out_of_range then return jsonb_build_object('status','invalid');end;
 -- Control and direction characters out, spaces collapsed within lines (as the first doctor note).
 hy:=btrim(regexp_replace(regexp_replace(coalesce(p_command->>'interpretationHy',''),'[\u0000-\u0009\u000b-\u001f\u007f​-‏‪-‮⁦-⁩]',' ','g'),'[ ]+',' ','g'));
 en:=btrim(regexp_replace(regexp_replace(coalesce(p_command->>'interpretationEn',''),'[\u0000-\u0009\u000b-\u001f\u007f​-‏‪-‮⁦-⁩]',' ','g'),'[ ]+',' ','g'));
 if length(hy)not between 1 and 2000 or length(en)not between 1 and 1500 then return jsonb_build_object('status','invalid');end if;
 -- Lock the case, then check the assignment, session and care access against what is committed now, holding the
 -- doctor's staff and clinic rows until the insert (as doctor_first_note_approve, Astra FN-02).
 perform 1 from public.patient_clinical_cases where user_id=m for update;
 perform 1 from public.workspace_staff where user_id=auth.uid()for share;
 perform 1 from public.workspace_clinics k where k.id=(select clinic_id from public.workspace_staff where user_id=auth.uid())for share;
 d:=public._assigned_active_doctor(m);
 if not public._real_staff_managed_session_allowed(d)or not public.staff_care_access(m,d,true)then
  raise insufficient_privilege using message='Assigned doctor with care access required';end if;
 if not public._lab_ai_member_upload_enabled()then return jsonb_build_object('status','disabled');end if;
 select * into prior from public.member_upload_doctor_approvals where submission_id=sub;
 if found then return case when prior.member_id=m and prior.job_id=jid and prior.doctor_id=d then jsonb_build_object('status','approved','replayed',true,'version',prior.version)
  else jsonb_build_object('status','stale')end;end if;
 select * into j from public.lab_ai_jobs where id=jid and kind='member_upload'and member_id=m for update;
 if not found then return jsonb_build_object('status','stale');end if;
 select * into md from public.member_reported_documents where id=j.member_document_id;
 select * into c from public.member_upload_ai_confirmations where job_id=j.id;
 if j.state<>'done'or md.deleted_at is not null or c.job_id is null or c.identity_answer is not distinct from 'not_mine'then return jsonb_build_object('status','not-ready');end if;
 cur:=public._member_upload_current_approval(j.id);
 if cur.version is distinct from based then return jsonb_build_object('status','stale');end if;
 ver:=coalesce(cur.version,0)+1;
 -- Every value the member has not removed, once each.
 select count(*)into total from public.member_upload_ai_values where job_id=j.id and member_status<>'rejected';
 select count(distinct e->>'valueId')into listed from jsonb_array_elements(p_command->'values')e
  where jsonb_typeof(e)='object'and exists(select 1 from public.member_upload_ai_values w where w.job_id=j.id and w.member_status<>'rejected'and w.id::text=e->>'valueId');
 if total=0 or listed<>total or jsonb_array_length(p_command->'values')<>total then return jsonb_build_object('status','invalid');end if;
 -- Pass 1: what each value becomes, and what changed against what the doctor saw.
 for x in select * from jsonb_array_elements(p_command->'values')loop
  if x-array['valueId','action','value']<>'{}'or x->>'action'not in('keep','correct','remove')
   or(x->>'action'='correct')<>(x ? 'value')or(x ? 'value'and jsonb_typeof(x->'value')<>'number')then return jsonb_build_object('status','invalid');end if;
  act:=x->>'action';
  select * into v from public.member_upload_ai_values where id=(x->>'valueId')::uuid and job_id=j.id for update;
  -- What the doctor saw as the value: the previous approval's, else the member's correction, else the AI reading.
  prev:=null;
  if cur.id is not null then select * into prev from public.member_upload_approved_values where approval_id=cur.id and value_id=v.id;end if;
  shown:=case when prev.action='corrected'then prev.value when prev.action is null and v.member_status='corrected'then v.member_value else v.value end;
  begin nv:=case act when 'correct'then(x->>'value')::numeric when 'keep'then shown end;
  exception when numeric_value_out_of_range or invalid_text_representation then return jsonb_build_object('status','invalid');end;
  if act='correct'and(nv<=-1e9 or nv>=1e9)then return jsonb_build_object('status','invalid');end if;
  -- 'kept' means the AI reading as printed; anything else is stored as 'corrected' with its value.
  stored:=case when act='remove'then 'removed'when nv is not distinct from v.value then 'kept'else 'corrected'end;
  if stored='corrected'and nv is null then return jsonb_build_object('status','invalid');end if;
  rows:=rows||jsonb_build_array(jsonb_build_object('valueId',v.id,'action',stored,'value',case when stored='corrected'then nv end));
  if act<>'keep'or prev.action='removed'then
   changes:=changes||jsonb_build_array(jsonb_build_object('valueId',v.id,'action',act,'ai',v.value_text,
    'before',case when prev.action='removed'then null else shown end,'beforeRemoved',coalesce(prev.action='removed',false),'after',nv));
  end if;
 end loop;
 insert into public.member_upload_doctor_approvals(id,job_id,member_id,document_id,doctor_id,submission_id,version,interpretation_hy,interpretation_en,interpretation_edited,changes)
  values(ap,j.id,m,md.id,d,sub,ver,hy,en,(p_command->>'interpretationEdited')::boolean,
   jsonb_build_object('values',changes,'interpretationEdited',(p_command->>'interpretationEdited')::boolean,
    'interpretationChanged',cur.id is not null and(cur.interpretation_hy is distinct from hy or cur.interpretation_en is distinct from en),'previousVersion',cur.version));
 -- Pass 2: record each value and make the member's chart follow the approval.
 begin sample:=(j.identity->>'sampleDate')::date;exception when others then sample:=null;end;
 for x in select * from jsonb_array_elements(rows)loop
  insert into public.member_upload_approved_values(approval_id,value_id,job_id,action,value)values(ap,(x->>'valueId')::uuid,j.id,x->>'action',(x->>'value')::numeric);
  select * into v from public.member_upload_ai_values where id=(x->>'valueId')::uuid;
  nv:=case x->>'action'when 'kept'then v.value when 'corrected'then(x->>'value')::numeric end;
  day:=coalesce(v.collected_on,sample,md.result_date);
  if x->>'action'='removed'or nv is null then delete from public.member_reported_values where ai_value_id=v.id;
  elsif v.measure is not null then
   begin
    update public.member_reported_values set value=nv,source='doctor_approved'where ai_value_id=v.id;
    if not found and day is not null then
     insert into public.member_reported_values(user_id,source,ai_value_id,measure,value,value2,unit,measured_on)values(m,'doctor_approved',v.id,v.measure,nv,null,v.measure_unit,day);
    end if;
   exception when check_violation or unique_violation or numeric_value_out_of_range then
    -- Out of the chart's plausible range or precision, or over the member's limit: kept in the approval, not charted (Astra R-03).
    delete from public.member_reported_values where ai_value_id=v.id;
   end;
  end if;
 end loop;
 perform public._access_audit_record(m,'member_upload_approve',ap::text);
 return jsonb_build_object('status','approved','replayed',false,'version',ver);
exception when lock_not_available then return jsonb_build_object('status','unavailable');
end$$;

-- 6. Staff read: the current approval of each reading -----------------------------------------------------------
-- The assigned active doctor or an active administrator, each in a managed staff session (as staff_lab_ai_results
-- after 20261020195207). canApprove is true only for the assigned doctor with care access. Each read that returns is recorded.
create function public.staff_member_upload_approvals(p_user_id uuid)returns jsonb
language plpgsql security definer set search_path=''as $$
declare viewer text;r jsonb;
begin
 if exists(select 1 from public.workspace_staff s where s.user_id=auth.uid()and s.role='admin'and s.active and s.removed_at is null)
  and exists(select 1 from public.patient_clinical_cases c where c.user_id=p_user_id)then
  if not public._real_staff_managed_session_allowed(auth.uid())then raise insufficient_privilege using message='Active administrator session required';end if;
  viewer:='admin';
 else perform public._assigned_active_doctor(p_user_id);viewer:='doctor';end if;
 r:=jsonb_build_object('version','member-upload-approvals-v1','required',public._member_upload_approval_required(),
  'canApprove',viewer='doctor'and public._real_staff_managed_session_allowed(auth.uid())and public.staff_care_access(p_user_id,auth.uid(),true),
  -- Each finished reading of the member's kept files: its printed ranges (for the range status the doctor sees) and
  -- its current approval, if any.
  'readings',coalesce((select jsonb_agg(jsonb_build_object('jobId',j.id,'documentId',d.id,
    'ranges',coalesce((select jsonb_agg(jsonb_build_object('valueId',v.id,'refLow',v.ref_low,'refHigh',v.ref_high)order by v.seq)from public.member_upload_ai_values v where v.job_id=j.id),'[]'),
    'approval',(select jsonb_build_object('version',a.version,'approvedAt',a.created_at,'byYou',a.doctor_id=auth.uid(),
      'doctorName',(select s.display_name from public.workspace_staff s where s.user_id=a.doctor_id),'interpretationHy',a.interpretation_hy,'interpretationEn',a.interpretation_en,
      'interpretationEdited',a.interpretation_edited,'changes',a.changes->'values',
      'values',coalesce((select jsonb_agg(jsonb_build_object('valueId',av.value_id,'action',av.action,'value',av.value))from public.member_upload_approved_values av where av.approval_id=a.id),'[]'))
     from(select(public._member_upload_current_approval(j.id)).*)a where a.id is not null))order by d.created_at desc)
   from public.member_reported_documents d join public.lab_ai_jobs j on j.kind='member_upload'and j.member_document_id=d.id and j.state='done'
   where d.user_id=p_user_id and d.deleted_at is null),'[]'));
 perform public._access_audit_record(p_user_id,'member_upload_approvals',null);
 return r;
end$$;

-- 7. Member: results to show (approved, or every saved value when approval is not required) ----------------------
-- Per file: its state and, once approved, the doctor's interpretation and name. Per value: the approved (or saved)
-- number, the printed unit and range and the date. Never the doctor-only attention marks, the lab's flags, the
-- AI summary or values of a reading still waiting for the doctor.
create function public.member_upload_results()returns jsonb
language plpgsql stable security definer set search_path=''as $$
declare req boolean;
begin
 if auth.uid()is null then raise insufficient_privilege;end if;
 if not public._lab_ai_member_upload_enabled()then return jsonb_build_object('version','member-upload-results-v1','enabled',false);end if;
 req:=public._member_upload_approval_required();
 return(with docs as(
   select d.id document_id,d.file_name,d.result_date,d.created_at,j.id job_id,j.identity,a.id approval_id,a.created_at approved_at,a.interpretation_hy,a.interpretation_en,a.doctor_id
   from public.member_reported_documents d join public.lab_ai_jobs j on j.kind='member_upload'and j.member_document_id=d.id and j.state='done'
   join public.member_upload_ai_confirmations c on c.job_id=j.id and c.identity_answer is distinct from 'not_mine'
   left join lateral(select(public._member_upload_current_approval(j.id)).*)a on true
   where d.user_id=auth.uid()and d.deleted_at is null and exists(select 1 from public.member_upload_ai_values v where v.job_id=j.id and v.member_status<>'rejected')),
  vals as(
   select x.document_id,v.id value_id,v.test_name,v.catalogue_ref,v.unit,v.ref_low,v.ref_high,v.ref_text,
    case when x.approval_id is not null then case when av.action='corrected'then av.value else v.value end
     when v.member_status='corrected'then v.member_value else v.value end num,
    case when x.approval_id is not null then case when av.action='corrected'then av.value::text else v.value_text end
     when v.member_status='corrected'then v.member_value::text else v.value_text end txt,
    x.approval_id is not null checked,coalesce(av.action='corrected',false)doctor_edited,
    coalesce(v.collected_on,(case when x.identity->>'sampleDate'~'^\d{4}-\d{2}-\d{2}$'then(x.identity->>'sampleDate')end)::date,x.result_date)on_day,v.seq
   from docs x join public.member_upload_ai_values v on v.job_id=x.job_id and v.member_status<>'rejected'
   left join public.member_upload_approved_values av on av.approval_id=x.approval_id and av.value_id=v.id
   where(x.approval_id is not null and av.action in('kept','corrected'))or(x.approval_id is null and not req))
  select jsonb_build_object('version','member-upload-results-v1','enabled',true,'approvalRequired',req,
   'documents',coalesce((select jsonb_agg(jsonb_build_object('documentId',x.document_id,'fileName',x.file_name,'resultDate',x.result_date,
     'state',case when x.approval_id is not null then 'approved'when req then 'waiting'else 'not_checked'end,'approvedAt',x.approved_at,
     'doctorName',(select s.display_name from public.workspace_staff s where s.user_id=x.doctor_id),
     'interpretation',case when x.approval_id is not null then jsonb_build_object('hy',x.interpretation_hy,'en',x.interpretation_en)end)order by x.created_at desc)from docs x),'[]'),
   'values',coalesce((select jsonb_agg(jsonb_build_object('valueId',y.value_id,'documentId',y.document_id,'testName',y.test_name,'catalogueRef',y.catalogue_ref,'valueText',y.txt,
     'value',y.num,'unit',y.unit,'refLow',y.ref_low,'refHigh',y.ref_high,'refText',y.ref_text,'date',y.on_day,'checked',y.checked,'doctorEdited',y.doctor_edited)order by y.on_day nulls last,y.seq)from vals y),'[]')));
end$$;

-- 8. Grants ----------------------------------------------------------------------------------------------------
revoke all on function public._member_upload_approval_required(),public._member_upload_current_approval(uuid),public._member_upload_value_member_visible(uuid,text),
 public.doctor_member_upload_approve(jsonb),public.staff_member_upload_approvals(uuid),public.member_upload_results()from public,anon,authenticated,service_role;
-- The read policy on member_reported_values calls the visibility check as the reader.
grant execute on function public._member_upload_value_member_visible(uuid,text)to authenticated;
grant execute on function public.doctor_member_upload_approve(jsonb),public.staff_member_upload_approvals(uuid),public.member_upload_results()to authenticated;
