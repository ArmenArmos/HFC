// Session-pooler connection string for the hosted project a deploy targets,
// built from the deploy workflow's environment. Returns null when no pooler
// host is set (a linked project then supplies the connection).
export function poolerDbUrl(env = process.env) {
  const host = env.SUPABASE_POOLER_HOST;
  if (!host) return null;
  if (!/^[a-z0-9-]+\.pooler\.supabase\.com$/.test(host)) throw new Error('Invalid pooler host');
  const ref = env.SUPABASE_PROJECT_ID;
  const password = env.SUPABASE_DB_PASSWORD;
  if (!ref || !password) throw new Error('Missing database credentials');
  const url = new URL(`postgresql://${host}:5432/postgres`);
  url.username = `postgres.${ref}`;
  url.password = password;
  url.searchParams.set('sslmode', 'require');
  if (env.GITHUB_ACTIONS) console.log(`::add-mask::${url.href}`);
  return url.href;
}
