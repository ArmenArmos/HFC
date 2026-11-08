import assert from 'node:assert/strict';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {bpDevicesEnabled} from '@/lib/bp-device/config';
import {bpDeviceCommandSchema,bpInventorySchema,bpMemberDevicesSchema,bpHeldReadingSchema,type BpMemberDevices} from '@/lib/bp-device/schema';
import {readBpMemberDevices,sendBpDeviceCommand,type BpRpc} from '@/lib/bp-device/runtime';
import {FakeBpTransport,rpcIngestPort,syncBpReadings,type BpIngestPort} from '@/lib/bp-device/sync';
import {BpReadingsHistory} from '@/components/staff/bp-readings-history';
import {BpAssignmentHistory} from '@/components/staff/bp-assignment-history';

const member='b7000000-0000-4000-8000-000000000001',device='b7000000-0000-4000-8000-000000000301',sub='b7000000-0000-4000-8000-000000000501';

// Dark by default; never in the marketing build.
assert.equal(bpDevicesEnabled({}),false);
assert.equal(bpDevicesEnabled({NOREON_BP_DEVICES_ENABLED:'true'}),true);
assert.equal(bpDevicesEnabled({NOREON_BP_DEVICES_ENABLED:'true',NOREON_DEPLOYMENT_TARGET:'marketing'}),false);

// Commands are strict per action.
assert.ok(bpDeviceCommandSchema.safeParse({version:'bp-device-v1',submissionId:sub,action:'assign',deviceId:device,memberId:member,effectiveAt:null,reason:null}).success);
assert.ok(!bpDeviceCommandSchema.safeParse({version:'bp-device-v1',submissionId:sub,action:'end',deviceId:device,status:'returned',effectiveAt:null}).success,'A return needs a reason');
assert.ok(!bpDeviceCommandSchema.safeParse({version:'bp-device-v1',submissionId:sub,action:'register',model:'X',serial:'ab',memberId:member}).success,'No extra keys');
assert.ok(!bpDeviceCommandSchema.safeParse({version:'bp-device-v1',submissionId:sub,action:'set-status',deviceId:device,status:'assigned',reason:null}).success,'Assigned is never set directly');

// Held readings carry no values for admins.
assert.ok(!bpHeldReadingSchema.safeParse({id:sub,serial:'BP-A1',deviceId:null,measuredAt:'2026-10-16T05:00:00+00:00',receivedAt:'2026-10-16T05:00:00+00:00',reason:'no-assignment',claimedMember:null,systolic:120}).success);
assert.ok(bpInventorySchema.safeParse({version:'bp-device-v1',devices:[],held:[]}).success);

// Runtime: register serial is upper-cased, unknown errors are outcome-unknown, and a read for another member is refused.
const calls:{name:string;args?:Record<string,unknown>}[]=[];
const client=(data:unknown,error:{code?:string}|null=null):BpRpc=>({rpc:(name,args)=>{calls.push({name,args});return Promise.resolve({data,error});}});
assert.deepEqual(await sendBpDeviceCommand(client({status:'saved',deviceId:device,replayed:false}),{version:'bp-device-v1',submissionId:sub,action:'register',model:'Synthetic',serial:'bp-a1'}),{status:'saved',deviceId:device,replayed:false});
assert.equal((calls.at(-1)?.args?.p_command as {serial:string}).serial,'BP-A1');
assert.deepEqual(await sendBpDeviceCommand(client(null,{code:'XX000'}),{version:'bp-device-v1',submissionId:sub,action:'recheck-held',readingId:sub}),{status:'outcome-unknown'});
assert.deepEqual(await sendBpDeviceCommand(client(null,{code:'55P03'}),{version:'bp-device-v1',submissionId:sub,action:'recheck-held',readingId:sub}),{status:'unavailable'});
assert.deepEqual(await sendBpDeviceCommand(client({status:'saved',surprise:true}),{version:'bp-device-v1',submissionId:sub,action:'recheck-held',readingId:sub}),{status:'outcome-unknown'});
assert.deepEqual(await sendBpDeviceCommand(client({}),{action:'register'}),{status:'invalid'});
const memberRead:BpMemberDevices={version:'bp-device-v1',memberId:member,current:null,history:[],available:[],readings:[]};
assert.ok(bpMemberDevicesSchema.safeParse(memberRead).success);
await assert.rejects(readBpMemberDevices(client({...memberRead,memberId:sub}),member),'A read for a different member is refused');

