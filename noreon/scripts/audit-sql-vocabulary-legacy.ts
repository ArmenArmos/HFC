// Exact historical function blocks only, after the scanner's comment/identifier
// normalisation. These explicit vocabularies replace inference from guards and
// control flow. Changing a block invalidates its pin; new writers fail closed.
export const legacyAuditWriters:Record<string,{reason:string;source:string;value:string;codes:string[]}>= {
 'a09d84e4a10854c18b607b58a9ce08a37c2c2213b18e3a0a86c964330437c926':{
  reason:"command_patient_clinical_review: Historical clinical review assigns one of four event literals in separate branches.",
  source:"clinical_case",value:"kind",codes:["report-approved","result-received","consultation-decided","consultation-completed"],
 },
 '4d25e503fe8285e012356ee9e75a418d31cd491a5a5519a0b3f574b012c78328':{
  reason:"staff_care_command: Historical care writer prefixes a measurement literal or a guarded note kind with care-.",
  source:"clinical_case",value:"'care-'||kind",codes:["care-measurement","care-evidence","care-contact-attempted","care-reached","care-unreachable","care-refer-doctor"],
 },
 'a09ba7d789f2e2fb1d642fdcd6bcdfb6469d28d396fde0ec9a56711a71897f81':{
  reason:"staff_care_command: Historical care writer prefixes a measurement literal or a guarded note kind with care-.",
  source:"clinical_case",value:"'care-'||kind",codes:["care-measurement","care-evidence","care-contact-attempted","care-reached","care-unreachable","care-refer-doctor"],
 },
 '7e6f2fb2a7c34b6790f0da024cb3e67c4aebc05c839d93b90d99bf3dac16430e':{
  reason:"command_patient_test_request: Historical test-request dispatcher records a validated operation parameter.",
  source:"test_request",value:"p_operation",codes:["confirm","accept","cancel","request-change","change-outcome"],
 },
 '5afcf1f398e79e2dc9cee7bee6ad8a37b747794a0848afd40477aa11aedefcd9':{
  reason:"command_patient_test_request: Historical test-request dispatcher records a validated operation parameter.",
  source:"test_request",value:"p_operation",codes:["confirm","accept","cancel","request-change","change-outcome"],
 },
 'f43b95b4a16e6e963f590902599fef3852291d1298bfb729f62d52ea55d446d0':{
  reason:"command_patient_test_request: Historical test-request dispatcher records a validated operation parameter.",
  source:"test_request",value:"p_operation",codes:["confirm","accept","cancel","request-change","change-outcome"],
 },
 'e2b2a11e5e889da5cc06ddb67f236ddec3b35518cf60b0329df01fe6ff100f8a':{
  reason:"command_patient_test_request: Historical test-request dispatcher records a validated operation parameter.",
  source:"test_request",value:"p_operation",codes:["confirm","accept","cancel","request-change","change-outcome"],
 },
 '705f5da9c4bcf2b4a431f322459c11e4fdaad586db3fa50aed6b7ad24c107aeb':{
  reason:"command_patient_test_request: Historical test-request dispatcher records a validated operation parameter.",
  source:"test_request",value:"p_operation",codes:["confirm","accept","cancel","request-change","change-outcome"],
 },
 'aaefd2d5feb7a04fbcdbc36159d58d11c5e1029db57389a61b1b602316cc5a5a':{
  reason:"real_staff_record_invitation_submission: Historical invitation recorder prefixes a guarded outcome with submission_.",
  source:"staff_admin",value:"'submission_'||p_outcome",codes:["submission_accepted","submission_failed","submission_unknown"],
 },
 'cfc2b0535c41918bc4172569eac10fc3834291b3a3ec044583319751b9795749':{
  reason:"real_staff_record_invitation_submission: Historical invitation recorder prefixes a guarded outcome with submission_.",
  source:"staff_admin",value:"'submission_'||p_outcome",codes:["submission_accepted","submission_failed","submission_unknown"],
 },
 '351c832df7a352f543d4a84b2192f8058e2f7e0dd73d46509772b75c1fb84568':{
  reason:"patient_coordination_command: Historical coordination dispatcher records its CASE-validated operation parameter.",
  source:"coordination",value:"p_operation",codes:["create","edit","reassign","contact","await-member","reopen","complete","refer","resolve","cancel"],
 },
 '110e2747944c81e8136ccb94c08ede8173b87f37838f0fdb20d8d99db8520480':{
  reason:"patient_coordination_command: Historical coordination dispatcher records its CASE-validated operation parameter.",
  source:"coordination",value:"p_operation",codes:["create","edit","reassign","contact","await-member","reopen","complete","refer","resolve","cancel"],
 },
 'c51ca6fd2c148306336616eadd8eb0ab526f8677e4d4e41bfc4758f12fbab4bb':{
  reason:"command_patient_test_request: Historical test-request dispatcher records a validated operation parameter.",
  source:"test_request",value:"p_operation",codes:["confirm","accept","cancel","request-change","change-outcome"],
 },
 'd1d45eeb8472e37233cda78342172e4dd0e16f5a791818db83521ac15fe9eea1':{
  reason:"apply_booking_notice_receipt: Historical booking receipt maps a recorded receipt outcome to the event kind.",
  source:"booking",value:"outcome",codes:["reconciliation","accepted","failed","unknown"],
 },
 'fb549dd97438b8ec488ed3d3dbcc0dd440f442eab293885e2dedc4566b82dc2e':{
  reason:"apply_booking_notice_receipt: Historical booking receipt maps a recorded receipt outcome to the event kind.",
  source:"booking",value:"outcome",codes:["reconciliation","accepted","failed","unknown"],
 },
 '0a93c4541e510058b93ee41f307ea35bd6f9075855c1b6970a1a516db5cbbb60':{
  reason:"clinic_batch_command: Historical clinic dispatcher records a validated JSON operation.",
  source:"clinic",value:"p->>'op'",codes:["create-batch","reserve-upload"],
 },
 '440fba88b375da2293fb3ea6b4a70556581ea6d054bb991d11e01d94c184080b':{
  reason:"clinic_admin_membership_command: Historical membership writer prefixes a validator-approved JSON operation with membership-.",
  source:"clinic",value:"'membership-'||(p->>'op')",codes:["membership-grant-existing","membership-update","membership-revoke"],
 },
 '64d067ff5d0f1b4f43007e2b141b8040b926a65d1c101271eba4c96f73ccf8c5':{
  reason:"clinic_admin_membership_command: Historical membership writer prefixes a validator-approved JSON operation with membership-.",
  source:"clinic",value:"'membership-'||(p->>'op')",codes:["membership-grant-existing","membership-update","membership-revoke"],
 },
 '85a267bd398844af9ebc84a71f5ad416cd3c1385944d767f466c23fcf9a66304':{
  reason:"apply_booking_notice_receipt: Historical booking receipt maps a recorded receipt outcome to the event kind.",
  source:"booking",value:"outcome",codes:["reconciliation","accepted","failed","unknown"],
 },
 'f382fb939c784753c81ac2175fe5b9695aceafa6f5377d5c4e077341199930fe':{
  reason:"clinic_batch_command: Historical clinic dispatcher records a validated JSON operation.",
  source:"clinic",value:"p->>'op'",codes:["create-batch","reserve-upload"],
 },
 'a88e1a2edcee8fa1af261a36818930c4ec3cbeecade435b4b3726e745040e900':{
  reason:"_legacy_command_patient_test_request: Historical test-request dispatcher records a validated operation parameter.",
  source:"test_request",value:"p_operation",codes:["confirm","accept","cancel","request-change","change-outcome"],
 },
 '7a47bfdc38adb344aa087fe8b754dfa02cde38ec301576805a3c8b2a343e46a2':{
  reason:"_patient_coordination_command_before_nurse_handoffs_as: Historical coordination dispatcher records its CASE-validated operation parameter.",
  source:"coordination",value:"p_operation",codes:["create","edit","reassign","contact","await-member","reopen","complete","refer","resolve","cancel"],
 },
 '4546fb0a445a4a9141b751c47889540d6aa47f630fe047bb4d563e5310ff3913':{
  reason:"command_patient_clinical_review_before_clinic_lab: Historical clinical review assigns one of four event literals in separate branches.",
  source:"clinical_case",value:"kind",codes:["report-approved","result-received","consultation-decided","consultation-completed"],
 },
 'e078c53379cd5d0627b753379abc0e7ce06a63ad2852c3e8f09a15dd29826333':{
  reason:"_clinic_profile_apply: Historical profile apply assigns a literal-only CASE to an event variable.",
  source:"clinic",value:"event",codes:["profile_auto_applied","profile_updated"],
 },
 '553a3233cdddc8b09ea21dbb2150cfc5a3f566218a6be73dfee39d0223c54f3c':{
  reason:"staff_record_member_access: Historical staff access wrapper forwards a guarded surface parameter.",
  source:"access",value:"p_surface",codes:["member_history","member_upload","member_report"],
 },
 '31d3eff37959b5153db6624d29078644a124aa9f0a70f975e6e64200540af587':{
  reason:"test_signin_claim: Historical test sign-in maps refusal branches into a reason variable.",
  source:"telegram_auth",value:"test_signin.'refused'.reason",codes:["test_signin.refused.switched_off","test_signin.refused.outside_range","test_signin.refused.not_allowlisted"],
 },
 '3981b057c2eb77474db0455de84fa5377049bf233d515845234cbefc81a2703e':{
  reason:"test_signin_check: Historical test sign-in maps refusal branches into a reason variable.",
  source:"telegram_auth",value:"test_signin.'refused'.reason",codes:["test_signin.refused.switched_off_or_removed","test_signin.refused.unknown_request","test_signin.refused.not_verifiable","test_signin.refused.expired","test_signin.refused.rate_limited","test_signin.refused.wrong_code"],
 },
 '4f46f9d056563ad812e4ee04449f5105fb1b41fe22c402c14954c903e9ccc079':{
  reason:"test_signin_check: Provider-independent follow-up uses fixed-work bcrypt comparison and spends each issued code once; spent codes use wrong_code, preserving the existing finite refusal vocabulary.",
  source:"telegram_auth",value:"test_signin.'refused'.reason",codes:["test_signin.refused.switched_off_or_removed","test_signin.refused.unknown_request","test_signin.refused.not_verifiable","test_signin.refused.expired","test_signin.refused.rate_limited","test_signin.refused.wrong_code"],
 },
};

// These validators supply values to pinned writers. A changed definition must
// invalidate the explicit vocabulary even when the writer itself is unchanged.
export const legacyAuditDependencies:Record<string,{hash:string;reason:string}>={
 record_booking_notice_receipt:{
  hash:'d7a4067ec50705761af7263d8c01799bb7f10b6fee731193361b58c37a6f6afb',
  reason:'Booking receipt writers rely on the accepted, failed and unknown outcome guard.',
 },
 _clinic_portal_command:{
  hash:'2fcfad5770cb269ade19e7b8e391375775826786a699289b7d51fe9b2f07fc2e',
  reason:'Clinic batch writers rely on the create-batch and reserve-upload validator.',
 },
 _clinic_portal_admin_command:{
  hash:'c4e8171e2a60269403e65ff09a2773e3dfd0cc61f29ccd5e71a9ba64989806fa',
  reason:'Membership writers rely on the grant-existing, update and revoke validator.',
 },
};
