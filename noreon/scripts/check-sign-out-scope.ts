import assert from 'node:assert/strict';
import {readdirSync,readFileSync,statSync} from 'node:fs';
import {join} from 'node:path';

// Supabase's signOut() defaults to the global scope, which ends every session
// of the account on every device (#222: a member's installed app was signed
// out). Every call must name its scope. Only the password-reset finish signs
// out everywhere, on purpose.
const globalAllowed=new Set(['lib/staff/real-recovery-actions.ts']);
const roots=['app','lib','components'];
const files:string[]=[];
const walk=(dir:string)=>{for(const name of readdirSync(dir)){const path=join(dir,name);if(statSync(path).isDirectory())walk(path);else if(/\.(ts|tsx)$/.test(name))files.push(path);}};
roots.forEach(walk);

let calls=0;
const problems:string[]=[];
for(const file of files){
 const source=readFileSync(file,'utf8');
 for(const match of source.matchAll(/\.auth\.signOut\(([^)]*)\)/g)){
  calls++;
  const line=source.slice(0,match.index).split('\n').length;
  const scope=/scope\s*:\s*['"](local|global|others)['"]/.exec(match[1])?.[1];
  if(scope==='local')continue;
  if(scope==='global'&&globalAllowed.has(file))continue;
  problems.push(`${file}:${line} signOut(${match[1]}) must use { scope: 'local' }`);
 }
}
assert.ok(calls>=15,`expected to find the app's sign-out calls, found ${calls}`);
assert.deepEqual(problems,[],problems.join('\n'));

// Staff and clinic sign-out buttons, and rejected staff sign-ins, stay on this device.
for(const [file,needle] of [
 ['lib/patient-care/clinical-actions.ts',"realStaffSignOut(){const client=await realStaffClient();await client.auth.signOut({scope:'local'})"],
 ['lib/clinic-portal/actions.ts',"clinicSignOut(){const client=await clinicAuthClient();await client.auth.signOut({scope:'local'})"],
 ['lib/staff/actions.ts','await client?.auth.signOut({ scope: "local" });'],
] as const)assert.ok(readFileSync(file,'utf8').includes(needle),`${file} sign-out is local`);

// The password-reset finish must keep signing out everywhere: weakening it to
// this device would let a session opened with the old password survive the reset.
const recovery=readFileSync('lib/staff/real-recovery-actions.ts','utf8');
const finish=recovery.slice(recovery.indexOf('async function finishRecovery('),recovery.indexOf('export async function resetRealStaffPassword('));
assert.ok(finish.length>0,'finishRecovery found');
const finishScopes=[...finish.matchAll(/\.auth\.signOut\(([^)]*)\)/g)].map(m=>/scope\s*:\s*['"](\w+)['"]/.exec(m[1])?.[1]);
assert.deepEqual(finishScopes,['global','global'],'both password-reset finish sign-outs are global');
assert.equal([...recovery.matchAll(/scope\s*:\s*['"]global['"]/g)].length,2,'global sign-out only in finishRecovery');

console.log(`Sign-out scope: ${calls} calls, all local except the password-reset finish PASS.`);
