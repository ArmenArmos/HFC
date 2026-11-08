/** Exact isolated test targets only. Never infer a production connection. */
export function clinicSqlTarget(env=process.env) {
 const container=env.NOREON_TEST_DB_CONTAINER;
 const database=env.NOREON_TEST_DB_NAME;
 const ci=env.CI==='true'&&env.GITHUB_ACTIONS==='true'&&container==='supabase_db_noreon-core';
 const owned=container==='supabase_db_noreon-clinic-settings-qa';
 if(!owned&&!ci)throw Error('Owned clinic QA or repository Actions CI database required');
 if(ci?database!=='postgres':!['postgres','noreon_clinic_selected_20261016'].includes(database))throw Error('Explicit allowed NOREON_TEST_DB_NAME required');
 return {container,database,ci};
}
