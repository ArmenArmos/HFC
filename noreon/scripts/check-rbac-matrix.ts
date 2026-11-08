/**
 * RBAC permission matrix invariants (WP F): lib/rbac/roles.ts.
 * Run: node --no-warnings --conditions=noreon-server-test --import ./scripts/register-alias.mjs scripts/check-rbac-matrix.ts
 */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {APP_ROLES,ASSISTANTS,ASSISTANT_FORBIDDEN_PERMISSIONS,CLINICAL_DECISION_PERMISSIONS,PERMISSIONS,PERMISSIONS_LIST,can,canAny,rolesFromIdentities,assistantGreeting,type AppRole} from '../lib/rbac/roles';
import {LOCALES} from '../lib/locale';

function scenario(name:string,fn:()=>void){fn();console.log(`ok   ${name}`);}
const holders=(p:(typeof PERMISSIONS_LIST)[number])=>APP_ROLES.filter(r=>can(r,p));

scenario('eight roles, each with a permission list from the vocabulary',()=>{
 assert.deepEqual([...APP_ROLES],['patient','caregiver','nurse','family_physician','cardiologist','care_coordinator','clinic_admin','noreon_admin']);
 for(const role of APP_ROLES){
  assert.ok(PERMISSIONS[role].length>0,role);
  for(const p of PERMISSIONS[role])assert.ok((PERMISSIONS_LIST as readonly string[]).includes(p),`${role}:${p}`);
  assert.equal(new Set(PERMISSIONS[role]).size,PERMISSIONS[role].length,`${role} has no duplicates`);
 }
});

scenario('only physicians set targets and approve or change plans',()=>{
 assert.deepEqual(holders('target.set'),['family_physician','cardiologist']);
 assert.deepEqual(holders('plan.approve'),['family_physician','cardiologist']);
 assert.deepEqual(holders('plan.change'),['family_physician','cardiologist']);
 for(const p of CLINICAL_DECISION_PERMISSIONS)assert.ok(holders(p).every(r=>r==='family_physician'||r==='cardiologist'),p);
 // Triage is also a nurse's, so it is not physician-only, but no assistant may hold it either.
 assert.deepEqual([...ASSISTANT_FORBIDDEN_PERMISSIONS].sort(),[...CLINICAL_DECISION_PERMISSIONS,'triage.perform'].sort());
 assert.deepEqual(holders('triage.perform'),['nurse','family_physician','cardiologist']);
});

scenario('members and caregivers never read assigned members; coordinators and admins have no clinical access',()=>{
 for(const r of ['patient','caregiver']as const){
  assert.equal(can(r,'member.read_assigned'),false,r);
  assert.equal(can(r,'triage.perform'),false,r);
 }
 for(const r of ['care_coordinator','clinic_admin','noreon_admin']as const){
  assert.equal(can(r,'member.read_assigned'),false,r);
  for(const p of CLINICAL_DECISION_PERMISSIONS)assert.equal(can(r,p),false,`${r}:${p}`);
 }
 assert.ok(can('patient','caregiver.manage_own')&&can('patient','consent.manage_own'));
 assert.equal(can('caregiver','caregiver.manage_own'),false);
 assert.ok(can('caregiver','bp.log_delegated')&&!can('caregiver','bp.log_own'));
 assert.ok(canAny(['patient','nurse'],'triage.perform'));
 assert.equal(canAny([],'chat.own'),false);
});

scenario('network-wide permissions belong to the Noreon admin only',()=>{
 assert.deepEqual(holders('staff.manage_network'),['noreon_admin']);
 assert.deepEqual(holders('outcomes.view_network'),['noreon_admin']);
 assert.deepEqual(holders('audit.view_network'),['noreon_admin']);
});

scenario('rolesFromIdentities maps each plane',()=>{
 assert.deepEqual(rolesFromIdentities({}),[]);
 assert.deepEqual(rolesFromIdentities({member:{userId:'m'}}),['patient']);
 assert.deepEqual(rolesFromIdentities({member:{userId:'m'},caregiverLinks:[{}]}),['patient','caregiver']);
 assert.deepEqual(rolesFromIdentities({caregiverLinks:[{}]}),['caregiver']);
 assert.deepEqual(rolesFromIdentities({caregiverLinks:[]}),[]);
 assert.deepEqual(rolesFromIdentities({staff:{role:'doctor',specialty:'family_physician'}}),['family_physician']);
 assert.deepEqual(rolesFromIdentities({staff:{role:'doctor',specialty:'cardiologist'}}),['cardiologist']);
 assert.deepEqual(rolesFromIdentities({staff:{role:'doctor'}}),['family_physician']);
 assert.deepEqual(rolesFromIdentities({staff:{role:'nurse'}}),['nurse']);
 assert.deepEqual(rolesFromIdentities({staff:{role:'coordinator'}}),['care_coordinator']);
 assert.deepEqual(rolesFromIdentities({staff:{role:'admin'}}),['noreon_admin']);
 assert.deepEqual(rolesFromIdentities({staff:{role:'qa'}}),[]);
 assert.deepEqual(rolesFromIdentities({clinic:{capability:'clinic_admin'}}),['clinic_admin']);
 assert.deepEqual(rolesFromIdentities({clinic:{capability:'clinic_staff'}}),[]);
 // A staff account never also counts as a member or caregiver, as the database refuses them.
 assert.deepEqual(rolesFromIdentities({staff:{role:'nurse'},member:{userId:'m'},caregiverLinks:[{}]}),['nurse']);
 assert.deepEqual(rolesFromIdentities({staff:{role:'admin'},clinic:{capability:'clinic_admin'}}),['clinic_admin','noreon_admin']);
});

