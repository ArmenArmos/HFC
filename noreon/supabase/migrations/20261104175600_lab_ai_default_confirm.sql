-- Khikar, 5 Nov 21:42 CET: AI-read clinic values count by default, exceptions stay with the doctor.
-- Placeholder stamp requested by the lead; rename before integration. No switch is enabled here.
-- Clinical attention is retained, and explained clinical alerts are not extraction uncertainty.
-- No numeric model confidence exists. Failed code checks and unexplained attention fail closed.
-- Keep the obsolete auto_accept_margin column for additive rollout compatibility; v2 never reads it.

-- Same spelling normalization as catalogue.ts, including Armenian/Russian printed units.
create function public._lab_ai_auto_unit(raw text)returns text
language plpgsql immutable set search_path=''as $$
declare u text:=lower(normalize(coalesce(raw,''),NFKC));p text[];
begin
 u:=regexp_replace(u,'\s+','','g');
 foreach p slice 1 in array array[
 ['[µμ]','u'],['мкмоль|մկմոլ','umol'],['ммоль|մմոլ','mmol'],['нмоль|նմոլ','nmol'],['пмоль|պմոլ','pmol'],['моль|մոլ','mol'],
 ['мкед','uiu'],['мед(?=/)','mu'],['мкг|մկգ','ug'],['мг|մգ','mg'],['нг|նգ','ng'],['пг|պգ','pg'],['дл|դլ','dl'],['мл|մլ','ml'],['мме|մմմ','miu'],['мкме','uiu'],['ме|մմ(?=/)','iu'],['ед|մ(?=/)','u'],
 ['мм|մմ','mm'],['мин|րոպե','min'],['г|գ','g'],['л|լ','l'],['ч|ժ','h'],['м(?=²|2$)','m'],['²','2'],['×','*']
 ]loop u:=regexp_replace(u,p[1],p[2],'g');end loop;
 u:=regexp_replace(u,'^(x|\*)?10\^?9/l$|^(x|\*)?10e9/l$','10^9/l');
 u:=regexp_replace(u,'^(x|\*)?10\^?3/ul$|^k/ul$','10^3/ul');
 u:=regexp_replace(u,'^mcg/','ug/');u:=regexp_replace(u,'^mmol/molhb$','mmol/mol');
 u:=regexp_replace(u,'^iu/l$','u/l');u:=regexp_replace(u,'^(mc|u)iu/ml$','uiu/ml');
 if u ~ '^ml/min(/1[.,]73(m2|m\^2)?)?$'then
  return case when u like 'ml/min/%'then 'ml/min/1.73m2'else 'ml/min'end;end if;
 return u;
end$$;
revoke all on function public._lab_ai_auto_unit(text)from public,anon,authenticated,service_role;

-- A result follows the test name (or starts the snippet) without words or operators.
-- One optional status flag, then at most one complete reference. Brackets are not free text.
-- Reference bounds elsewhere never corroborate. Any other known unit in
-- the analyte's family fails closed, even if both unit/value interpretations are plausible.
create function public._lab_ai_auto_source_unit(snippet text,test_name text,value_text text,unit text,units jsonb)returns boolean
language plpgsql immutable set search_path=''as $$
declare
 source text:=lower(normalize(coalesce(snippet,''),NFKC));
 token text:='(?:(?:[x×*]?\s*10\s*(?:\^|e)?\s*[39]|[[:alpha:]]+)\s*/\s*[[:alpha:]]+(?:\s*/\s*1[.,]73(?:\s*m(?:2|\^2)?)?)?(?:\s+hb)?|%)';
 token_end text:='(?![[:alnum:]/^])';
 name text:=lower(normalize(coalesce(test_name,''),NFKC));
 name_at int;result text;before_number text;after_number text;printed_unit text[];
 word_end text:='(?![[:alnum:]])';
 flag text;reference_label text;number text;reference_value text;tail text;reference text;bracket text[];
 m text[];found text;
begin
 if coalesce(unit,'')=''then return false;end if;
 -- Keep this grammar identical to sourceUnitCorroborated in auto-accept.ts.
 flag:='(?:hh|ll|h|l|high|low|выше|ниже|բարձր|ցածր|↑|↓|\*)'||word_end;
 reference_label:='^(?:reference|ref|normal|range|норма|референсные\s+значения|референс|նորմ|հղումային)'||word_end||'\s*:?\s*';
 number:='[0-9]+(?:[.,][0-9]+)?';
 reference_value:='^(?:[<>≤≥]\s*'||number||'|'||number||'\s*[-–—]\s*'||number||')(?: ?('||token||')'||token_end||')?$';
 for m in select regexp_matches(source,'(?<![[:alpha:]/^])('||token||')'||token_end,'g')loop
  found:=public._lab_ai_auto_unit(m[1]);
  if units ? found and found<>unit then return false;end if;
 end loop;
 -- Test names can contain digits (HbA1c, B12, T4); inspect only what follows.
 name_at:=case when name=''then 0 else strpos(source,name)end;
 result:=case when name_at=0 then source else substr(source,name_at+length(name))end;
 m:=regexp_match(result,'^([^0-9]*)([0-9]+(?:[.,][0-9]+)?)(.*)$');
 if m is null or replace(m[2],',','.')<>replace(btrim(value_text),',','.')then return false;end if;
 before_number:=m[1];after_number:=m[3];
 if before_number !~ '^[\s;|]*$'then return false;end if;
 printed_unit:=regexp_match(after_number,'^( ?('||token||'))'||token_end);
 if printed_unit is null or public._lab_ai_auto_unit(printed_unit[2])<>unit then return false;end if;
 tail:=regexp_replace(substr(after_number,length(printed_unit[1])+1),'^\s+|\s+$','','g');
 if tail ~ '^\s*(?:[-–—]|to|до|մինչև)\s*[0-9]'then return false;end if;
 m:=regexp_match(tail,'^('||flag||')');
 if m is not null then tail:=regexp_replace(substr(tail,length(m[1])+1),'^\s+|\s+$','','g');end if;
 if tail=''then return true;end if;
 -- Retain column separators before a reference, never after its closing bracket.
 tail:=regexp_replace(tail,'^[\s,;:|]+','');
 bracket:=regexp_match(tail,'^(?:\(([^()]*)\)|\[([^\[\]]*)\])\s*$');
 reference:=case when bracket is null then tail else regexp_replace(coalesce(bracket[1],bracket[2]),'^\s+|\s+$','','g')end;
 if bracket is null and reference !~ reference_label then return false;end if;
 reference:=regexp_replace(reference,reference_label,'');
 m:=regexp_match(reference,reference_value);
 return m is not null and (m[1] is null or public._lab_ai_auto_unit(m[1])=unit);
