import type {ClinicalSnapshot} from '@/lib/patient-care/clinical-case-repository';
import type {DoctorPlanRead} from './contracts';

/** The snapshot omits draft_lab_token. Until it exposes that binding, require a
 * save after the latest current generation. A replacement saved after publication
 * is manual: generation is unavailable for published plans and manual saves clear
 * the binding. The publication trigger remains the authoritative lab-token check. */
export function currentAiDraft(snapshot:ClinicalSnapshot,plan:Extract<DoctorPlanRead,{enabled:true}>):boolean{
 if(snapshot.draftStale||!snapshot.draft)return false;
 const generation=plan.latest;
 if(!generation)return true;
 const saved=Date.parse(snapshot.draftSavedAt??''),published=Date.parse(snapshot.publications?.[0]?.publishedAt??'');
 if(plan.published&&saved>published)return true;
 return generation.labToken===plan.labToken&&generation.evidenceToken===snapshot.evidenceToken&&generation.caseRevision<=snapshot.revision&&saved>=Date.parse(generation.createdAt);
}
