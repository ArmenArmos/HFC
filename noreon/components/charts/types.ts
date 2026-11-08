import type {StaffLocale} from '@/lib/staff/staff-locale-copy';
export type ChartSource='home'|'clinic'|'reviewed'|'unreviewed'|'member'|'verified';
export type TrendPoint={id:string;at:string;values:readonly number[];source:ChartSource;slot?:'morning'|'evening';dateOnly?:boolean};
/** references: the member's own target lines (WP T), one value per series index, drawn dashed with a text line. */
export type TrendReference={value:number;series:number};
export type TrendData={points:TrendPoint[];target?:{below:number};references?:readonly TrendReference[]};
export type TrendProps=TrendData&{title:string;labels:readonly string[];unit:string;locale:StaffLocale;entity?:'bp'|'ldl'|'adherence'|'other';emptyText:string;sparkline?:boolean;defaultExpanded?:boolean};