end$$;
revoke all on function public._lab_ai_auto_source_unit(text,text,text,text,jsonb)from public,anon,authenticated,service_role;

create or replace function public._lab_ai_auto_accept_ok(v public.lab_ai_values)returns boolean
language sql stable security definer set search_path=''as $$
 -- Unit arrays: [canonical scale, offset, printed low, printed high].
 -- Printed windows are inverse canonical windows, rounded outward to six decimals.
 -- These measurement sanity windows remain pending Armen's sign-off.
 with analytes(key,aliases,units,lo,hi)as(values
  -- mmol/l
('total_cholesterol',array['total cholesterol','cholesterol total','cholesterol','chol','ընդհանուր խոլեստերին','խոլեստերին','общий холестерин','холестерин общий','холестерин'],'{"mmol/l":[1,0,1.0,20.0],"mg/dl":[0.02586,0,38.66976,773.395205]}'::jsonb,1,20),
  -- mmol/l
('hdl_c',array['hdl-c','hdl cholesterol','hdl','բխլպ խոլեստերին','բխլպ','бхлп','хс-лпвп','лпвп','холестерин лпвп'],'{"mmol/l":[1,0,0.1,5.0],"mg/dl":[0.02586,0,3.866976,193.348802]}'::jsonb,0.1,5),
  -- mmol/l
('ldl_c',array['ldl-c','ldl cholesterol','ldl','ցխլպ խոլեստերին','ցխլպ','хс-лпнп','лпнп','холестерин лпнп'],'{"mmol/l":[1,0,0.1,15.0],"mg/dl":[0.02586,0,3.866976,580.046404]}'::jsonb,0.1,15),
  -- mmol/l
('non_hdl_c',array['non-hdl-c','non-hdl cholesterol','non-hdl','ոչ-բխլպ խոլեստերին','ոչ-բխլպ','холестерин не-лпвп','не-лпвп'],'{"mmol/l":[1,0,0.1,20.0],"mg/dl":[0.02586,0,3.866976,773.395205]}'::jsonb,0.1,20),
  -- mmol/l
('triglycerides',array['triglycerides','triglyceride','tg','տրիգլիցերիդներ','տրիգլիցերիդ','триглицериды'],'{"mmol/l":[1,0,0.1,50.0],"mg/dl":[0.01129,0,8.857395,4428.697963]}'::jsonb,0.1,50),
  -- g/l
('apob',array['apolipoprotein b','apo b','apob','аполипопротеин b','ապոլիպոպրոտեին b'],'{"g/l":[1,0,0.1,5.0],"mg/dl":[0.01,0,10.0,500.0]}'::jsonb,0.1,5),
  -- nmol/l
('lpa',array['lipoprotein(a)','lipoprotein (a)','lipoprotein a','lp(a)','lpa','липопротеин(а)','липопротеин (а)','липопротеин а','լիպոպրոտեին (a)','լիպոպրոտեին(a)'],'{"nmol/l":[1,0,0.0,1000.0]}'::jsonb,0,1000),
  -- %
('hba1c',array['hba1c','hb a1c','glycated haemoglobin','glycated hemoglobin','գլիկացված հեմոգլոբին','гликированный гемоглобин','гликозилированный гемоглобин'],'{"%":[1,0,3.0,20.0],"mmol/mol":[0.09148,2.152,9.269785,195.102755]}'::jsonb,3,20),
  -- mmol/l
('fasting_glucose',array['fasting glucose','glucose','fasting plasma glucose','ծոմային գլյուկոզա','գլյուկոզա','глюкоза натощак','глюкоза'],'{"mmol/l":[1,0,1.0,60.0],"mg/dl":[0.0555,0,18.018018,1081.081082]}'::jsonb,1,60),
  -- uiu/ml
('insulin',array['fasting insulin','insulin','ինսուլին','инсулин'],'{"uiu/ml":[1,0,0.1,1000.0],"mu/l":[1,0,0.1,1000.0],"pmol/l":[0.16666666666666666,0,0.6,6000.0]}'::jsonb,0.1,1000),
  -- dimensionless
('homa_ir',array['homa-ir','homa ir','homa'],'{"":[1,0,0.0,100.0]}'::jsonb,0,100),
  -- ng/ml
('c_peptide',array['c-peptide','c peptide','c-պեպտիդ','с-пептид','c-пептид'],'{"ng/ml":[1,0,0.0,50.0],"nmol/l":[3.021148036253776,0,0.0,16.55]}'::jsonb,0,50),
  -- umol/l
('creatinine',array['creatinine','կրեատինին','креатинин'],'{"umol/l":[1,0,10.0,3000.0],"mg/dl":[88.4,0,0.113122,33.936652]}'::jsonb,10,3000),
  -- ml/min/1.73m2
('egfr',array['egfr','gfr','կֆա','скф','estimated glomerular filtration rate'],'{"ml/min/1.73m2":[1,0,1.0,200.0],"ml/min":[1,0,1.0,200.0]}'::jsonb,1,200),
  -- mg/mmol
('uacr',array['albumin/creatinine ratio','albumin creatinine ratio','uacr','acr','միզի acr','альбумин/креатинин'],'{"mg/mmol":[1,0,0.0,5000.0],"mg/g":[0.113,0,0.0,44247.787611]}'::jsonb,0,5000),
  -- mmol/l
('urea',array['urea','միզանյութ','мочевина'],'{"mmol/l":[1,0,0.5,100.0],"mg/dl":[0.1665,0,3.003003,600.600601]}'::jsonb,0.5,100),
  -- u/l
('alt',array['alanine aminotransferase','alt','alat','ալտ','алт','алат'],'{"u/l":[1,0,1.0,10000.0]}'::jsonb,1,10000),
  -- u/l
('ast',array['aspartate aminotransferase','ast','asat','աստ','аст','асат'],'{"u/l":[1,0,1.0,10000.0]}'::jsonb,1,10000),
  -- u/l
('ggt',array['gamma-glutamyl transferase','ggt','gamma gt','գգտ','ггт'],'{"u/l":[1,0,1.0,10000.0]}'::jsonb,1,10000),
  -- u/l
('alp',array['alkaline phosphatase','alp','ալֆ','щелочная фосфатаза','щф'],'{"u/l":[1,0,1.0,10000.0]}'::jsonb,1,10000),
  -- umol/l
('bilirubin_total',array['total bilirubin','bilirubin total','bilirubin','ընդհանուր բիլիռուբին','բիլիռուբին','билирубин общий','общий билирубин','билирубин'],'{"umol/l":[1,0,0.5,1000.0],"mg/dl":[17.1,0,0.029239,58.479533]}'::jsonb,0.5,1000),
  -- g/l
('hemoglobin',array['haemoglobin','hemoglobin','hgb','hb','հեմոգլոբին','гемоглобин'],'{"g/l":[1,0,20.0,250.0],"g/dl":[10,0,2.0,25.0]}'::jsonb,20,250),
  -- 10^9/l
('wbc',array['white blood cells','leukocytes','wbc','լեյկոցիտներ','лейкоциты'],'{"10^9/l":[1,0,0.1,500.0],"10^3/ul":[1,0,0.1,500.0]}'::jsonb,0.1,500),
  -- 10^9/l
('platelets',array['platelets','plt','թրոմբոցիտներ','тромбоциты'],'{"10^9/l":[1,0,1.0,3000.0],"10^3/ul":[1,0,1.0,3000.0]}'::jsonb,1,3000),
  -- ng/ml
('ferritin',array['ferritin','ֆերիտին','ферритин'],'{"ng/ml":[1,0,1.0,100000.0],"ug/l":[1,0,1.0,100000.0]}'::jsonb,1,100000),
  -- mm/h
('esr',array['erythrocyte sedimentation rate','esr','էգն','соэ'],'{"mm/h":[1,0,0.0,200.0]}'::jsonb,0,200),
  -- mg/l
('crp',array['hs-crp','high sensitivity crp','c-reactive protein','crp','սռս','срб','с-реактивный белок'],'{"mg/l":[1,0,0.0,500.0],"mg/dl":[10,0,0.0,50.0]}'::jsonb,0,500),
  -- g/l
('fibrinogen',array['fibrinogen','ֆիբրինոգեն','фибриноген'],'{"g/l":[1,0,0.1,15.0],"mg/dl":[0.01,0,10.0,1500.0]}'::jsonb,0.1,15),
  -- miu/l
('tsh',array['thyroid stimulating hormone','tsh','թխհ','ттг'],'{"miu/l":[1,0,0.001,500.0],"uiu/ml":[1,0,0.001,500.0]}'::jsonb,0.001,500),
  -- pmol/l
('free_t4',array['free t4','ft4','ազատ t4','свободный т4','т4 свободный'],'{"pmol/l":[1,0,1.0,200.0],"ng/dl":[12.87,0,0.0777,15.540016]}'::jsonb,1,200),
  -- iu/ml
('anti_tpo',array['anti-tpo','anti tpo','atpo','ат-тпо','антитела к тпо'],'{"iu/ml":[1,0,0.0,10000.0],"u/ml":[1,0,0.0,10000.0]}'::jsonb,0,10000),
  -- umol/l
('uric_acid',array['uric acid','urate','միզաթթու','мочевая кислота'],'{"umol/l":[1,0,30.0,2000.0],"mg/dl":[59.48,0,0.504371,33.624748]}'::jsonb,30,2000),
  -- umol/l
('homocysteine',array['homocysteine','հոմոցիստեին','гомоцистеин'],'{"umol/l":[1,0,1.0,500.0]}'::jsonb,1,500),
  -- ng/ml
('vitamin_d',array['25-oh vitamin d','25(oh)d','vitamin d','վիտամին d','витамин d'],'{"ng/ml":[1,0,1.0,300.0],"nmol/l":[0.4,0,2.5,750.0]}'::jsonb,1,300),
  -- pg/ml
('vitamin_b12',array['vitamin b12','b12','cobalamin','վիտամին b12','витамин b12'],'{"pg/ml":[1,0,10.0,5000.0],"pmol/l":[1.355,0,7.380073,3690.036901]}'::jsonb,10,5000),
  ('folate',array['folate','folic acid','ֆոլատ','фолиевая кислота','фолаты'],'{"ng/ml":[1,0,0.5,100.0],"nmol/l":[0.441,0,1.133786,226.75737]}'::jsonb,0.5,100) -- ng/ml
 ), name as(select ' '||btrim(regexp_replace(lower(normalize(v.test_name,NFKC)),'[^[:alnum:]()/+.-]+',' ','g'))||' ' n),
 matched as(select a.* from analytes a,name,unnest(a.aliases)alias
  where position(' '||alias||' 'in name.n)>0 or starts_with(name.n,' '||alias||'(')or position(' '||alias||','in name.n)>0
  order by length(alias)desc limit 1),
 converted as(select a.*,(a.units->public._lab_ai_auto_unit(v.unit))u from matched a),
 canonical as(select c.*,v.value*(c.u->>0)::numeric+(c.u->>1)::numeric n from converted c)
 select coalesce(
  coalesce((select enabled and auto_accept_enabled from public.lab_ai_capabilities where singleton),false)
  and exists(select 1 from public.lab_ai_jobs j where j.id=v.job_id and j.kind='attachment'and j.user_id=v.user_id and j.state='done'and j.identity_status='match')
  and cardinality(v.checks)=0
  and (v.attention is null and v.attention_rule is null
   or v.attention='threshold'and v.attention_rule=case v.catalogue_ref
    when 'hba1c'then 'THRESHOLD.hba1cUrgent'when 'ldl_c'then 'THRESHOLD.phase2LdlHigh'when 'total_cholesterol'then 'THRESHOLD.phase2TotalCholesterolHigh'end
   or v.attention_rule is null and(v.attention='lab_critical'and v.lab_flag='critical'
    or v.attention='needs_doctor'and(v.lab_flag in('high','low','abnormal')or v.value<v.ref_low or v.value>v.ref_high)))
  -- The whole printed number must equal the stored number, never a censored/annotated value.
  and case when btrim(v.value_text)~'^[0-9]{1,9}([.,][0-9]{1,6})?$'then replace(btrim(v.value_text),',','.')::numeric=v.value else false end
  and exists(select 1 from canonical c where c.key=v.catalogue_ref and c.u is not null
   and v.value between (c.u->>2)::numeric and (c.u->>3)::numeric and c.n between c.lo and c.hi
   and public._lab_ai_auto_source_unit(v.snippet,v.test_name,v.value_text,public._lab_ai_auto_unit(v.unit),c.units))
  and v.collected_on is not null and v.collected_on<=(now()at time zone 'Asia/Yerevan')::date
  and exists(select 1 from public.clinic_batch_files f where f.id=v.file_id
   and v.collected_on between (f.created_at at time zone 'Asia/Yerevan')::date-400 and(f.created_at at time zone 'Asia/Yerevan')::date
   and(f.created_at at time zone 'Asia/Yerevan')::date<=(now()at time zone 'Asia/Yerevan')::date)
  and public._lab_ai_current(v.attachment_id),false)
