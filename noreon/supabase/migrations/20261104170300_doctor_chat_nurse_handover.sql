-- Doctor-to-nurse sources use the existing task/event/receipt path. No member write.
-- Keep the existing actor-aware command unchanged for all other callers.
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
  update public.patient_coordination_events set detail=jsonb_set(detail,'{input}',(detail->'input')||jsonb_build_object('source','doctor-handover','sourceConversationId',source_id))where request_id=p_request;
 end if;
 return result;
end$$;
revoke all on function public.patient_coordination_command(uuid,uuid,bigint,uuid,text,jsonb)from public,anon,authenticated,service_role;
grant execute on function public.patient_coordination_command(uuid,uuid,bigint,uuid,text,jsonb)to authenticated;

-- Both queue and snapshot already use this projection. Old tasks get null.
create or replace function public._patient_coordination_task_json(t public.patient_coordination_tasks) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('id',t.id,'caseId',t.patient_case_id,'memberName',p.display_name,'kind',t.kind,'title',t.title,'instructions',t.instructions,'dueAt',t.due_at,'creatorId',t.creator_id,'ownerId',t.owner_id,'ownerName',s.display_name,'status',t.status,'revision',t.revision,'createdAt',t.created_at,'updatedAt',t.updated_at,'needsReassignment',t.status not in ('completed','cancelled') and not public._patient_coordination_owner_valid(t.patient_case_id,t.owner_id,t.kind='doctor-referral'),'eligibleOwners',(select coalesce(jsonb_agg(jsonb_build_object('id',o.user_id,'name',o.display_name,'role',o.role) order by o.role,o.user_id),'[]') from public.workspace_staff o where o.user_id in(c.assigned_doctor_id,c.assigned_nurse_id) and public._patient_coordination_owner_valid(c.user_id,o.user_id,false)),
 'sourceConversationId',(select e.detail#>>'{input,sourceConversationId}'from public.patient_coordination_events e where e.task_id=t.id and e.revision=1 and e.operation='create'))
 from public.profiles p join public.workspace_staff s on s.user_id=t.owner_id join public.patient_clinical_cases c on c.user_id=t.patient_case_id where p.id=t.patient_case_id
$$;
revoke all on function public._patient_coordination_task_json(public.patient_coordination_tasks)from public,anon,authenticated,service_role;
