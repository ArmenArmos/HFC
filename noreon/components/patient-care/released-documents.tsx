import { FILE_LINK } from "@/lib/patient/file-link";
import {FileText} from 'lucide-react';
import {CareSection,copy,stamp} from './common';
import type {PatientLocale} from '@/lib/patient/copy';
import type {MemberDocument} from '@/lib/doctor-completion/document-schema';

/** Clinic lab PDFs your doctor has released to you. Labelled by clinic and date,
 * never by the clinic's own file name. Null means the list could not be read. */
export function ReleasedDocuments({documents,locale:l}:{documents:MemberDocument[]|null;locale:PatientLocale}){
 if(documents&&!documents.length)return null;
 return <CareSection title={copy(l,'Lab documents from your doctor','Լաբորատոր փաստաթղթեր ձեր բժշկից', 'Лабораторные документы от вашего врача')}>
  {documents?<ul className="divide-y">{documents.map(doc=><li key={doc.fileId} className="py-2"><a className="inline-flex min-h-11 items-center gap-2 text-body2 underline" href={`/patient/documents/${doc.fileId}`} {...FILE_LINK}><FileText aria-hidden className="size-4 shrink-0"/>{copy(l,`Lab results from ${doc.clinic}, ${stamp(doc.uploadedAt,l,false)}`,`Լաբորատոր արդյունքներ՝ ${doc.clinic}, ${stamp(doc.uploadedAt,l,false)}`, `Результаты анализов из ${doc.clinic}, ${stamp(doc.uploadedAt,l,false)}`)}</a></li>)}</ul>
   :<p role="status" className="text-body2">{copy(l,'Your lab documents are unavailable right now. Try again later.','Ձեր լաբորատոր փաստաթղթերն այս պահին անհասանելի են։ Փորձեք ավելի ուշ։', 'Ваши лабораторные документы сейчас недоступны. Попробуйте позже.')}</p>}
 </CareSection>;
}