$$;
revoke all on function public._lab_ai_auto_accept_ok(public.lab_ai_values)from public,anon,authenticated,service_role;

-- Append-only, id-only system event, written in the same transaction as the transition.
create table public.lab_ai_auto_confirmations(
 id bigint generated always as identity primary key,
 event text not null default 'lab_value_auto_confirmed'check(event='lab_value_auto_confirmed'),
 job_id uuid not null references public.lab_ai_jobs(id),
 value_id uuid not null unique references public.lab_ai_values(id),
 rule_version text not null check(rule_version='lab-auto-accept-v2'),
 created_at timestamptz not null default clock_timestamp()
);
-- Intentionally no client policy: only the definer trigger writes this private audit source.
alter table public.lab_ai_auto_confirmations enable row level security;
revoke all on public.lab_ai_auto_confirmations from public,anon,authenticated,service_role;
create trigger lab_ai_auto_confirmations_immutable before update or delete on public.lab_ai_auto_confirmations for each row execute function public._audit_immutable();
create function public._lab_ai_auto_confirmation_audit()returns trigger
language plpgsql security definer set search_path=''as $$
begin
 insert into public.lab_ai_auto_confirmations(job_id,value_id,rule_version)values(new.job_id,new.id,new.auto_accept_rule);
 return new;
