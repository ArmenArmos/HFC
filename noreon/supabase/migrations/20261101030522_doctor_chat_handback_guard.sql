-- Inline conversation cards retain the existing assigned-doctor conversation and handback paths.
-- Add a displayed version + takeover/consent/scope guard atomically, rather than a racy application preflight.
create function public.doctor_chat_conversation(p_member uuid)returns jsonb
language plpgsql security definer set search_path=''as $$
declare w jsonb;m jsonb;
begin
 -- Existing authorization locks the case then the conversation, fencing reassignment and new messages.
 perform public._conversation_user(p_member,true);
 if not public.staff_care_access(p_member,auth.uid(),true)then raise insufficient_privilege;end if;
 lock table public.zoe_settings,public.zoe_consents in share mode nowait;
 w:=public.conversation_workspace(p_member);
 m:=public.doctor_zoe_mode(p_member);
 -- Member-specific open-window state includes reviewed rows, so a reviewed thread can still be reopened.
 -- conversation_workspace already audits this member under the same assignment/conversation locks.
 return jsonb_build_object('workspace',w,'mode',m,'zoeReview',public._zoe_answered_open((w->>'conversationId')::uuid),
  'modeRevision',md5(jsonb_build_array(m,public._zoe_takeover_scope())::text));
end$$;

create function public.doctor_chat_hand_back(p_member uuid,p_version bigint,p_mode_revision text)returns jsonb
language plpgsql security definer set search_path=''as $$
declare c public.conversations;m jsonb;
begin
 perform public._conversation_user(p_member,true);
 if not public.staff_care_access(p_member,auth.uid(),true)then raise insufficient_privilege;end if;
 if p_version is null or p_version<0 or p_mode_revision is null or p_mode_revision!~'^[a-f0-9]{32}$'then
  return jsonb_build_object('ok',false,'code','invalid');end if;
 -- Same lock order as the conversation/reply paths: case, conversation, then settings/consents.
 lock table public.zoe_settings,public.zoe_consents in share mode nowait;
 select * into c from public.conversations where member_id=p_member;
 m:=public.doctor_zoe_mode(p_member);
 -- Availability is checked under the same settings/consent locks, including a stale active card.
 if not(m->>'zoeActive')::boolean then return jsonb_build_object('ok',false,'code','zoe_inactive');end if;
 -- A retry after success is harmless, but a later takeover must still pass both displayed guards.
 if not(m->>'doctorMode')::boolean then return public.doctor_zoe_hand_back(p_member);end if;
 if c.id is null or c.version is distinct from p_version
  or p_mode_revision is distinct from md5(jsonb_build_array(m,public._zoe_takeover_scope())::text)then
  return jsonb_build_object('ok',false,'code','stale_context');end if;
 -- Owns the audit, mode transition, and at most one existing member notification. No new send path.
 return public.doctor_zoe_hand_back(p_member);
end$$;
revoke all on function public.doctor_chat_conversation(uuid),public.doctor_chat_hand_back(uuid,bigint,text)from public,anon,authenticated,service_role;
grant execute on function public.doctor_chat_conversation(uuid),public.doctor_chat_hand_back(uuid,bigint,text)to authenticated;

-- Resolution keeps the existing role policy and sequence guard, fenced against reassignment.
create or replace function public.care_alert_resolve(p_alert uuid,p_expected_seq bigint,p_resolution text,p_note text)returns jsonb
language plpgsql security definer set search_path=''as $$
declare actor jsonb:=public._care_alert_actor();a public.care_alerts;m uuid;has_case boolean;note text:=nullif(btrim(p_note),'');
begin
 if p_resolution is null or p_resolution not in('member_contacted','emergency_care_advised','no_action_needed','duplicate','other')
  or length(note)>1000 or(p_resolution='other'and note is null)then return jsonb_build_object('ok',false,'code','invalid');end if;
 -- Read only the member key first. Lock in the conversation authorization order:
 -- account, case, invitation, session, staff, then the alert. Never alert before case.
 select member_id into m from public.care_alerts where id=p_alert;
 if not found then return jsonb_build_object('ok',false,'code','not_found');end if;
 perform 1 from auth.users where id=auth.uid()for share nowait;
 perform 1 from public.patient_clinical_cases where user_id=m for update nowait;
 has_case:=found;
 perform 1 from public.real_staff_invitations where auth_user_id=auth.uid()for share nowait;
 perform 1 from auth.sessions where id::text=auth.jwt()->>'session_id'and user_id=auth.uid()for share nowait;
 perform 1 from public.workspace_staff where user_id=auth.uid()for share nowait;
 -- Re-read role/session after acquiring the locks. The early actor check is not authorization to commit.
 actor:=public._care_alert_actor();
 -- Admins retain access to alerts raised before a clinical case exists. Doctors require the locked case.
 if not has_case and actor->>'role'<>'admin'then return jsonb_build_object('ok',false,'code','not_found');end if;
 select * into a from public.care_alerts where id=p_alert and member_id=m for update;
 if not found or not public._care_alert_visible(a,actor)then return jsonb_build_object('ok',false,'code','not_found');end if;
 if a.state='resolved'then return jsonb_build_object('ok',true,'changed',false,'alert',public._care_alert_json(a));end if;
 if a.state_seq is distinct from p_expected_seq then return jsonb_build_object('ok',false,'code','changed','alert',public._care_alert_json(a));end if;
 update public.care_alerts set state='resolved',
  acknowledged_by=coalesce(acknowledged_by,(actor->>'id')::uuid),acknowledged_at=coalesce(acknowledged_at,clock_timestamp()),
  resolved_by=(actor->>'id')::uuid,resolved_at=clock_timestamp(),resolution=p_resolution,resolution_note=note,state_seq=state_seq+1
 where id=a.id returning * into a;
 insert into public.care_alert_audit(alert_id,actor_id,kind,detail)values(a.id,(actor->>'id')::uuid,'resolved',jsonb_build_object('role',actor->>'role','resolution',p_resolution,'note',note is not null));
 perform public._care_alert_trace(a,'care_alert.resolved','recorded',p_resolution,public._conversation_trace_actor(),(actor->>'id')::uuid,
  jsonb_build_object('noreon.care_alert.note_written',note is not null));
 return jsonb_build_object('ok',true,'changed',true,'alert',public._care_alert_json(a));
end$$;