scenario('every role has its own assistant with an hy, en and ru greeting',()=>{
 const ids=new Set<string>();
 for(const role of APP_ROLES){
  const a=ASSISTANTS[role];
  assert.ok(a.id&&!ids.has(a.id),role);ids.add(a.id);
  for(const l of LOCALES){
   const g=a.greeting[l];
   assert.ok(typeof g==='string'&&g.length>10,`${role}:${l}`);
   assert.equal(assistantGreeting(role as AppRole,l),g);
   // Voice guide: no exclamation marks, no em dashes.
   assert.ok(!/[!—]/.test(g),`${role}:${l} voice`);
  }
  assert.ok(a.greeting.hy.includes('Զոյա'),`${role} hy says «Զոյա»`);
  assert.ok(!/Zoe/.test(a.greeting.hy),`${role} hy never says Zoe`);
  assert.ok(a.greeting.en.includes('Zoe')&&a.greeting.ru.includes('Зоя'),role);
  assert.ok(a.intents.length>0,role);
 }
});

scenario('assistants never perform clinical decisions',()=>{
 for(const role of APP_ROLES){
  for(const intent of ASSISTANTS[role].intents){
   assert.ok(!/(^|\.)(set|approve|publish|prescribe|order)(\.|$|_)/.test(intent),`${role}:${intent}`);
   assert.ok(!/triage/.test(intent),`${role}:${intent} never triages`);
   assert.ok(!(ASSISTANT_FORBIDDEN_PERMISSIONS as readonly string[]).includes(intent),`${role}:${intent}`);
  }
 }
});

scenario('roles.ts stays framework-free',()=>{
 const source=readFileSync(new URL('../lib/rbac/roles.ts',import.meta.url),'utf8');
 assert.ok(!/from ['"]next\//.test(source)&&!/server-only/.test(source));
});

// lib/rbac/server.ts with injected plane readers: an absent or failing plane never throws.
const {currentAppRoles,currentPrincipals,assertCan,PermissionDenied}=await import('../lib/rbac/server');
const fail=async():Promise<never>=>{throw Error('plane unavailable');};
const none=async()=>null;
{
 const readers={member:async()=>({userId:'m1'}),caregiverLinks:async()=>[{id:'l1'}],staff:fail,clinic:none};
 assert.deepEqual(await currentAppRoles(readers),['patient','caregiver']);
 const principals=await currentPrincipals(readers);
 assert.equal(principals.memberId,'m1');assert.equal(principals.staffId,null);
 assert.deepEqual(await assertCan('caregiver.manage_own',readers),['patient']);
 await assert.rejects(assertCan('plan.approve',readers),PermissionDenied);
 console.log('ok   currentAppRoles: member and caregiver planes, failing staff plane ignored');
}
{
 const readers={member:fail,caregiverLinks:fail,staff:async()=>({id:'s1',role:'doctor'as const,specialty:'cardiologist'as const}),clinic:fail};
 assert.deepEqual(await currentAppRoles(readers),['cardiologist']);
 assert.deepEqual(await assertCan('plan.approve',readers),['cardiologist']);
 assert.deepEqual(await currentAppRoles({member:none,caregiverLinks:fail,staff:async()=>({id:'s2',role:'coordinator'as const}),clinic:async()=>({userId:'c',capability:'clinic_admin'as const})}),['care_coordinator','clinic_admin']);
 assert.deepEqual(await currentAppRoles({member:none,caregiverLinks:none as never,staff:none,clinic:none}),[]);
 await assert.rejects(assertCan('chat.own',{member:none,caregiverLinks:fail,staff:none,clinic:none}),PermissionDenied);
 console.log('ok   currentAppRoles: staff by specialty, coordinator with clinic admin, nobody signed in');
}