end$$;
revoke all on function public._lab_ai_auto_confirmation_audit()from public,anon,authenticated,service_role;
create trigger lab_ai_auto_confirmation_audit after update of status on public.lab_ai_values for each row
 when(old.status='unverified'and new.status='auto_accepted')execute function public._lab_ai_auto_confirmation_audit();
-- Doctor confirm/correct/reject already records before.status='auto_accepted' in lab_ai_value_reviews.
-- auto_accepted_at and auto_accept_rule remain immutable after those actions; reviewed_by identifies the doctor.

create or replace function public._lab_ai_values_guard()returns trigger language plpgsql set search_path=''as $$
begin
 if tg_op='DELETE'then raise exception using errcode='55000',message='AI-read values are kept';end if;
 if tg_op='INSERT'then
  if new.status<>'unverified'or new.reviewed_by is not null or new.corrected_value is not null or new.auto_accepted_at is not null then
   raise exception using errcode='42501',message='AI-read values start unverified';end if;
  return new;
 end if;
 if(new.id,new.job_id,new.user_id,new.file_id,new.attachment_id,new.seq,new.source,new.test_name,new.catalogue_ref,new.value_text,new.value,new.unit,new.ref_low,new.ref_high,
   new.ref_text,new.lab_flag,new.collected_on,new.lab_name,new.page,new.snippet,new.checks,new.attention,new.attention_rule,new.created_at)
  is distinct from(old.id,old.job_id,old.user_id,old.file_id,old.attachment_id,old.seq,old.source,old.test_name,old.catalogue_ref,old.value_text,old.value,old.unit,old.ref_low,old.ref_high,
   old.ref_text,old.lab_flag,old.collected_on,old.lab_name,old.page,old.snippet,old.checks,old.attention,old.attention_rule,old.created_at)then
  raise exception using errcode='55000',message='The AI reading is kept as it was';end if;
 if new.status='auto_accepted'and old.status='unverified'then
  if new.reviewed_by is not null or new.corrected_value is not null or new.auto_accepted_at is null
   or new.auto_accept_rule is distinct from 'lab-auto-accept-v2'
   or current_setting('noreon.lab_auto_accept_job',true)is distinct from new.job_id::text or not public._lab_ai_auto_accept_ok(new)then
   raise exception using errcode='42501',message='This value needs the doctor';end if;
  return new;
 end if;
 -- When it was accepted, and by which rule, is kept for good once set.
 if(new.auto_accepted_at,new.auto_accept_rule)is distinct from(old.auto_accepted_at,old.auto_accept_rule)then
  raise exception using errcode='55000',message='Automatic acceptance is kept as it was';end if;
 if new.status in('unverified','auto_accepted')and new.status is distinct from old.status then
  raise exception using errcode='55000',message='A review is not undone';end if;
 if new.status not in('unverified','auto_accepted')and(auth.uid()is null or new.reviewed_by is distinct from auth.uid()
  or not exists(select 1 from public.workspace_staff s where s.user_id=auth.uid()and s.role='doctor'and s.active)
  or not exists(select 1 from public.patient_clinical_cases c where c.user_id=new.user_id and c.assigned_doctor_id=auth.uid()))then
  raise exception using errcode='42501',message='Only the assigned doctor reviews a value';end if;
 return new;
