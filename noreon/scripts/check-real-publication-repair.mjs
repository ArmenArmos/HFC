/** Test the actual forward repair on isolated synthetic rows; all changes roll back. */
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';
const migration=readFileSync('supabase/migrations/20261012190143_real_published_result_rls_binding.sql','utf8');
const fixture=readFileSync('scripts/check-real-publication.sql','utf8').split("select pg_temp.must_fail('update public.patient_clinical_publications")[0];
const sql=fixture+`
update public.patient_care_results set publication_plan_id=null where user_id='71000000-0000-4000-8000-000000000001';
insert into public.patient_care_results(user_id,marker,value,unit,collected_at,received_at,source,source_label,reviewed_at,reviewed_by) values('71000000-0000-4000-8000-000000000001','Withheld synthetic row',2,'mmol/L',now(),now(),'laboratory','Synthetic',now(),'Assigned doctor');
`+migration+`
select set_config('request.jwt.claim.sub','71000000-0000-4000-8000-000000000001',true);
set local role authenticated;
do $$begin if (select count(*) from public.patient_care_results)<>1 then raise exception 'TEST repair did not release exactly the published row';end if; if exists(select 1 from public.patient_care_results where marker='Withheld synthetic row') then raise exception 'TEST repair exposed unpublished evidence';end if;end$$;
reset role;
select set_config('request.jwt.claim.sub','71000000-0000-4000-8000-000000000002',true);
set local role authenticated;
do $$begin if exists(select 1 from public.patient_care_results) then raise exception 'TEST repair exposed another member result';end if;end$$;
reset role;
rollback;
`;
const r=spawnSync('docker',['exec','-i','supabase_db_noreon-integrity-replay','psql','-qAt','-v','ON_ERROR_STOP=1','-U','postgres','-d','postgres'],{input:sql,encoding:'utf8'});
assert.equal(r.status,0,r.stderr);
console.log('Provenance repair releases the published row to its owner, keeps unrelated evidence withheld and denies other members.');
