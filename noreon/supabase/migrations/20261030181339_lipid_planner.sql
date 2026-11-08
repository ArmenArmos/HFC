-- Lipid follow-up planner, first version (prototype v8.1 planner; output/lipid-planner/STATUS.md). Dark and read-only.
--
--   1. ldl_goal_settings.lipid_planner_enabled, off by default, and only on together with ldl_goal_enabled.
--   2. doctor_lipid_planner_read: for the assigned doctor, one member's LDL record plus what the planner needs that
--      doctor_ldl_read does not give: only the LDL values a doctor reviewed or released, reviewed ALT, CK and Lp(a), 28 days
--      of dose ticks, and open side-effect or stopping reports.
--
-- This migration computes nothing and stores nothing. lib/lipid-planner works the plan out on each read from rules held
-- as configuration, every rule proposed until Armen and Yesayi sign it. Nothing here writes to a member, a request or a
-- message; the only row a read adds is the access record.

-- 1. Switch ---------------------------------------------------------------------------------------------------
alter table public.ldl_goal_settings add column lipid_planner_enabled boolean not null default false;
create function public._lipid_planner_enabled()returns boolean language sql stable security definer set search_path=''as $$
 select coalesce((select ldl_goal_enabled and lipid_planner_enabled from public.ldl_goal_settings where singleton),false)
$$;

-- 2. Reviewed labs ---------------------------------------------------------------------------------------------
-- As _ldl_alt_observations: a clinic or laboratory result a doctor reviewed, or a read value a doctor verified or corrected
-- on a current attachment. The name is a prefilter; lib/lipid-planner/facts.ts decides what each one is. CK is not in the
-- lab catalogue, so its read values are found by name.
create function public._lipid_reviewed_labs(p_member uuid)returns jsonb language sql stable security definer set search_path=''as $$
 with ck as(select '(^|[^[:alpha:]])(ck|cpk|кфк)([^[:alpha:]]|$)|creatine.{0,2}(phospho)?.{0,1}kinase|креатин.{0,2}(фосфо)?.{0,1}киназ|կրեատին.{0,2}(ֆոսֆո)?.{0,1}կինազ'as re),
  lpa as(select 'lp ?\(a\)|lipoprotein ?\(?a\)?|липопротеин ?\(?а\)?|լիպոպրոտեին ?\(?a\)?'as re)
 select coalesce(jsonb_agg(o order by o->>'on',o->>'id'),'[]'::jsonb)from(
  select a||jsonb_build_object('test','alt')o from jsonb_array_elements(public._ldl_alt_observations(p_member))a
  union all
  select jsonb_build_object('id','cr:'||c.id,'test',case when c.marker ~* ck.re then 'ck' else 'lpa' end,'value',c.value,'unit',c.unit,
    'on',(c.collected_at at time zone 'Asia/Yerevan')::date,'name',c.marker)
   from public.patient_care_results c,ck,lpa
   where c.user_id=p_member and c.source in('clinic','laboratory')and c.collected_at<=clock_timestamp()
    and c.reviewed_at is not null and c.reviewed_by is not null and(c.marker ~* ck.re or c.marker ~* lpa.re)
  union all
  select jsonb_build_object('id','la:'||v.id,'test',case when v.catalogue_ref='lpa'then 'lpa' else 'ck' end,'value',coalesce(v.corrected_value,v.value),
    'unit',coalesce(v.corrected_unit,v.unit),'on',v.collected_on,'name',v.test_name)
   from public.lab_ai_values v,ck
   where v.user_id=p_member and(v.catalogue_ref='lpa'or v.test_name ~* ck.re)and v.status in('verified','corrected')and v.reviewed_by is not null
    and public._lab_ai_current(v.attachment_id)and coalesce(v.corrected_value,v.value)is not null and v.collected_on is not null
 )x
$$;

-- 3. The read --------------------------------------------------------------------------------------------------
create function public.doctor_lipid_planner_read(p_member uuid)returns jsonb
language plpgsql security definer set search_path=''as $$
begin
 perform public._assigned_active_doctor(p_member);
 if not public._lipid_planner_enabled()then return jsonb_build_object('version','lipid-planner-v1','enabled',false);end if;
 perform public._access_audit_record(p_member,'ldl_goal','lipid_planner');
 return jsonb_build_object('version','lipid-planner-v1','enabled',true,'today',public._ldl_today(),
  'record',public.doctor_ldl_read(p_member),
  'reviewedLdl',public._ldl_response_observations(p_member),
  'reviewedLabs',public._lipid_reviewed_labs(p_member),
  'medicines',public._ldl_medicine_facts(p_member,28),
  'concerns',coalesce((select jsonb_agg(jsonb_build_object('kind',c.kind,'on',(c.created_at at time zone 'Asia/Yerevan')::date,
    'medicine',coalesce(public._medicine_ask_medicine(a.source,a.medicine_id)->>'name',''))order by c.created_at,c.id)
   from public.member_medicine_concerns c join public.member_medicine_asks a on a.id=c.ask_id
   where c.user_id=p_member and c.state='open'and c.kind in('side_effect','decided_to_stop')),'[]'::jsonb));
end$$;

-- 4. Grants: functions only ------------------------------------------------------------------------------------
revoke all on function public._lipid_planner_enabled(),public._lipid_reviewed_labs(uuid),public.doctor_lipid_planner_read(uuid)
 from public,anon,authenticated,service_role;
grant execute on function public.doctor_lipid_planner_read(uuid)to authenticated;

-- 5. Doctor Zoe: the plan as a card for the doctor, read through the same gate. It is not one of the model's tools.
create or replace function public._staff_zoe_tool_allowed(p_role text,p_tool text)returns boolean language sql immutable set search_path=''as $$
 select case p_role
  when 'doctor' then p_tool in('overview','bp','labs','ldl','plan','adherence','open_items','visits','member_messages','zoe_why','lipid_plan')
  when 'nurse' then p_tool in('overview','bp','plan','adherence','open_items','visits')
  else false end
$$;
