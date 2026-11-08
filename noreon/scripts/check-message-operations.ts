import assert from 'node:assert/strict';
const {parseMessageOperation,requireMessageOperations}=await import('@/lib/messaging/operations');
const id='b9800000-0000-4000-8000-000000000001';
for(const args of [['status'],['status-all'],['acknowledge',id,'a'.repeat(32),'ops'],['reconcile'],['retry',id,'ops@example.test'],['resume','4','configuration-checked','ops@example.test'],['resume','4','unknown-reviewed','ops@example.test','200']])assert.doesNotThrow(()=>parseMessageOperation(args));
for(const args of [['send'],['status','extra'],['retry','bad','ops'],['retry',id,''],['resume','9007199254740992','operator-reset','ops'],['resume','4','anything','ops'],['resume','4','operator-reset','ops','0']])assert.throws(()=>parseMessageOperation(args));
assert.throws(()=>requireMessageOperations({}));assert.doesNotThrow(()=>requireMessageOperations({NOREON_MESSAGE_OPERATIONS_ENABLED:'true'}));
console.log('Operator commands require explicit gates and validate exact IDs, actor labels, revisions and limits; there is no send command.');

const {messageOperatorRuntime}=await import('@/lib/messaging/runtime');
const prior={...process.env};
try{
 process.env.NOREON_MESSAGE_OPERATIONS_ENABLED='true';process.env.NOREON_TWILIO_CALLBACKS_ENABLED='false';
 process.env.NEXT_PUBLIC_SUPABASE_URL='https://fictional.supabase.co';process.env.NOREON_MESSAGING_SERVICE_ROLE_KEY='fictional-test-only';
 delete process.env.NOREON_TWILIO_ACCOUNT_SID;
 assert.doesNotThrow(()=>messageOperatorRuntime(false));assert.throws(()=>messageOperatorRuntime(true));
}finally{for(const key of Object.keys(process.env))if(!(key in prior))delete process.env[key];Object.assign(process.env,prior);}

assert.doesNotThrow(()=>parseMessageOperation(['spend-status']));
assert.doesNotThrow(()=>parseMessageOperation(['spend-configure','0','operator@example.test','/tmp/policy.json']));
assert.throws(()=>parseMessageOperation(['spend-configure','0','operator@example.test']));