end$$;

create or replace function public.lab_ai_job_finish(p_job uuid,p_lease uuid,p_result jsonb)returns jsonb
language plpgsql security definer set search_path=''as $$
declare j public.lab_ai_jobs;a public.clinic_result_attachments;disp text;oc text;idst text;x jsonb;n int:=0;pages int;md public.member_reported_documents;auto int[]:='{}';accepted int:=0;
begin
 if auth.role()is distinct from 'service_role'then raise insufficient_privilege;end if;
 select * into j from public.lab_ai_jobs where id=p_job for update;
 if not found then return jsonb_build_object('ok',false,'code','job_unknown');end if;
 if j.state<>'running'or j.lease_token is distinct from p_lease then
  return case when j.state in('done','rejected','failed')then jsonb_build_object('ok',true,'replayed',true,'state',j.state)else jsonb_build_object('ok',false,'code','job_not_running')end;
 end if;
 disp:=p_result->>'disposition';oc:=p_result->>'outcome';
 if jsonb_typeof(p_result)is distinct from 'object'or disp is null or disp not in('done','rejected','retry','defer')or coalesce(oc,'')!~'^[a-z0-9_]{1,60}$'then
  return jsonb_build_object('ok',false,'code','invalid');end if;
 if disp='retry'then
  update public.lab_ai_jobs set state=case when attempts>=3 then 'failed'else 'queued'end,outcome=oc,lease_token=null,lease_until=null,
   next_attempt_at=clock_timestamp()+make_interval(mins=>5*attempts),finished_at=case when attempts>=3 then clock_timestamp()end where id=j.id returning * into j;
  return jsonb_build_object('ok',true,'state',j.state);
 end if;
 if disp='defer'then
  update public.lab_ai_jobs set state='queued',outcome=oc,attempts=greatest(attempts-1,0),lease_token=null,lease_until=null,next_attempt_at=clock_timestamp()+interval '30 minutes'where id=j.id;
  return jsonb_build_object('ok',true,'state','queued');
 end if;
 if disp='rejected'then
  update public.lab_ai_jobs set state='rejected',outcome=oc,lease_token=null,lease_until=null,finished_at=clock_timestamp()where id=j.id;
  return jsonb_build_object('ok',true,'state','rejected');
 end if;
 -- done, member upload: values for the member to answer, identity and summary.
 if j.kind='member_upload'then
  select * into md from public.member_reported_documents where id=j.member_document_id;
  if md.deleted_at is not null then
   update public.lab_ai_jobs set state='rejected',outcome='document_removed',lease_token=null,lease_until=null,finished_at=clock_timestamp()where id=j.id;
   return jsonb_build_object('ok',true,'state','rejected');
  end if;
  idst:=p_result->>'identityStatus';
  begin pages:=(p_result->>'pageCount')::int;exception when others then return jsonb_build_object('ok',false,'code','invalid');end;
  if idst is null or idst not in('match','unknown','mismatch','multiple_patients')or pages is null or pages not between 1 and 10
   or(p_result->>'sourceSha256')is distinct from md.sha256 or jsonb_typeof(p_result->'values')is distinct from 'array'or jsonb_array_length(p_result->'values')>200
   or(idst='multiple_patients'and jsonb_array_length(p_result->'values')>0)
   or(p_result ? 'summary'and jsonb_typeof(p_result->'summary')not in('object','null'))
   or(jsonb_typeof(p_result->'summary')='object'and length((p_result->'summary')::text)>20000)
   or coalesce(p_result->>'provider','')!~'^[a-z0-9_.-]{1,64}$'or coalesce(p_result->>'model','')!~'^[a-z0-9_.:/-]{1,80}$'then
   return jsonb_build_object('ok',false,'code','invalid');end if;
  begin
   for x in select * from jsonb_array_elements(p_result->'values')loop
    n:=n+1;
    if jsonb_typeof(x)<>'object'or coalesce((x->>'page')::int,0)not between 1 and pages then raise invalid_parameter_value;end if;
    insert into public.member_upload_ai_values(job_id,member_id,document_id,seq,test_name,catalogue_ref,value_text,value,unit,ref_low,ref_high,ref_text,lab_flag,collected_on,lab_name,page,snippet,checks,
     attention,attention_rule,measure,measure_unit)
    values(j.id,j.member_id,md.id,n,x->>'testName',x->>'catalogueRef',x->>'valueText',(x->>'value')::numeric,x->>'unit',(x->>'refLow')::numeric,(x->>'refHigh')::numeric,x->>'refText',
     x->>'labFlag',(x->>'collectedOn')::date,x->>'labName',(x->>'page')::smallint,x->>'snippet',
     coalesce((select array_agg(c)from jsonb_array_elements_text(coalesce(x->'checks','[]'))c),'{}'),x->>'attention',x->>'attentionRule',x->>'measure',x->>'measureUnit');
   end loop;
  exception when check_violation or not_null_violation or invalid_text_representation or invalid_parameter_value or numeric_value_out_of_range or datetime_field_overflow
   or invalid_datetime_format or string_data_right_truncation or unique_violation then
   return jsonb_build_object('ok',false,'code','invalid');
  end;
  update public.lab_ai_jobs set state='done',outcome=oc,page_count=pages,source_sha256=p_result->>'sourceSha256',identity_status=idst,
   identity=case when jsonb_typeof(p_result->'identity')='object'and length((p_result->'identity')::text)<=4000 then p_result->'identity'end,
   summary=case when jsonb_typeof(p_result->'summary')='object'then p_result->'summary'end,
   provider=p_result->>'provider',model=p_result->>'model',lease_token=null,lease_until=null,finished_at=clock_timestamp()where id=j.id;
  return jsonb_build_object('ok',true,'state','done','values',n);
 end if;
 -- done, file reading: the checked extraction and suggestions; every suggested member has a booking here.
 if j.kind='file'then
  idst:=p_result->>'identityStatus';
  begin pages:=(p_result->>'pageCount')::int;exception when others then return jsonb_build_object('ok',false,'code','invalid');end;
  if idst is null or idst not in('match','unknown','mismatch','multiple_patients')or pages is null or pages not between 1 and 10
   or(p_result->>'sourceSha256')is distinct from(select sha256 from public.clinic_batch_files where id=j.file_id)
   or jsonb_typeof(p_result->'extraction')is distinct from 'object'or length((p_result->'extraction')::text)>200000
   or jsonb_typeof(p_result->'suggestions')is distinct from 'array'or jsonb_array_length(p_result->'suggestions')>3
   or(idst='multiple_patients'and jsonb_array_length(p_result->'suggestions')>0)
   or exists(select 1 from jsonb_array_elements(p_result->'suggestions')sg where jsonb_typeof(sg)<>'object'
    or coalesce(sg->>'confidence','')not in('high','medium','low')or coalesce(sg->>'identityStatus','')not in('match','unknown','mismatch')
    or not exists(select 1 from public._lab_clinic_bookings(j.clinic_id)b where b.member_id::text=sg->>'memberId'))
   or coalesce(p_result->>'provider','')!~'^[a-z0-9_.-]{1,64}$'or coalesce(p_result->>'model','')!~'^[a-z0-9_.:/-]{1,80}$'then
   return jsonb_build_object('ok',false,'code','invalid');end if;
  update public.lab_ai_jobs set state='done',outcome=oc,page_count=pages,source_sha256=p_result->>'sourceSha256',identity_status=idst,
   identity=case when jsonb_typeof(p_result->'identity')='object'and length((p_result->'identity')::text)<=4000 then p_result->'identity'end,
   extraction=p_result->'extraction',suggestions=(select coalesce(jsonb_agg(jsonb_build_object('memberId',sg->>'memberId','confidence',sg->>'confidence','identityStatus',sg->>'identityStatus')),'[]')
    from jsonb_array_elements(p_result->'suggestions')sg),
   provider=p_result->>'provider',model=p_result->>'model',lease_token=null,lease_until=null,finished_at=clock_timestamp()where id=j.id;
  return jsonb_build_object('ok',true,'state','done','suggestions',jsonb_array_length(p_result->'suggestions'));
 end if;
 -- done, member reading
 if not public._lab_ai_current(j.attachment_id)then
  update public.lab_ai_jobs set state='rejected',outcome='attachment_not_current',lease_token=null,lease_until=null,finished_at=clock_timestamp()where id=j.id;
  return jsonb_build_object('ok',true,'state','rejected');
 end if;
 select * into a from public.clinic_result_attachments where id=j.attachment_id;
 idst:=p_result->>'identityStatus';
 begin pages:=(p_result->>'pageCount')::int;exception when others then return jsonb_build_object('ok',false,'code','invalid');end;
 if idst is null or idst not in('match','unknown','mismatch','multiple_patients')or pages is null or pages not between 1 and 10
  or coalesce(p_result->>'sourceSha256','')!~'^[a-f0-9]{64}$'or jsonb_typeof(p_result->'values')is distinct from 'array'or jsonb_array_length(p_result->'values')>200
  or(idst='multiple_patients'and jsonb_array_length(p_result->'values')>0)
  or(p_result ? 'summary'and jsonb_typeof(p_result->'summary')not in('object','null'))
  or(p_result->>'sourceSha256')is distinct from(select sha256 from public.clinic_batch_files where id=j.file_id)then
  return jsonb_build_object('ok',false,'code','invalid');end if;
 begin
  for x in select * from jsonb_array_elements(p_result->'values')loop
   n:=n+1;
   if jsonb_typeof(x)<>'object'or coalesce((x->>'page')::int,0)not between 1 and pages then raise invalid_parameter_value;end if;
   if x->'autoAccept'='true'::jsonb then auto:=auto||n;end if;
   insert into public.lab_ai_values(job_id,user_id,file_id,attachment_id,seq,test_name,catalogue_ref,value_text,value,unit,ref_low,ref_high,ref_text,lab_flag,collected_on,lab_name,page,snippet,checks,attention,attention_rule)
   values(j.id,j.user_id,j.file_id,j.attachment_id,n,x->>'testName',x->>'catalogueRef',x->>'valueText',(x->>'value')::numeric,x->>'unit',(x->>'refLow')::numeric,(x->>'refHigh')::numeric,x->>'refText',
    x->>'labFlag',(x->>'collectedOn')::date,x->>'labName',(x->>'page')::smallint,x->>'snippet',
    coalesce((select array_agg(c)from jsonb_array_elements_text(coalesce(x->'checks','[]'))c),'{}'),x->>'attention',x->>'attentionRule');
  end loop;
 exception when check_violation or not_null_violation or invalid_text_representation or invalid_parameter_value or numeric_value_out_of_range or datetime_field_overflow
  or invalid_datetime_format or string_data_right_truncation or unique_violation then
  return jsonb_build_object('ok',false,'code','invalid');
 end;
 update public.lab_ai_jobs set state='done',outcome=oc,page_count=pages,source_sha256=p_result->>'sourceSha256',identity_status=idst,
  identity=case when jsonb_typeof(p_result->'identity')='object'then p_result->'identity'end,
  summary=case when jsonb_typeof(p_result->'summary')='object'then p_result->'summary'end,
  provider=p_result->>'provider',model=p_result->>'model',lease_token=null,lease_until=null,finished_at=clock_timestamp()where id=j.id;
 -- Values the worker proposed for automatic acceptance, each checked again here (and by the guard).
 if cardinality(auto)>0 then
  -- Only this function, for this job, may make the transition (the guard checks this setting).
  perform set_config('noreon.lab_auto_accept_job',j.id::text,true);
  update public.lab_ai_values v set status='auto_accepted',auto_accepted_at=clock_timestamp(),auto_accept_rule='lab-auto-accept-v2'
   where v.job_id=j.id and v.seq=any(auto)and v.status='unverified'and public._lab_ai_auto_accept_ok(v);
  get diagnostics accepted=row_count;
  perform set_config('noreon.lab_auto_accept_job','',true);
 end if;
 return jsonb_build_object('ok',true,'state','done','values',n,'autoAccepted',accepted);
