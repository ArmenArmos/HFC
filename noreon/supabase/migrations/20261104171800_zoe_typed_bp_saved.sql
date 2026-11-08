-- Gohar's production QA (QA msg 267, 4 Nov): a typed 185/115 in the chat was answered with the fixed repeat line and
-- "I've passed this to your doctor", but nothing was saved. A typed reading lived only in the chat text, so the doctor's record
-- showed no reading, no quiet note was left, and a typed repeat could never raise an alert (every note and alert comes from the
-- save of a measurement: _bp_check_saved). Lead's decision, 4 Nov: a typed very high reading is saved at once as member-reported.
--
-- zoe_run_bp_typed_save: the run names the member (the worker never does), the same way zoe_run_medicines_add does. One row per
-- member message and reading (a replay, a second run over the same unanswered message, or a concurrent one writes nothing more),
-- entry_source patient_text_entry (the label the V3 text entry already uses: the member typed it, nobody measured it for them),
-- measured_at the time the member wrote it. The existing save trigger then leaves the quiet note for a first reading and raises the
-- alert for a repeat. The answer says whether that measurement's own note or alert row exists now, and the reply claims the doctor has it only
-- then: the trigger swallows a failed note or alert (a retry sweep finishes it), so the save alone proves nothing.
create function public.zoe_run_bp_typed_save(p_run uuid,p_message_seq bigint,p_index integer,p_systolic integer,p_diastolic integer)returns jsonb
language plpgsql security definer set search_path=''as $$
declare r public.zoe_runs;m public.conversation_messages;sid uuid;mid uuid;
begin
 if auth.role()is distinct from 'service_role'then raise insufficient_privilege;end if;
 select * into r from public.zoe_runs where id=p_run;
 if not found or r.state<>'started'
  or p_message_seq is null or p_index is null or p_index not between 0 and 19
  or p_systolic is null or p_diastolic is null
  or p_systolic not between 60 and 300 or p_diastolic not between 30 and 200 or p_diastolic>=p_systolic then return jsonb_build_object('ok',false,'code','invalid');end if;
 -- A staff account's chat is theirs, not a member's record.
 if exists(select 1 from public.workspace_staff where user_id=r.member_id)then return jsonb_build_object('ok',false,'code','invalid');end if;
 -- The member's own message in this conversation, no newer than the run's: its time is when the reading was taken.
 select * into m from public.conversation_messages where conversation_id=r.conversation_id and seq=p_message_seq and author_id=r.member_id and seq<=r.message_seq;
 if not found then return jsonb_build_object('ok',false,'code','invalid');end if;
 sid:=md5('zoe-typed-bp:'||r.conversation_id::text||':'||p_message_seq::text||':'||p_index::text)::uuid;
 insert into public.patient_measurements(user_id,submission_id,systolic,diastolic,measured_at,entry_source)
 values(r.member_id,sid,p_systolic,p_diastolic,m.created_at,'patient_text_entry')
 on conflict(user_id,submission_id)do nothing;
 select id into mid from public.patient_measurements where user_id=r.member_id and submission_id=sid;
 return jsonb_build_object('ok',true,'notified',
  exists(select 1 from public.bp_repeat_notes n where n.member_id=r.member_id and n.measurement_id=mid and n.closed_at is null)
  -- This measurement's own alert: the screening the save wrote (source_ref is the measurement), not any older open alert.
  or exists(select 1 from public.care_alert_screenings s join public.care_alerts a on a.id=s.alert_id
   where s.member_id=r.member_id and s.source='reading'and s.source_ref=mid::text and a.state<>'resolved'));
end$$;
revoke all on function public.zoe_run_bp_typed_save(uuid,bigint,integer,integer,integer)from public,anon,authenticated,service_role;
grant execute on function public.zoe_run_bp_typed_save(uuid,bigint,integer,integer,integer)to service_role;
