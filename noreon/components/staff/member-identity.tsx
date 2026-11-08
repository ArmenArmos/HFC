import {chatMemberIdentityLine,type MemberIdentity as Identity} from '@/lib/staff/member-identity';
import type {StaffLocale} from '@/lib/staff/staff-locale-copy';

export function MemberIdentity({member,locale,className=''}:{member:Identity;locale:StaffLocale;className?:string}){
 return <span className={`member-identity tabular-nums ${className}`.trim()}>{chatMemberIdentityLine(member,locale)}</span>;
}
