\set ON_ERROR_STOP on
begin;
set local role service_role;
select public.configure_patient_message_spend((select revision from public.patient_message_spend_policy where id=1),'{"enabled":true,"currency":"USD","daily_limit_micros":5000000,"sms_segment_ceiling_micros":1000000,"whatsapp_message_ceiling_micros":1000000,"max_sms_segments":1,"allowed_prefixes":["+374"]}'::jsonb||jsonb_build_object('valid_until',clock_timestamp()+interval '1 day'),'test-operator');
do $$declare r jsonb;t uuid;begin
 r:=public.claim_auth_sms_hook('test-twilio',repeat('a',64),'twilio','sms');t:=(r->>'claimToken')::uuid;
 if r->>'status'<>'send' then raise exception 'TEST no Twilio claim';end if;
 begin perform public.claim_auth_sms_hook('test-twilio',repeat('a',64),'brevo','sms');raise exception 'TEST provider change allowed';exception when others then if sqlerrm<>'auth hook conflict' then raise;end if;end;
 begin perform public.claim_auth_sms_hook('test-twilio',repeat('b',64),'twilio','sms');raise exception 'TEST body change allowed';exception when others then if sqlerrm<>'auth hook conflict' then raise;end if;end;
 begin perform public.claim_auth_sms_hook('test-wa',repeat('a',64),'twilio','whatsapp');raise exception 'TEST channel change allowed';exception when others then if sqlerrm<>'invalid' then raise;end if;end;
 begin perform public.finish_auth_sms_hook('test-twilio',t,'accepted','12345');raise exception 'TEST numeric Twilio receipt allowed';exception when others then if sqlerrm<>'invalid' then raise;end if;end;
 if not public.finish_auth_sms_hook('test-twilio',t,'accepted','SM'||repeat('a',32)) then raise exception 'TEST Twilio receipt not saved';end if;
 if public.claim_auth_sms_hook('test-twilio',repeat('a',64),'twilio','sms')->>'status'<>'accepted' then raise exception 'TEST replay sent';end if;
 if public.finish_auth_sms_hook('test-twilio',t,'accepted','MM'||repeat('b',32)) then raise exception 'TEST receipt changed';end if;
 r:=public.claim_auth_sms_hook('test-brevo',repeat('c',64));t:=(r->>'claimToken')::uuid;
 begin perform public.finish_auth_sms_hook('test-brevo',t,'accepted','SM'||repeat('a',32));raise exception 'TEST SID Brevo receipt allowed';exception when others then if sqlerrm<>'invalid' then raise;end if;end;
 if not public.finish_auth_sms_hook('test-brevo',t,'accepted','12345') then raise exception 'TEST old Brevo call broken';end if;
end$$;
reset role;
do $$begin
 if not (select relrowsecurity from pg_class where oid='public.auth_sms_hook_attempts'::regclass) then raise exception 'TEST RLS missing';end if;
 if has_function_privilege('anon','public.claim_auth_sms_hook(text,text,text,text)','execute') or has_function_privilege('authenticated','public.claim_auth_sms_hook(text,text,text,text)','execute') or has_table_privilege('service_role','public.auth_sms_hook_attempts','update') then raise exception 'TEST broad privileges';end if;
 begin update public.auth_sms_hook_attempts set provider='brevo' where webhook_id='test-twilio';raise exception 'TEST binding mutable';exception when others then if sqlerrm<>'auth hook binding immutable' then raise;end if;end;
end$$;
rollback;
\echo Twilio provider/channel binding, receipt validation, RLS and immutable replay pass.
