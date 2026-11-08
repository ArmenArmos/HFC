'use server';
import {loggedAction} from '@/lib/observability/with-logging';
import {requireRealStaff} from '@/lib/patient-care/clinical-case-repository';
import {readChatMemberIdentities} from './chat-member-identity-read';

export const readStaffChatMemberIdentities=loggedAction('readStaffChatMemberIdentities',async function readStaffChatMemberIdentities(ids:unknown){
 const {client,identity}=await requireRealStaff();
 const rows=await readChatMemberIdentities(client as unknown as Parameters<typeof readChatMemberIdentities>[0],ids);
 // Admins are never assigned care-team members. Keep this boundary masked even
 // if an over-broad RPC payload accidentally includes a full phone.
 return identity.role==='admin'&&rows?rows.map(row=>{const masked={...row};delete masked.phone;return masked;}):rows;
});
