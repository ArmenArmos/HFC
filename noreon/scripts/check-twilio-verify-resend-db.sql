\set ON_ERROR_STOP on
begin;
set local role service_role;
select public.configure_patient_message_spend((select revision from public.patient_message_spend_policy where id=1),'{"enabled":true,"currency":"USD","daily_limit_micros":5000000,"sms_segment_ceiling_micros":100000,"whatsapp_message_ceiling_micros":100000,"max_sms_segments":1,"allowed_prefixes":["+374"]}'::jsonb||jsonb_build_object('valid_until',clock_timestamp()+interval '1 day'),'verify-resend-test');
select public.configure_auth_verify_spend((select revision from public.patient_message_spend_policy where id=1),1000000,'verify-resend-test');
do $$declare r jsonb;r2 jsonb;f jsonb;begin
 r:=public.claim_auth_sms_verify_hook('resend-a',repeat('a',64),repeat('a',64),repeat('1',64));
 if r->>'status'<>'send' or r ? 'previousReference' then raise exception 'TEST initial receipt';end if;
 begin perform public.claim_auth_sms_verify_hook('resend-b',repeat('b',64),repeat('b',64),repeat('1',64));raise exception 'TEST parallel send';exception when others then if sqlerrm<>'Verify recipient busy' then raise;end if;end;
 perform public.finish_auth_sms_hook('resend-a',(r->>'claimToken')::uuid,'accepted','VE'||repeat('a',32));
 r2:=public.claim_auth_sms_verify_hook('resend-b',repeat('b',64),repeat('b',64),repeat('1',64));
 if r2->>'previousReference'<>'VE'||repeat('a',32) then raise exception 'TEST missing exact cancel reference';end if;
 if public.claim_auth_sms_verify_hook('resend-a',repeat('a',64),repeat('a',64),repeat('1',64))->>'status'<>'failed' then raise exception 'TEST stale canceled replay accepted';end if;
 if public.claim_auth_verify_feedback(repeat('a',64)) is not null then raise exception 'TEST old feedback raced cancel';end if;
 begin perform public.claim_auth_sms_verify_hook('resend-c',repeat('c',64),repeat('c',64),repeat('1',64));raise exception 'TEST parallel resend';exception when others then if sqlerrm<>'Verify recipient busy' then raise;end if;end;
 perform public.finish_auth_sms_hook('resend-b',(r2->>'claimToken')::uuid,'accepted','VE'||repeat('b',32));
 f:=public.claim_auth_verify_feedback(repeat('b',64));
 if f is null then raise exception 'TEST no current feedback';end if;
 begin perform public.claim_auth_sms_verify_hook('resend-c',repeat('c',64),repeat('c',64),repeat('1',64));raise exception 'TEST cancel raced approval';exception when others then if sqlerrm<>'Verify recipient busy' then raise;end if;end;
 perform public.finish_auth_verify_feedback('resend-b',(f->>'claimToken')::uuid,'accepted');
 r:=public.claim_auth_sms_verify_hook('resend-c',repeat('c',64),repeat('c',64),repeat('1',64));
 if r ? 'previousReference' then raise exception 'TEST approved VE canceled';end if;
 perform public.finish_auth_sms_hook('resend-c',(r->>'claimToken')::uuid,'unknown');
 begin perform public.claim_auth_sms_verify_hook('resend-d',repeat('d',64),repeat('d',64),repeat('1',64));raise exception 'TEST uncertain resend';exception when others then if sqlerrm<>'Verify recipient busy' then raise;end if;end;
 begin perform public.claim_auth_sms_verify_hook('legacy-bypass',repeat('e',64),repeat('e',64));raise exception 'TEST legacy bypass';exception when others then if sqlerrm<>'Verify recipient binding required' then raise;end if;end;
end $$;
reset role;
do $$begin
 if has_table_privilege('service_role','public.auth_verify_recipients','update') or has_table_privilege('service_role','public.auth_verify_attempt_bindings','insert') then raise exception 'TEST binding writable';end if;
 if has_function_privilege('anon','public.claim_auth_sms_verify_hook(text,text,text,text)','execute') then raise exception 'TEST anonymous access';end if;
end $$;
rollback;
\echo Recipient serialization, exact predecessor, feedback/cancel races, unknown holds and legacy bypass guards pass.
