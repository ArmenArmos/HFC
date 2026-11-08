-- Only revision guards and adapters. Existing commands own their domain permission and side effects.
-- No new tables, clinical rules, plan approval or publication. Internal snapshots are never callable by browser roles.
create function public._doctor_decision_snapshot(p_kind text,p_id uuid)returns jsonb
language plpgsql stable security definer set search_path=''as $$
declare m uuid;at_ timestamptz;data_ jsonb;raw_ jsonb;rev bigint;
begin
 if p_kind='alert' then
  select a.member_id,a.created_at,public._care_alert_json(a),to_jsonb(a) into m,at_,data_,raw_
   from public.care_alerts a where a.id=p_id and a.state='open';
 elsif p_kind='ldl' then
  if not public._ldl_response_enabled()then return null;end if;
  select r.member_id,r.created_at,jsonb_build_object('status',r.status,'facts',r.facts),to_jsonb(r) into m,at_,data_,raw_
   from public.ldl_responses r where r.id=p_id and r.closed_at is null;
 elsif p_kind='medicine' then
  select c.user_id,c.created_at,jsonb_build_object('kind',c.kind,'ask',public._medicine_ask_json(a)),to_jsonb(c)||jsonb_build_object('ask',to_jsonb(a))
   into m,at_,data_,raw_ from public.member_medicine_concerns c join public.member_medicine_asks a on a.id=c.ask_id
   where c.id=p_id and c.state='open';
 else return null;
 end if;
 if m is null then return null;end if;
 select revision into rev from public.patient_clinical_cases where user_id=m;
 return jsonb_build_object('kind',p_kind,'id',p_id,'memberId',m,'at',at_,'data',data_,
  'revision',md5(jsonb_build_array(raw_,data_,rev)::text));
end$$;

create function public.doctor_decision_item(p_kind text,p_id uuid)returns jsonb
language plpgsql security definer set search_path=''as $$
declare s jsonb;
begin
 -- Validate the session even for a missing record; no foreign record is returned before assignment checks.
 if coalesce(public.real_clinical_staff_identity()->>'role','')<>'doctor'then raise insufficient_privilege;end if;
 s:=public._doctor_decision_snapshot(p_kind,p_id);
 if s is null then return null;end if;
 perform public._assigned_active_doctor((s->>'memberId')::uuid);
 if not public.staff_care_access((s->>'memberId')::uuid,auth.uid(),true)then raise insufficient_privilege;end if;
 perform public._access_audit_record((s->>'memberId')::uuid,'doctor_decisions','read');
 return s;
end$$;

create function public.doctor_decision_items(p_member uuid)returns jsonb
language plpgsql security definer set search_path=''as $$
declare items jsonb;
begin
 perform public._assigned_active_doctor(p_member);
 if not public.staff_care_access(p_member,auth.uid(),true)then raise insufficient_privilege;end if;
 -- Each snapshot contains both the displayed record and its revision from the same statement snapshot.
 select coalesce(jsonb_agg(s order by case s->>'kind'when 'alert'then 0 else 1 end,s->>'at',s->>'id'),'[]')into items from(
  select public._doctor_decision_snapshot(kind,id)s from(
   select 'alert'::text kind,a.id from public.care_alerts a where a.member_id=p_member and a.state='open'
   union all select 'ldl',r.id from public.ldl_responses r where r.member_id=p_member and r.closed_at is null
   union all select 'medicine',c.id from public.member_medicine_concerns c where c.user_id=p_member and c.state='open'
  )ids
 )snapshots where s is not null;
 perform public._access_audit_record(p_member,'doctor_decisions','read');
 return jsonb_build_object('items',items);
end$$;

