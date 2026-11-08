-- Astra N1-3: bind approval retries to their exact command. An approval from before this migration has no hash, so any retry of it is
-- stale (the doctor reloads and sees what was saved; Astra PR390-R1).
alter table public.member_upload_doctor_approvals add column command_hash text;

-- Copied verbatim from 20261021070050 except Astra N1-3: store and compare the command hash.
create or replace function public.doctor_member_upload_approve(p_command jsonb)returns jsonb
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
 if found then
  if prior.command_hash is distinct from md5(p_command::text)then return jsonb_build_object('status','stale');end if;
  return case when prior.member_id=m and prior.job_id=jid and prior.doctor_id=d then jsonb_build_object('status','approved','replayed',true,'version',prior.version)
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
 insert into public.member_upload_doctor_approvals(id,job_id,member_id,document_id,doctor_id,submission_id,version,interpretation_hy,interpretation_en,interpretation_edited,command_hash,changes)
  values(ap,j.id,m,md.id,d,sub,ver,hy,en,(p_command->>'interpretationEdited')::boolean,md5(p_command::text),
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

-- Astra N1-4: ambiguous legacy marks stay NULL, kept but hidden.
create function public._nurse_visit_marks_backfill()returns void
language plpgsql security definer set search_path=''as $$
begin
 alter table public.nurse_visit_marks disable trigger nurse_visit_marks_immutable;
 update public.nurse_visit_marks k set arrangement=public._nurse_visit_arrangement(k.source,k.source_id)
 where k.arrangement is null and public._nurse_visit_arrangement(k.source,k.source_id)is not null
  and((k.source='appointment'and not exists(select 1 from public.booking_appointment_versions x where x.appointment_id=k.source_id and x.created_at>k.recorded_at))
   or(k.source='home-request'and not exists(select 1 from public.patient_test_request_events x where x.request_id=k.source_id and x.created_at>k.recorded_at and x.operation<>'completed-by-visit')));
 alter table public.nurse_visit_marks enable trigger nurse_visit_marks_immutable;
end$$;
revoke all on function public._nurse_visit_marks_backfill()from public,anon,authenticated,service_role;
select public._nurse_visit_marks_backfill();

-- Copied verbatim from 20261018170600 except Astra N1-6: optional arrangement and checklist guards.
create or replace function public.nurse_visit_mark(p_command jsonb)returns jsonb
language plpgsql security definer set search_path=''as $$
declare m uuid;src text;sid uuid;sub uuid;item text;done boolean;note text;vals jsonb;s public.workspace_staff;v jsonb;prior public.nurse_visit_marks;r bigint;mid uuid;cv text;
 bad constant jsonb:=jsonb_build_object('status','invalid');
begin
 perform set_config('lock_timeout','1500ms',true);
 if jsonb_typeof(p_command)is distinct from 'object'or p_command->>'version'is distinct from 'nurse-visit-v1'
  or not(p_command?&array['memberId','source','sourceId','submissionId','item','done','note','values'])
  or p_command-array['version','memberId','source','sourceId','submissionId','item','done','note','values','startsAt','checklistVersion']<>'{}'
  or jsonb_typeof(p_command->'done')is distinct from 'boolean'or jsonb_typeof(p_command->'item')is distinct from 'string'
  or jsonb_typeof(p_command->'note')not in('null','string')or jsonb_typeof(p_command->'values')not in('null','object')then return bad;end if;
 begin
  m:=(p_command->>'memberId')::uuid;sid:=(p_command->>'sourceId')::uuid;sub:=(p_command->>'submissionId')::uuid;
 exception when invalid_text_representation then return bad;end;
 src:=p_command->>'source';item:=p_command->>'item';done:=(p_command->>'done')::boolean;
 note:=nullif(btrim(p_command->>'note'),'');vals:=nullif(p_command->'values','null'::jsonb);
 if src not in('home-request','appointment')or m is null or sid is null or sub is null or(note is not null and length(note)>1000)then return bad;end if;
 if item='measure:bp'and done then
  if vals is null or vals-array['systolic','diastolic','pulse']<>'{}'or not(vals?&array['systolic','diastolic','pulse'])
   or not public._nurse_visit_number(vals->'systolic',60,300,true)or not public._nurse_visit_number(vals->'diastolic',30,200,true)
   or(vals->>'systolic')::numeric<=(vals->>'diastolic')::numeric
   or(vals->'pulse'<>'null'::jsonb and not public._nurse_visit_number(vals->'pulse',20,250,true))then return bad;end if;
 elsif item in('measure:weight','measure:waist')and done then
  if vals is null or vals-array['value']<>'{}'or not public._nurse_visit_number(vals->'value',case when item='measure:weight'then 20 else 30 end,case when item='measure:weight'then 400 else 250 end,false)then return bad;end if;
 elsif vals is not null then return bad;
 end if;
 perform pg_advisory_xact_lock(hashtextextended('nurse-visit:'||sid::text,0));
 perform public._nurse_visit_nurse();
 s:=public._patient_visit_authorize(m,true,false);
 if not public._nurse_visit_enabled()then return jsonb_build_object('status','disabled');end if;
 select * into prior from public.nurse_visit_marks where member_id=m and submission_id=sub;
 if found then
  if prior.source<>src or prior.source_id<>sid or prior.item<>item or prior.done<>done or prior.note is distinct from note or prior.vals is distinct from vals or prior.actor_id<>s.user_id then
   return jsonb_build_object('status','stale');end if;
  return jsonb_build_object('status','saved','markId',prior.id,'submissionId',sub,'replayed',true);
 end if;
 v:=public._nurse_visit_row(src,sid);
 if v is null or(v->>'memberId')::uuid<>m then raise insufficient_privilege;end if;
 if p_command?'startsAt'then
  begin
   if jsonb_typeof(p_command->'startsAt')is distinct from 'string'then return bad;end if;
   if(p_command->>'startsAt')::timestamptz is distinct from(v->>'startsAt')::timestamptz then return jsonb_build_object('status','stale');end if;
  exception when invalid_datetime_format or datetime_field_overflow or invalid_parameter_value then return bad;end;
 end if;
 if v->'completion'<>'null'::jsonb then return jsonb_build_object('status','completed');end if;
 select i->>'version'into cv from jsonb_array_elements(public._nurse_visit_items(src,sid))i where i->>'key'=item;
 if not found then return jsonb_build_object('status','stale');end if;
 if item like 'check:%'and p_command?'checklistVersion'and(p_command->>'checklistVersion')is distinct from cv then return jsonb_build_object('status','stale');end if;
 insert into public.nurse_visit_marks(member_id,source,source_id,item,done,note,vals,checklist_version,submission_id,actor_id,actor_name)
  values(m,src,sid,item,done,note,vals,cv,sub,s.user_id,s.display_name)returning id into mid;
 update public.patient_clinical_cases set revision=revision+1,updated_at=clock_timestamp()where user_id=m returning revision into r;
 insert into public.patient_clinical_case_events(user_id,revision,kind,actor_id,detail)
  values(m,r,'care-evidence',s.user_id,jsonb_build_object('nurseVisit','mark','source',src,'sourceId',sid,'item',item,'done',done,'commented',note is not null,'markId',mid,'submissionId',sub));
 return jsonb_build_object('status','saved','markId',mid,'submissionId',sub,'replayed',false);
exception when insufficient_privilege then return jsonb_build_object('status','access');
 when lock_not_available or query_canceled or deadlock_detected then return jsonb_build_object('status','unavailable');
end$$;