end$$;


-- Supply the upload day so TS and SQL apply the same 400-day window on retries.
create or replace function public.lab_ai_job_claim(p_limit integer)returns jsonb
language plpgsql security definer set search_path=''as $$
declare j public.lab_ai_jobs;out jsonb:='[]';f public.clinic_batch_files;a public.clinic_result_attachments;p public.profiles;v public.patient_care_visits;fr public.lab_ai_jobs;md public.member_reported_documents;
begin
 if auth.role()is distinct from 'service_role'then raise insufficient_privilege;end if;
 if not public._lab_ai_enabled()then return out;end if;
 -- Member uploads wait (are not claimed) while their own switch is off.
 for j in select * from public.lab_ai_jobs where((state='queued'and next_attempt_at<=clock_timestamp())or(state='running'and lease_until<clock_timestamp()))
  and(kind<>'member_upload'or public._lab_ai_member_upload_enabled())
  order by next_attempt_at,id limit least(greatest(coalesce(p_limit,1),1),5)for update skip locked loop
  f:=null;md:=null;
  if j.kind='member_upload'then
   select * into md from public.member_reported_documents where id=j.member_document_id;
   if md.deleted_at is not null then
    update public.lab_ai_jobs set state='rejected',outcome='document_removed',lease_token=null,lease_until=null,finished_at=clock_timestamp()where id=j.id;continue;
   end if;
  else
   select * into f from public.clinic_batch_files where id=j.file_id;
  end if;
  if(j.kind='attachment'and not public._lab_ai_current(j.attachment_id))or(j.kind='file'and(f.state<>'stored'or exists(select 1 from public.clinic_result_attachments x where x.file_id=f.id)))then
   update public.lab_ai_jobs set state='rejected',outcome=case j.kind when 'file'then 'file_already_linked'else 'attachment_not_current'end,lease_token=null,lease_until=null,finished_at=clock_timestamp()where id=j.id;continue;
  end if;
  if j.attempts>=3 then
   update public.lab_ai_jobs set state='failed',outcome=case when j.state='running'then 'lease_lost'else coalesce(j.outcome,'retries_exhausted')end,lease_token=null,lease_until=null,finished_at=clock_timestamp()where id=j.id;continue;
  end if;
  update public.lab_ai_jobs set state='running',attempts=attempts+1,lease_token=gen_random_uuid(),lease_until=clock_timestamp()+interval '10 minutes',started_at=clock_timestamp()
   where id=j.id returning * into j;
  if j.kind='member_upload'then
   select * into p from public.profiles where id=j.member_id;
   out:=out||jsonb_build_array(jsonb_build_object('kind','member_upload','jobId',j.id,'leaseToken',j.lease_token,'attempt',j.attempts,
    'file',jsonb_build_object('documentId',md.id,'bucket','member-history','objectKey',md.object_path,'sizeBytes',md.size_bytes,'sha256',md.sha256,'mime',md.mime),
    'member',jsonb_build_object('name',coalesce(p.display_name,''),'birthDate',p.birth_date),
    -- Earlier clinic values a doctor already reviewed, for "what changed" (never unverified ones).
    'previous',coalesce((select jsonb_agg(jsonb_build_object('catalogueRef',x.catalogue_ref,'value',coalesce(x.corrected_value,x.value),'unit',coalesce(x.corrected_unit,x.unit),'collectedOn',x.collected_on)
      order by x.collected_on desc nulls last)from(select * from public.lab_ai_values x where x.user_id=j.member_id and x.status in('verified','corrected')and x.catalogue_ref is not null
      and coalesce(x.corrected_value,x.value)is not null and public._lab_ai_current(x.attachment_id)order by x.collected_on desc nulls last limit 60)x),'[]')));
   continue;
  end if;
  if j.kind='file'then
   out:=out||jsonb_build_array(jsonb_build_object('kind','file','jobId',j.id,'leaseToken',j.lease_token,'attempt',j.attempts,
    'file',jsonb_build_object('fileId',f.id,'bucket','clinic-originals','objectKey',f.object_key,'sizeBytes',f.measured_size,'sha256',f.sha256,'mime',f.mime,'uploadedOn',(f.created_at at time zone 'Asia/Yerevan')::date),
    -- Members with a booking at this clinic, for the suggestion only (worker memory, never logged).
    'candidates',coalesce((select jsonb_agg(jsonb_build_object('memberId',x.member_id,'name',coalesce(pr.display_name,''),'birthDate',pr.birth_date,'bookingDays',x.days))
      from(select member_id,jsonb_agg(distinct((starts_at at time zone 'Asia/Yerevan')::date))days from public._lab_clinic_bookings(j.clinic_id)group by member_id limit 300)x
      join public.profiles pr on pr.id=x.member_id),'[]')));
   continue;
  end if;
  select * into a from public.clinic_result_attachments where id=j.attachment_id;
  select * into p from public.profiles where id=j.user_id;
  select * into v from public.patient_care_visits where id=a.visit_id and user_id=a.user_id;
  -- The clinic upload's reading of these exact bytes, if done: reused, so the file is not sent twice.
  select * into fr from public.lab_ai_jobs where kind='file'and file_id=j.file_id and state='done'and extraction is not null and source_sha256=f.sha256;
  out:=out||jsonb_build_array(jsonb_build_object('kind','attachment','jobId',j.id,'leaseToken',j.lease_token,'attempt',j.attempts,
   'file',jsonb_build_object('fileId',f.id,'bucket','clinic-originals','objectKey',f.object_key,'sizeBytes',f.measured_size,'sha256',f.sha256,'mime',f.mime,'uploadedOn',(f.created_at at time zone 'Asia/Yerevan')::date),
   'member',jsonb_build_object('name',coalesce(p.display_name,''),'birthDate',p.birth_date),
   'cached',case when fr.id is null then null else jsonb_build_object('extraction',fr.extraction,'pageCount',fr.page_count,'provider',fr.provider,'model',fr.model)end,
   'visitTests',coalesce((select jsonb_agg(jsonb_build_object('id',t->>'id','title',t->>'title'))from jsonb_array_elements(coalesce(v.booking_context->'tests','[]'))t),'[]'),
   -- Earlier values a person already reviewed, for "what changed" (never unverified ones).
   'previous',coalesce((select jsonb_agg(jsonb_build_object('catalogueRef',x.catalogue_ref,'value',coalesce(x.corrected_value,x.value),'unit',coalesce(x.corrected_unit,x.unit),'collectedOn',x.collected_on)
     order by x.collected_on desc nulls last)from(select * from public.lab_ai_values x where x.user_id=j.user_id and x.status in('verified','corrected')and x.catalogue_ref is not null
     and coalesce(x.corrected_value,x.value)is not null and x.job_id<>j.id and public._lab_ai_current(x.attachment_id)order by x.collected_on desc nulls last limit 60)x),'[]')));
 end loop;
 return out;
