\set ON_ERROR_STOP on
begin;
select public.configure_patient_message_spend((select revision from public.patient_message_spend_policy where id=1),'{"enabled":true,"currency":"USD","daily_limit_micros":5000000,"sms_segment_ceiling_micros":100000,"whatsapp_message_ceiling_micros":100000,"max_sms_segments":1,"allowed_prefixes":["+374"]}'::jsonb||jsonb_build_object('valid_until',clock_timestamp()+interval '1 day'),'verify-recovery-test');
select public.configure_auth_verify_spend((select revision from public.patient_message_spend_policy where id=1),100000,'verify-recovery-test');
set local role service_role;
do $$declare r jsonb;begin
 r:=public.claim_auth_sms_verify_hook('recover-failed',repeat('a',64),repeat('a',64),repeat('1',64));
 perform public.finish_auth_sms_hook('recover-failed',(r->>'claimToken')::uuid,'failed');
 begin perform public.recover_failed_auth_verify_recipient('recover-failed','bad actor');raise exception 'TEST invalid operator accepted';exception when others then if sqlerrm<>'invalid operator' then raise;end if;end;
 if public.recover_failed_auth_verify_recipient('wrong-webhook','test-operator') then raise exception 'TEST wrong CAS accepted';end if;
 if not public.recover_failed_auth_verify_recipient('recover-failed','test-operator') then raise exception 'TEST failed initial send remains stuck';end if;
 if public.recover_failed_auth_verify_recipient('recover-failed','test-operator') then raise exception 'TEST duplicate recovery';end if;
 if (select active_webhook_id from public.auth_verify_recipients where recipient_digest=repeat('1',64)) is not null then raise exception 'TEST binding not released';end if;
 if (select reserved_micros from public.patient_message_spend_totals where currency='USD')<>100000 then raise exception 'TEST refunded reservation';end if;
 if (select status from public.auth_sms_hook_attempts where webhook_id='recover-failed')<>'failed' then raise exception 'TEST outcome changed';end if;
 if (select paused_reason from public.patient_message_dispatch_control where id=1) is null then raise exception 'TEST automatically resumed';end if;
 if (select count(*) from public.auth_verify_recovery_events where webhook_id='recover-failed' and operator_label='test-operator')<>1 then raise exception 'TEST missing audit';end if;
 begin perform public.claim_auth_sms_verify_hook('recover-new',repeat('b',64),repeat('b',64),repeat('1',64));raise exception 'TEST pause bypass';exception when others then if sqlerrm<>'message dispatch paused' then raise;end if;end;
 perform public.resume_patient_message_dispatch((select revision from public.patient_message_dispatch_control where id=1),'configuration-checked',null,'test-operator');
 r:=public.claim_auth_sms_verify_hook('recover-new',repeat('b',64),repeat('b',64),repeat('1',64));
 if r->>'status'<>'send' then raise exception 'TEST fresh send blocked after explicit resume';end if;
 if (select reserved_micros from public.patient_message_spend_totals where currency='USD')<>200000 then raise exception 'TEST new attempt not reserved';end if;
end $$;
reset role;
-- Negative states are synthetic fixtures in this rolled-back transaction only.
do $$declare r jsonb;state text;n integer:=2;begin
 for state in select unnest(array['submitting','unknown','accepted','failed']) loop
  n:=n+1;update public.patient_message_dispatch_control set paused_reason=null,paused_at=null where id=1;
  r:=public.claim_auth_sms_verify_hook('recover-negative-'||state,repeat(n::text,64),repeat(n::text,64),repeat(n::text,64));
  if state<>'submitting' then perform public.finish_auth_sms_hook('recover-negative-'||state,(r->>'claimToken')::uuid,state,case when state='accepted' then 'VE'||repeat('a',32) else null end);end if;
  update public.patient_message_dispatch_control set paused_reason='provider-rejected',paused_at=clock_timestamp() where id=1;
  if state='failed' then
   update public.patient_message_dispatch_control set paused_reason=null,paused_at=null where id=1;
   if public.recover_failed_auth_verify_recipient('recover-negative-'||state,'test-operator') then raise exception 'TEST unpaused recovery';end if;
   update public.patient_message_dispatch_control set paused_reason='provider-rejected',paused_at=clock_timestamp() where id=1;
   insert into public.auth_verify_feedback(webhook_id,provider_reference,status)values('recover-negative-'||state,'VE'||repeat('f',32),'failed');
  end if;
  if public.recover_failed_auth_verify_recipient('recover-negative-'||state,'test-operator') then raise exception 'TEST unsafe recovery %',state;end if;
 end loop;
 update public.patient_message_dispatch_control set paused_reason=null,paused_at=null where id=1;
 r:=public.claim_auth_sms_verify_hook('recover-predecessor',repeat('7',64),repeat('7',64),repeat('7',64));
 perform public.finish_auth_sms_hook('recover-predecessor',(r->>'claimToken')::uuid,'accepted','VE'||repeat('7',32));
 r:=public.claim_auth_sms_verify_hook('recover-cancel-failed',repeat('8',64),repeat('8',64),repeat('7',64));
 perform public.finish_auth_sms_hook('recover-cancel-failed',(r->>'claimToken')::uuid,'failed');
 if public.recover_failed_auth_verify_recipient('recover-cancel-failed','test-operator') then raise exception 'TEST predecessor forgotten';end if;
 if has_function_privilege('anon','public.recover_failed_auth_verify_recipient(text,text)','execute') or has_function_privilege('authenticated','public.recover_failed_auth_verify_recipient(text,text)','execute') or has_table_privilege('service_role','public.auth_verify_recovery_events','insert') then raise exception 'TEST broad recovery privileges';end if;
 if not (select relrowsecurity from pg_class where oid='public.auth_verify_recovery_events'::regclass) then raise exception 'TEST missing RLS';end if;
end $$;
rollback;
\echo Audited failed-initial-send recovery, CAS, retained budget and unsafe-state rejection pass.
