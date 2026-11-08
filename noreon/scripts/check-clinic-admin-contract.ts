import assert from'node:assert/strict';import{clinicAdminPageSchema,clinicAdminCommandSchema,clinicAdminLookupSchema}from'@/lib/clinic-portal/admin-schema';import{readClinicAdminPage,lookupClinicAccount,runClinicAdminCommand,refreshClinicAdminCommand}from'@/lib/clinic-portal/admin-runtime';import{clinic,actor,attempt}from'./fixtures/clinic-portal';
const page={version:'clinic-admin-memberships-v1',clinic:{id:clinic,name:'Synthetic clinic',active:true},memberships:[],invitations:[],invitationsHasMore:false,nextCursor:null,capabilities:{grantExisting:true,inviteNew:false}};assert.equal(clinicAdminPageSchema.parse(page).capabilities.inviteNew,false);assert.throws(()=>clinicAdminPageSchema.parse({...page,capabilities:{grantExisting:true,inviteNew:true}}));assert.throws(()=>clinicAdminLookupSchema.parse({status:'eligible',account:{userId:actor,email:'synthetic@example.invalid',password:'not allowed'}}));
const command=clinicAdminCommandSchema.parse({version:'clinic-admin-command-v1',op:'grant-existing',submissionId:attempt,clinicId:clinic,membershipId:actor,userId:actor,email:'synthetic@example.invalid',displayName:'Synthetic clinic administrator'});assert.throws(()=>clinicAdminCommandSchema.parse({...command,role:'admin'}));let calls:string[]=[];let data:unknown=page;const rpc={rpc:async(name:string)=>{calls.push(name);return{data,error:null};}};assert.equal((await readClinicAdminPage(rpc,clinic)).status,'loaded');data={...page,clinic:{...page.clinic,id:actor}};assert.equal((await readClinicAdminPage(rpc,clinic)).status,'unavailable');data={status:'eligible',account:{userId:actor,email:'someoneelse@example.invalid'}};assert.equal((await lookupClinicAccount(rpc,'synthetic@example.invalid')).status,'unavailable');data={status:'committed',submissionId:attempt,membershipId:actor,revision:0};assert.equal((await runClinicAdminCommand(rpc,command)).status,'committed');data={status:'committed',submissionId:clinic,membershipId:actor,revision:0};assert.equal((await runClinicAdminCommand(rpc,command)).status,'unknown');data={status:'loaded',membership:null,receipt:{status:'retired',submissionId:attempt,serialized:true}};calls=[];assert.equal((await refreshClinicAdminCommand(rpc,command)).status,'loaded');assert.deepEqual(calls,['clinic_admin_membership_refresh']);console.log('Clinic Noreon-admin management strictDTO/accountlookup/commandreceipt/read-only retirement and disablednewinvite contract PASS (injected RPC; authorization checked by guarded entrypoint/SQL later).');

// The record boundary refuses clinical content instead of showing or silently stripping it. The keys stay on the
// wire, always empty, so an app on either side of a schema-first deploy keeps working (audit S1-11, review R2).
const {recordSchema}=await import('@/lib/clinic-admin/schema');
const {readClinicPatientRecord}=await import('@/lib/clinic-admin/record');
const {clinicAdminRecord}=await import('./fixtures/clinic-admin');
assert.equal(recordSchema.safeParse(clinicAdminRecord).success,true,'Operational record with empty clinical keys is accepted');
const leaks:Record<string,unknown>={assessment:{completedAt:null,assessmentDate:'2026-10-01',algorithmVersion:'x',urgentRule:null,answers:{},updatedAt:'2026-11-01T08:00:00Z'},
 measurements:[{measuredAt:'2026-11-01T08:00:00Z',systolic:120,diastolic:80,pulse:null,source:'app'}],tests:[{title:'X'}],results:[{marker:'X',value:1}],
 plan:{clinician:'X',instructions:'X',publishedAt:'2026-11-01T08:00:00Z',acknowledgedAt:null,medicines:[]},memberDocuments:[{name:'X'}],reports:[{name:'X'}]};
for(const [key,value] of Object.entries(leaks)){
 const leaked={...clinicAdminRecord,[key]:value};
 assert.equal(recordSchema.safeParse(leaked).success,false,`${key} with content is refused`);
 assert.equal((await readClinicPatientRecord({rpc:async()=>({data:leaked,error:null})},clinic,clinicAdminRecord.member.memberId)).status,'unavailable');
 const {[key]:_,...missing}=clinicAdminRecord as Record<string,unknown>;
 assert.equal(recordSchema.safeParse(missing).success,false,`${key} must be present`);
}
for(const [key,value] of [['entries',[{observedAt:'x',recordedBy:'x',payload:{}}]],['thisClinic',false]] as const)
 assert.equal(recordSchema.safeParse({...clinicAdminRecord,visits:[{...clinicAdminRecord.visits[0],[key]:value}]}).success,false,`Visit ${key} is refused`);
