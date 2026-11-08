/** Extend the existing real publication fixture with removal/history assertions. */
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';
import {staffManagementTestDatabaseAllowed} from './staff-management-test-database.mjs';
const container=process.env.NOREON_TEST_DB_CONTAINER;
if(!staffManagementTestDatabaseAllowed(container))throw Error('Owned staff-management replay or repository CI database required');
const source=readFileSync(new URL('./check-real-publication.sql',import.meta.url),'utf8');
const marker='rollback;\n\\echo Real publication';
assert.equal(source.split(marker).length,2,'existing publication rollback marker must be unique');
const extension=`
-- This fixture has already produced real published plans via the supported RPCs.
create temp table staff_history_before as select
 (select jsonb_agg(to_jsonb(p) order by p.plan_id) from public.patient_clinical_publications p where p.user_id=(select uid from ctx)) publications,
 (select jsonb_agg(to_jsonb(p) order by p.id) from public.patient_care_plans p where p.user_id=(select uid from ctx)) plans,
 (select jsonb_agg(to_jsonb(p) order by p.id) from public.patient_care_medications p where p.user_id=(select uid from ctx)) medications,
 (select jsonb_agg(to_jsonb(p) order by p.id) from public.patient_care_results p where p.user_id=(select uid from ctx)) results;
select pg_temp.password_actor('71000000-0000-4000-8000-000000000003');
select pg_temp.must_fail(format('select public.real_admin_remove_staff(%L,%L,%L)',actor,public._real_staff_directory_row(actor)->>'version',gen_random_uuid()),'Reassign') from ctx;
select public.assign_patient_clinical_case(uid,(select revision from public.patient_clinical_cases where user_id=uid),null) from ctx;
select public.real_admin_remove_staff(actor,public._real_staff_directory_row(actor)->>'version',gen_random_uuid()) from ctx;
do $$declare previous record;target uuid:=(select actor from ctx);member uuid:=(select uid from ctx);begin
 select * into previous from staff_history_before;
 if not exists(select 1 from auth.users where id=target) or not exists(select 1 from public.workspace_staff where user_id=target and not active) then raise exception 'Removed doctor identity lost';end if;
 if previous.publications is distinct from (select jsonb_agg(to_jsonb(p) order by p.plan_id) from public.patient_clinical_publications p where p.user_id=member) or
 previous.plans is distinct from (select jsonb_agg(to_jsonb(p) order by p.id) from public.patient_care_plans p where p.user_id=member) or
 previous.medications is distinct from (select jsonb_agg(to_jsonb(p) order by p.id) from public.patient_care_medications p where p.user_id=member) or
 previous.results is distinct from (select jsonb_agg(to_jsonb(p) order by p.id) from public.patient_care_results p where p.user_id=member) then raise exception 'Removing doctor changed published clinical history';end if;
end $$;
select pg_temp.password_actor('71000000-0000-4000-8000-000000000001');
set local role authenticated;
do $$begin if jsonb_array_length(public.patient_published_clinical_reviews())<>3 then raise exception 'Member lost published reviews after clinician removal';end if;end$$;
reset role;
`;
const input=source.replace(marker,()=>extension+marker);
const result=spawnSync('docker',['exec','-i',container,'psql','-qAt','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1'],{input,encoding:'utf8'});
assert.equal(result.status,0,result.stderr);
console.log('PASS removal after reassignment retains exact published plans, medications, results, clinical publications, clinician identity and member read access.');
