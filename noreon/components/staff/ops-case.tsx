"use client";
import { RealStaffBooking } from "@/components/real-booking/staff";
import type { BookingFormState } from "@/lib/real-booking/schema";
import { getDemoStaffBookingRequests } from "@/lib/demo-booking/model";
import {BookingPreparation} from "@/components/service-workflow/booking-preparation";
import {bookingApplies,bookingHasReceipt,bookingResultsReceived,activeTestBookings} from "@/lib/service-workflow/reconciliation";
import { CaseTabs, CasePanel } from "./case-sections";

import { useState } from "react";
import {Dialog, DialogContent, DialogTitle, DialogDescription} from "@/components/ui/dialog";
import {demoPreparation} from "@/lib/service-workflow/model";
import Link from "next/link";
import type { ServiceWorkflow } from "@/lib/service-workflow/types";
import { CareSection } from "@/components/patient-care/common";
import { ActionError, buttonClass, quietClass, inputClass, useWorkflowCommand } from "@/components/service-workflow/shared";
import { useDemoReports } from "@/components/service-workflow/reports-provider";

function date(value: string) {
  return new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", hourCycle: "h23", timeZone: "Asia/Yerevan" }).format(new Date(value));
}

/** Backoffice controls for fictional case operations only. */
export function OpsCase({ workflow, memberName, questionnaireComplete, bookingAction }: { bookingAction?: (state: BookingFormState, form: FormData) => Promise<BookingFormState>; workflow: ServiceWorkflow; memberName: string; questionnaireComplete: boolean }) {
  const { run, pending, error } = useWorkflowCommand(workflow);
  const { reports, approvals, originalUrls, shared, persistenceError, loaded } = useDemoReports();
  const [confirmReset, setConfirmReset] = useState(false);
  const [editingBookingId, setEditingBookingId] = useState<string | null>(null);
  const editingBooking = workflow.bookings.find(booking => booking.id === editingBookingId);
  const missing = workflow.tests.filter((test) => !workflow.receivedTestIds.includes(test.id));
  const legacyBookings = workflow.bookings.filter(booking => !workflow.bookingRequests?.some(request => booking.id === request.bookingId || booking.id.startsWith(`demo-request-${request.id}-`)));
  const scheduled = workflow.bookings.filter((booking) => booking.status === "scheduled");

  return <div className="space-y-6">
    <Link className={quietClass} href="/staff/backoffice/cases">Back to cases</Link>
    <header><h1 className="text-h1">{memberName}’s case</h1><p className="mt-2 text-body2 text-muted-foreground">Coordinate bookings and receipt. The assigned GP reviews and publishes the plan.</p></header>
    <CaseTabs doctor={false}/><CasePanel name="overview">
    {!questionnaireComplete && <p role="status" className="rounded-md bg-muted p-4 text-body2">The member needs to finish their questionnaire before tests can be arranged. They can resume it from Today.</p>}
    <ActionError error={error} />
    {bookingAction && <RealStaffBooking requests={getDemoStaffBookingRequests(workflow)} action={bookingAction} demo />}
    <div className="grid gap-6 lg:grid-cols-2">
      <CareSection title="Case progress" detail="Current progress and next steps.">
        <dl className="space-y-3">
          <div className="flex justify-between gap-4 border-b pb-3 text-body2"><dt className="text-muted-foreground">Tests ordered</dt><dd className="font-medium">{workflow.tests.length}</dd></div>
          <div className="flex justify-between gap-4 border-b pb-3 text-body2"><dt className="text-muted-foreground">Active bookings</dt><dd className="font-medium">{activeTestBookings(workflow).length}</dd></div>
          <div className="flex justify-between gap-4 border-b pb-3 text-body2"><dt className="text-muted-foreground">Results outstanding</dt><dd className="font-medium">{missing.length}</dd></div>
          <div className="flex justify-between gap-4 border-b pb-3 text-body2"><dt className="text-muted-foreground">Review state</dt><dd className="font-medium">{!questionnaireComplete ? "Questionnaire in progress" : workflow.publication ? "Published" : workflow.allResultsAt || !workflow.tests.length ? "Ready for doctor" : "Waiting for results"}</dd></div>
        </dl>
      </CareSection>
      {(!bookingAction || legacyBookings.length > 0) && <CareSection title={bookingAction ? "Earlier demo bookings" : "Test bookings"} detail="Scheduled tests and receipt status.">
        {legacyBookings.length === 0 ? <p className="text-body2 text-muted-foreground">No test bookings yet.</p> : <div className="space-y-4">{legacyBookings.map((booking) => {
          const complete = bookingResultsReceived(workflow, booking);
          const hasReceipt = bookingHasReceipt(workflow, booking);
          const applies = bookingApplies(workflow, booking);
          const tasks = booking.testSnapshots ?? workflow.tests.filter(test => booking.testIds.includes(test.id));
          const homeLog = tasks.length > 0 && tasks.every(test => test.method === 'home-log');
          const canEdit = !workflow.bookingRequests?.some(request => request.id === booking.id) && shared && applies && !hasReceipt && !tasks.some(test => test.method === 'home-log');
          return <article key={booking.id} className="space-y-2 border-b pb-4 last:border-0">
            <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-body2 font-semibold">{date(booking.at)}</p><span className="rounded-md bg-muted px-2 py-1 text-caption">{booking.status === 'cancelled' ? 'Cancelled' : booking.review || workflow.recommendationsPending ? 'Review needed' : complete ? 'Results received' : hasReceipt ? 'Results arriving' : 'Requested'}</span></div>
            <p className="text-body2 break-words">{homeLog ? 'Home recording task' : booking.mode === 'office' ? `Office visit · ${booking.address || 'Address not confirmed'}` : booking.mode === 'home' ? `Home visit · ${booking.address || 'Address not confirmed'}` : 'Clinic · address not confirmed'}</p>
            <details><summary className="min-h-11 cursor-pointer text-body2 text-primary">Tests ({booking.testIds.length})</summary><ul className="space-y-1 pb-2 text-body2 text-muted-foreground">{booking.testIds.map(id => <li key={id}>{tasks.find(test => test.id === id)?.title ?? id}</li>)}</ul></details>
            {booking.status === 'scheduled' && <div className="space-y-1">
              <BookingPreparation workflow={workflow} booking={booking} pendingInstructionsAction={canEdit ? <button className={quietClass} type="button" disabled={pending} onClick={() => setEditingBookingId(booking.id)}>Add instructions</button> : undefined}/>
              {canEdit && booking.providerPreparation ? <button className={quietClass} type="button" disabled={pending} onClick={() => setEditingBookingId(booking.id)}>Edit instructions</button> : !canEdit && !complete && !homeLog ? <details><summary className="min-h-11 cursor-pointer text-caption text-muted-foreground">Recording availability</summary><p className="pb-2 text-caption text-muted-foreground">{!shared ? "Open the shared operations case to record provider instructions." : booking.review || workflow.recommendationsPending ? "Review the changed booking before recording provider instructions." : hasReceipt ? "This booking includes received results. Provider preparation can only be recorded before results are received." : "Home recording tasks do not have provider bookings."}</p></details> : null}
            </div>}
          </article>;
        })}</div>}
        <Dialog open={!!editingBooking} onOpenChange={open => {if (!open && !pending) setEditingBookingId(null);}}>
          <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
            <DialogTitle>{editingBooking?.providerPreparation ? 'Edit provider instructions' : 'Add provider instructions'}</DialogTitle>
            <DialogDescription>Record instructions received from the named provider for this booking. This demo does not contact the provider or message the member.</DialogDescription>
            {editingBooking && <form key={editingBooking.id} className="space-y-4" onSubmit={event => {
              event.preventDefault(); const values = new FormData(event.currentTarget);
              run({type:'record-provider-preparation',bookingId:editingBooking.id,provider:String(values.get('provider') ?? ''),instructions:String(values.get('instructions') ?? '')}, () => setEditingBookingId(null));
            }}>
              <p className="text-caption text-muted-foreground">{date(editingBooking.at)} · {editingBooking.mode !== 'clinic' ? editingBooking.address : 'Clinic · address not confirmed'}</p>
              {!editingBooking.providerPreparation && <p className="rounded-md bg-muted p-3 text-caption">{demoPreparation.en}</p>}
              <ActionError error={error}/>
              <fieldset className="space-y-4" disabled={pending}>
                <label className="block space-y-2 text-body2"><span>Provider name or contact</span><input name="provider" className={inputClass} required maxLength={120} defaultValue={editingBooking.providerPreparation?.provider}/></label>
                <label className="block space-y-2 text-body2"><span>Instructions received from the provider</span><textarea name="instructions" className={inputClass} rows={6} required maxLength={4000} defaultValue={editingBooking.providerPreparation?.instructions}/></label>
                <div className="flex flex-wrap gap-2"><button className={buttonClass}>{pending ? 'Saving…' : 'Save instructions'}</button><button className={quietClass} type="button" onClick={() => setEditingBookingId(null)}>Cancel</button></div>
              </fieldset>
            </form>}
          </DialogContent>
        </Dialog>
      </CareSection>}
      <CareSection title="Results receipt" detail="Record receipt of a scheduled test.">
        {missing.length === 0 ? <p className="text-body2 text-muted-foreground">{workflow.tests.length ? "All ordered results have been received." : questionnaireComplete ? "No tests are currently ordered." : "Tests will appear after the questionnaire is complete."}</p> : <div className="space-y-3">{missing.map((test) => {
          const ready = test.method === "home-log" || scheduled.some(booking => bookingApplies(workflow, booking, test.id));
          return <div key={test.id} className="flex flex-wrap items-center justify-between gap-3 border-b pb-3 last:border-0"><div><p className="text-body2">{test.title}</p>{!ready && <p className="mt-1 text-caption text-muted-foreground">The member needs to book this test before receipt can be recorded.</p>}</div><button className={quietClass} type="button" disabled={pending || !ready || !questionnaireComplete} onClick={() => run({ type: "receive", testIds: [test.id] })}>{test.method === "home-log" ? "Mark home records received" : "Mark result received"}</button></div>;
        })}</div>}
      </CareSection>
      <details className="lg:col-span-2"><summary className="min-h-11 cursor-pointer text-body2 text-muted-foreground">Demo controls</summary><CareSection title="Reset workflow" detail="Clear bookings, results, draft and publication for this case.">
        {confirmReset ? <div className="flex flex-wrap gap-3"><button className={buttonClass} type="button" disabled={pending} onClick={() => run({ type: "reset" }, () => setConfirmReset(false))}>Confirm reset</button><button className={quietClass} type="button" disabled={pending} onClick={() => setConfirmReset(false)}>Keep workflow</button></div> : <button className={quietClass} type="button" onClick={() => setConfirmReset(true)}>Reset workflow</button>}
      </CareSection></details>
    </div>
    </CasePanel><CasePanel name="results">
    <CareSection title="Shared reports" detail="Read-only report status and source documents. Clinical review belongs to the assigned doctor.">
      {persistenceError ? <p role="alert" className="text-body2 text-destructive">{persistenceError}</p> : !loaded ? <p role="status" className="text-body2 text-muted-foreground">Loading shared reports…</p> : reports.length === 0 ? <p className="text-body2 text-muted-foreground">No reports are available for this case.</p> : <ul className="divide-y">
        {reports.map((report) => {
          const approval = approvals[report.id];
          const approved = !!approval && approval.revision === report.revision;
          return <li key={report.id} className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
            <div className="min-w-0">
              <p className="break-words text-body2 font-medium">{report.file_name}</p>
              <p className="mt-1 text-caption text-muted-foreground">{report.state} · revision {report.revision} · {approved ? `Approved by ${approval.doctor}` : "Not approved at current revision"}</p>
            </div>
            {shared && originalUrls[report.id] && <a className="text-body2 font-medium text-primary underline underline-offset-4" href={originalUrls[report.id]} target="_blank" rel="noreferrer">Open original</a>}
          </li>;
        })}
      </ul>}
    </CareSection></CasePanel>
  </div>;
}
