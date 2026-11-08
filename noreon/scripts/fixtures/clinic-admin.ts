/** Fictional operational record, without clinical content. */
const stamp='2026-11-01T08:00:00Z';
export const clinicAdminRecord={
 version:'clinic-admin-record-v1',enabled:true,status:'ok',
 member:{memberId:'c1c10000-0000-4000-8000-000000000090',name:'Fictional clinic member',phone:null,birthDate:'1975-04-05',sex:'female',locale:'en',joinedAt:stamp,updatedAt:stamp},
 pendingRequests:[],consents:[{version:'patient-pilot-v1',acceptedAt:stamp}],
 careTeam:{enrolled:true,revision:1,enrolledAt:stamp,doctor:null,nurse:null,editable:true,doctors:[],nurses:[]},
 assessment:null,measurements:[],tests:[],results:[],plan:null,memberDocuments:[],reports:[],
 bookings:[],visits:[{visitId:'c1c10000-0000-4000-8000-000000000091',visitedAt:stamp,clinicName:'Fictional clinic',thisClinic:true,recordedBy:'Fictional clinic nurse',role:'nurse',entries:[]}],
 files:[{fileId:'c1c10000-0000-4000-8000-000000000092',name:'Fictional clinic upload.pdf',uploadedAt:stamp,batchName:'Fictional batch',linkedAt:stamp,visitedAt:stamp}],
 profileChanges:[],
};
