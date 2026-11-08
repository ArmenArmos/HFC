import 'server-only';
import {z} from 'zod';
import type {DocumentRpc} from '@/lib/doctor-completion/document-runtime';
import type {MemberContact} from './member-contact-schema';
import {memberContactsSchema} from './member-contact-schema';
/** QA F-01. Admin only: the database refuses any other session. Null means unreadable; a missing id is not a member. */
export async function readMemberContacts(rpc:DocumentRpc,memberIds:string[]):Promise<Record<string,MemberContact>|null>{
 const ids=[...new Set(memberIds)].filter(id=>z.uuid().safeParse(id).success);
 if(!ids.length)return {};
 try{const r=await rpc.rpc('admin_member_contacts',{p_members:ids});if(r.error)return null;
  const p=memberContactsSchema.safeParse(r.data);return p.success?p.data:null;}catch{return null;}
}
