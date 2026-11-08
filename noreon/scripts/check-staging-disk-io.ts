import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

// Source-level guard, not a query-plan or spill measurement. SQL fixtures compare
// actual multi-page results with the previous implementation after a replay.
const migrations = readdirSync('supabase/migrations').filter(f => f.endsWith('.sql')).sort();
function latest(name: string) {
  const pattern = new RegExp(`create(?: or replace)? function public\\.${name}\\([\\s\\S]*?\\$\\$([\\s\\S]*?)\\$\\$;`, 'gi');
  let found: RegExpMatchArray | undefined;
  for (const file of migrations) for (const match of readFileSync(`supabase/migrations/${file}`, 'utf8').matchAll(pattern)) found = match;
  assert.ok(found, `Function ${name} exists`);
  return { definition: found[0], body: found[1].replace(/--[^\n]*/g, '') };
}
const page = latest('_audit_page').body;
assert.match(page, /page_keys as materialized\(\s*select f\.at,f\.key\s+from public\._audit_source_rows/i,
  'Only timestamp/key pairs may reach the history-wide page selection');
assert.match(page, /and\(c_at is null or\(f\.at,f\.key\)<\(c_at,c_key\)\)\s*order by f\.at desc,f\.key desc limit lim\+1\s*\)/i,
  'Keyset filtering and limit are inside the materialized page boundary');
assert.ok(page.indexOf('limit lim+1') < page.indexOf('jsonb_build_object('), 'Build DTOs after page selection');
assert.match(page, /where f\.key=any\(b\.keys\)/i,
  'Fetch details only for selected keys with a scalar filter, avoiding a wide join sort');
assert.match(page, /page_bounds as materialized\(\s*select min\(k\.at\)lo,max\(k\.at\)hi,array_agg\(k\.key\)keys from page_keys k/i,
  'Second source traversal stays within the selected page time range');
assert.match(page, /cross join lateral public\._audit_source_rows\(b\.lo,b\.hi,p_actor,p_member,p_category\)/i,
  'Pass Vars, not SubPlans, as source arguments so SQL inlining remains possible');
const sourceFunction = latest('_audit_source_rows');
const source = sourceFunction.definition;
const originalRows = readFileSync('supabase/migrations/20261104173000_audit_log.sql', 'utf8')
  .match(/create function public\._audit_rows\([\s\S]*?\$\$([\s\S]*?)\$\$;/)![1];
assert.equal(sourceFunction.body.trim(), originalRows.replace(/--[^\n]*/g, '').trim(),
  'All audit sources, filters and metadata expressions remain unchanged');
assert.match(source, /language sql stable as \$\$/i, 'Relational helper stays inlinable (invoker, no SET options)');
assert.doesNotMatch(source, /security definer|set search_path/i);
const allSql = migrations.map(f => readFileSync(`supabase/migrations/${f}`, 'utf8')).join('\n');
assert.match(allSql, /revoke all on function public\._audit_source_rows\(timestamptz,timestamptz,uuid,uuid,text\)\s*from public,anon,authenticated,service_role/i);
assert.doesNotMatch(allSql, /grant execute on function public\._audit_source_rows/i, 'Raw audit source is never exposed');
const people = latest('_audit_people').body;
assert.doesNotMatch(people, /public\._audit_rows\(/i, 'People lookup must not materialize the whole audit DTO stream');
assert.match(people, /exists\(select 1 from public\._audit_source_rows/i, 'Only actor existence is needed for eligibility');
const inbox = latest('doctor_ai_inbox');
assert.match(inbox.definition, /language plpgsql volatile security definer set search_path=''/i,
  'Inbox stays volatile: first access and reads after 10 minutes still audit');
assert.match(inbox.body, /for audit_member in select[\s\S]*order by[\s\S]*loop/i,
  'Take per-member locks in a consistent order to avoid multi-member deadlocks');
assert.match(inbox.body, /if exists\([\s\S]*public\.access_audit[\s\S]*continue;[\s\S]*pg_advisory_xact_lock[\s\S]*if not exists\([\s\S]*public\.access_audit[\s\S]*_access_audit_record/i,
  'Read first, serialize cold reads, recheck after lock before recording');
const lock = inbox.body.match(/perform pg_advisory_xact_lock\([^;]+;/i)![0];
assert.match(lock, /me::text\|\|':'\|\|audit_member::text\|\|':'\|\|coalesce\(audit_session,''\)/i,
  'Cold-read lock is scoped to doctor, member and session');
const audit = inbox.body.slice(inbox.body.indexOf('for audit_member'));
assert.equal(audit.match(/audit_cutoff:=clock_timestamp\(\)-interval '10 minutes'/gi)?.length, 2,
  'Refresh the rolling cutoff before the fast path and after waiting for the lock');
assert.equal(audit.match(/a\.actor_id=me and a\.member_id=audit_member[\s\S]*?a\.session_id is not distinct from audit_session\s*and a\.at>audit_cutoff/gi)?.length, 2,
  'Both checks suppress only audits younger than 10 minutes for the identical doctor/member/session');
assert.doesNotMatch(audit, /audit_day|date_trunc|interval '24 hours'|update public\.access_audit/i,
  'No calendar bucket or timestamp refresh on polling');
console.log('Staging disk IO source guards passed (SQL and spill behavior not executed).');