end$$;

-- AI-prepared drafts always keep the freshness check. With default confirmation on,
-- unresolved current values also block. Switch off retains main's token-only behavior.
-- Doctor-written drafts retain the existing source receipt and approval gates.
create or replace function public._clinical_publication_lab_check()returns trigger
language plpgsql security definer set search_path=''as $$
declare t text;auto_confirm boolean;
begin
 select draft_lab_token into t from public.patient_clinical_cases where user_id=new.user_id;
 select coalesce(auto_accept_enabled,false) into auto_confirm from public.lab_ai_capabilities where singleton;
 if t is null and not coalesce(auto_confirm,false)then return new;end if;
 perform 1 from public.clinic_result_attachments where user_id=new.user_id for update;
 perform 1 from public.lab_ai_values where user_id=new.user_id for share;
 if auto_confirm and exists(select 1 from public.lab_ai_values v where v.user_id=new.user_id and v.status='unverified'and public._lab_ai_current(v.attachment_id))then
  raise exception using errcode='40001',message='Lab values need doctor review before publication';end if;
 if t is null then return new;end if;
 if t is distinct from public._ai_plan_lab_token(new.user_id)then
  raise exception using errcode='40001',message='Lab values changed since the AI-prepared plan was saved';end if;
 return new;
end$$;
revoke all on function public._clinical_publication_lab_check()from public,anon,authenticated,service_role;
revoke all on function public._lab_ai_values_guard(),public.lab_ai_job_claim(integer),public.lab_ai_job_finish(uuid,uuid,jsonb)from public,anon,authenticated,service_role;
grant execute on function public.lab_ai_job_claim(integer),public.lab_ai_job_finish(uuid,uuid,jsonb)to service_role;
