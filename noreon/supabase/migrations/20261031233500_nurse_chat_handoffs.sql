-- N3: immutable source link onto the existing operational referral lifecycle.
-- Both the app flag and nurse_chat_settings stay off in the go-live seed.
create table public.conversation_nurse_handoffs (
 task_id uuid primary key references public.patient_coordination_tasks(id),
 conversation_id uuid not null references public.conversations(id),
 message_id text not null,
 message_text text not null,
 context_version bigint not null,
 nurse_id uuid not null references public.workspace_staff(user_id),
 nurse_name text not null,
 request_id uuid not null,
 topic text not null check(topic in('blood-pressure','side-effect','adherence','symptom','member-request','other')),
 observation text not null check(length(observation)between 1 and 2000),
 unique(nurse_id,request_id),unique(conversation_id,message_id)
);
alter table public.conversation_nurse_handoffs enable row level security;
-- No direct table access. Scoped, audited RPCs below are the only read/write path.
revoke all on public.conversation_nurse_handoffs from public,anon,authenticated,service_role;
create trigger conversation_nurse_handoffs_immutable before update or delete on public.conversation_nurse_handoffs
 for each row execute function public._conversation_immutable();

create function public.conversation_nurse_handoff(p_member uuid,p_request_id uuid,p_expected_version bigint,p_message_id text,p_topic text,p_observation text)returns jsonb
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
 insert into public.patient_coordination_tasks(id,patient_case_id,kind,title,instructions,creator_id,owner_id)
 values(task,p_member,'doctor-referral','Nurse handoff',btrim(p_observation),auth.uid(),doc);
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
revoke all on function public.conversation_nurse_handoff(uuid,uuid,bigint,text,text,text)from public,anon,authenticated,service_role;
grant execute on function public.conversation_nurse_handoff(uuid,uuid,bigint,text,text,text)to authenticated;

-- Same bounded, audited snapshots in nurse chat, doctor Today and doctor chat.
create function public.conversation_nurse_handoffs(p_member uuid default null)returns jsonb
language plpgsql security definer set search_path=''as $$
declare who jsonb:=public.real_clinical_staff_identity();h record;items jsonb:='[]';more boolean:=false;a jsonb;
begin
 perform 1 from public.nurse_chat_settings where singleton and enabled for share nowait;
 if not found or auth.role()is distinct from 'authenticated'or who is null or who->>'role'not in('nurse','doctor')then raise insufficient_privilege;end if;
 if p_member is not null then
  a:=public._conversation_user(p_member,false);
  if a#>>'{doctor,role}'not in('nurse','doctor')then raise insufficient_privilege;end if;
 end if;
 for h in select l.*,t.patient_case_id from public.conversation_nurse_handoffs l
  join public.patient_coordination_tasks t on t.id=l.task_id
  where(p_member is null or t.patient_case_id=p_member)and public.patient_coordination_access(t.patient_case_id)
  order by (t.status in('completed','cancelled')),t.created_at desc,t.id limit 51
 loop
  if jsonb_array_length(items)=50 then more:=true;exit;end if;
  a:=public._conversation_user(h.patient_case_id,false);
  items:=items||jsonb_build_array(jsonb_build_object('messageId',h.message_id,'messageText',h.message_text,'topic',h.topic,'observation',h.observation,'nurseName',h.nurse_name,'task',public.patient_coordination_snapshot(h.task_id)));
 end loop;
 return jsonb_build_object('items',items,'hasMore',more);
end$$;
revoke all on function public.conversation_nurse_handoffs(uuid)from public,anon,authenticated,service_role;
grant execute on function public.conversation_nurse_handoffs(uuid)to authenticated;

-- Only a linked handoff needs the extra cancellation guard: its nurse creator
-- must not close the doctor's work. Ordinary tasks keep the existing behavior.
-- Keep the task action and its revision/receipt/audit implementation authoritative.
alter function public.patient_coordination_command(uuid,uuid,bigint,uuid,text,jsonb)rename to patient_coordination_command_before_nurse_handoffs;
revoke all on function public.patient_coordination_command_before_nurse_handoffs(uuid,uuid,bigint,uuid,text,jsonb)from public,anon,authenticated,service_role;
create function public.patient_coordination_command(p_case uuid,p_task uuid,p_expected_revision bigint,p_request uuid,p_operation text,p_input jsonb)returns jsonb
language plpgsql security definer set search_path=''as $$
declare t public.patient_coordination_tasks;
begin
 if public.real_clinical_staff_identity()->>'role'='nurse'and p_operation='cancel'then
  -- Match the underlying lock order; check before receipt replay too.
  perform pg_advisory_xact_lock(hashtextextended('noreon:coordination:'||p_request::text,0));
  perform 1 from auth.users where id=p_case for share;
  perform 1 from public.patient_clinical_cases where user_id=p_case for update;
  select * into t from public.patient_coordination_tasks where id=p_task and patient_case_id=p_case for update;
  if exists(select 1 from public.conversation_nurse_handoffs where task_id=t.id)then
   raise insufficient_privilege using message='Assigned doctor required to cancel a nurse handoff';
  end if;
 end if;
 return public.patient_coordination_command_before_nurse_handoffs(p_case,p_task,p_expected_revision,p_request,p_operation,p_input);
end$$;
revoke all on function public.patient_coordination_command(uuid,uuid,bigint,uuid,text,jsonb)from public,anon,authenticated,service_role;
grant execute on function public.patient_coordination_command(uuid,uuid,bigint,uuid,text,jsonb)to authenticated;
