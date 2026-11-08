import type {ClinicalSnapshot} from '@/lib/patient-care/clinical-case-repository';
import {extractionSchema} from '@/lib/reports/schema';
import {isClinicLabReceipt} from '@/lib/patient-care/clinical-review-schema';
import type {ClinicLabSource} from '@/lib/patient-care/clinic-lab-sources';
import {coversRequiredLabTest,requiredLabValues,labDateEligible} from '@/lib/patient-care/required-lab-match';

type SourceReport = ClinicalSnapshot['evidence']['reports'][number];
export function matchingReportRows(snapshot:ClinicalSnapshot,testId:string,report:SourceReport){
  const parsed=extractionSchema.safeParse(report.reviewed);
  if(!parsed.success||!parsed.data.reportDate||!labDateEligible(parsed.data.reportDate,snapshot.evidence.assessment?.completed_at))return [];
  return requiredLabValues(testId,parsed.data.rows.map((row,index)=>({...row,index})));
}
/** Presentation only. Assignment and write authority remain enforced by the route and RPCs. */
export function hasCurrentReportApproval(snapshot: ClinicalSnapshot, report: SourceReport) {
  const review = snapshot.review;
  const approval = review?.approvals[report.id];
  return !!review && review.evidenceToken === snapshot.evidenceToken &&
    report.state === 'confirmed' && !!report.confirmedAt &&
    extractionSchema.safeParse(report.reviewed).success &&
    approval?.revision === report.revision && approval.actorId === review.doctorId;
}

/** A clinic lab receipt is current while the review is and its values are exactly the doctor's current
 * confirmed values (publication rechecks the same in the database). */
export function hasCurrentClinicLabReceipt(snapshot: ClinicalSnapshot, testId: string, sources: ClinicLabSource[]) {
  const review = snapshot.review;
  const receipt = review?.receipts[testId];
  if (!review || !receipt || !isClinicLabReceipt(receipt) || review.evidenceToken !== snapshot.evidenceToken || receipt.actorId !== review.doctorId ||
    !review.engine.tests.some(test => test.id === testId)) return false;
  const current = sources.find(source => source.attachmentId === receipt.attachmentId)?.values ?? [];
  if (!coversRequiredLabTest(testId,receipt.values) || !receipt.values.every(value=>labDateEligible(value.collectedOn,snapshot.evidence.assessment?.completed_at))) return false;
  return receipt.values.every(value => {
    const now = current.find(candidate => candidate.id === value.id);
    return !!now && now.reviewedAt === value.reviewedAt && now.name===value.name && now.collectedOn===value.collectedOn && now.valueText === value.valueText && now.value === value.value && now.unit === value.unit;
  });
}

export function hasCurrentResultReceipt(snapshot: ClinicalSnapshot, testId: string, sources: ClinicLabSource[] = []) {
  const review = snapshot.review;
  const receipt = review?.receipts[testId];
  if (receipt && isClinicLabReceipt(receipt)) return hasCurrentClinicLabReceipt(snapshot, testId, sources);
  const report = snapshot.evidence.reports.find(report => report.id === receipt?.reportId);
  if(!receipt||!report)return false;
  const parsed=extractionSchema.safeParse(report.reviewed);
  if(!parsed.success||!parsed.data.reportDate||!labDateEligible(parsed.data.reportDate,snapshot.evidence.assessment?.completed_at))return false;
  // Stored receipts can include other source rows. Validate the indices, then the
  // selected set's coverage, just as the server does. UI options remain filtered.
  if(!receipt.rows.every(index=>Number.isInteger(index)&&index>=0&&index<parsed.data.rows.length))return false;
  const selected=receipt.rows.map(index=>parsed.data.rows[index]);
  if(!coversRequiredLabTest(testId,selected))return false;
  return !!receipt && !!report && hasCurrentReportApproval(snapshot, report) &&
    receipt.reportRevision === report.revision && receipt.actorId === review?.doctorId &&
    !!review?.engine.tests.some(test => test.id === testId);
}

export function ReportProvenance({snapshot, report}: {snapshot: ClinicalSnapshot; report: SourceReport}) {
  const review = snapshot.review;
  const approval = review?.approvals[report.id];
  const current = hasCurrentReportApproval(snapshot, report);
  const receipts = Object.entries(review?.receipts ?? {}).flatMap(([testId, receipt]) => !isClinicLabReceipt(receipt) && receipt.reportId === report.id ? [[testId, receipt] as const] : []);
  return <div className="space-y-3 text-body2">
    <dl className="grid gap-3 sm:grid-cols-2">
      <div><dt className="text-caption text-muted-foreground">Source state</dt><dd className="break-words">{report.state}</dd></div>
      <div><dt className="text-caption text-muted-foreground">Member confirmed</dt><dd>{report.confirmedAt ? <time dateTime={report.confirmedAt}>{report.confirmedAt}</time> : 'Not recorded'}</dd></div>
    </dl>
    {approval ? <div className="space-y-1 rounded-md border p-3">
      <p className="font-medium">{current ? 'Current approval' : 'Historical approval. Current evidence is not approved by this record.'}</p>
      <p>Approved report revision: {approval.revision}</p>
      <p className="break-all">Approving clinician reference: {approval.actorId}</p>
      <p>Approved at: <time dateTime={approval.at}>{approval.at}</time></p>
    </div> : <p>No approval recorded.</p>}
    {receipts.length > 0 && <div className="space-y-2"><h4 className="font-medium">Linked required-test receipts</h4><ul className="space-y-3">{receipts.map(([testId, receipt]) => {
      const receiptCurrent = hasCurrentResultReceipt(snapshot, testId);
      const test = review?.engine.tests.find(test => test.id === testId);
      return <li key={testId} className="space-y-1 rounded-md border p-3">
        <p className="font-medium">{receiptCurrent ? 'Current receipt' : 'Historical receipt. Does not establish a current result.'}</p>
        <p className="break-words">{test?.title ?? testId}</p>
        <p className="break-all">Required test reference: {testId}</p>
        <p>Source report revision: {receipt.reportRevision}</p>
        <p>Source rows: {receipt.rows.map(row => row + 1).join(', ')}</p>
        <p className="break-all">Recording clinician reference: {receipt.actorId}</p>
        <p>Recorded at: <time dateTime={receipt.at}>{receipt.at}</time></p>
        <p className="whitespace-pre-wrap break-words">{receipt.note}</p>
      </li>;
    })}</ul></div>}
  </div>;
}
