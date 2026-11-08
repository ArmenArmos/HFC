-- Armen 2 Nov, item 13 (STAGING, needs Armen and Yesayi's sign-off): a Zoe forward with reason mild_side_effect (lib/zoe/nurse-first.ts
-- decides it, below same-day only) also gives the assigned nurse a task in Today, using the existing coordination queue. Nothing about
-- the doctor's route changes: the forward, its inbox row and the member's line stay as they are, so a failed or skipped task loses nothing.
-- No assigned nurse, or nurse chat off: audited and no task. Doctor creator, so the nurse can work it but not cancel it.
create function public._zoe_nurse_first_task()returns trigger
language plpgsql security definer set search_path=''as $$
declare z public.zoe_runs;c public.conversations;k public.patient_clinical_cases;task uuid;done text;
begin
 select * into z from public.zoe_runs where id=(new.detail->>'runId')::uuid;
 if z.id is null or z.outcome is distinct from 'answered'or new.detail->>'forward'is distinct from 'auto'
  or new.detail->>'urgency'not in('none','self_monitoring','planned','doctor_soon')then return new;end if;
 begin
  select * into c from public.conversations where id=new.conversation_id;
  select * into k from public.patient_clinical_cases where user_id=c.member_id;
  task:=md5('zoe-nurse-first:'||z.id::text)::uuid;
  if not exists(select 1 from public.nurse_chat_settings where singleton and enabled)then done:='nurse_chat_off';
  elsif k.assigned_nurse_id is null or not public._patient_coordination_owner_valid(c.member_id,k.assigned_nurse_id,false)then done:='no_assigned_nurse';
  elsif exists(select 1 from public.patient_coordination_tasks t where t.patient_case_id=c.member_id and t.kind='contact-followup'and t.title='Mild side effect from Zoe'
   and t.status not in('completed','cancelled'))then done:='already_open';
  else
   insert into public.patient_coordination_tasks(id,patient_case_id,kind,title,instructions,creator_id,owner_id)values(task,c.member_id,'contact-followup','Mild side effect from Zoe',
    'Zoe recorded a mild side effect. Read the conversation, collect the details and write a note for the doctor. Do not advise stopping, reducing or switching a medicine.',k.assigned_doctor_id,k.assigned_nurse_id);
   insert into public.patient_coordination_events(task_id,revision,request_id,actor_id,actor_name,actor_role,operation,new_status,new_owner_id,detail)
   values(task,1,md5('zoe-nurse-first-request:'||z.id::text)::uuid,k.assigned_doctor_id,'Zoe','system','create','open',k.assigned_nurse_id,jsonb_build_object('input',jsonb_build_object('runId',z.id)));
   done:='task';
  end if;
 exception when others then done:='failed';
 end;
 insert into public.conversation_audit(conversation_id,actor_id,kind,detail)values(new.conversation_id,null,'zoe.nurse_first',jsonb_build_object('runId',z.id,'outcome',done));
 return new;
end$$;
revoke all on function public._zoe_nurse_first_task()from public,anon,authenticated,service_role;
create trigger zoe_nurse_first after insert on public.conversation_audit for each row
 when(new.kind='zoe.forward'and new.detail->>'reason'='mild_side_effect')execute function public._zoe_nurse_first_task();
