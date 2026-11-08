import 'server-only';
import {requireRegistered} from '@/lib/patient/repository';
import {readMemberBpWeekOrThrow} from '@/lib/bp-week/server';
import {bpDevicesEnabled} from '@/lib/bp-device/config';
import {readOwnHistory} from '@/lib/member-history/server';
import {readOwnUploadReadings} from '@/lib/member-history/ai-server';
import {getCareData} from '@/lib/patient-care/repository';
import {readMemberPlanHistory} from '@/lib/patient-care/member-plan-history';
import {visibleLessons, lessonsShowDrafts} from '@/lib/lessons/catalogue';
import {readLessonProgress} from '@/lib/lessons/server';
import {readMemberSafety} from '@/lib/member-safety/member';
import {exerciseGuidance} from '@/lib/member-safety/contract';
import {memberContact} from '@/lib/patient-care/member-contact';
import {realReviewEnabled} from '@/lib/patient-care/real-review-config';
import {bookingToken} from './booking';
import type {EverydayView} from './everyday-contract';

async function content(view:EverydayView) {
  const {assessment}=await requireRegistered();
  switch(view) {
    case 'bp_week': return {view,read:await readMemberBpWeekOrThrow(),showDevice:bpDevicesEnabled()};
    case 'earlier': {
      const [history,readings]=await Promise.all([readOwnHistory(),readOwnUploadReadings()]);
      return {view,history,reading:readings?.enabled===true};
    }
    case 'result_history': {
      const [care,history]=await Promise.all([getCareData(),readOwnHistory()]);
      return {view,results:care.results,tests:care.tests.filter(t=>t.status==='collected'||t.status==='cancelled'),reportedValues:history?.values??null};
    }
    case 'previous_plans': return {view,...await readMemberPlanHistory()};
    case 'lessons': return {view,lessons:visibleLessons(lessonsShowDrafts()),progress:await readLessonProgress()};
    case 'answers': return {view,assessment,exercise:exerciseGuidance(await readMemberSafety())};
    case 'team': {
      const [care,contact]=await Promise.all([getCareData(),memberContact()]);
      return {view,clinician:care.plan?.clinician??null,contact,reviewEnabled:realReviewEnabled(process.env)};
    }
    case 'help': return {view,contact:await memberContact()};
  }
}
/** The page repositories own all clinical filtering and release holds. Incidental read time is not a revision. */
export async function readEveryday(view:EverydayView) {
  const data=await content(view);
  const revision=data.view==='lessons'?{...data,progress:data.progress&&{done:data.progress.done}}:data;
  return {...data,token:bookingToken(revision)};
}
export type EverydayRead=Awaited<ReturnType<typeof readEveryday>>;
