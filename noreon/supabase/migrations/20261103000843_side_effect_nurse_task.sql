-- Monika, 2 Nov: minor side effects go to the nurse first. This only adds a nurse task. The member's message still
-- reaches the doctor exactly as before, so nothing is withheld, delayed or quietened. The nurse gets no new permission.
-- The list of side effects and the fixed text live here so a member can never choose what a nurse is told.
create function public._side_effect_nurse_task(p_member uuid,p_what text,p_request_id uuid)returns jsonb
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
 insert into public.patient_coordination_tasks(id,patient_case_id,kind,title,instructions,due_at,creator_id,owner_id)
 values(task,p_member,'contact-followup','Side effect reported: '||label,
  'Call the member, collect details and write a note for the doctor. If it is not mild, or there was fainting or a fall, pass it to the doctor at once. Do not advise stopping, reducing or switching a medicine.',
  due,c.assigned_doctor_id,c.assigned_nurse_id);
 insert into public.patient_coordination_events(task_id,revision,request_id,actor_id,actor_name,actor_role,operation,new_status,new_owner_id,detail)
 values(task,1,p_request_id,c.assigned_doctor_id,'Noreon side effect routing','system','create','open',c.assigned_nurse_id,
  jsonb_build_object('input',jsonb_build_object('source','member-side-effect','what',label)));
 return jsonb_build_object('status','created','taskId',task,'replayed',false);
end $$;
revoke all on function public._side_effect_nurse_task(uuid,text,uuid)from public,anon,authenticated,service_role;

create function public.member_side_effect_nurse_task(p_what text,p_request_id uuid)returns jsonb
language plpgsql security definer set search_path=''as $$
begin
 if auth.uid() is null then raise insufficient_privilege using message='Signed-in member required';end if;
 return public._side_effect_nurse_task(auth.uid(),p_what,p_request_id);
end $$;
revoke all on function public.member_side_effect_nurse_task(text,uuid)from public,anon,authenticated,service_role;
grant execute on function public.member_side_effect_nurse_task(text,uuid)to authenticated;

-- Telegram presses run as the service role with a member already resolved from the verified press.
create function public.channel_side_effect_nurse_task(p_member uuid,p_what text,p_request_id uuid)returns jsonb
language sql security definer set search_path=''as $$
 select public._side_effect_nurse_task(p_member,p_what,p_request_id)
$$;
revoke all on function public.channel_side_effect_nurse_task(uuid,text,uuid)from public,anon,authenticated,service_role;
grant execute on function public.channel_side_effect_nurse_task(uuid,text,uuid)to service_role;
