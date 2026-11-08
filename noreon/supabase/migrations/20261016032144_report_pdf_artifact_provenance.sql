-- Additive original/canonical PDF identity. Historical rows remain unknown;
-- no checksum/page-map backfill and no change to original storage ownership.
alter table public.patient_reports add column pdf_artifact jsonb;

create function public._report_pdf_artifact_valid(p_artifact jsonb,p_mime text,p_checksum text,p_size integer,p_pages integer)
returns boolean language plpgsql immutable set search_path='' as $$
declare original jsonb;canonical jsonb;mapping jsonb;item jsonb;ordinal bigint;bytes numeric;
begin
 if p_artifact is null then return true;end if;
 if jsonb_typeof(p_artifact)is distinct from 'object' then return false;end if;
 if not(p_artifact?&array['version','parser','policy','original','canonical','pageMap'])
 or p_artifact-array['version','parser','policy','original','canonical','pageMap']<>'{}'::jsonb
 or p_artifact->'version'is distinct from '1'::jsonb
 or p_artifact->'parser'is distinct from '"qpdf-12.4.2"'::jsonb
 or p_artifact->'policy'is distinct from '"noreon-pdf-v1"'::jsonb
 or p_mime is distinct from 'application/pdf' or p_checksum is null or p_size is null or p_pages is null then return false;end if;
 original:=p_artifact->'original';canonical:=p_artifact->'canonical';mapping:=p_artifact->'pageMap';
 if jsonb_typeof(original)is distinct from 'object'or jsonb_typeof(canonical)is distinct from 'object'or jsonb_typeof(mapping)is distinct from 'array'then return false;end if;
 if not(original?&array['checksum','byteLength'])or original-array['checksum','byteLength']<>'{}'::jsonb
 or not(canonical?&array['checksum','byteLength'])or canonical-array['checksum','byteLength']<>'{}'::jsonb
 or jsonb_typeof(original->'checksum')is distinct from 'string'or jsonb_typeof(canonical->'checksum')is distinct from 'string'
 or jsonb_typeof(original->'byteLength')is distinct from 'number'or jsonb_typeof(canonical->'byteLength')is distinct from 'number'then return false;end if;
 if original->>'checksum'!~'^[a-f0-9]{64}$'or canonical->>'checksum'!~'^[a-f0-9]{64}$'
 or original->>'checksum'is distinct from p_checksum then return false;end if;
 bytes:=(original->>'byteLength')::numeric;
 if bytes<>trunc(bytes)or bytes not between 1 and 8388608 or bytes<>p_size then return false;end if;
 bytes:=(canonical->>'byteLength')::numeric;
 if bytes<>trunc(bytes)or bytes not between 1 and 12582912 then return false;end if;
 if jsonb_array_length(mapping)not between 1 and 10 or jsonb_array_length(mapping)<>p_pages then return false;end if;
 for item,ordinal in select value,ordinality from jsonb_array_elements(mapping)with ordinality loop
  if jsonb_typeof(item)is distinct from 'object'then return false;end if;
  if not(item?&array['originalPage','canonicalPage','originalObject','canonicalObject'])
  or item-array['originalPage','canonicalPage','originalObject','canonicalObject']<>'{}'::jsonb
  or jsonb_typeof(item->'originalPage')is distinct from 'number'or jsonb_typeof(item->'canonicalPage')is distinct from 'number'
  or jsonb_typeof(item->'originalObject')is distinct from 'string'or jsonb_typeof(item->'canonicalObject')is distinct from 'string'then return false;end if;
  if(item->>'originalPage')::numeric<>ordinal or(item->>'canonicalPage')::numeric<>ordinal
  or item->>'originalObject'!~'^[1-9][0-9]* [0-9]+ R$'or item->>'canonicalObject'!~'^[1-9][0-9]* [0-9]+ R$'then return false;end if;
 end loop;
 return true;
end$$;
revoke all on function public._report_pdf_artifact_valid(jsonb,text,text,integer,integer)from public,anon,authenticated,service_role;
grant execute on function public._report_pdf_artifact_valid(jsonb,text,text,integer,integer)to service_role;
alter table public.patient_reports add constraint patient_reports_pdf_artifact_valid
 check(public._report_pdf_artifact_valid(pdf_artifact,mime,checksum,size_bytes,page_count)is true);

