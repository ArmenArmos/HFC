import assert from 'node:assert/strict';
import { MEMBER_APP_ORIGIN, memberAppAccess, deploymentErrors, realRegistrationReady } from '@/lib/deployment';
// The public site's hosts never serve the member app: noreon.health and www send it on, the retired demo host is gone.
for (const host of ['noreon.health', 'www.noreon.health', 'WWW.noreon.health:443']) assert.equal(memberAppAccess(host), 'redirect', host);
assert.equal(memberAppAccess('demo.noreon.health'), 'not-found');
for (const host of ['app.noreon.health', 'staging.noreon.health', 'localhost:3000', 'preview.vercel.app']) assert.equal(memberAppAccess(host), 'serve', host);
assert.equal(MEMBER_APP_ORIGIN, 'https://app.noreon.health');
const app = { NOREON_DEPLOYMENT_TARGET: 'app', NEXT_PUBLIC_SUPABASE_URL: 'https://example.invalid', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon', SUPABASE_SERVICE_ROLE_KEY: 'service' };
assert.deepEqual(deploymentErrors(app), []);
assert.equal(deploymentErrors({ ...app, SUPABASE_SERVICE_ROLE_KEY: undefined }).length > 0, true);
assert.equal(deploymentErrors({ NOREON_DEPLOYMENT_TARGET: 'demo' }).length > 0, true, 'The demo target no longer exists');
assert.deepEqual(deploymentErrors({ NOREON_DEPLOYMENT_TARGET: 'marketing' }), []);
assert.equal(deploymentErrors({}).length, 0); // Existing deployment remains compatible.
console.log('Deployment isolation checks passed');

assert.equal(realRegistrationReady({NOREON_DEPLOYMENT_TARGET:"app"}), false);
assert.equal(realRegistrationReady({NOREON_DEPLOYMENT_TARGET:"app",NOREON_REGISTRATION_ENABLED:"true"}), false);
assert.equal(realRegistrationReady({NOREON_DEPLOYMENT_TARGET:"app",NOREON_REGISTRATION_ENABLED:"true",NOREON_PHONE_OTP_PROVIDER:"twilio-whatsapp"}), true);
assert.ok(deploymentErrors({NOREON_SHARED_DEMO:'true',NEXT_PUBLIC_PATIENT_DEMO:'true',NOREON_WORKSPACE_SUPABASE_URL:'https://example.invalid',NOREON_WORKSPACE_ANON_KEY:'anon',NOREON_WORKSPACE_SERVICE_ROLE_KEY:'short'}).length>0,'Short admission signing secret must fail deployment validation');
