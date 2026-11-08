/**
 * The one role model for every surface (WP F): eight application roles, the permissions each holds, how a request's
 * identities map onto roles, and the conversational assistant each role gets.
 *
 * Framework-free on purpose (no next/* imports), like the rest of lib/. This file mirrors the database for the UI and
 * for card commands; it is never the enforcement point. Every write and every staff read is still authorised inside its
 * SECURITY DEFINER function (staff_care_access, _case_physician, _staff_coordination_access, _caregiver_can).
 *
 * Zoe is an assistant, not a clinician: no assistant may hold a clinical decision permission
 * (CLINICAL_DECISION_PERMISSIONS: target.set, plan.approve, plan.change, lab.order, lab.result_review, held by
 * physicians only) or perform triage (triage.perform, held by nurses and physicians). ASSISTANT_FORBIDDEN_PERMISSIONS is
 * that whole set. The assistant only opens cards; the human role's explicit confirmation performs the write.
 */
import type {Locale} from '../locale';
import {NOREON, NOREON_HY, ZOE, ZOE_HY} from '../brand';

export const APP_ROLES=['patient','caregiver','nurse','family_physician','cardiologist','care_coordinator','clinic_admin','noreon_admin']as const;
export type AppRole=typeof APP_ROLES[number];

export const PERMISSIONS_LIST=[
 'chat.own',
 'member.read_own','member.read_delegated','member.read_assigned','member.read_clinic_logistics',
 'bp.log_own','bp.log_delegated','dose.confirm_own','dose.confirm_delegated',
 'triage.perform','target.set','plan.approve','plan.change',
 'lab.order','lab.result_enter','lab.result_review',
 'schedule.manage',
 'alert.receive','alert.acknowledge','alert.escalate','alert.configure_thresholds','alert.configure_routing',
 'previsit.summary_view',
 'outcomes.view_clinic','outcomes.view_network','outcomes.export_deidentified',
 'staff.manage_clinic','staff.manage_network','clinic.manage',
 'voice.use','voice.settings_manage',
 'caregiver.manage_own','consent.manage_own',
 'audit.view_clinic','audit.view_network',
]as const;
export type Permission=typeof PERMISSIONS_LIST[number];

/** Clinical decisions: made by a physician only, never by Zoe and never by a non-physician role. */
export const CLINICAL_DECISION_PERMISSIONS=['target.set','plan.approve','plan.change','lab.order','lab.result_review']as const satisfies readonly Permission[];
/** What no assistant may ever do itself: every clinical decision, and triage (which nurses also perform). */
export const ASSISTANT_FORBIDDEN_PERMISSIONS=[...CLINICAL_DECISION_PERMISSIONS,'triage.perform']as const satisfies readonly Permission[];

const PHYSICIAN:readonly Permission[]=[
 'chat.own','member.read_assigned','triage.perform','target.set','plan.approve','plan.change',
 'lab.order','lab.result_enter','lab.result_review','alert.receive','alert.acknowledge','alert.escalate','alert.configure_thresholds',
 'previsit.summary_view','outcomes.view_clinic','voice.use',
];

export const PERMISSIONS:Readonly<Record<AppRole,readonly Permission[]>>=Object.freeze({
 patient:['chat.own','member.read_own','bp.log_own','dose.confirm_own','alert.receive','voice.use','caregiver.manage_own','consent.manage_own'],
 // Every delegated permission is further limited by the scopes the member granted (_caregiver_can in SQL).
 caregiver:['chat.own','member.read_delegated','bp.log_delegated','dose.confirm_delegated','alert.receive','voice.use'],
 nurse:['chat.own','member.read_assigned','triage.perform','lab.result_enter','schedule.manage','alert.receive','alert.acknowledge','alert.escalate','previsit.summary_view','voice.use'],
 family_physician:PHYSICIAN,
 cardiologist:PHYSICIAN,
 // Logistics only: no clinical read or write (staff_care_access never includes coordinators).
 care_coordinator:['chat.own','member.read_clinic_logistics','schedule.manage','alert.receive','voice.use'],
 clinic_admin:['chat.own','member.read_clinic_logistics','schedule.manage','alert.configure_routing','outcomes.view_clinic','outcomes.export_deidentified','staff.manage_clinic','clinic.manage','voice.use','voice.settings_manage','audit.view_clinic'],
 noreon_admin:['chat.own','member.read_clinic_logistics','schedule.manage','alert.configure_thresholds','alert.configure_routing','outcomes.view_clinic','outcomes.view_network','outcomes.export_deidentified','staff.manage_clinic','staff.manage_network','clinic.manage','voice.use','voice.settings_manage','audit.view_clinic','audit.view_network'],
});