create function public.doctor_decision_apply(p_kind text,p_id uuid,p_member uuid,p_revision text,p_note text default '')returns jsonb
language plpgsql security definer set search_path=''as $$
declare s jsonb;r jsonb;doctor_ uuid;
begin
 if p_kind is null or p_kind not in('alert','ldl','medicine')or p_id is null or p_member is null
  or p_revision is null or p_revision!~'^[a-f0-9]{32}$'or length(coalesce(p_note,''))>500 then
  return jsonb_build_object('status','invalid');end if;
 -- Assignment changes and clinical changes serialize on the case row, as LDL and conversation commands do.
 doctor_:=public._ldl_doctor_lock(p_member);
 if not public.staff_care_access(p_member,doctor_,true)then raise insufficient_privilege;end if;
 if p_kind='alert'then
  perform 1 from public.care_alerts where id=p_id and member_id=p_member for update;
 elsif p_kind='ldl'then
  perform 1 from public.ldl_responses where id=p_id and member_id=p_member for update;
 else
  perform 1 from public.member_medicine_concerns where id=p_id and user_id=p_member for update;
  perform 1 from public.member_medicine_asks a join public.member_medicine_concerns c on c.ask_id=a.id where c.id=p_id and c.user_id=p_member for update of a;
 end if;
 s:=public._doctor_decision_snapshot(p_kind,p_id);
 if s is null or s->>'memberId'<>p_member::text or s->>'revision'<>p_revision then return jsonb_build_object('status','stale');end if;
 if p_kind='alert'then
  r:=public.care_alert_acknowledge(p_id,(s#>>'{data,stateSeq}')::bigint);
  if not coalesce((r->>'ok')::boolean,false)then return jsonb_build_object('status','stale');end if;
 elsif p_kind='medicine'then
  r:=public.doctor_medicine_concern_handle(p_id);
  if not coalesce((r->>'ok')::boolean,false)then return jsonb_build_object('status','stale');end if;
 else
  r:=public.doctor_ldl_response_close(p_id,p_note);
  if r->>'status'<>'saved'then return r;end if;
 end if;
 -- IDs and revision only. Domain audit is kept; LDL closure now has an explicit access-audit entry too.
 perform public._access_audit_record(p_member,'doctor_decisions',p_kind||':'||p_id::text||':'||p_revision||':saved');
 return jsonb_build_object('status','saved');
exception when insufficient_privilege then return jsonb_build_object('status','access');
 when lock_not_available then return jsonb_build_object('status','unavailable');
end$$;

revoke all on function public._doctor_decision_snapshot(text,uuid),public.doctor_decision_item(text,uuid),
 public.doctor_decision_items(uuid),public.doctor_decision_apply(text,uuid,uuid,text,text)from public,anon,authenticated,service_role;
grant execute on function public.doctor_decision_item(text,uuid),public.doctor_decision_items(uuid),
 public.doctor_decision_apply(text,uuid,uuid,text,text)to authenticated;

-- Issue the existing exact-draft intent and its visible text in one transaction under the existing case/conversation
-- locks. A card uses this intent directly, never a newly issued intent for possibly different text on press.
create function public.doctor_decision_reply(p_member uuid)returns jsonb
language plpgsql security definer set search_path=''as $$
declare w jsonb;a jsonb;mode_ jsonb;
begin
 perform public._conversation_user(p_member,true);
 if not public.staff_care_access(p_member,auth.uid(),true)then raise insufficient_privilege;end if;
 w:=public.conversation_workspace(p_member);
 a:=public.conversation_actions(p_member);
 mode_:=public.doctor_zoe_mode(p_member);
 return jsonb_build_object('workspace',w,'actions',a,'mode',mode_,
  'modeRevision',md5(jsonb_build_array(mode_,public._zoe_takeover_scope())::text));
end$$;
revoke all on function public.doctor_decision_reply(uuid)from public,anon,authenticated,service_role;
grant execute on function public.doctor_decision_reply(uuid)to authenticated;

-- The page and card share conversation_command. The card adds a guard for the shown takeover/consent/topic state.
create function public.doctor_decision_reply_apply(p_member uuid,p_mode_revision text,p_command jsonb)returns jsonb
language plpgsql security definer set search_path=''as $$
declare mode_ jsonb;
begin
 perform public._conversation_user(p_member,true);
 if not public.staff_care_access(p_member,auth.uid(),true)then raise insufficient_privilege;end if;
 if p_command->>'purpose' is distinct from 'reply.approve'
  or coalesce(p_command->>'intentId','')!~'^[a-f0-9]{32}$' then return jsonb_build_object('ok',false,'code','invalid_command');end if;
 if not exists(select 1 from public.conversation_intents i join public.conversation_drafts d on d.id=i.draft_id
  join public.conversations c on c.id=d.conversation_id where i.id=(p_command->>'intentId')::uuid and c.member_id=p_member)
  then return jsonb_build_object('ok',false,'code','intent_unknown');end if;
 -- Consent inserts and topic/switch changes cannot race the displayed takeover effect.
 lock table public.zoe_settings,public.zoe_consents in share mode nowait;
 mode_:=public.doctor_zoe_mode(p_member);
 if p_mode_revision is distinct from md5(jsonb_build_array(mode_,public._zoe_takeover_scope())::text)
  then return jsonb_build_object('ok',false,'code','stale_context');end if;
 return public.conversation_command(p_command);
end$$;
revoke all on function public.doctor_decision_reply_apply(uuid,text,jsonb)from public,anon,authenticated,service_role;
grant execute on function public.doctor_decision_reply_apply(uuid,text,jsonb)to authenticated;
