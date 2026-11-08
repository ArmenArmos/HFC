\set ON_ERROR_STOP on
begin;
set local role service_role;
select public.configure_patient_message_spend((select revision from public.patient_message_spend_policy where id=1),'{"enabled":true,"currency":"USD","daily_limit_micros":5000000,"sms_segment_ceiling_micros":100000,"whatsapp_message_ceiling_micros":100000,"max_sms_segments":1,"allowed_prefixes":["+374"]}'::jsonb||jsonb_build_object('valid_until',clock_timestamp()+interval '1 day'),'verify-test');
do $$declare r jsonb;t uuid;f jsonb;begin
 begin perform public.claim_auth_sms_verify_hook('verify-disabled',repeat('a',64),repeat('b',64),repeat('a',64));raise exception 'TEST default enabled';exception when others then if sqlerrm<>'Verify spending unconfigured' then raise;end if;end;
 perform public.configure_auth_verify_spend((select revision from public.patient_message_spend_policy where id=1),2500000,'verify-test');
 begin perform public.claim_auth_sms_hook('verify-bypass',repeat('a',64),'twilio-verify','sms');raise exception 'TEST unbound verify';exception when others then if sqlerrm<>'invalid' then raise;end if;end;
 r:=public.claim_auth_sms_verify_hook('verify-one',repeat('a',64),repeat('b',64),repeat('1',64));t:=(r->>'claimToken')::uuid;
 if r->>'status'<>'send' then raise exception 'TEST no claim';end if;
 if (select amount_micros from public.auth_sms_hook_attempts where webhook_id='verify-one')<>2500000 then raise exception 'TEST wrong reservation';end if;
 if public.claim_auth_verify_feedback(repeat('b',64)) is not null then raise exception 'TEST unaccepted approval';end if;
 begin perform public.finish_auth_sms_hook('verify-one',t,'accepted','SM'||repeat('1',32));raise exception 'TEST SM receipt accepted';exception when others then if sqlerrm<>'invalid' then raise;end if;end;
 perform public.finish_auth_sms_hook('verify-one',t,'accepted','VE'||repeat('1',32));
 if public.claim_auth_verify_feedback(repeat('c',64)) is not null then raise exception 'TEST wrong code approved';end if;
 f:=public.claim_auth_verify_feedback(repeat('b',64));
 if f->>'reference'<>'VE'||repeat('1',32) then raise exception 'TEST wrong VE';end if;
 if public.claim_auth_verify_feedback(repeat('b',64)) is not null then raise exception 'TEST duplicate feedback';end if;
 if public.finish_auth_verify_feedback('verify-one',gen_random_uuid(),'accepted') then raise exception 'TEST wrong token';end if;
 if not public.finish_auth_verify_feedback('verify-one',(f->>'claimToken')::uuid,'unknown') then raise exception 'TEST unknown not durable';end if;
 if public.claim_auth_verify_feedback(repeat('b',64)) is not null then raise exception 'TEST unknown resubmitted';end if;
 r:=public.claim_auth_sms_verify_hook('verify-two',repeat('d',64),repeat('e',64),repeat('d',64));
 begin perform public.claim_auth_sms_verify_hook('verify-three',repeat('f',64),repeat('0',64),repeat('f',64));raise exception 'TEST $5 ceiling exceeded';exception when others then if sqlerrm<>'message spending limit' then raise;end if;end;
 begin perform public.claim_auth_sms_verify_hook('verify-one',repeat('a',64),repeat('f',64),repeat('1',64));raise exception 'TEST association mutated';exception when others then if sqlerrm<>'auth hook conflict' then raise;end if;end;
end $$;
reset role;
do $$begin
 if has_function_privilege('anon','public.claim_auth_sms_verify_hook(text,text,text)','execute') or has_function_privilege('authenticated','public.claim_auth_verify_feedback(text)','execute') or has_function_privilege('service_role','public.claim_auth_sms_hook_bound(text,text,text,text,text)','execute') or has_table_privilege('service_role','public.auth_verify_feedback','insert') then raise exception 'TEST broad privileges';end if;
 if not (select relrowsecurity from pg_class where oid='public.auth_verify_feedback'::regclass) then raise exception 'TEST no RLS';end if;
end $$;
rollback;
\echo Verify budget, provider binding, immutable association, feedback claim and privilege guards pass.
