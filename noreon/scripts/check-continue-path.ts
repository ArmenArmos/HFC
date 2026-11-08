import {readFileSync} from 'node:fs';
// Sign-in "continue to" pages (?next= on /patient): only the exact allowed member pages, so an expired
// Telegram link can land on its page after sign-in and nothing else can redirect. No network.
import assert from 'node:assert/strict';
const {CONTINUE_PATHS,continuePath,signInContinuing}=await import('@/lib/patient/continue-path');

for(const path of Object.values(CONTINUE_PATHS))assert.equal(continuePath(path),path,path);
const noticePath='/patient/chat?notice=11111111-1111-4111-8111-111111111111';
assert.equal(continuePath(noticePath),noticePath,'An opaque push notice target survives sign-in');
for(const bad of [noticePath+'&extra=1','/patient/chat?notice=bad','/patient/chat?notice=https://evil.example',noticePath+'#fragment'])assert.equal(continuePath(bad),null,'Only one exact UUID query is allowed');
for(const bad of ['//evil.example','https://evil.example/patient/care','/patient/care/','/patient/care?x=1','/patient/telegram-link','/staff/real/unassigned','/patient',' /patient/care','',null,undefined,['/patient/care'],42])
 assert.equal(continuePath(bad),null,String(bad));
assert.equal(signInContinuing('/patient/care',true),'/patient?next=%2Fpatient%2Fcare&link=expired','Expired link: continue to its page');
assert.equal(signInContinuing(undefined,true),'/patient?link=expired','Unknown link: plain sign-in with the note');
assert.equal(signInContinuing('https://evil.example'),'/patient','Never an open redirect');
assert.equal(signInContinuing('/patient/results'),'/patient?next=%2Fpatient%2Fresults');
assert.equal(signInContinuing('/patient/progress'),'/patient?next=%2Fpatient%2Fprogress');
// A signed-out member on a notice's plain link keeps the page through sign-in (Astra, #415).
assert.match(readFileSync('lib/supabase/session.ts','utf8'),/"\/patient\/progress"/);
// The link page continues to exactly the pages a link step opens.
// BC-05: a sign-in that ended mid-task comes back to the same screen. Telegram links still open only the steps below.
for(const path of ['/patient/measurements/new','/patient/medicines','/patient/bp-week','/patient/account'])assert.equal(continuePath(path),path,path);
assert.deepEqual(Object.keys(CONTINUE_PATHS).sort(),['next_profile','next_questionnaire','next_review','open_care','open_chat','open_home','open_messages','open_progress','open_results','replies_off']);
console.log('check-continue-path: ok');
