/** Actual password actions with Auth/RPC boundaries replaced. No network or email. */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
const require = createRequire(import.meta.url);
const userId = '11111111-1111-4111-8111-111111111111';
let stage = 'verified';
let failure = 'rpc';
let saves = 0;
let reads = 0;
let cleared = 0;
const context = {id: '22222222-2222-4222-8222-222222222222', generation: 1, status: 'verified'};
const setup = () => ({context, user: {id: userId}, sessionId: 'fixture-session', proof: {stage}, client: {auth: {updateUser: async () => {
  saves++;
  return failure === 'password' ? {error: {}, data: {user: null}} : {error: null, data: {user: {id: userId}}};
}}}});
const exports: Record<string, unknown> = {};
const code = ts.transpileModule(readFileSync('lib/staff/real-invitation-actions.ts', 'utf8'), {compilerOptions: {target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS}}).outputText;
new vm.Script(code).runInNewContext({exports, Buffer, require(name: string) {if(name==='@/lib/observability/with-logging')return {loggedAction:(_action:string,run:unknown)=>run,withRouteLogging:(handler:unknown)=>handler,logSweep:()=>{}};
  if (name === 'zod' || name === 'node:crypto') return require(name);
  if (name === 'next/navigation') return {redirect: (path: string) => {throw Error(`redirect:${path}`);}};
  if (name === './real-invitation-session') return {
    doctorSetupSession: async () => {reads++; return failure === 'readback' && reads > 1 ? null : setup();},
    writeInvitationProof: async (_context: unknown, _user: string, _session: string, next: string) => {stage = next;},
    clearInvitationProof: async () => {cleared++;},
  };
  if (name === './real-invitations') return {invitationWriteClient: () => ({rpc: async (rpc: string) => {
    if (rpc.includes('finalize') && failure === 'throw') throw Error('Local transport failure');
    return {error: rpc.includes('finalize') && failure === 'rpc' ? {} : null};
  }})};
  if (['@/lib/patient-care/clinical-case-repository', './real-invitation-dispatch', './real-session-binding', '@/lib/telegram-auth/staff-invite'].includes(name)) return {};
  throw Error(`Unexpected import ${name}`);
}});
type State = {ok: boolean; message: string; passwordSaved?: boolean};
const actions = exports as Record<string, (previous: State, data: FormData) => Promise<State>>;
const initial = {ok: false, message: ''};
const data = new FormData();
data.set('password', 'fictional-fixture-password');
data.set('confirmation', 'fictional-fixture-password');
for (const problem of ['rpc', 'throw', 'readback']) {
  stage = 'verified'; failure = problem; saves = 0; reads = 0;
  const result = await actions.setRealDoctorPassword(initial, data);
  assert.equal(result.ok, false);
  assert.equal(result.passwordSaved, true, `${problem} after saving must offer activation recovery`);
  assert.equal(saves, 1);
  assert.equal(stage, 'password_set');
  failure = 'none';
  await assert.rejects(() => actions.retryRealDoctorActivation(initial, new FormData()), /redirect:\/staff\/real\/members/);
  assert.equal(saves, 1, 'Activation recovery must not save or request the password again');
}
stage = 'verified'; failure = 'password'; reads = 0;
const rejected = await actions.setRealDoctorPassword(initial, data);
assert.equal(rejected.passwordSaved, undefined, 'An unsuccessful password save must retain password entry');
assert.equal(stage, 'verified');
assert.equal(cleared, 3, 'Successful activation clears the setup proof');
console.log('Password recovery: actual actions preserve saved-password state on RPC, transport and readback failures; retry activates without resaving. Mocked Auth/RPC boundaries.');
