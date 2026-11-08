import type {Locale} from '@/lib/locale';
import {ClinicFileLinkedNotice} from './member-masked';
/** Compatibility for old imports: clinic sessions never fetch or frame an original. */
export function ClinicPdfViewer(_props:{clinicId:string;actorScope:string;memberId:string;fileId:string;name:string;locale:Locale;onClose:()=>void}){
 return <ClinicFileLinkedNotice locale={_props.locale}/>;
}
