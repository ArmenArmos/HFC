"use client";
import {useActionState, useState} from "react";
import {Badge} from "@/components/ui/badge";
import {Button} from "@/components/ui/button";
import {Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle} from "@/components/ui/dialog";
import {Textarea} from "@/components/ui/textarea";
import type {TestAccountActionState} from "@/lib/staff/test-account-actions";

type Action = (previous: TestAccountActionState, form: FormData) => Promise<TestAccountActionState>;

/** Marks a test account in staff and admin views. */
export function TestAccountBadge() {
  return <Badge variant="warning" aria-label="Test account">TEST</Badge>;
}

function Result({state}: {state: TestAccountActionState}) {
  if (!state) return null;
  return <p role={state.ok ? "status" : "alert"} className="text-body2">{state.message}</p>;
}

/** Reset with a confirmation dialog. One request key per open dialog, so a double click or a
 * retry of the same dialog finishes one reset instead of starting another. */
export function TestAccountResetButton({memberId, name, action}: {memberId: string; name: string | null; action: Action}) {
  const [open, setOpen] = useState(false);
  const [requestKey, setRequestKey] = useState(() => crypto.randomUUID());
  const [state, formAction, pending] = useActionState(action, null);
  return <div className="space-y-2">
    <Button type="button" variant="outline" onClick={() => { setRequestKey(crypto.randomUUID()); setOpen(true); }}>Reset test account</Button>
    <Result state={state}/>
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-h3">Reset {name || "this test account"}?</DialogTitle>
          <DialogDescription>
            Telegram is unlinked, every session ends and the sign-in phone moves to a +999 placeholder, so the tester can sign up again with the same phone and Telegram. Nothing is deleted: this account and its history stay as they are.
          </DialogDescription>
        </DialogHeader>
        <form action={formAction} onSubmit={() => setOpen(false)}>
          <input type="hidden" name="memberId" value={memberId}/>
          <input type="hidden" name="requestKey" value={requestKey}/>
          <input type="hidden" name="confirm" value="reset"/>
          <DialogFooter>
            <DialogClose render={<Button type="button" variant="outline"/>}>Cancel</DialogClose>
            <Button type="submit" variant="destructive" disabled={pending}>{pending ? "Resetting" : "Reset account"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  </div>;
}

/** Admin only: mark or unmark a member account as a test account, with a reason. */
export function TestAccountFlagForm({memberId, isTest, action}: {memberId: string; isTest: boolean; action: Action}) {
  const [state, formAction, pending] = useActionState(action, null);
  return <form action={formAction} className="space-y-2">
    <input type="hidden" name="memberId" value={memberId}/>
    <input type="hidden" name="test" value={isTest ? "false" : "true"}/>
    <label className="block space-y-1">
      <span className="text-body2 font-semibold">{isTest ? "Reason for removing the test mark" : "Reason for marking as a test account"}</span>
      <Textarea name="reason" required minLength={3} maxLength={300} rows={2}/>
    </label>
    <Button type="submit" variant="outline" disabled={pending}>{isTest ? "Remove test mark" : "Mark as test account"}</Button>
    <Result state={state}/>
  </form>;
}
