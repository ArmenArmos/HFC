-- Unsupported source-specific obligations remain blocked, without inventing a deadline or clearance.
create or replace function public.lock_assigned_clinical_case(p_user_id uuid,p_actor uuid,p_revision bigint,p_token text) returns public.patient_clinical_cases
language plpgsql security definer set search_path='' as $$
declare c public.patient_clinical_cases;e jsonb;
begin
 perform public.lock_patient_clinical_sources(p_user_id);
 select * into c from public.patient_clinical_cases where user_id=p_user_id for update nowait;
 if not found or c.assigned_doctor_id is distinct from p_actor or not exists(select 1 from public.workspace_staff s join public.workspace_clinics k on k.id=s.clinic_id where s.user_id=p_actor and s.role='doctor' and s.active and k.active) then raise insufficient_privilege using message='Assigned active doctor required';end if;
 if c.revision is distinct from p_revision then raise serialization_failure using message='Case changed. Reload and review';end if;
 e:=public.patient_clinical_evidence(p_user_id);
 if e->>'token' is distinct from p_token then raise serialization_failure using message='Evidence changed. Reload and review';end if;
 if e#>>'{data,assessment,completed_at}' is null or e#>>'{data,assessment,urgent_rule}' is not null or e#>'{data,consent}'='null'::jsonb then raise exception 'Complete questionnaire and resolve urgent guidance';end if;
 -- Existing NRN clinical THRESHOLD: >=180 systolic OR >=110 diastolic.
 -- No reading-linked native symptom triage/resolution exists: no implicit clearance.
 if exists(select 1 from public.patient_measurements where user_id=p_user_id and (systolic>=180 or diastolic>=110)) then raise exception 'Routine review is on hold: recorded crisis-range blood pressure has no linked symptom triage or resolution. Arrange clinical assessment; later normal readings do not clear this hold.';end if;
 if c.review#>>'{engine,urgency}'='orange' then raise exception 'Native source-specific mandatory consultation pathway unavailable';end if;
 return c;
end $$;
create or replace function public.prepare_patient_clinical_review(p_user_id uuid,p_actor uuid,p_expected_revision bigint,p_evidence_token text,p_engine jsonb) returns bigint
language plpgsql security definer set search_path='' as $$
declare c public.patient_clinical_cases;n bigint;
begin
 if p_engine->>'urgency'='orange' then raise exception 'Native source-specific mandatory consultation pathway unavailable';end if;
 c:=public.lock_assigned_clinical_case(p_user_id,p_actor,p_expected_revision,p_evidence_token);
 if jsonb_typeof(p_engine)<>'object' or nullif(p_engine->>'version','') is null or coalesce(p_engine->>'urgency','') not in ('green','yellow','orange') or jsonb_typeof(p_engine->'tests') is distinct from 'array' or jsonb_array_length(p_engine->'tests')>50 then raise exception 'Trusted clinical recommendations unavailable';end if;
 if exists(select 1 from jsonb_array_elements(p_engine->'tests') t where nullif(t->>'id','') is null or nullif(t->>'title','') is null or t->>'method' not in ('lab','clinic','home-log')) or (select count(*)<>count(distinct t->>'id') from jsonb_array_elements(p_engine->'tests') t) then raise exception 'Invalid trusted requirements';end if;
 if c.review->>'evidenceToken'=p_evidence_token and c.review->'engine'=p_engine and c.review->>'doctorId'=p_actor::text then return c.revision;end if;
 update public.patient_clinical_cases set review=jsonb_build_object('evidenceToken',p_evidence_token,'doctorId',p_actor,'preparedAt',now(),'engine',p_engine,'approvals','{}'::jsonb,'receipts','{}'::jsonb,'consultation',jsonb_build_object('decision','undecided')),revision=revision+1,updated_at=now() where user_id=p_user_id returning revision into n;
 insert into public.patient_clinical_case_events(user_id,revision,kind,actor_id,detail) values(p_user_id,n,'review-prepared',p_actor,jsonb_build_object('evidenceToken',p_evidence_token,'engineVersion',p_engine->>'version'));
 return n;
end $$;
