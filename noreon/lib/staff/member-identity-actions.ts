'use server';
import {loggedAction} from '@/lib/observability/with-logging';
import {requireRealStaff} from '@/lib/patient-care/clinical-case-repository';
import {runStaffMemberIdentities} from './member-identity-command';

export const readStaffMemberIdentities=loggedAction('readStaffMemberIdentities',async function readStaffMemberIdentities(raw:unknown){
 const {client}=await requireRealStaff();
 return runStaffMemberIdentities(raw,client);
});