-- Deliberately omit unknown metadata from historical source objects. This keeps
-- pre-existing source tokens stable; present metadata participates deterministically.
create or replace function public.patient_clinical_evidence(p_user_id uuid)returns jsonb
language sql stable security definer set search_path=''as $$
 with evidence as(select jsonb_build_object(
 'profile',(select jsonb_build_object('name',display_name,'birthDate',birth_date,'biologicalSex',biological_sex)from public.profiles where id=p_user_id),
 'consent',(select to_jsonb(c)from public.patient_consents c where user_id=p_user_id and version='patient-pilot-v1'),
 'assessment',(select to_jsonb(a)-'user_id'from public.patient_assessments a where user_id=p_user_id),
 'measurements',coalesce((select jsonb_agg(to_jsonb(m)-'user_id'order by m.measured_at desc,m.id)from public.patient_measurements m where user_id=p_user_id),'[]'),
 'reports',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'revision',r.revision,'state',r.state,'reviewed',r.reviewed,'confirmedAt',r.confirmed_at)
  ||case when r.pdf_artifact is null then '{}'::jsonb else jsonb_build_object('pdfArtifact',r.pdf_artifact)end order by r.id)
  from public.patient_reports r where user_id=p_user_id and deleted_at is null and state<>'deleted'),'[]')
 )body)
 select jsonb_build_object('token',md5(body::text),'data',body)from evidence
$$;

create function public._workspace_report_pdf_artifact_valid(p_record jsonb)returns boolean
language plpgsql immutable set search_path=''as $$
declare artifact jsonb;bytes numeric;pages numeric;
begin
 artifact:=p_record#>'{extraction_provenance,pdf_artifact}';
 if artifact is null then return true;end if;
 if jsonb_typeof(p_record->'mime')is distinct from 'string'
 or jsonb_typeof(p_record->'checksum')is distinct from 'string'
 or jsonb_typeof(p_record->'size_bytes')is distinct from 'number'
 or jsonb_typeof(p_record->'page_count')is distinct from 'number'then return false;end if;
 bytes:=(p_record->>'size_bytes')::numeric;pages:=(p_record->>'page_count')::numeric;
 if bytes<>trunc(bytes)or bytes not between 1 and 8388608 or pages<>trunc(pages)or pages not between 1 and 10 then return false;end if;
 return public._report_pdf_artifact_valid(artifact,p_record->>'mime',p_record->>'checksum',bytes::integer,pages::integer)is true;
end$$;
revoke all on function public._workspace_report_pdf_artifact_valid(jsonb)from public,anon,authenticated,service_role;
grant execute on function public._workspace_report_pdf_artifact_valid(jsonb)to service_role;
alter table public.workspace_case_reports add constraint workspace_case_reports_pdf_artifact_valid
 check(public._workspace_report_pdf_artifact_valid(record)is true);

-- Provenance identity is part of the source associated with a care requirement.
-- Identical metadata/order does not churn contentRevision or associations.
create or replace function public.workspace_report_content_transition(p_old jsonb,p_new jsonb,p_at text)returns jsonb
language plpgsql immutable set search_path=''as $$
declare changed boolean;reason text;active jsonb;history jsonb;
begin
 changed:=coalesce(p_old->'extraction','null')is distinct from coalesce(p_new->'extraction','null')
  or coalesce(p_old->'reviewed','null')is distinct from coalesce(p_new->'reviewed','null')
  or coalesce(p_old#>'{extraction_provenance,pdf_artifact}','null')is distinct from coalesce(p_new#>'{extraction_provenance,pdf_artifact}','null');
 reason:=case when changed then 'content-changed'when p_new->>'state'is distinct from 'confirmed'then 'unconfirmed'else null end;
 active:=coalesce(p_old->'associations','[]');history:=coalesce(p_old->'associationHistory','[]');
 if reason is not null then
  history:=history||coalesce((select jsonb_agg(a||jsonb_build_object('reason',reason,'retiredAt',p_at))from jsonb_array_elements(active)a),'[]');
  active:='[]';
 end if;
 return p_new||jsonb_build_object('revision',coalesce((p_old->>'revision')::bigint,0)+1,
  'contentRevision',coalesce((p_old->>'contentRevision')::bigint,0)+case when changed then 1 else 0 end,
  'associations',active,'associationHistory',history);
end$$;
