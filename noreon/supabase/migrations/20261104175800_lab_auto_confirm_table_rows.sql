-- Placeholder stamp requested by the lead: rename before integration and regenerate types.
-- No switch is changed. Existing result binding, clinical gates and numeric windows stay intact.
-- The six-argument helper adds the extractor's own reference to the existing grammar.
-- Retain the five-argument helper for compatibility; it still rejects bare reference columns.

create or replace function public._lab_ai_auto_source_unit(snippet text,test_name text,value_text text,unit text,units jsonb,ref_text text)returns boolean
language plpgsql immutable set search_path=''as $$
declare
 source text:=lower(normalize(coalesce(snippet,''),NFKC));
 token text:='(?:(?:[x×*]?\s*10\s*(?:\^|e)?\s*[39]|[[:alpha:]]+)\s*/\s*[[:alpha:]]+(?:\s*/\s*1[.,]73(?:\s*m(?:2|\^2)?)?)?(?:\s+hb)?|%)';
 token_end text:='(?![[:alnum:]/^])';
 name text:=lower(normalize(coalesce(test_name,''),NFKC));
 name_at int;result text;before_number text;after_number text;printed_unit text[];
 word_end text:='(?![[:alnum:]])';
 flag text;reference_label text;number text;reference_value text;tail text;reference text;bracket text[];
 m text[];found text;own_reference text;table_reference text;reference_key text;
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
 -- Bare table columns must match the recorded numeric reference in full.
 -- No word/operator substitutions: preserve <, >, ≤ and ≥ as distinct symbols.
 own_reference:=regexp_replace(lower(normalize(coalesce(ref_text,''),NFKC)),'\s+',' ','g');
 own_reference:=btrim(own_reference);
 table_reference:=regexp_replace(tail,'\s+',' ','g');
 m:=regexp_match(table_reference,reference_value);
 if own_reference<>''and own_reference ~ reference_value and m is not null
  and(m[1] is null or public._lab_ai_auto_unit(m[1])=unit)then
  reference_key:=translate(regexp_replace(own_reference,'\s+','','g'),'–—,','--.');
  if translate(regexp_replace(table_reference,'\s+','','g'),'–—,','--.')=reference_key
   or(m[1] is not null and translate(regexp_replace(left(table_reference,length(table_reference)-length(m[1])),'\s+','','g'),'–—,','--.')=reference_key)then
   return true;
  end if;
 end if;
 -- Retain column separators before a reference, never after its closing bracket.
 tail:=regexp_replace(tail,'^[\s,;:|]+','');
 bracket:=regexp_match(tail,'^(?:\(([^()]*)\)|\[([^\[\]]*)\])\s*$');
 reference:=case when bracket is null then tail else regexp_replace(coalesce(bracket[1],bracket[2]),'^\s+|\s+$','','g')end;
 if bracket is null and reference !~ reference_label then return false;end if;
 reference:=regexp_replace(reference,reference_label,'');
 m:=regexp_match(reference,reference_value);
 return m is not null and (m[1] is null or public._lab_ai_auto_unit(m[1])=unit);
end$$;
revoke all on function public._lab_ai_auto_source_unit(text,text,text,text,jsonb,text)from public,anon,authenticated,service_role;

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
   and public._lab_ai_auto_source_unit(v.snippet,v.test_name,v.value_text,public._lab_ai_auto_unit(v.unit),c.units,v.ref_text))
  and v.collected_on is not null and v.collected_on<=(now()at time zone 'Asia/Yerevan')::date
  and exists(select 1 from public.clinic_batch_files f where f.id=v.file_id
   and v.collected_on between (f.created_at at time zone 'Asia/Yerevan')::date-400 and(f.created_at at time zone 'Asia/Yerevan')::date
   and(f.created_at at time zone 'Asia/Yerevan')::date<=(now()at time zone 'Asia/Yerevan')::date)
  and public._lab_ai_current(v.attachment_id),false)
$$;
revoke all on function public._lab_ai_auto_accept_ok(public.lab_ai_values)from public,anon,authenticated,service_role;
