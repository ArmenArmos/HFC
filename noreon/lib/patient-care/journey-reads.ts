import "server-only";
import { createClient } from "@/lib/supabase/server";
import { doctorCompletionEnabled } from "@/lib/doctor-completion/config";
import { readMemberDocuments, type DocumentRpc } from "@/lib/doctor-completion/document-runtime";
import { readMemberNurseVisit, type NurseVisitRpc } from "@/lib/nurse-visit/runtime";

/** The two journey reads Home already makes (nurse visit, released clinic results), for the pages
 * that show the same stage (QA 177). Both readers return undefined or null on failure, which never
 * moves a member forward. */
export async function readJourneyExtras(): Promise<{ nurseVisit: Awaited<ReturnType<typeof readMemberNurseVisit>>; released: Awaited<ReturnType<typeof readMemberDocuments>> }> {
  const client = await createClient().catch(() => null);
  if (!client) return { nurseVisit: undefined, released: null };
  const [nurseVisit, released] = await Promise.all([
    readMemberNurseVisit(client as unknown as NurseVisitRpc),
    doctorCompletionEnabled() ? readMemberDocuments(client as unknown as DocumentRpc) : Promise.resolve(null),
  ]);
  return { nurseVisit, released };
}