// Sync adapter (fake transport only, awaiting Q11): cursor advances only past known outcomes.
const readings=[1,2,3].map(n=>({externalId:`r${n}`,serial:'BP-A1',systolic:120+n,diastolic:80,pulse:70,measuredAt:`2026-10-16T0${n}:00:00Z`,memberId:null}));
const transport=new FakeBpTransport(readings);
const seen:Record<string,unknown>[]=[];
const ok:BpIngestPort=async payload=>{seen.push(payload);return{status:'attached',readingId:sub,reason:null,replayed:false};};
const first=await syncBpReadings(transport,ok,null);
assert.equal(first.complete,true);assert.equal(first.cursor,'3');assert.equal(seen.length,3);
assert.deepEqual(Object.keys(seen[0]).sort(),['diastolic','externalId','measuredAt','memberId','pulse','serial','systolic','transport','version']);
assert.equal(seen[0].transport,'fake');assert.equal(seen[0].version,'bp-reading-v1');
let n=0;
const flaky:BpIngestPort=async()=>++n===2?{status:'unavailable'}:{status:'held',readingId:sub,reason:'no-assignment',replayed:false};
const second=await syncBpReadings(new FakeBpTransport(readings),flaky,null);
assert.equal(second.complete,false);assert.equal(second.cursor,null,'A failed run resumes from the same cursor');
assert.equal((await syncBpReadings(new FakeBpTransport(readings),ok,'3')).outcomes.length,0);
// The RPC port refuses an unexpected response shape.
assert.deepEqual(await rpcIngestPort({rpc:()=>Promise.resolve({data:{status:'attached'},error:null})})({}),{status:'failed'});
// Review B7-R1: a resent reading that was dismissed is a known outcome; sync moves past it.
assert.deepEqual(await rpcIngestPort({rpc:()=>Promise.resolve({data:{status:'dismissed',readingId:sub,reason:null,replayed:true},error:null})})({}),{status:'dismissed',readingId:sub,reason:null,replayed:true});
{const port=rpcIngestPort({rpc:()=>Promise.resolve({data:{status:'dismissed',readingId:sub,reason:null,replayed:true},error:null})});const run=await syncBpReadings(new FakeBpTransport(readings),port,null);assert.equal(run.complete,true);assert.equal(run.cursor,'3');}
assert.deepEqual(await rpcIngestPort({rpc:()=>Promise.resolve({data:{status:'held',readingId:sub,reason:'member-mismatch',replayed:false},error:null})})({}),{status:'held',readingId:sub,reason:'member-mismatch',replayed:false});

// Renders: trend plus a full table in both languages; sources are labelled.
const visitRow={id:'b7000000-0000-4000-8000-000000000777',systolic:262,diastolic:118,pulse:90,measuredAt:'2026-10-14T05:00:00+00:00',source:'visit' as const,serial:null};
const rows=[{id:sub,systolic:131,diastolic:84,pulse:72,measuredAt:'2026-10-16T05:00:00+00:00',source:'device' as const,serial:'BP-A1'},{id:device,systolic:128,diastolic:82,pulse:null,measuredAt:'2026-10-15T05:00:00+00:00',source:'manual' as const,serial:null}];
const en=renderToStaticMarkup(createElement(BpReadingsHistory,{readings:rows,locale:'en'}));
// Review B7-R3/R6: visit readings are labelled as such, and an extreme value is plotted inside the chart, not clipped.
const extreme=renderToStaticMarkup(createElement(BpReadingsHistory,{readings:[...rows,visitRow],locale:'en'}));
assert.match(extreme,/Recorded at a visit/);
const ys=[...extreme.matchAll(/<circle[^>]*cy="([\d.-]+)"/g)].map(m=>Number(m[1]));assert.equal(ys.length,3);assert.ok(ys.every(v=>v>=0&&v<=200),'Every point inside the chart');assert.equal(new Set(ys).size,3,'Distinct values stay distinct');
assert.match(en,/Monitor BP-A1/);assert.match(en,/Recorded manually/);assert.match(en,/role="img"/);assert.match(en,/131\/84/);assert.match(en,/Not recorded/);
assert.doesNotMatch(en,/—/,'No em dashes in copy');
const hy=renderToStaticMarkup(createElement(BpReadingsHistory,{readings:rows,locale:'hy'}));
assert.match(hy,/Սարք BP-A1/);assert.match(hy,/lang="hy"/);
assert.match(renderToStaticMarkup(createElement(BpReadingsHistory,{readings:[],locale:'en'})),/No readings yet/);
const history=renderToStaticMarkup(createElement(BpAssignmentHistory,{locale:'en',history:[{id:sub,deviceId:device,serial:'BP-A1',model:'Synthetic',memberId:member,memberName:'Synthetic member',assignedAt:'2026-10-15T05:00:00+00:00',recordedAt:'2026-10-15T05:00:00+00:00',assignedBy:{name:'Synthetic nurse',role:'nurse'},assignReason:null,endedAt:'2026-10-16T05:00:00+00:00',endedBy:{name:'Synthetic admin',role:'admin'},endReason:'Synthetic wrong hand-over'}]}));
assert.match(history,/Synthetic wrong hand-over/);assert.match(history,/Synthetic admin, admin/);
console.log('BP device flag, schemas, runtime, fake sync adapter and renders checked.');
