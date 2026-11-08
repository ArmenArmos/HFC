import assert from 'node:assert/strict';
import {NextRequest} from 'next/server';
// The actual proxy: the public site's hosts send member links to the app, the retired demo host
// is not found, the app keeps serving /patient, and old entry paths still go to the homepage.
const saved={...process.env};
Object.assign(process.env,{NOREON_DEPLOYMENT_TARGET:'marketing'});
delete process.env.NEXT_PUBLIC_SUPABASE_URL;delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
try{
 const {proxy}=await import('../proxy');
 const req=(url:string,method='GET')=>new NextRequest(url,{method,headers:{host:new URL(url).host}});
 for(const host of ['noreon.health','www.noreon.health']){
  for(const path of ['/patient','/patient/dashboard','/patient/results/history?view=trends','/patient/account/telegram']){
   const response=await proxy(req(`https://${host}${path}`));
   assert.equal(response.status,307,`${host}${path}`);
   assert.equal(response.headers.get('location'),`https://app.noreon.health${path}`,`${host}${path} keeps its path and query`);
  }
  for(const path of ['/login','/welcome','/health-questions/start']){
   const response=await proxy(req(`https://${host}${path}`));
   assert.equal(response.status,307,`${host}${path}`);
   assert.equal(response.headers.get('location'),`https://${host}/`,`${host}${path} still returns to the homepage`);
  }
  const home=await proxy(req(`https://${host}/`));
  assert.equal(home.headers.get('location'),null,'The public homepage is served, not redirected');
 }
 for(const path of ['/patient','/patient/dashboard'])assert.equal((await proxy(req(`https://demo.noreon.health${path}`))).status,404,`demo.noreon.health${path}`);
 delete process.env.NOREON_DEPLOYMENT_TARGET;
 const app=await proxy(req('https://app.noreon.health/patient/dashboard'));
 assert.equal(app.headers.get('location'),null,'The member app serves /patient itself');
 assert.notEqual(app.status,404);
 console.log('Public site: /patient on noreon.health and www redirects to app.noreon.health with path and query; demo.noreon.health is not found; old entry paths return home; the app serves /patient.');
}finally{for(const key of Object.keys(process.env))if(!(key in saved))delete process.env[key];Object.assign(process.env,saved);}
