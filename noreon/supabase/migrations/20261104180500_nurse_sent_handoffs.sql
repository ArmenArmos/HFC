-- Integrator: stamp this migration and regenerate lib/db/types.ts before applying it.
-- The existing conversation_nurse_handoffs RPC includes full task history, other
-- nurses' handoffs and active-first ordering. Do not reuse it for this narrow read.
-- Read-only but volatile: patient_coordination_access delegates to shared nurse
-- authorization whose Telegram branch takes FOR SHARE locks.
create function public.nurse_sent_handoffs() returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare who jsonb:=public.real_clinical_staff_identity();result jsonb;
begin
 if auth.role() is distinct from 'authenticated' or auth.uid() is null
  or who is null or who->>'role' is distinct from 'nurse'
  or not exists(select 1 from public.nurse_chat_settings where singleton and enabled)
 then raise insufficient_privilege using message='Current nurse access required';end if;

 with bounded as (
  select h.task_id,h.topic,h.observation,t.patient_case_id,t.created_at,t.status
  from public.conversation_nurse_handoffs h
  join public.patient_coordination_tasks t on t.id=h.task_id
  where h.nurse_id=auth.uid() and public.patient_coordination_access(t.patient_case_id)
  order by t.created_at desc,t.id desc limit 51
 ), page as (select * from bounded order by created_at desc,task_id desc limit 50)
 select jsonb_build_object('items',coalesce((
  select jsonb_agg(jsonb_build_object(
   'taskId',h.task_id,'member',jsonb_build_object('id',h.patient_case_id,'name',p.display_name,
    'birthDate',p.birth_date,'birthYear',extract(year from p.birth_date)::integer,
    'phoneLast4',case when length(phone.digits)>=4 then right(phone.digits,4) else null end),
   'sentAt',h.created_at,'topic',h.topic,'observation',h.observation,'status',h.status,
   'resolution',case when e.actor_role in('doctor','admin') and e.operation in('resolve','complete','cancel')
    then jsonb_build_object('note',e.note,'by',e.actor_name,'at',e.created_at) else null end
  ) order by h.created_at desc,h.task_id desc)
  from page h join public.profiles p on p.id=h.patient_case_id
  left join auth.users u on u.id=h.patient_case_id and u.phone_confirmed_at is not null
  cross join lateral (select regexp_replace(u.phone,'[^0-9]','','g') as digits) phone
  -- First select the latest transition into the CURRENT terminal status. Never
  -- substitute a contact, edit, reassign, prior resolution cycle or internal note.
  left join lateral (
   select ev.note,ev.actor_name,ev.actor_role,ev.operation,ev.created_at
   from public.patient_coordination_events ev
   where ev.task_id=h.task_id and h.status in('completed','cancelled')
    and ev.new_status=h.status and ev.old_status is distinct from ev.new_status
   order by ev.revision desc limit 1
  ) e on true
 ),'[]'::jsonb),'hasMore',(select count(*)>50 from bounded)) into result;
 return result;
end $$;
revoke all on function public.nurse_sent_handoffs() from public,anon,authenticated,service_role;
grant execute on function public.nurse_sent_handoffs() to authenticated;