export function can(role:AppRole,permission:Permission):boolean{
 return PERMISSIONS[role].includes(permission);
}
/** Any of the roles holds the permission. */
export function canAny(roles:readonly AppRole[],permission:Permission):boolean{
 return roles.some(role=>can(role,permission));
}

export type StaffRoleValue='admin'|'doctor'|'nurse'|'coordinator'|'qa';
export type PhysicianSpecialty='family_physician'|'cardiologist';
export type IdentityInput={
 /** A signed-in member (patientIdentity). */
 member?:{userId:string}|null;
 /** Active caregiver links (caregiver_members_read); any entry makes the account a caregiver. */
 caregiverLinks?:readonly unknown[]|null;
 /** The admitted staff identity (real_clinical_staff_identity). */
 staff?:{role:StaffRoleValue;specialty?:PhysicianSpecialty|null}|null;
 /** The clinic portal identity (clinic_portal_identity). */
 clinic?:{capability:'clinic_admin'|'clinic_staff'}|null;
};

/**
 * The roles a request holds, in APP_ROLES order. A staff account never also counts as a member or caregiver (the
 * database refuses member and caregiver functions to staff), qa maps to no application role, a doctor maps by specialty
 * (no specialty reads as family physician, as the database defaults it), and clinic_staff alone is no role here.
 */
export function rolesFromIdentities(input:IdentityInput):AppRole[]{
 const roles=new Set<AppRole>();
 const staff=input.staff??null;
 if(staff){
  if(staff.role==='admin')roles.add('noreon_admin');
  else if(staff.role==='nurse')roles.add('nurse');
  else if(staff.role==='coordinator')roles.add('care_coordinator');
  else if(staff.role==='doctor')roles.add(staff.specialty==='cardiologist'?'cardiologist':'family_physician');
 }
 if(input.clinic?.capability==='clinic_admin')roles.add('clinic_admin');
 if(!staff){
  if(input.member?.userId)roles.add('patient');
  if((input.caregiverLinks?.length??0)>0)roles.add('caregiver');
 }
 return APP_ROLES.filter(role=>roles.has(role));
}

export type Assistant={id:string;greeting:Readonly<Record<Locale,string>>;intents:readonly string[]};
const greet=(hy:string,en:string,ru:string):Readonly<Record<Locale,string>>=>Object.freeze({hy,en,ru});

/**
 * Each role's own conversational assistant: the same Zoe, with the role's greeting and the intents it may open as cards.
 * Intents are names of things the assistant can open or explain; none of them is a write. Draft copy, unapproved.
 */
