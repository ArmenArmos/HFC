begin;
create function pg_temp.check_true(ok boolean,msg text) returns void language plpgsql as $$ begin if ok is distinct from true then raise exception 'TEST: %',msg; end if; end $$;
do $$
declare c uuid:=gen_random_uuid();d uuid:=gen_random_uuid();cl uuid:=gen_random_uuid();s jsonb;w jsonb;draft jsonb;rev integer;ev bigint;oldcare jsonb;oldorder text;due timestamptz:=date_trunc('minute',now());oldack jsonb;
begin
 insert into auth.users(id) values(d);
 insert into public.workspace_clinics(id,name) values(cl,'Fictional continuity clinic');
 insert into public.workspace_staff(user_id,role,display_name,clinic_id) values(d,'doctor','Fictional doctor',cl);
 draft:=jsonb_build_object('explanation','Reviewed','instructions','Fictional plan','followUp','','medicationName','Example','medicationDose','Example dose','medicationInstructions','','medicationTimes',jsonb_build_array(to_char(due at time zone 'Asia/Yerevan','HH24:MI')));
 w:=jsonb_build_object('revision',0,'startedAt',now(),'tests','[]'::jsonb,'receivedTestIds','[]'::jsonb,'allResultsAt',now(),'consultation','not-required','draft',draft,'draftSaved',false,'publication',null);
 s:=jsonb_build_object('userId',c,'expiresAt',extract(epoch from now()+interval '1 day')*1000,'state',jsonb_build_object('consentAccepted',true,'assessment',jsonb_build_object('completedAt',now(),'urgentRule',null)));
 perform public.workspace_create_case(c,s,d);rev:=public.workspace_initialize_workflow(c,0,w);
 select evidence_revision into ev from public.workspace_cases where id=c;
 rev:=public.workspace_save_review_draft(c,d,rev,ev,draft);
 rev:=public.workspace_publish_review(c,d,rev,ev);
 -- Advance a fictional published order into the past to exercise a now-due check-in without clock sleeps.
 update public.workspace_cases set state=jsonb_set(state,'{workflow,medicationOrders,0,effectiveAt}',to_jsonb(now()-interval '1 hour')) where id=c;
 select state#>>'{workflow,publication,medicationOrderId}' into oldorder from public.workspace_cases where id=c;
 rev:=public.workspace_acknowledge_plan(c,rev,'workflow-plan-1');
 select state#>'{care,acknowledgements,0}' into oldack from public.workspace_cases where id=c;
 perform pg_temp.check_true(public.workspace_acknowledge_plan(c,rev,'workflow-plan-1')=rev,'acknowledgement is idempotent');

 -- Both tabs rendered no report (dose revision 0). A commits, then B's action reads a fresh case snapshot.
 rev:=public.workspace_report_dose_versioned(c,rev,'workflow-plan-1',oldorder,due,'taken',0);
 select state#>'{care,events,0}' into oldcare from public.workspace_cases where id=c;
 perform pg_temp.check_true((oldcare->>'revision')::bigint=1,'first report revision');
 perform pg_temp.check_true(public.workspace_report_dose_versioned(c,rev,'workflow-plan-1',oldorder,due,'taken',0)=rev,'lost-response retry is idempotent');
 begin perform public.workspace_report_dose_versioned(c,rev,'workflow-plan-1',oldorder,due,'skipped',0);raise exception 'TEST: stale tab overwrote first report';exception when others then if sqlerrm<>'dose revision conflict' then raise;end if;end;
 rev:=public.workspace_report_dose_versioned(c,rev,'workflow-plan-1',oldorder,due,'skipped',1);
 rev:=public.workspace_report_dose_versioned(c,rev,'workflow-plan-1',oldorder,due,'taken',2);
 begin perform public.workspace_report_dose_versioned(c,rev,'workflow-plan-1',oldorder,due,'taken',0);raise exception 'TEST: ABA stale retry accepted';exception when others then if sqlerrm<>'dose revision conflict' then raise;end if;end;
 begin perform public.workspace_report_dose(c,rev,'workflow-plan-1',oldorder,due,'taken');raise exception 'TEST: legacy bypass accepted';exception when others then if sqlerrm<>'dose revision conflict' then raise;end if;end;
 perform pg_temp.check_true(public.workspace_report_dose_versioned(c,rev,'workflow-plan-1',oldorder,due,'taken',3)=rev,'unchanged current report is no-op');
 perform pg_temp.check_true((select count(*)=3 from public.workspace_dose_event_history where case_id=c),'all reports retained, retries absent');
 perform pg_temp.check_true(jsonb_array_length(public.workspace_case_snapshot(c)->'doseHistory')=3,'member snapshot retains correction history');
 perform pg_temp.check_true(public.workspace_case_snapshot(gen_random_uuid()) is null,'unknown case cannot read another case history');
 insert into public.workspace_dose_event_history(case_id,medication_id,due_at,revision,status,recorded_at,kind) values(c,oldorder,due-interval '31 days',1,'taken',due-interval '31 days','baseline');
 perform pg_temp.check_true(jsonb_array_length(public.workspace_case_snapshot(c)->'doseHistory')=3,'member history uses past 30 days while older audit remains stored');
 perform pg_temp.check_true((select status='taken' and recorded_at=(oldcare->>'recordedAt')::timestamptz and plan_id='workflow-plan-1' from public.workspace_dose_event_history where case_id=c and due_at=due and revision=1),'original report retained');
 -- A fresh unrelated case revision does not alter the per-dose token.
 update public.workspace_cases set revision=revision+1 where id=c returning revision into rev;
 rev:=public.workspace_report_dose_versioned(c,rev,'workflow-plan-1',oldorder,due,'skipped',3);
 begin perform public.workspace_report_dose_versioned(c,rev-1,'workflow-plan-1',oldorder,due,'taken',4);raise exception 'TEST: case CAS bypass';exception when others then if sqlerrm<>'workspace case conflict' then raise;end if;end;
 begin perform public.workspace_report_dose_versioned(c,rev,'workflow-plan-0',oldorder,due,'skipped',3);raise exception 'TEST: retry bypassed plan validator';exception when others then if sqlerrm not like '%care plan changed%' then raise;end if;end;
 begin perform public.workspace_report_dose_versioned(c,rev,'workflow-plan-1',oldorder,due+interval '1 day','taken',0);raise exception 'TEST: future dose';exception when others then if sqlerrm not like '%not available for check-in%' then raise;end if;end;
 begin perform public.workspace_report_dose_versioned(c,rev,'workflow-plan-1',oldorder,due-interval '1 minute','taken',0);raise exception 'TEST: unscheduled dose';exception when others then if sqlerrm not like '%not available for check-in%' then raise;end if;end;
 update public.workspace_cases set state=jsonb_set(state,'{workflow,medicationOrders,0,effectiveAt}',to_jsonb(due+interval '1 second')) where id=c;
 begin perform public.workspace_report_dose_versioned(c,rev,'workflow-plan-1',oldorder,due,'skipped',3);raise exception 'TEST: retry bypassed effective time';exception when others then if sqlerrm not like '%not available for check-in%' then raise;end if;end;
 update public.workspace_cases set state=jsonb_set(state,'{workflow,medicationOrders,0,effectiveAt}',to_jsonb(due-interval '1 hour')) where id=c;
 update public.workspace_cases set state=jsonb_set(state,'{workflow,medicationOrders,0,retiredAt}',to_jsonb(due)) where id=c;
 begin perform public.workspace_report_dose_versioned(c,rev,'workflow-plan-1',oldorder,due,'skipped',3);raise exception 'TEST: retry bypassed retired order';exception when others then if sqlerrm not like '%not available for check-in%' then raise;end if;end;
 update public.workspace_cases set state=jsonb_set(state,'{workflow,medicationOrders,0,retiredAt}','null') where id=c;
 -- Simulate a pre-migration report (no revision, unknown original plan). Baseline is retained on first correction.
 delete from public.workspace_dose_event_history where case_id=c;
 update public.workspace_cases set state=jsonb_set(state,'{care,events}',jsonb_build_array(oldcare-'revision'-'planId')) where id=c;
 begin perform public.workspace_report_dose(c,rev,'workflow-plan-1',oldorder,due,'skipped');raise exception 'TEST: old client corrected baseline';exception when others then if sqlerrm<>'dose revision conflict' then raise;end if;end;
 rev:=public.workspace_report_dose_versioned(c,rev,'workflow-plan-1',oldorder,due,'skipped',1);
 perform pg_temp.check_true((select count(*)=2 from public.workspace_dose_event_history where case_id=c),'baseline plus correction');
 perform pg_temp.check_true((select kind='baseline' and plan_id is null and status='taken' from public.workspace_dose_event_history where case_id=c and due_at=due and revision=1),'legacy context preserved');
 perform pg_temp.check_true((select state#>>'{care,events,0,planId}' is null and state#>>'{care,events,0,revision}'='2' from public.workspace_cases where id=c),'corrected baseline projection');
 perform pg_temp.check_true(not has_table_privilege('service_role','public.workspace_dose_event_history','INSERT') and not has_table_privilege('authenticated','public.workspace_dose_event_history','SELECT'),'history privileges');
 perform pg_temp.check_true(not has_function_privilege('authenticated','public.workspace_report_dose_versioned(uuid,integer,text,text,timestamptz,text,bigint)','EXECUTE'),'versioned command remains server-only');
 update public.workspace_cases set expires_at=now()-interval '1 second' where id=c;
 perform pg_temp.check_true(public.workspace_case_snapshot(c) is null,'expired case history unavailable');
end $$;
rollback;
