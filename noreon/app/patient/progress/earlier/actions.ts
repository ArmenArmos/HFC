"use server";
import {loggedAction} from '@/lib/observability/with-logging';
import { revalidatePath } from "next/cache";
import { addOwnValue, deleteOwnValue, removeOwnDocument, type AddValueResult } from "@/lib/member-history/server";
import { answerOwnUploadIdentity, editOwnUploadReading } from "@/lib/member-history/ai-server";
import type { MemberCommandResult } from "@/lib/member-history/ai-reading";
export const addEarlierValue=loggedAction("addEarlierValue",async function addEarlierValue(input: unknown): Promise<AddValueResult> {
  const result = await addOwnValue(input);
  if (result.status === "saved") { revalidatePath("/patient/progress"); revalidatePath("/patient/progress/earlier"); }
  return result;
});
export const deleteEarlierValue=loggedAction("deleteEarlierValue",async function deleteEarlierValue(id: string) {
  const ok = await deleteOwnValue(id);
  revalidatePath("/patient/progress/earlier");
  return ok;
});
export const removeEarlierDocument=loggedAction("removeEarlierDocument",async function removeEarlierDocument(id: string) {
  const ok = await removeOwnDocument(id);
  revalidatePath("/patient/progress/earlier");
  return ok;
});
const refreshed = (result: MemberCommandResult) => {
  if (result.status === "saved") { revalidatePath("/patient/progress"); revalidatePath("/patient/progress/earlier"); }
  return result;
};
export const answerEarlierIdentity=loggedAction("answerEarlierIdentity",async function answerEarlierIdentity(input: unknown): Promise<MemberCommandResult> {
  return refreshed(await answerOwnUploadIdentity(input));
});
export const editEarlierReading=loggedAction("editEarlierReading",async function editEarlierReading(input: unknown): Promise<MemberCommandResult> {
  return refreshed(await editOwnUploadReading(input));
});
