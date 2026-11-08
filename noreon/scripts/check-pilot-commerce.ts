import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {TEST_CATALOGUE} from '@/lib/clinical/seed/tests';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {gmDashboardEnabled,pilotCatalogEnabled,pilotPaymentsEnabled} from '@/lib/pilot-commerce/config';
import {amd} from '@/lib/pilot-commerce/format';
import {FakePaymentProvider,configuredProvider,reconcileWithProvider} from '@/lib/pilot-commerce/provider';
import {sendPilotCommand,type PilotRpc} from '@/lib/pilot-commerce/runtime';
import {TestPrices,MemberPaymentStatus,type MemberPricing} from '@/components/pilot-commerce/member-pricing';

// Dark by default; payments need the catalogue; never in the marketing build.
assert.equal(pilotCatalogEnabled({}),false);
assert.equal(pilotCatalogEnabled({NOREON_PILOT_CATALOG_ENABLED:'true'}),true);
assert.equal(pilotPaymentsEnabled({NOREON_PILOT_PAYMENTS_ENABLED:'true'}),false);
assert.equal(pilotPaymentsEnabled({NOREON_PILOT_PAYMENTS_ENABLED:'true',NOREON_PILOT_CATALOG_ENABLED:'true'}),true);
assert.equal(gmDashboardEnabled({NOREON_GM_DASHBOARD_ENABLED:'true',NOREON_DEPLOYMENT_TARGET:'marketing'}),false);
// Only the fake provider can be selected.
assert.equal(configuredProvider({})?.name,'fake');
assert.equal(configuredProvider({NOREON_PILOT_PAYMENTS_PROVIDER:'stripe'}),null);
assert.equal(amd(1234567),'AMD 1,234,567');
assert.equal(amd(6000,'hy'),'6 000 դրամ');

// Every bookable suggested test has a seeded catalogue row, so the price join never loses one.
const seeded=readdirSync('supabase/migrations').filter(f=>f.endsWith('.sql')).map(f=>readFileSync(`supabase/migrations/${f}`,'utf8')).join('\n');
for(const test of TEST_CATALOGUE.filter(t=>t.method!=='home_log'&&!t.discussOnly))assert.match(seeded,new RegExp(`\\('${test.id}','STG-`),`${test.id} has a pilot catalogue row`);

const pricing:MemberPricing={payments:null,catalog:[
 {testKey:'lipid-panel',nameEn:'Lipid profile with LDL-C',nameHy:'Լիպիդային պրոֆիլ',includedInPackage:false,priceAmd:6000,priceSource:'staging-placeholder'},
 {testKey:'bp-visit',nameEn:'Repeated blood pressure measurement',nameHy:'Ճնշման չափում',includedInPackage:true,priceAmd:0,priceSource:'staging-placeholder'},
]};
const html=renderToStaticMarkup(createElement(TestPrices,{items:[{id:'lipid-panel',title:'x'},{id:'bp-visit',title:'y'},{id:'mystery',title:'Mystery test'}],pricing,locale:'en'}));
assert.match(html,/AMD 6,000/);
assert.match(html,/Included in your package/);
assert.match(html,/Mystery test<\/span><span[^>]*>Price not available yet/,'An unpriced test is named, not shown as free');
assert.doesNotMatch(html,/Total for priced tests|data-test-total/,'An unknown price hides the total');
assert.match(html,/sample prices/);
assert.doesNotMatch(html,/—|!/,'Member copy has no em dash or exclamation mark');
const hy=renderToStaticMarkup(createElement(TestPrices,{items:[{id:'lipid-panel',title:'x'}],pricing,locale:'hy'}));
assert.match(hy,/6 000 դրամ/);
const paid=renderToStaticMarkup(createElement(MemberPaymentStatus,{locale:'en',payment:{id:'9c000000-0000-4000-8000-000000000c01',memberId:'9c000000-0000-4000-8000-000000000001',bookingKind:'test-request',bookingId:'9c000000-0000-4000-8000-000000000a01',amountAmd:11000,currency:'AMD',lines:[],priceBasis:'staging-placeholder',status:'pending',revision:1,createdAt:'2026-10-17T10:00:00+04:00',updatedAt:'2026-10-17T10:00:00+04:00'}}));
assert.match(paid,/Awaiting payment/);assert.match(paid,/AMD 11,000/);

// Fake provider: a link alone is never paid; a settled answer is recorded once through the database.
const provider=new FakePaymentProvider();
const link=await provider.createLink({paymentId:'9c000000-0000-4000-8000-000000000c01',amountAmd:11000,currency:'AMD'});
assert.equal(link.url,null);
const calls:unknown[]=[];
const rpc={rpc:async(name:string,args?:Record<string,unknown>)=>{calls.push([name,args]);return{data:{status:'saved',current:'paid'},error:null};}};
assert.deepEqual(await reconcileWithProvider(rpc,provider,link.reference),{status:'pending'});
assert.equal(calls.length,0);
provider.settle(link.reference,'paid');
assert.equal((await reconcileWithProvider(rpc,provider,link.reference)).status,'saved');
assert.deepEqual(calls[0],['pilot_payment_provider_event',{p_event:{provider:'fake',providerReference:link.reference,eventId:`${link.reference}:paid`,status:'paid'}}]);

// Commands are validated before they reach the database; transport errors are an unknown outcome.
const never:PilotRpc={rpc:async()=>{throw Error('not called');}};
assert.equal((await sendPilotCommand(never,{action:'set-status',submissionId:'x'})).status,'invalid');
assert.equal((await sendPilotCommand(never,{action:'create-test',submissionId:'9c000000-0000-4000-8000-000000000501',testKey:'Bad Key',partnerCode:'A',nameEn:'a',nameHy:'a',includedInPackage:false,activeFrom:'2026-10-01',activeUntil:null,priceAmd:1,priceSource:'staging-placeholder',reason:'r'})).status,'invalid');
assert.equal((await sendPilotCommand(never,{action:'create-payment',submissionId:'9c000000-0000-4000-8000-000000000502',bookingKind:'appointment',bookingId:'9c000000-0000-4000-8000-000000000b02'})).status,'outcome-unknown');
console.log('pilot commerce TS checks passed');
