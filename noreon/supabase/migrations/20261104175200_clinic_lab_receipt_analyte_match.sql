-- Reserved timestamp: Khikar/integrator, 5 Nov 2026. Required clinic evidence must
-- name the test it satisfies and be dated on or after the questionnaire.
-- Mapping generated from required-lab-match.ts, TEST_CATALOGUE and LAB_ANALYTES.
-- BEGIN generated required lab mapping
create or replace function public._required_lab_mapping() returns jsonb
language sql immutable set search_path='' as $mapping$
 select $json${"panels":{"tsh":{"components":["tsh"]},"nt-probnp":{"components":["nt_probnp"]},"insulin-homa":{"components":["insulin","homa_ir"]},"lipid-panel":{"components":["total_cholesterol","hdl_c","ldl_c","triglycerides"]},"apob":{"components":["apob"]},"lpa":{"components":["lpa"]},"hba1c":{"components":["hba1c"]},"hba1c-glucose":{"components":["hba1c","fasting_glucose"]},"creatinine-egfr":{"components":["creatinine","egfr"]},"urine-acr":{"components":["uacr"]},"potassium":{"components":["potassium"]},"sodium":{"components":["sodium"]},"cbc-hb":{"components":["hemoglobin","red_blood_cells","wbc","platelets"],"undefinedReason":"The catalogue does not define the differential components."},"urinalysis":{"components":[],"undefinedReason":"The catalogue does not define the complete urinalysis components."}},"aliases":[{"key":"egfr","alias":"estimated glomerular filtration rate"},{"key":"esr","alias":"erythrocyte sedimentation rate"},{"key":"urinalysis","alias":"մեզի ընդհանուր հետազոտություն"},{"key":"hba1c","alias":"гликозилированный гемоглобин"},{"key":"tsh","alias":"thyroid stimulating hormone"},{"key":"ast","alias":"aspartate aminotransferase"},{"key":"ggt","alias":"gamma-glutamyl transferase"},{"key":"hba1c","alias":"гликированный гемоглобин"},{"key":"uacr","alias":"albumin/creatinine ratio"},{"key":"uacr","alias":"albumin creatinine ratio"},{"key":"alt","alias":"alanine aminotransferase"},{"key":"fasting_glucose","alias":"fasting plasma glucose"},{"key":"bilirubin_indirect","alias":"unconjugated bilirubin"},{"key":"total_cholesterol","alias":"ընդհանուր խոլեստերին"},{"key":"hba1c","alias":"glycated haemoglobin"},{"key":"hba1c","alias":"գլիկացված հեմոգլոբին"},{"key":"alp","alias":"alkaline phosphatase"},{"key":"bilirubin_total","alias":"ընդհանուր բիլիռուբին"},{"key":"crp","alias":"high sensitivity crp"},{"key":"bilirubin_direct","alias":"conjugated bilirubin"},{"key":"bilirubin_indirect","alias":"անուղղակի բիլիռուբին"},{"key":"non_hdl_c","alias":"non-hdl cholesterol"},{"key":"hba1c","alias":"glycated hemoglobin"},{"key":"non_hdl_c","alias":"ոչ-բխլպ խոլեստերին"},{"key":"non_hdl_c","alias":"холестерин не-лпвп"},{"key":"uacr","alias":"альбумин/креатинин"},{"key":"alp","alias":"щелочная фосфатаза"},{"key":"crp","alias":"c-reactive protein"},{"key":"crp","alias":"с-реактивный белок"},{"key":"bilirubin_direct","alias":"ուղղակի բիլիռուբին"},{"key":"bilirubin_indirect","alias":"indirect bilirubin"},{"key":"bilirubin_indirect","alias":"непрямой билирубин"},{"key":"bilirubin_indirect","alias":"билирубин непрямой"},{"key":"urine_creatinine","alias":"urinary creatinine"},{"key":"total_cholesterol","alias":"total cholesterol"},{"key":"total_cholesterol","alias":"cholesterol total"},{"key":"fasting_glucose","alias":"ծոմային գլյուկոզա"},{"key":"wbc","alias":"white blood cells"},{"key":"urinalysis","alias":"общий анализ мочи"},{"key":"total_cholesterol","alias":"общий холестерин"},{"key":"total_cholesterol","alias":"холестерин общий"},{"key":"apob","alias":"apolipoprotein b"},{"key":"apob","alias":"аполипопротеин b"},{"key":"apob","alias":"ապոլիպոպրոտեին b"},{"key":"folate","alias":"фолиевая кислота"},{"key":"bilirubin_direct","alias":"direct bilirubin"},{"key":"bilirubin_direct","alias":"прямой билирубин"},{"key":"bilirubin_direct","alias":"билирубин прямой"},{"key":"urine_creatinine","alias":"urine creatinine"},{"key":"hdl_c","alias":"hdl cholesterol"},{"key":"hdl_c","alias":"բխլպ խոլեստերին"},{"key":"hdl_c","alias":"холестерин лпвп"},{"key":"ldl_c","alias":"ldl cholesterol"},{"key":"ldl_c","alias":"ցխլպ խոլեստերին"},{"key":"ldl_c","alias":"холестерин лпнп"},{"key":"lpa","alias":"lipoprotein (a)"},{"key":"lpa","alias":"липопротеин (а)"},{"key":"lpa","alias":"լիպոպրոտեին (a)"},{"key":"fasting_glucose","alias":"fasting glucose"},{"key":"fasting_glucose","alias":"глюкоза натощак"},{"key":"insulin","alias":"fasting insulin"},{"key":"bilirubin_total","alias":"total bilirubin"},{"key":"bilirubin_total","alias":"bilirubin total"},{"key":"bilirubin_total","alias":"билирубин общий"},{"key":"bilirubin_total","alias":"общий билирубин"},{"key":"uric_acid","alias":"мочевая кислота"},{"key":"vitamin_d","alias":"25-oh vitamin d"},{"key":"ck","alias":"creatine kinase"},{"key":"urine_glucose","alias":"urinary glucose"},{"key":"red_blood_cells","alias":"red blood cells"},{"key":"triglycerides","alias":"տրիգլիցերիդներ"},{"key":"lpa","alias":"lipoprotein(a)"},{"key":"lpa","alias":"липопротеин(а)"},{"key":"lpa","alias":"լիպոպրոտեին(a)"},{"key":"anti_tpo","alias":"антитела к тпо"},{"key":"urine_creatinine","alias":"креатинин мочи"},{"key":"sodium","alias":"նատրիում (na+)"},{"key":"urinalysis","alias":"urine analysis"},{"key":"urinalysis","alias":"միզի ընդհանուր"},{"key":"triglycerides","alias":"triglycerides"},{"key":"lpa","alias":"lipoprotein a"},{"key":"lpa","alias":"липопротеин а"},{"key":"ck","alias":"креатинкиназа"},{"key":"urine_glucose","alias":"urine glucose"},{"key":"triglycerides","alias":"triglyceride"},{"key":"triglycerides","alias":"триглицериды"},{"key":"platelets","alias":"թրոմբոցիտներ"},{"key":"free_t4","alias":"свободный т4"},{"key":"free_t4","alias":"т4 свободный"},{"key":"homocysteine","alias":"homocysteine"},{"key":"ck","alias":"կրեատինկինազ"},{"key":"urine_glucose","alias":"глюкоза мочи"},{"key":"free_t3","alias":"свободный т3"},{"key":"free_t3","alias":"т3 свободный"},{"key":"potassium","alias":"կալիում (k+)"},{"key":"total_cholesterol","alias":"cholesterol"},{"key":"triglycerides","alias":"տրիգլիցերիդ"},{"key":"hemoglobin","alias":"haemoglobin"},{"key":"wbc","alias":"լեյկոցիտներ"},{"key":"homocysteine","alias":"հոմոցիստեին"},{"key":"homocysteine","alias":"гомоцистеин"},{"key":"vitamin_b12","alias":"vitamin b12"},{"key":"vitamin_b12","alias":"վիտամին b12"},{"key":"vitamin_b12","alias":"витамин b12"},{"key":"total_cholesterol","alias":"խոլեստերին"},{"key":"total_cholesterol","alias":"холестерин"},{"key":"creatinine","alias":"creatinine"},{"key":"bilirubin_total","alias":"բիլիռուբին"},{"key":"hemoglobin","alias":"hemoglobin"},{"key":"hemoglobin","alias":"հեմոգլոբին"},{"key":"hemoglobin","alias":"гемоглобин"},{"key":"wbc","alias":"leukocytes"},{"key":"platelets","alias":"тромбоциты"},{"key":"fibrinogen","alias":"fibrinogen"},{"key":"fibrinogen","alias":"ֆիբրինոգեն"},{"key":"fibrinogen","alias":"фибриноген"},{"key":"folate","alias":"folic acid"},{"key":"magnesium","alias":"մագնեզիում"},{"key":"urinalysis","alias":"urinalysis"},{"key":"non_hdl_c","alias":"non-hdl-c"},{"key":"fasting_glucose","alias":"գլյուկոզա"},{"key":"c_peptide","alias":"c-peptide"},{"key":"c_peptide","alias":"c peptide"},{"key":"creatinine","alias":"կրեատինին"},{"key":"creatinine","alias":"креатинин"},{"key":"urea","alias":"միզանյութ"},{"key":"bilirubin_total","alias":"bilirubin"},{"key":"bilirubin_total","alias":"билирубин"},{"key":"wbc","alias":"лейкоциты"},{"key":"platelets","alias":"platelets"},{"key":"uric_acid","alias":"uric acid"},{"key":"vitamin_d","alias":"vitamin d"},{"key":"vitamin_d","alias":"վիտամին d"},{"key":"vitamin_d","alias":"витамин d"},{"key":"vitamin_b12","alias":"cobalamin"},{"key":"potassium","alias":"potassium"},{"key":"magnesium","alias":"magnesium"},{"key":"potassium","alias":"potassium"},{"key":"nt_probnp","alias":"nt-probnp"},{"key":"nt_probnp","alias":"nt probnp"},{"key":"insulin","alias":"ինսուլին"},{"key":"c_peptide","alias":"c-պեպտիդ"},{"key":"c_peptide","alias":"с-пептид"},{"key":"c_peptide","alias":"c-пептид"},{"key":"uacr","alias":"միզի acr"},{"key":"urea","alias":"мочевина"},{"key":"ggt","alias":"gamma gt"},{"key":"ferritin","alias":"ferritin"},{"key":"ferritin","alias":"ферритин"},{"key":"anti_tpo","alias":"anti-tpo"},{"key":"anti_tpo","alias":"anti tpo"},{"key":"uric_acid","alias":"միզաթթու"},{"key":"sodium","alias":"նատրիում"},{"key":"calcium","alias":"կալցիում"},{"key":"sodium","alias":"նատրիում"},{"key":"hdl_c","alias":"хс-лпвп"},{"key":"ldl_c","alias":"хс-лпнп"},{"key":"non_hdl_c","alias":"non-hdl"},{"key":"non_hdl_c","alias":"ոչ-բխլպ"},{"key":"non_hdl_c","alias":"не-лпвп"},{"key":"fasting_glucose","alias":"glucose"},{"key":"fasting_glucose","alias":"глюкоза"},{"key":"insulin","alias":"insulin"},{"key":"insulin","alias":"инсулин"},{"key":"homa_ir","alias":"homa-ir"},{"key":"homa_ir","alias":"homa ir"},{"key":"ferritin","alias":"ֆերիտին"},{"key":"free_t4","alias":"free t4"},{"key":"free_t4","alias":"ազատ t4"},{"key":"vitamin_d","alias":"25(oh)d"},{"key":"potassium","alias":"կալիում"},{"key":"calcium","alias":"calcium"},{"key":"calcium","alias":"кальций"},{"key":"free_t3","alias":"free t3"},{"key":"free_t3","alias":"ազատ t3"},{"key":"potassium","alias":"կալիում"},{"key":"sodium","alias":"natrium"},{"key":"hba1c","alias":"hb a1c"},{"key":"crp","alias":"hs-crp"},{"key":"anti_tpo","alias":"ат-тпо"},{"key":"folate","alias":"folate"},{"key":"folate","alias":"фолаты"},{"key":"sodium","alias":"sodium"},{"key":"sodium","alias":"натрий"},{"key":"magnesium","alias":"магний"},{"key":"ck_mb","alias":"кфк-мб"},{"key":"potassium","alias":"kalium"},{"key":"sodium","alias":"sodium"},{"key":"sodium","alias":"натрий"},{"key":"hdl_c","alias":"hdl-c"},{"key":"ldl_c","alias":"ldl-c"},{"key":"apob","alias":"apo b"},{"key":"lpa","alias":"lp(a)"},{"key":"hba1c","alias":"hba1c"},{"key":"uric_acid","alias":"urate"},{"key":"folate","alias":"ֆոլատ"},{"key":"potassium","alias":"калий"},{"key":"ck_mb","alias":"ck-mb"},{"key":"ck_mb","alias":"ck mb"},{"key":"ck_mb","alias":"кк-мб"},{"key":"potassium","alias":"калий"},{"key":"total_cholesterol","alias":"chol"},{"key":"hdl_c","alias":"բխլպ"},{"key":"hdl_c","alias":"бхлп"},{"key":"hdl_c","alias":"лпвп"},{"key":"ldl_c","alias":"ցխլպ"},{"key":"ldl_c","alias":"лпнп"},{"key":"apob","alias":"apob"},{"key":"homa_ir","alias":"homa"},{"key":"egfr","alias":"egfr"},{"key":"uacr","alias":"uacr"},{"key":"urea","alias":"urea"},{"key":"alt","alias":"alat"},{"key":"alt","alias":"алат"},{"key":"ast","alias":"asat"},{"key":"ast","alias":"асат"},{"key":"anti_tpo","alias":"atpo"},{"key":"ldl_c","alias":"лпнп"},{"key":"ck_mb","alias":"ckmb"},{"key":"hdl_c","alias":"hdl"},{"key":"ldl_c","alias":"ldl"},{"key":"lpa","alias":"lpa"},{"key":"egfr","alias":"gfr"},{"key":"egfr","alias":"կֆա"},{"key":"egfr","alias":"скф"},{"key":"uacr","alias":"acr"},{"key":"alt","alias":"alt"},{"key":"alt","alias":"ալտ"},{"key":"alt","alias":"алт"},{"key":"ast","alias":"ast"},{"key":"ast","alias":"աստ"},{"key":"ast","alias":"аст"},{"key":"ggt","alias":"ggt"},{"key":"ggt","alias":"գգտ"},{"key":"ggt","alias":"ггт"},{"key":"alp","alias":"alp"},{"key":"alp","alias":"ալֆ"},{"key":"hemoglobin","alias":"hgb"},{"key":"wbc","alias":"wbc"},{"key":"platelets","alias":"plt"},{"key":"esr","alias":"esr"},{"key":"esr","alias":"էգն"},{"key":"esr","alias":"соэ"},{"key":"crp","alias":"crp"},{"key":"crp","alias":"սռս"},{"key":"crp","alias":"срб"},{"key":"tsh","alias":"tsh"},{"key":"tsh","alias":"թխհ"},{"key":"tsh","alias":"ттг"},{"key":"free_t4","alias":"ft4"},{"key":"vitamin_b12","alias":"b12"},{"key":"ldl_c","alias":"ցխլ"},{"key":"ck","alias":"cpk"},{"key":"ck","alias":"кфк"},{"key":"free_t3","alias":"ft3"},{"key":"sodium","alias":"na+"},{"key":"red_blood_cells","alias":"rbc"},{"key":"triglycerides","alias":"tg"},{"key":"alp","alias":"щф"},{"key":"hemoglobin","alias":"hb"},{"key":"ck","alias":"ck"},{"key":"potassium","alias":"k+"},{"key":"sodium","alias":"na"},{"key":"potassium","alias":"k"}],"groups":{"tsh":[["tsh"]],"nt-probnp":[["nt_probnp"]],"insulin-homa":[["insulin","homa_ir"]],"lipid-panel":[["total_cholesterol"],["hdl_c"],["ldl_c"],["triglycerides"]],"apob":[["apob"]],"lpa":[["lpa"]],"hba1c":[["hba1c"]],"hba1c-glucose":[["hba1c"],["fasting_glucose"]],"creatinine-egfr":[["creatinine","egfr"]],"urine-acr":[["uacr"]],"urinalysis":[["urinalysis"]],"potassium":[["potassium"]],"sodium":[["sodium"]],"cbc-hb":[["hemoglobin","wbc","platelets","red_blood_cells"]]}}$json$::jsonb