assert.equal((await readClinicPatientRecord({rpc:async()=>({data:clinicAdminRecord,error:null})},clinic,clinicAdminRecord.member.memberId)).status,'loaded');
for(const [data,status]of [[{version:'clinic-admin-record-v1',enabled:false},'disabled'],[{version:'clinic-admin-record-v1',enabled:true,status:'refused'},'missing']]as const){
 assert.equal((await readClinicPatientRecord({rpc:async()=>({data,error:null})},clinic,clinicAdminRecord.member.memberId)).status,status);
}
console.log('Clinic admin record strict operational contract PASS: clinical keys present and empty, any content refused (injected RPC).');

// Schema-first deployment: existing strict DTOs accept nulls, never partial values or extra keys.
const {patientRowSchema}=await import('@/lib/clinic-admin/schema');
const {memberFileSchema}=await import('@/lib/clinic-scheduling/member-file');
const {clinicLabResultsSchema,clinicLabMembersSchema}=await import('@/lib/clinic-portal/lab-results-schema');
const {compareSchema}=await import('@/lib/clinic-admin/files-schema');
const maskedMember={memberId:actor,name:'Synthetic member',phone:null,birthDate:null};
assert.equal(patientRowSchema.safeParse({...maskedMember,doctorName:null,nurseName:null}).success,true);
assert.equal(recordSchema.safeParse({...clinicAdminRecord,member:{...clinicAdminRecord.member,phone:null,birthDate:null},profileChanges:[{at:'2026-11-01T08:00:00Z',by:null,before:{name:'Before',birthDate:null},after:{name:'After',birthDate:null}}]}).success,true);
assert.equal(memberFileSchema.safeParse({version:'clinic-member-file-v1',enabled:true,status:'ok',member:maskedMember,bookings:[],checkins:[],visits:[],files:[]}).success,true);
const labMember={memberId:actor,name:'Synthetic member',birthDate:null,bookingAt:'2026-11-01T08:00:00Z'};
assert.equal(clinicLabMembersSchema.safeParse({version:'clinic-lab-members-v1',enabled:true,members:[labMember],capped:false}).success,true);
assert.equal(clinicLabResultsSchema.safeParse({version:'clinic-lab-results-v1',enabled:true,reading:false,files:[{fileId:actor,name:'Synthetic.pdf',uploadedAt:'2026-11-01T08:00:00Z',linked:null,everLinked:false,reading:null,suggestion:{memberId:actor,confidence:'high',name:'Synthetic member',birthDate:null}}],members:[labMember]}).success,true);
assert.equal(compareSchema.safeParse({status:'compared',read:true,differs:false,mismatch:null,sheet:{nameMatch:'yes',birthYearMatch:'yes'},member:{name:'Synthetic member',birthDate:null,current:{name:'Synthetic member',birthDate:null}}}).success,true);
assert.equal(patientRowSchema.safeParse({...maskedMember,phone:'•••• 1234',doctorName:null,nurseName:null}).success,false);
assert.equal(patientRowSchema.safeParse({...maskedMember,birthYear:1968,doctorName:null,nurseName:null}).success,false);

const {clinicMemberMaskedSchema}=await import('@/lib/clinic-portal/member-masked-schema');
const {clinicMemberRevealInputSchema,clinicMemberRevealSchema}=await import('@/lib/clinic-admin/member-reveal-schema');
assert.equal(clinicMemberMaskedSchema.safeParse({ok:true,members:[{memberId:actor,phoneLast4:'0123',birthYear:1968},{memberId:clinic,phoneLast4:null,birthYear:null}]}).success,true);
for(const bad of ['123','12345','abcd'])assert.equal(clinicMemberMaskedSchema.safeParse({ok:true,members:[{memberId:actor,phoneLast4:bad,birthYear:1968}]}).success,false);
assert.equal(clinicMemberMaskedSchema.safeParse({ok:true,members:[{memberId:actor,phoneLast4:'0123',birthYear:1968,phone:'+37499120123'}]}).success,false);
assert.equal(clinicMemberRevealSchema.safeParse({ok:true,phone:'+37499120123',birthDate:'1968-02-23'}).success,true);
assert.equal(clinicMemberRevealSchema.safeParse({ok:true,phone:null,birthDate:null}).success,true);
assert.equal(clinicMemberRevealSchema.safeParse({ok:true,phone:'0123',birthDate:'1968'}).success,false);
for(const code of ['reason_required','rate_limited','refused','disabled','access','unavailable'])assert.equal(clinicMemberRevealSchema.safeParse({ok:false,code}).success,true);
assert.deepEqual(clinicMemberRevealInputSchema.parse({reason:'  Calling tomorrow  '}),{reason:'Calling tomorrow'});
console.log('Clinic masking contract PASS: legacy null DTOs, separate strict partial values and audited reveal DTO.');
