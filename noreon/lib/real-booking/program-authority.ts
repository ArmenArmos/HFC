import 'server-only';
import {clinicalReviewEngine} from '@/lib/patient-care/clinical-review-engine';
import type {ClinicalSnapshot} from '@/lib/patient-care/clinical-case-repository';
import {bookingProgramSchema,type BookingProgram,type TrustedOffer} from './appointment-schema';

/** Only call with stored evidence read by an authenticated, scoped server path. */
export function deriveBookingProgram(snapshot:ClinicalSnapshot,requirementsToken:string):BookingProgram{
 const engine=clinicalReviewEngine(snapshot,'booking');
 return bookingProgramSchema.parse({memberId:snapshot.id,sourceToken:snapshot.evidenceToken,requirementsToken,engineVersion:engine.version,items:engine.tests});
}
export function checkOfferCoverage(program:BookingProgram,offer:TrustedOffer){
 const visitIds=new Set(program.items.filter(i=>i.method!=='home-log').map(i=>i.id));
 const assigned=[...offer.coveredTestIds,...offer.followUps.map(f=>f.testId)];
 if(!offer.coveredTestIds.length||assigned.length!==visitIds.size||new Set(assigned).size!==assigned.length||assigned.some(id=>!visitIds.has(id)))throw Error('Offer coverage requires the complete assigned program and explicit follow-up');
 return {completeProgram:program,coveredTestIds:offer.coveredTestIds,followUps:offer.followUps,homeTasks:program.items.filter(i=>i.method==='home-log')};
}
