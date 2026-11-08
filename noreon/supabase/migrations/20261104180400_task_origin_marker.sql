-- Placeholder stamp requested by the lead. Rename and regenerate database types before integration.
alter table public.patient_coordination_tasks add column origin text
 check(origin in('nurse_handoff','doctor_handover','zoe_side_effect'));
comment on column public.patient_coordination_tasks.origin is
 'System provenance for fixed display copy. Null for staff-authored or unproven legacy tasks.';

-- The immutable handoff link is reliable. Do not guess from historical titles.
update public.patient_coordination_tasks t set origin='nurse_handoff'
 where t.origin is null and exists(select 1 from public.conversation_nurse_handoffs h where h.task_id=t.id);


-- Latest source: 20261031233500_nurse_chat_handoffs.sql.
create or replace function public.conversation_nurse_handoff(p_member uuid,p_request_id uuid,p_expected_version bigint,p_message_id text,p_topic text,p_observation text)returns jsonb
language plpgsql security definer set search_path=''as $$
declare a jsonb;w jsonb;c public.conversations;h public.conversation_nurse_handoffs;doc uuid;task uuid:=gen_random_uuid();source_text text;created_request uuid:=gen_random_uuid();
begin
 perform 1 from public.nurse_chat_settings where singleton and enabled for share nowait;
 if not found then return jsonb_build_object('ok',false,'code','off');end if;
 if p_request_id is null or p_expected_version is null or p_expected_version<0 or p_message_id is null or length(p_message_id)not between 1 and 80
  or p_topic is null or p_topic not in('blood-pressure','side-effect','adherence','symptom','member-request','other')
  or p_observation is null or public._conversation_utf16(p_observation)not between 1 and 2000 or p_observation!~'[^[:space:]]'then return jsonb_build_object('ok',false,'code','invalid');end if;
 perform pg_advisory_xact_lock(hashtextextended('noreon:coordination:'||p_request_id::text,0));
 -- Same assignment, invitation, clinic, verified member and live-session locks as nurse replies.
 a:=public._conversation_user(p_member,false);
 if a#>>'{doctor,role}'is distinct from 'nurse'then raise insufficient_privilege;end if;
 select * into c from public.conversations where member_id=p_member;
 select * into h from public.conversation_nurse_handoffs where nurse_id=auth.uid()and request_id=p_request_id;
 if found then
  if h.conversation_id is distinct from c.id or h.message_id is distinct from p_message_id or h.context_version is distinct from p_expected_version
   or h.topic is distinct from p_topic or h.observation is distinct from btrim(p_observation)then return jsonb_build_object('ok',false,'code','request_conflict');end if;
  return jsonb_build_object('ok',true,'taskId',h.task_id,'replayed',true);
 end if;
 if c.id is null or c.version<>p_expected_version then return jsonb_build_object('ok',false,'code','stale_context');end if;
 -- The exact reader used by the nurse determines which source messages can be selected.
 w:=public.conversation_nurse_workspace(p_member);
 if w->>'ok' is distinct from 'true'then return w;end if;
 select i->>'text'into source_text from jsonb_array_elements(w->'items')i where i->>'id'=p_message_id;
 if source_text is null then return jsonb_build_object('ok',false,'code','invalid');end if;
 if exists(select 1 from public.conversation_nurse_handoffs where conversation_id=c.id and message_id=p_message_id)then return jsonb_build_object('ok',false,'code','already_exists');end if;
 select assigned_doctor_id into doc from public.patient_clinical_cases where user_id=p_member;
 if not public._patient_coordination_owner_valid(p_member,doc,true)then raise insufficient_privilege;end if;
 -- Narrow exception to nurse creation: only a referral to this member's current doctor.
 -- No deadline, reminder change, alert resolution, doctor takeover or outbound notification.
 insert into public.patient_coordination_tasks(id,patient_case_id,kind,title,instructions,creator_id,owner_id,origin)
 values(task,p_member,'doctor-referral','Nurse handoff',btrim(p_observation),auth.uid(),doc,'nurse_handoff');
 insert into public.patient_coordination_events(task_id,revision,request_id,actor_id,actor_name,actor_role,operation,new_status,new_owner_id,detail)
 values(task,1,created_request,auth.uid(),a#>>'{doctor,displayName}','nurse','create','open',doc,jsonb_build_object('input',jsonb_build_object('messageId',p_message_id,'topic',p_topic)));
 -- The existing command writes the referral care note, history and immutable receipt.
 perform public.patient_coordination_command(p_member,task,1,p_request_id,'refer',jsonb_build_object('note',btrim(p_observation)));
 insert into public.conversation_nurse_handoffs(task_id,conversation_id,message_id,message_text,context_version,nurse_id,nurse_name,request_id,topic,observation)
 values(task,c.id,p_message_id,source_text,p_expected_version,auth.uid(),a#>>'{doctor,displayName}',p_request_id,p_topic,btrim(p_observation));
 insert into public.conversation_audit(conversation_id,actor_id,kind,detail)values(c.id,auth.uid(),'nurse.handoff',jsonb_build_object('taskId',task,'messageId',p_message_id,'doctorId',doc,'requestId',p_request_id));
 return jsonb_build_object('ok',true,'taskId',task,'replayed',false);
exception when insufficient_privilege then return jsonb_build_object('ok',false,'code','denied');
 when lock_not_available then return jsonb_build_object('ok',false,'code','unavailable');
end$$;

-- Latest source: 20261103000843_side_effect_nurse_task.sql.
create or replace function public._side_effect_nurse_task(p_member uuid,p_what text,p_request_id uuid)returns jsonb
language plpgsql security definer set search_path=''as $$
declare c public.patient_clinical_cases;task uuid:=gen_random_uuid();label text;name text;due timestamptz;yerevan timestamp;existing uuid;
begin
 label:=case p_what when 'ankle_swelling' then 'ankle swelling' when 'dizziness' then 'dizziness' when 'nausea' then 'nausea'
  when 'dry_cough' then 'dry cough' when 'headache' then 'headache' when 'frequent_urination' then 'frequent urination' end;
 if label is null or p_request_id is null then raise exception 'Invalid side effect'using errcode='22023';end if;
 perform 1 from public.nurse_chat_settings where singleton and enabled;
 if not found then return jsonb_build_object('status','off');end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('noreon:side-effect-nurse:'||p_request_id::text,0));
 select task_id into existing from public.patient_coordination_events where request_id=p_request_id;
 if found then return jsonb_build_object('status','created','taskId',existing,'replayed',true);end if;
 select * into c from public.patient_clinical_cases where user_id=p_member for update;
 if not found or c.assigned_nurse_id is null or c.assigned_doctor_id is null then return jsonb_build_object('status','no_nurse');end if;
 if not public._patient_coordination_owner_valid(p_member,c.assigned_nurse_id,false)then return jsonb_build_object('status','no_nurse');end if;
 -- At most one open task per member and side effect: a second report joins the call already due.
 select id into existing from public.patient_coordination_tasks
  where patient_case_id=p_member and title='Side effect reported: '||label and status in('open','awaiting-member');
 if found then return jsonb_build_object('status','already_open','taskId',existing);end if;
 -- Same working day. After 18:00 Yerevan time, the next day's 18:00.
 yerevan:=(now()at time zone 'Asia/Yerevan')::date+time '18:00';
 if yerevan<=(now()at time zone 'Asia/Yerevan')then yerevan:=yerevan+interval '1 day';end if;
 due:=yerevan at time zone 'Asia/Yerevan';
 select display_name into name from public.workspace_staff where user_id=c.assigned_nurse_id;
 -- The audit tables require a staff actor. The doctor who owns the case stands in, so a nurse is never recorded as
 -- creating this and cannot cancel a report she did not make. The actor name and role say the routing did it.
 insert into public.patient_coordination_tasks(id,patient_case_id,kind,title,instructions,due_at,creator_id,owner_id,origin)
 values(task,p_member,'contact-followup','Side effect reported: '||label,
  'Call the member, collect details and write a note for the doctor. If it is not mild, or there was fainting or a fall, pass it to the doctor at once. Do not advise stopping, reducing or switching a medicine.',
  due,c.assigned_doctor_id,c.assigned_nurse_id,'zoe_side_effect');
 insert into public.patient_coordination_events(task_id,revision,request_id,actor_id,actor_name,actor_role,operation,new_status,new_owner_id,detail)
 values(task,1,p_request_id,c.assigned_doctor_id,'Noreon side effect routing','system','create','open',c.assigned_nurse_id,
  jsonb_build_object('input',jsonb_build_object('source','member-side-effect','what',label)));
 return jsonb_build_object('status','created','taskId',task,'replayed',false);
end $$;

-- Latest source: 20261104172700_clinic_admin_approvals.sql.
create or replace function public._zoe_nurse_first_task()returns trigger
language plpgsql security definer set search_path=''as $$
declare z public.zoe_runs;c public.conversations;k public.patient_clinical_cases;task uuid;done text;
begin
 select * into z from public.zoe_runs where id=(new.detail->>'runId')::uuid;
 if z.id is null or z.outcome is distinct from 'answered'or new.detail->>'forward'is distinct from 'auto'
  or new.detail->>'urgency'not in('none','self_monitoring','planned','doctor_soon')then return new;end if;
 begin
  select * into c from public.conversations where id=new.conversation_id;
  select * into k from public.patient_clinical_cases where user_id=c.member_id for share;
  task:=md5('zoe-nurse-first:'||z.id::text)::uuid;
  if not exists(select 1 from public.nurse_chat_settings where singleton and enabled)then done:='nurse_chat_off';
  elsif k.assigned_nurse_id is null or not public._patient_coordination_owner_valid(c.member_id,k.assigned_nurse_id,false)then done:='no_assigned_nurse';
  elsif exists(select 1 from public.patient_coordination_tasks t where t.patient_case_id=c.member_id and t.kind='contact-followup'and t.title='Mild side effect from Zoe'
   and t.status not in('completed','cancelled'))then done:='already_open';
  else
   insert into public.patient_coordination_tasks(id,patient_case_id,kind,title,instructions,creator_id,owner_id,origin)values(task,c.member_id,'contact-followup','Mild side effect from Zoe',
    'Zoe recorded a mild side effect. Read the conversation, collect the details and write a note for the doctor. Do not advise stopping, reducing or switching a medicine.',k.assigned_doctor_id,k.assigned_nurse_id,'zoe_side_effect');
   insert into public.patient_coordination_events(task_id,revision,request_id,actor_id,actor_name,actor_role,operation,new_status,new_owner_id,detail)
   values(task,1,md5('zoe-nurse-first-request:'||z.id::text)::uuid,k.assigned_doctor_id,'Zoe','system','create','open',k.assigned_nurse_id,jsonb_build_object('input',jsonb_build_object('runId',z.id)));
   done:='task';
  end if;
 exception when others then done:='failed';
 end;
 insert into public.conversation_audit(conversation_id,actor_id,kind,detail)values(new.conversation_id,null,'zoe.nurse_first',jsonb_build_object('runId',z.id,'outcome',done));
 return new;
end$$;

-- Latest source: 20261104170300_doctor_chat_nurse_handover.sql. Mark only a new, authorized handover, never a replay.
create or replace function public.patient_coordination_command(p_case uuid,p_task uuid,p_expected_revision bigint,p_request uuid,p_operation text,p_input jsonb)returns jsonb
language plpgsql security definer set search_path=''as $$
declare result jsonb;source_id uuid;replay boolean;event_source text;
begin
 if not(p_input ? 'sourceConversationId')then
  return public._patient_coordination_command_as(auth.uid(),null,null,p_case,p_task,p_expected_revision,p_request,p_operation,p_input);
 end if;
 if p_operation is distinct from 'create' or jsonb_typeof(p_input->'sourceConversationId')is distinct from 'string'
  or p_input->>'kind'is distinct from 'contact-followup' then raise check_violation using message='Check the handover source';end if;
 source_id:=(p_input->>'sourceConversationId')::uuid;
 -- Same request/member/case lock order as the existing command. All source work is
 -- in this transaction, so a refusal rolls back the underlying create as well.
 perform pg_advisory_xact_lock(hashtextextended('noreon:coordination:'||p_request::text,0));
 select exists(select 1 from public.patient_coordination_receipts where request_id=p_request)into replay;
 result:=public._patient_coordination_command_as(auth.uid(),null,null,p_case,p_task,p_expected_revision,p_request,p_operation,p_input-'sourceConversationId');
 if (public.real_clinical_staff_identity()->>'role')is distinct from 'doctor'
  or not exists(select 1 from public.patient_clinical_cases c where c.user_id=p_case and c.assigned_doctor_id=auth.uid() and c.assigned_nurse_id=(p_input->>'ownerId')::uuid)
  or not exists(select 1 from public.conversations c where c.id=source_id and c.member_id=p_case)then
  raise insufficient_privilege using message='Current assigned doctor, nurse and conversation required';
 end if;
 select detail#>>'{input,sourceConversationId}'into event_source from public.patient_coordination_events where request_id=p_request;
 if replay then
  if event_source is distinct from source_id::text then raise serialization_failure using message='Task request changed';end if;
 else
  update public.patient_coordination_tasks set origin='doctor_handover'where id=p_task and patient_case_id=p_case;
  update public.patient_coordination_events set detail=jsonb_set(detail,'{input}',(detail->'input')||jsonb_build_object('source','doctor-handover','sourceConversationId',source_id))where request_id=p_request;
 end if;
 return result;
end$$;

-- Latest source: 20261104170300_doctor_chat_nurse_handover.sql. Shared queue/snapshot projection.
create or replace function public._patient_coordination_task_json(t public.patient_coordination_tasks) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('id',t.id,'caseId',t.patient_case_id,'memberName',p.display_name,'kind',t.kind,'origin',t.origin,'title',t.title,'instructions',t.instructions,'dueAt',t.due_at,'creatorId',t.creator_id,'ownerId',t.owner_id,'ownerName',s.display_name,'status',t.status,'revision',t.revision,'createdAt',t.created_at,'updatedAt',t.updated_at,'needsReassignment',t.status not in ('completed','cancelled') and not public._patient_coordination_owner_valid(t.patient_case_id,t.owner_id,t.kind='doctor-referral'),'eligibleOwners',(select coalesce(jsonb_agg(jsonb_build_object('id',o.user_id,'name',o.display_name,'role',o.role) order by o.role,o.user_id),'[]') from public.workspace_staff o where o.user_id in(c.assigned_doctor_id,c.assigned_nurse_id) and public._patient_coordination_owner_valid(c.user_id,o.user_id,false)),
 'sourceConversationId',(select e.detail#>>'{input,sourceConversationId}'from public.patient_coordination_events e where e.task_id=t.id and e.revision=1 and e.operation='create'))
 from public.profiles p join public.workspace_staff s on s.user_id=t.owner_id join public.patient_clinical_cases c on c.user_id=t.patient_case_id where p.id=t.patient_case_id
$$;

-- Latest source: 20261102202240_nurse_actor_authorization.sql. Keep the explicit composite aligned with the added column.
create or replace function public._patient_coordination_queue_as(p_actor uuid,p_binding uuid,p_generation bigint,p_case uuid default null,p_filter text default 'active',p_after_created_at timestamptz default null,p_after_id uuid default null,p_limit integer default 50) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare rows jsonb;has_more boolean;cursor jsonb;
begin
 if p_filter is null or p_filter not in ('active','all','open','awaiting-member','awaiting-doctor','completed','cancelled','reassign') or p_limit is null or p_limit not between 1 and 100 or (p_after_created_at is null) is distinct from (p_after_id is null) or (p_after_created_at is not null and not isfinite(p_after_created_at)) then raise check_violation using message='Check the task page';end if;
 if (p_binding is null and auth.uid() is null) or (case when p_binding is null then public.real_clinical_staff_identity()else to_jsonb(public._nurse_visit_nurse_as(p_actor,p_binding,p_generation))end) is null then raise insufficient_privilege using message='Current staff access required';end if;
 if p_case is not null and not public._patient_coordination_access_as(p_actor,p_binding,p_generation,p_case) then raise insufficient_privilege using message='Current case access required';end if;
 with authorized as (
  select t.* from public.patient_coordination_tasks t where (p_case is null or t.patient_case_id=p_case)
   and public._patient_coordination_access_as(p_actor,p_binding,p_generation,t.patient_case_id)
   and (p_filter='all' or (p_filter='active' and t.status not in ('completed','cancelled')) or t.status=p_filter or (p_filter='reassign' and t.status not in ('completed','cancelled') and not public._patient_coordination_owner_valid(t.patient_case_id,t.owner_id,t.kind='doctor-referral')))
   and (p_after_id is null or (t.created_at,t.id)>(p_after_created_at,p_after_id)) order by t.created_at,t.id limit p_limit+1
 ), numbered as(select a.*,row_number() over(order by created_at,id) rn from authorized a)
 select coalesce(jsonb_agg(public._patient_coordination_task_json((n.id,n.patient_case_id,n.kind,n.title,n.instructions,n.due_at,n.creator_id,n.owner_id,n.status,n.revision,n.created_at,n.updated_at,n.origin)::public.patient_coordination_tasks) order by n.created_at,n.id) filter(where rn<=p_limit),'[]'),count(*)>p_limit,
  (jsonb_agg(jsonb_build_object('createdAt',created_at,'id',id)) filter(where rn=p_limit))->0 into rows,has_more,cursor from numbered n;
 return jsonb_build_object('tasks',rows,'nextCursor',case when has_more then cursor else null end);
end $$;