export const ASSISTANTS:Readonly<Record<AppRole,Assistant>>=Object.freeze({
 patient:{id:'zoe-member',
  greeting:greet(`Բարև, ես ${ZOE_HY.definite} եմ՝ ${NOREON_HY.genitive} օգնականը։ Ինչո՞վ օգնեմ այսօր։`,`Hello, I am ${ZOE.en}, your ${NOREON.en} assistant. How can I help today?`,`Здравствуйте, я ${ZOE.ru}, ваш помощник ${NOREON.ru}. Чем помочь сегодня?`),
  intents:['bp.log','dose.confirm','plan.view','results.view','visit.view','message.care_team','caregiver.manage','consents.manage','voice.settings']},
 caregiver:{id:'zoe-caregiver',
  greeting:greet(`Բարև, ես ${ZOE_HY.definite} եմ։ Կօգնեմ ձեզ հոգ տանել ձեր մտերիմի մասին այն չափով, որքան նա թույլատրել է։`,`Hello, I am ${ZOE.en}. I help you care for your family member, within what they have allowed.`,`Здравствуйте, я ${ZOE.ru}. Я помогу вам заботиться о близком человеке в пределах того, что он разрешил.`),
  intents:['members.view','invitations.view','bp.log_for_member','plan.view_for_member','readings.view_for_member','dose.confirm_for_member']},
 nurse:{id:'zoe-nurse',
  greeting:greet(`Բարև, ես ${ZOE_HY.definite} եմ։ Ցույց տա՞մ այսօրվա առաջնահերթությունները։`,`Hello, I am ${ZOE.en}. Shall I show today's priorities?`,`Здравствуйте, я ${ZOE.ru}. Показать приоритеты на сегодня?`),
  intents:['today.view','alerts.view','tasks.view','visits.view','member.find','handoff.open','previsit.summary']},
 family_physician:{id:'zoe-family-physician',
  greeting:greet(`Բարև, ես ${ZOE_HY.definite} եմ։ Ձեր հաստատմանն սպասող քարտերը պատրաստ են։`,`Hello, I am ${ZOE.en}. The cards waiting for your approval are ready.`,`Здравствуйте, я ${ZOE.ru}. Карточки, ожидающие вашего решения, готовы.`),
  intents:['today.view','alerts.view','approvals.view','member.find','previsit.summary','plan.review','target.review','labs.review']},
 cardiologist:{id:'zoe-cardiologist',
  greeting:greet(`Բարև, ես ${ZOE_HY.definite} եմ։ Ահա ձեզ ուղղորդված անդամները և նրանց սպասող որոշումները։`,`Hello, I am ${ZOE.en}. Here are the members referred to you and the decisions waiting for you.`,`Здравствуйте, я ${ZOE.ru}. Вот участники, направленные к вам, и решения, которые ждут вас.`),
  intents:['referrals.view','alerts.view','approvals.view','member.find','previsit.summary','plan.review','target.review','labs.review']},
 care_coordinator:{id:'zoe-coordinator',
  greeting:greet(`Բարև, ես ${ZOE_HY.definite} եմ։ Ցույց տա՞մ կազմակերպման սպասող գործերը։`,`Hello, I am ${ZOE.en}. Shall I show the logistics waiting to be arranged?`,`Здравствуйте, я ${ZOE.ru}. Показать организационные задачи, которые ждут?`),
  intents:['logistics.view','consultations.arrange','bookings.view','tasks.view']},
 clinic_admin:{id:'zoe-clinic-admin',
  greeting:greet(`Բարև, ես ${ZOE_HY.definite} եմ։ Կօգնեմ ձեր կլինիկայի թիմի, ժամերի և արդյունքների հարցում։`,`Hello, I am ${ZOE.en}. I can help with your clinic's team, hours and outcomes.`,`Здравствуйте, я ${ZOE.ru}. Помогу с командой, расписанием и результатами вашей клиники.`),
  intents:['team.view','hours.view','bookings.view','approvals.view','outcomes.view','audit.view','routing.view']},
 noreon_admin:{id:'zoe-noreon-admin',
  greeting:greet(`Բարև, ես ${ZOE_HY.definite} եմ։ Ցույց տա՞մ ցանցի այսօրվա պատկերը։`,`Hello, I am ${ZOE.en}. Shall I show today's picture across the network?`,`Здравствуйте, я ${ZOE.ru}. Показать сегодняшнюю картину по сети?`),
  intents:['network.overview','staff.view','clinics.view','outcomes.view','audit.view','routing.view','thresholds.view']},
});

export function assistantGreeting(role:AppRole,locale:Locale):string{
 return ASSISTANTS[role].greeting[locale]??ASSISTANTS[role].greeting.hy;
}