$mapping$;
-- END generated required lab mapping

create function public._required_lab_analyte(p_name text) returns text
language plpgsql immutable set search_path='' as $$
declare folded text:=btrim(regexp_replace(lower(normalize(p_name,NFKC)),'[^[:alnum:]()/+.\-]+',' ','g'));term jsonb;
begin
 for term in select value from jsonb_array_elements(public._required_lab_mapping()->'aliases') loop
  if folded=term->>'alias' then return term->>'key';end if;
 end loop;
 return null;
end$$;

-- Member-imported reports are an alternative source on the same Required results
-- screen, so they must obey the identical identity and questionnaire-date rules.
create function public._report_required_lab_values(p_user uuid,p_receipt jsonb)returns jsonb
language sql stable security definer set search_path=''as $$
 select coalesce(jsonb_agg(jsonb_build_object('name',r.reviewed#>>array['rows',i#>>'{}','name'],'collectedOn',r.reviewed->>'reportDate')),'[]'::jsonb)
 from public.patient_reports r,jsonb_array_elements(p_receipt->'rows')i
 where r.user_id=p_user and r.id=(p_receipt->>'reportId')::uuid and r.deleted_at is null
$$;

create function public._required_lab_test_covered(p_test text,p_values jsonb) returns boolean
language plpgsql immutable set search_path='' as $$
declare panel jsonb:=public._required_lab_mapping()#>array['panels',p_test];component text;
begin
 if panel is null or panel ? 'undefinedReason' or jsonb_array_length(panel->'components')=0 or jsonb_typeof(p_values)is distinct from 'array' or jsonb_array_length(p_values)=0 then return false;end if;
 for component in select jsonb_array_elements_text(panel->'components') loop
  if not exists(select 1 from jsonb_array_elements(p_values)v where public._required_lab_analyte(v->>'name')=component)then return false;end if;
 end loop;
 return true;
end$$;

create function public._required_lab_values(p_test text,p_values jsonb) returns jsonb
language sql immutable set search_path='' as $$
 select coalesce(jsonb_agg(v order by n),'[]'::jsonb)from jsonb_array_elements(p_values)with ordinality x(v,n)
 where exists(select 1 from jsonb_array_elements(public._required_lab_mapping()#>array['groups',p_test])g where g ? public._required_lab_analyte(v->>'name'))
$$;

create function public._assert_required_lab_receipt(p_user uuid,p_test text,p_values jsonb) returns void
language plpgsql stable security definer set search_path='' as $$
declare on_day date;
begin
 if not public._required_lab_test_covered(p_test,p_values)then raise exception 'The selected values do not cover this required test';end if;
 select (completed_at at time zone 'Asia/Yerevan')::date into on_day from public.patient_assessments where user_id=p_user;
 if on_day is null or exists(select 1 from jsonb_array_elements(p_values)v where nullif(v->>'collectedOn','')is null or (v->>'collectedOn')::date<on_day or (v->>'collectedOn')::date>(clock_timestamp()at time zone 'Asia/Yerevan')::date)
 then raise exception 'Lab results must be dated on or after the questionnaire and not in the future';end if;
end$$;

-- One atomic command and one revision for the bulk action. Never trust test ids,
-- names, dates or claimed coverage from the client: values are read under the
-- existing case/source locks, then every test is matched here.
alter function public.command_patient_clinical_review(uuid,bigint,text,text,jsonb) rename to command_patient_clinical_review_before_lab_match;
revoke all on function public.command_patient_clinical_review_before_lab_match(uuid,bigint,text,text,jsonb)from public,anon,authenticated,service_role;
create function public.command_patient_clinical_review(p_user_id uuid,p_expected_revision bigint,p_evidence_token text,p_operation text,p_input jsonb)returns bigint
language plpgsql security definer set search_path=''as $$
declare c public.patient_clinical_cases;v jsonb;n bigint;test jsonb;vals jsonb;matched jsonb;att uuid;received int:=0;
begin
 if p_operation='receive-result'then
  n:=public.command_patient_clinical_review_before_lab_match(p_user_id,p_expected_revision,p_evidence_token,p_operation,p_input);
  select * into c from public.patient_clinical_cases where user_id=p_user_id;
  vals:=public._report_required_lab_values(p_user_id,c.review#>array['receipts',p_input->>'testId']);
  perform public._assert_required_lab_receipt(p_user_id,p_input->>'testId',vals);
  return n;
 end if;
 if p_operation not in('receive-clinic-result','receive-all-clinic-results')or p_operation is null then
  return public.command_patient_clinical_review_before_lab_match(p_user_id,p_expected_revision,p_evidence_token,p_operation,p_input);
 end if;
 c:=public.lock_assigned_clinical_case(p_user_id,auth.uid(),p_expected_revision,p_evidence_token);v:=c.review;
 if v is null or v->>'evidenceToken' is distinct from p_evidence_token or v->>'doctorId' is distinct from auth.uid()::text then raise exception 'Refresh clinical recommendations before review';end if;
 if p_input->>'sourceChecked' is distinct from 'true' then raise exception 'Check the original source document';end if;
 if nullif(btrim(p_input->>'note'),'') is null or length(p_input->>'note')>2000 then raise exception 'Select source rows and describe their relevance';end if;
 att:=case when p_input->>'attachmentId' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then (p_input->>'attachmentId')::uuid end;
 vals:=public._clinic_lab_receipt_values(p_user_id,att,p_input->'valueIds');
 if vals is null then raise exception 'Every selected clinic lab value must be confirmed by a doctor and current';end if;
 for test in select t from jsonb_array_elements(v#>'{engine,tests}')t where t->>'method'='lab' and(p_operation='receive-all-clinic-results'or t->>'id'=p_input->>'testId')loop
  matched:=public._required_lab_values(test->>'id',vals);
  if p_operation='receive-all-clinic-results' and not public._required_lab_test_covered(test->>'id',matched)then continue;end if;
  perform public._assert_required_lab_receipt(p_user_id,test->>'id',matched);
  v:=jsonb_set(v,array['receipts',test->>'id'],jsonb_build_object('source','clinic-lab','attachmentId',att,'values',matched,'note',btrim(p_input->>'note'),'actorId',auth.uid(),'at',now()));
  received:=received+1;
 end loop;
 if received=0 then raise exception 'The selected values do not cover this required test';end if;
 update public.patient_clinical_cases set review=v,revision=revision+1,updated_at=now()where user_id=p_user_id returning revision into n;
 insert into public.patient_clinical_case_events(user_id,revision,kind,actor_id,detail)values(p_user_id,n,'result-received',auth.uid(),jsonb_build_object('evidenceToken',p_evidence_token,'source','clinic-lab','count',received));
 return n;
end$$;
revoke all on function public.command_patient_clinical_review(uuid,bigint,text,text,jsonb)from public,anon,authenticated,service_role;
grant execute on function public.command_patient_clinical_review(uuid,bigint,text,text,jsonb)to authenticated;
revoke all on function public._required_lab_mapping(),public._required_lab_analyte(text),public._required_lab_test_covered(text,jsonb),public._required_lab_values(text,jsonb),public._assert_required_lab_receipt(uuid,text,jsonb),public._report_required_lab_values(uuid,jsonb)from public,anon,authenticated,service_role;

-- Publication rechecks the stored selection using the same mapping/date rule.
create or replace function public.publish_patient_clinical_plan(p_user_id uuid,p_actor uuid,p_expected_revision bigint,p_evidence_token text,p_engine jsonb,p_request_id uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare c public.patient_clinical_cases;e jsonb;v jsonb;pub public.patient_clinical_publications;pid uuid;stamp timestamptz;label text;n bigint;test jsonb;receipt jsonb;r public.patient_reports;tid uuid;mid uuid;prior_plan uuid;row_index jsonb;source_row jsonb;lab_row jsonb;evidence jsonb;
 regimen jsonb;med jsonb;approval text:=nullif(coalesce(current_setting('noreon.plan_regimen_hash',true),''),'');
begin
 perform set_config('noreon.plan_regimen_hash','',true);
 -- No auto-retry: a lock conflict rolls the entire command back for explicit reload.
 perform public.lock_patient_clinical_sources(p_user_id);
 select * into c from public.patient_clinical_cases where user_id=p_user_id for update nowait;
 if c.assigned_doctor_id is distinct from p_actor or not exists(select 1 from public.workspace_staff s join public.workspace_clinics k on k.id=s.clinic_id where s.user_id=p_actor and s.role='doctor' and s.active and k.active) then raise insufficient_privilege using message='Assigned active doctor required';end if;
 select * into pub from public.patient_clinical_publications where request_id=p_request_id;
 if found then
  if pub.user_id<>p_user_id or pub.actor_id<>p_actor or pub.evidence_token<>p_evidence_token or pub.review->'engine' is distinct from p_engine then raise exception 'Publication request conflict';end if;
  return pub.plan_id;
 end if;
 c:=public.lock_assigned_clinical_case(p_user_id,p_actor,p_expected_revision,p_evidence_token);
 -- Fresh request IDs cannot manufacture an identical plan version or notification.
 -- Assignment and evidence CAS above are checked before this semantic guard.
 if exists(select 1 from public.patient_clinical_publications prior join public.patient_care_plans active_plan on active_plan.id=prior.plan_id and active_plan.user_id=prior.user_id and active_plan.active
  where prior.user_id=p_user_id and prior.actor_id=p_actor and prior.evidence_token=p_evidence_token and prior.review=c.review and prior.draft=c.draft) then raise exception 'Unchanged plan already published. Review and save a changed clinical draft before publishing a new version.';end if;
 v:=c.review;e:=public.patient_clinical_evidence(p_user_id);
 if v is null or v->>'evidenceToken' is distinct from p_evidence_token or v->>'doctorId' is distinct from p_actor::text or v->'engine' is distinct from p_engine or coalesce(p_engine->>'urgency','') not in ('green','yellow','orange') then raise exception 'Refresh current clinical recommendations';end if;
 if c.draft_saved_by is distinct from p_actor or c.draft_evidence_token is distinct from p_evidence_token or c.draft_review_token is distinct from md5(v::text) or not public.workspace_valid_review_draft(c.draft) then raise exception 'Save a valid draft after reviewing the current evidence and gates';end if;
 if exists(select 1 from public.patient_reports src where src.user_id=p_user_id and src.deleted_at is null and (src.state<>'confirmed' or src.reviewed is null or v#>>array['approvals',src.id::text,'revision'] is distinct from src.revision::text)) then raise exception 'Approve every current imported source report';end if;
 for test in select * from jsonb_array_elements(v#>'{engine,tests}') loop
  receipt:=v#>array['receipts',test->>'id'];
  if test->>'method'<>'lab' then
   -- Still refused unless this exact test has an evidence path and a doctor's current confirmation.
   if public._required_evidence_kind(test->>'id') is null then raise exception 'A required clinic or home-log test has no supported native receipt pathway';end if;
   evidence:=v#>array['evidenceReceipts',test->>'id'];
   if evidence is null then raise exception 'Confirm every required clinic or home test';end if;
   if public._required_evidence_source(p_user_id,test->>'id',evidence->>'sourceId') is distinct from evidence->'snapshot' then raise exception 'Required source receipt is stale';end if;
   if evidence#>>'{snapshot,result}'='abnormal' and(v#>>'{consultation,decision}' is distinct from 'required' or v#>>'{consultation,completedAt}' is null or v#>>'{consultation,evidenceToken}' is distinct from p_evidence_token) then raise exception 'An abnormal investigation needs a completed consultation';end if;
   continue;
  end if;
  if receipt is null then raise exception 'Receive every required laboratory result';end if;
  -- Clinic lab: the values must still be exactly what was received (no later correction, detach or move).
  if receipt->>'source'='clinic-lab' then
   perform public._assert_required_lab_receipt(p_user_id,test->>'id',receipt->'values');
   if public._clinic_lab_receipt_values(p_user_id,(receipt->>'attachmentId')::uuid,(select jsonb_agg(x->'id')from jsonb_array_elements(receipt->'values')x)) is distinct from receipt->'values' then raise exception 'Required source receipt is stale';end if;
   continue;
  end if;
  select * into r from public.patient_reports where id=(receipt->>'reportId')::uuid and user_id=p_user_id and deleted_at is null;
  if not found or r.state<>'confirmed' or r.revision::text is distinct from receipt->>'reportRevision' or v#>>array['approvals',r.id::text,'revision'] is distinct from r.revision::text then raise exception 'Required source receipt is stale';end if;
  perform public._assert_required_lab_receipt(p_user_id,test->>'id',public._report_required_lab_values(p_user_id,receipt));
 end loop;
 if v#>>'{consultation,decision}' not in ('required','not-required') or v#>>'{consultation,decision}' is null then raise exception 'Record an explicit consultation decision';end if;
 if v#>>'{consultation,decision}'='required' and (v#>>'{consultation,completedAt}' is null or (v#>>'{consultation,completedAt}')::timestamptz>now() or v#>>'{consultation,evidenceToken}' is distinct from p_evidence_token) then raise exception 'Complete the consultation for the current evidence';end if;
 -- Never lock medication rows after plans: dose commands lock medication then plan.
 select id into prior_plan from public.patient_care_plans where user_id=p_user_id and active for update nowait;
 regimen:=public._draft_regimen(c.draft);
 if c.draft?'medicines' and not public._multi_medicine_enabled() then raise exception 'Several-medicine plans are switched off';end if;
 -- A one-medicine draft cannot express a regimen, even of one: refuse rather than drop what the current plan holds.
 if not c.draft?'medicines' and ((select count(*) from public.patient_care_plan_medications l where l.plan_id=prior_plan)>1
  or exists(select 1 from public.patient_clinical_publications src join public.patient_care_plan_regimens held on held.plan_id=src.plan_id where src.plan_id=prior_plan and src.draft?'medicines' and jsonb_array_length(held.medicines)>0))
  then raise exception 'This draft would drop medicines from the current plan';end if;
 -- Checked once the plan row is locked, so no other version can slip in between this check and the new plan.
 if (c.draft?'medicines' or approval is not null) and approval is distinct from public._regimen_approval_hash(regimen,prior_plan) then raise exception 'Approve the current regimen before publishing';end if;
 stamp:=now();select display_name into label from public.workspace_staff where user_id=p_actor;
 update public.patient_care_plans set active=false,retired_at=stamp where user_id=p_user_id and active;
 insert into public.patient_care_plans(user_id,clinician,published_at,instructions) values(p_user_id,label,stamp,concat_ws(E'\n\n',c.draft->>'explanation',c.draft->>'instructions',nullif(c.draft->>'followUp',''))) returning id into pid;
 -- An unchanged medicine keeps its order, so its dose log continues. Anything else is a new order from this version on.
 for med in select value from jsonb_array_elements(regimen) loop
  mid:=null;
  select m.id into mid from public.patient_care_medications m join public.patient_care_plan_medications link on link.medication_id=m.id and link.plan_id=prior_plan
  where m.user_id=p_user_id and m.name=med->>'name' and m.dose=med->>'dose' and m.instructions=med->>'instructions'
  and array(select distinct t from unnest(m.times) t order by t)=array(select value::time from jsonb_array_elements_text(med->'times') order by value::time);
  if mid is null then
   insert into public.patient_care_medications(user_id,plan_id,name,dose,instructions,times,start_date,effective_at) values(p_user_id,pid,med->>'name',med->>'dose',med->>'instructions',array(select value::time from jsonb_array_elements_text(med->'times')),timezone('Asia/Yerevan',stamp)::date,stamp) returning id into mid;
  end if;
  insert into public.patient_care_plan_medications(plan_id,medication_id,user_id) values(pid,mid,p_user_id);
 end loop;
 -- Copy only doctor-received, actual source data. Non-numeric printed rows remain
 -- verbatim in the immutable publication, without a fabricated numeric conversion.
 for test in select * from jsonb_array_elements(v#>'{engine,tests}') loop
  -- Confirmed clinic and home tests stay in the immutable publication only.
  if test->>'method'<>'lab' then continue;end if;
  receipt:=v#>array['receipts',test->>'id'];
  if receipt->>'source'='clinic-lab' then
   select id into tid from public.patient_care_tests where user_id=p_user_id and source_lab_attachment_id=(receipt->>'attachmentId')::uuid and source_requirement_id=test->>'id';
   if tid is null then
    insert into public.patient_care_tests(user_id,title,preparation,status,ordered_by,ordered_at,source,source_label,source_lab_attachment_id,source_requirement_id)
    values(p_user_id,test->>'title',test->>'preparation','collected',label,(v->>'preparedAt')::timestamptz,'laboratory',
     coalesce((select nullif(x->>'laboratory','')from jsonb_array_elements(receipt->'values')x where nullif(x->>'laboratory','')is not null limit 1),'Clinic laboratory'),
     (receipt->>'attachmentId')::uuid,test->>'id') returning id into tid;
   end if;
   for lab_row in select * from jsonb_array_elements(receipt->'values') loop
    if jsonb_typeof(lab_row->'value')='number' and nullif(btrim(lab_row->>'unit'),'') is not null then
     insert into public.patient_care_results(user_id,test_id,marker,value,unit,collected_at,received_at,source,source_label,reviewed_at,reviewed_by,explanation,reference_text,source_lab_value_id,source_lab_reviewed_at,publication_plan_id)
     values(p_user_id,tid,lab_row->>'name',(lab_row->>'value')::double precision,lab_row->>'unit',((lab_row->>'collectedOn')||'T00:00:00+04:00')::timestamptz,(receipt->>'at')::timestamptz,'laboratory',
      coalesce(nullif(lab_row->>'laboratory',''),'Clinic laboratory'),stamp,label,receipt->>'note',left(lab_row->>'reference',160),(lab_row->>'id')::uuid,(lab_row->>'reviewedAt')::timestamptz,pid)
     on conflict on constraint care_result_lab_source_identity do nothing;
    end if;
   end loop;
   continue;
  end if;
  select * into r from public.patient_reports where id=(receipt->>'reportId')::uuid and user_id=p_user_id;
  select id into tid from public.patient_care_tests where user_id=p_user_id and source_report_id=r.id and source_requirement_id=test->>'id';
  if tid is null then
   insert into public.patient_care_tests(user_id,title,preparation,status,ordered_by,ordered_at,source,source_label,source_report_id,source_requirement_id)
   values(p_user_id,test->>'title',test->>'preparation','collected',label,(v->>'preparedAt')::timestamptz,'laboratory',coalesce(nullif(r.reviewed->>'laboratory',''),'Source report'),r.id,test->>'id') returning id into tid;
  end if;
  for row_index in select * from jsonb_array_elements(receipt->'rows') loop
   source_row:=r.reviewed#>array['rows',row_index::text];
   if length(source_row->>'literal')<=30 and source_row->>'literal' ~ '^-?[0-9]+([.,][0-9]+)?$' and nullif(btrim(source_row->>'unit'),'') is not null then
    insert into public.patient_care_results(user_id,test_id,marker,value,unit,collected_at,received_at,source,source_label,reviewed_at,reviewed_by,explanation,reference_text,source_report_id,source_revision,source_row,publication_plan_id)
    values(p_user_id,tid,source_row->>'name',replace(source_row->>'literal',',','.')::double precision,source_row->>'unit',((r.reviewed->>'reportDate')||'T00:00:00+04:00')::timestamptz,(receipt->>'at')::timestamptz,'laboratory',coalesce(nullif(r.reviewed->>'laboratory',''),'Source report'),stamp,label,receipt->>'note',source_row->>'reference',r.id,r.revision,(row_index::text)::integer,pid) on conflict on constraint care_result_source_identity do nothing;
   end if;
  end loop;
 end loop;
 update public.patient_clinical_cases set revision=revision+1,updated_at=stamp where user_id=p_user_id returning revision into n;
 insert into public.patient_clinical_publications(user_id,plan_id,request_id,actor_id,case_revision,evidence_token,evidence,review,draft,published_at) values(p_user_id,pid,p_request_id,p_actor,n,p_evidence_token,e->'data',v,c.draft,stamp);
 insert into public.patient_clinical_case_events(user_id,revision,kind,actor_id,detail) values(p_user_id,n,'plan-published',p_actor,jsonb_build_object('planId',pid));
 -- Native enqueue only qualifies explicit current channel consent; never fabricates it.
 perform public.enqueue_patient_plan_message(pid);
 return pid;
end $$;
