import type {ChatMemberIdentity} from '@/lib/staff/chat-member-identity-schema';
import type {ChatWho} from './chat-v2-read';
export type PanelMember={
 identity:ChatMemberIdentity;risk:'very_high'|'high'|'moderate'|'low'|null;
 attention:'urgent'|'needs_me'|'none'|'unknown';unavailable:boolean;
 bp:{systolic:number;diastolic:number;at:string;unverified:boolean}|null;
 ldl:{value:number;on:string;counted:boolean}|null;
};
export type PanelBar={key:string;count:number;memberIds:string[]};
export type PanelGraph={kind:'ldl'|'risk'|'alerts'|'readings';bars:PanelBar[];total:number};
export type DoctorPanel={kind:'panel';rosterComplete?:boolean;rows:PanelMember[];graphs:PanelGraph[];who:ChatWho;asOf:string};
export type PanelResponse=DoctorPanel|{kind:'refused'|'unavailable'};
