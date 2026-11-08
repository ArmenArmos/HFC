/** Only owned local replays or this repository's isolated GitHub Actions database. */
export function staffManagementTestDatabaseAllowed(container,env=process.env){
 return ['supabase_db_noreon-mvp-combined-replay-20261014','supabase_db_noreon-staff-management-replay-20261014','supabase_db_noreon-staff-removal-replay-20261014'].includes(container)
  || (env.CI==='true' && env.GITHUB_ACTIONS==='true' && container==='supabase_db_noreon-core');
}
