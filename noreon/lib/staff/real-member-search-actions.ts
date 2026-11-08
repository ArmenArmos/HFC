'use server';
import {loggedAction} from '@/lib/observability/with-logging';
import {requireRealStaff} from '@/lib/patient-care/clinical-case-repository';
import {runMemberIdentitySearch} from './member-search-command';
import type {MemberSearchResult} from './member-search-schema';
import {withTestAccountFlags} from './test-accounts';

export const searchRealMembers=loggedAction("searchRealMembers",async function searchRealMembers(raw:unknown):Promise<MemberSearchResult>{
 const {client}=await requireRealStaff();
 return withTestAccountFlags(client,await runMemberIdentitySearch(raw,client));
});
