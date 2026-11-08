/** QA 177: Home's strip, the programme step card ("Step n of 4") and Progress's "My journey" read one
 * stage from one input, so after the visit or with results at the doctor they all say Results. */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {journeyStripIndex,journeyStripInput,JOURNEY_STAGES,type JourneyFacts} from '@/lib/patient-care/journey-strip';
import {journeyStages,currentStage} from '@/lib/programme/stages';
import {memberTimelineSchema} from '@/lib/programme/schema';
import {reviewedResultCount} from '@/lib/patient-care/reviewed-results';

const programme=memberTimelineSchema.parse({version:'programme-v1',enabled:true,today:'2026-10-29',schedulePending:true,opensDaysBefore:3,startedAt:null,checkpoints:[]});
assert.equal(programme.enabled,true);
const base:JourneyFacts={questionnaireComplete:true,lab:null,planPublished:false};
/** The stage each view shows for the same facts. */
function views(facts:JourneyFacts){
 const strip=journeyStripInput(facts);
 const stages=journeyStages({questionnaireComplete:facts.questionnaireComplete,lab:strip.lab,nurseSamplesTaken:strip.nurseSamplesTaken,visitDone:strip.visitDone,testsArranged:true,planPublishedAt:facts.planPublished?'2026-10-28T10:00:00Z':null,programme:programme as never});
 const now=currentStage(stages);
 return {strip:JOURNEY_STAGES[journeyStripIndex(strip)]??'done',programme:now?.id??'done',step:stages.filter(s=>s.state==='done').length+1,meaning:now?.meaning.en??''};
}
const agree=(facts:JourneyFacts,stage:string,why:string)=>{const v=views(facts);assert.equal(v.strip,stage,`strip: ${why}`);assert.equal(v.programme,stage,`programme: ${why}`);return v;};

agree(base,'tests','Arranged tests, no visit yet');
// The QA 177 member: home visit completed by the nurse with samples, clinic results released by the doctor, no plan.
const qa:JourneyFacts={...base,nurseVisit:{steps:[{step:'confirmed'},{step:'samples-collected'},{step:'completed'}]},requests:[{status:'completed'}],released:[{fileId:'f'}]};
const v=agree(qa,'results','Visit done and results with the doctor');
assert.equal(v.step,3,'Step 3 of 4');
assert.doesNotMatch(v.meaning,/takes your samples|samples are taken/i,'No copy saying samples are still to be taken');
// Each fact alone also moves to Results (none of them can be missed by one view and seen by another).
agree({...base,requests:[{status:'completed'}]},'results','A completed home-visit request');
agree({...base,nurseVisit:{steps:[{step:'samples-at-lab'}]}},'results','Nurse sent samples to the lab');
agree({...base,released:[{}]},'results','Released clinic results');
agree({...base,appointments:[{status:'confirmed',portal:{checkin:{outcome:'completed'}}}]},'results','Clinic recorded the visit as complete');
agree({...base,appointments:[{status:'confirmed',portal:{checkin:{outcome:'no-show'}}}]},'tests','A no-show is not a visit');
agree({...base,appointments:[{status:'cancelled',portal:{checkin:{outcome:'completed'}}}]},'tests','A cancelled visit covers nothing');
agree({...base,appointments:[{status:'confirmed',portal:{checkin:{outcome:'completed'}},programme:{currentProgramme:false,open:false}}]},'tests','An earlier programme visit is history');
agree({...base,requests:[{status:'requested'}],nurseVisit:{steps:[{step:'confirmed'}]}},'tests','Requested and confirmed only');
agree({...base,requests:[{status:'completed',contextStale:true}]},'tests','An earlier programme’s completed visit does not move this programme (Astra #404 F1)');
// Failed reads never move a member forward.
agree({...base,nurseVisit:undefined,requests:null,appointments:null,released:null},'tests','Unreadable facts stay at Tests');
agree({...base,lab:'results-received'},'plan','Recorded lab results leave the plan current, as before');
agree({...qa,planPublished:true},'done','A published plan finishes the four steps');

// Every page builds its stage from journeyStripInput.
for(const file of ['components/patient/member-home-content.tsx','components/patient-care/member-progress-content.tsx','app/patient/service/page.tsx'])
 assert.match(readFileSync(file,'utf8'),/journeyStripInput\(/,`${file} uses the shared stage input`);
assert.doesNotMatch(readFileSync('components/patient/member-home-content.tsx','utf8'),/journeyStripIndex\(\{/,'Home no longer builds its own strip input');

// "Reviewed results": published reviewed results, released clinic reports and doctor-approved upload values.
// Astra #404 F3: publication time decides whether a released report is already among the results.
const rel=(at:string)=>({releasedAt:at});
assert.equal(reviewedResultCount({results:[],released:[rel('2026-10-30T08:00:00Z'),rel('2026-10-30T09:00:00Z')],doctorApprovedValues:0,planPublishedAt:null}),2,'Released reports count before publication (QA 177: not 0)');
assert.equal(reviewedResultCount({results:[],released:[rel('2026-10-30T08:00:00Z'),rel('2026-10-30T09:00:00Z')],doctorApprovedValues:1,planPublishedAt:null}),3,'An unrelated approved upload adds to released reports, never replaces them');
assert.equal(reviewedResultCount({results:[{reviewedAt:'2026-10-30T10:00:00Z'},{reviewedAt:'2026-10-30T10:00:00Z'}],released:[rel('2026-10-30T08:00:00Z')],doctorApprovedValues:0,planPublishedAt:'2026-10-30T10:00:00Z'}),2,'After publication the report is not counted twice');
assert.equal(reviewedResultCount({results:[{reviewedAt:'2026-10-30T10:00:00Z'}],released:[rel('2026-10-30T08:00:00Z'),rel('2026-11-02T08:00:00Z')],doctorApprovedValues:0,planPublishedAt:'2026-10-30T10:00:00Z'}),2,'A report released after the plan still counts');
assert.equal(reviewedResultCount({results:[{reviewedAt:'2026-10-20'}],released:null,doctorApprovedValues:null}),1,'A failed read adds nothing');
assert.match(readFileSync('components/patient/member-home-content.tsx','utf8'),/reviewedResults=\{reviewedResultCount\(\{ results: care\.results, released, doctorApprovedValues, planPublishedAt: care\.plan\?\.publishedAt \?\? null \}\)/);
console.log('Journey stage agreement: Home strip, step card and Progress share one stage; QA 177 member is at Results, step 3 of 4.');
