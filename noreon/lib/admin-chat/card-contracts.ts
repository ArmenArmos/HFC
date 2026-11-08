import type {MemberSearchPage} from '@/lib/staff/member-search-schema';
import type {CoordinationActor,CoordinationTaskPage,CoordinationMemberPage} from '@/lib/staff/real-coordination/schema';
import type {PilotBookingData} from '@/lib/real-booking/appointment-schema';
import type {BookingRequest} from '@/lib/real-booking/schema';
import type {MemberContact} from '@/lib/staff/member-contact-schema';
export type AdminMemberBookings={memberId:string;name:string|null;enabled:boolean;pilot:PilotBookingData|null;requests:BookingRequest[]|null;contact:MemberContact|null};
export type AdminCardKind='care-team'|'tasks'|'bookings';
export type CareDirectoryEntry={id:string;name:string;clinic:string;clinicId?:string};
export type AdminActionCard=
 |{kind:'care-team';page:MemberSearchPage;doctors:CareDirectoryEntry[];nurses:CareDirectoryEntry[]}
 |{kind:'bookings';page:MemberSearchPage}
 |{kind:'tasks';actor:CoordinationActor;page:CoordinationTaskPage;memberPage:CoordinationMemberPage};
