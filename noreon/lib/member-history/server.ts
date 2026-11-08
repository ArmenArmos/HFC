import "server-only";
import { rateLimit } from "@/lib/security/rate-limit";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { clinicalWriteClient } from "@/lib/patient-care/clinical-publication-server";
import { patientIdentity } from "@/lib/patient/auth";
import { readAllPages } from "@/lib/patient-care/pagination";
import { cleanFileName, measureIds, MEMBER_UPLOAD_MAX_BYTES, sniffMime, valueInputSchema, yerevanToday, type ClinicMeasurements, type ReportedDocument, type ReportedValue } from "./measures";

const BUCKET = "member-history";
type Client = Awaited<ReturnType<typeof createClient>>;

async function member() {
  const identity = await patientIdentity();
  return identity ? { userId: identity.userId, client: await createClient() } : null;
}

const documentRow = z.object({ id: z.uuid(), file_name: z.string(), mime: z.string(), size_bytes: z.number(), result_date: z.string().nullable(), created_at: z.string() });
const valueRow = z.object({ id: z.uuid(), source: z.enum(["member-reported", "ai_confirmed", "ai_read", "member_corrected", "doctor_approved"]).default("member-reported"), measure: z.enum(measureIds), value: z.coerce.number(), value2: z.coerce.number().nullable(), unit: z.string(), measured_on: z.string() });
const clinicSchema = z.object({
  bp: z.array(z.object({ id: z.uuid(), systolic: z.number(), diastolic: z.number(), at: z.string() })),
  observations: z.array(z.object({ field: z.enum(["weight", "waist"]), value: z.number(), unit: z.string(), at: z.string() })),
});
const toDocument = (r: z.infer<typeof documentRow>): ReportedDocument => ({ id: r.id, fileName: r.file_name, mime: r.mime, sizeBytes: r.size_bytes, resultDate: r.result_date, createdAt: r.created_at });
const toValue = (r: z.infer<typeof valueRow>): ReportedValue => ({ id: r.id, source: r.source, measure: r.measure, value: r.value, value2: r.value2, unit: r.unit, measuredOn: r.measured_on });

/** RLS is the filter: a member reads only their own rows. Staff read through staff_member_history. */
async function readRows(client: Client, memberId: string) {
  const [documents, values] = await Promise.all([
    client.from("member_reported_documents").select("id,file_name,mime,size_bytes,result_date,created_at").eq("user_id", memberId).order("created_at", { ascending: false }).limit(50),
    readAllPages((from, to) => client.from("member_reported_values").select("id,source,measure,value,value2,unit,measured_on").eq("user_id", memberId).order("measured_on", { ascending: false }).order("created_at", { ascending: false }).range(from, to)),
  ]);
  if (documents.error) throw Error("Member history is unavailable.");
  return { documents: z.array(documentRow).parse(documents.data).map(toDocument), values: z.array(valueRow).parse(values).map(toValue) };
}

/** The signed-in member's history. Null means unreadable, never "nothing recorded". */
export async function readOwnHistory() {
  const m = await member().catch(() => null);
  if (!m) return null;
  try {
    const [rows, clinic] = await Promise.all([readRows(m.client, m.userId), m.client.rpc("member_clinic_measurements")]);
    if (clinic.error) return null;
    return { ...rows, clinic: clinicSchema.parse(clinic.data) as ClinicMeasurements };
  } catch {
    return null;
  }
}

/** How many of the member's own uploaded values their doctor approved (Home's "Reviewed results").
 * RLS is the filter. Null means unreadable. */
export async function countOwnDoctorApprovedValues(): Promise<number | null> {
  try {
    const client = await createClient();
    const r = await client.from("member_reported_values").select("id", { count: "exact", head: true }).eq("source", "doctor_approved");
    return r.error ? null : (r.count ?? 0);
  } catch {
    return null;
  }
}

const staffHistory = z.object({ documents: z.array(documentRow), values: z.array(valueRow) });
/** Staff read (assigned active doctor or active admin, admitted session). The RPC records the access in the same transaction, so nothing is shown unrecorded. */
export async function readMemberHistoryForStaff(client: unknown, memberId: string) {
  if (!z.uuid().safeParse(memberId).success) return null;
  try {
    const r = await (client as Client).rpc("staff_member_history", { p_member: memberId });
    if (r.error) return null;
    const rows = staffHistory.parse(r.data);
    return { documents: rows.documents.map(toDocument), values: rows.values.map(toValue) };
  } catch {
    return null;
  }
}

export type AddValueResult = { status: "saved" } | { status: "invalid"; fields: string[] } | { status: "access" | "unavailable" };
export async function addOwnValue(input: unknown): Promise<AddValueResult> {
  const parsed = valueInputSchema.safeParse(input);
  if (!parsed.success) return { status: "invalid", fields: [...new Set(parsed.error.issues.map((i) => String(i.path[0] ?? "")))] };
  let m;
  try { m = await member(); } catch { return { status: "unavailable" }; }
  if (!m) return { status: "access" };
  const v = parsed.data;
  const r = await m.client.rpc("member_reported_value_add", { p_measure: v.measure, p_value: v.value, p_value2: v.value2 as number, p_unit: v.unit, p_measured_on: v.measuredOn });
  if (r.error) return r.error.code === "23514" ? { status: "invalid", fields: [] } : { status: "unavailable" };
  return { status: "saved" };
}
export async function deleteOwnValue(id: string) {
  const m = await member().catch(() => null);
  if (!m || !z.uuid().safeParse(id).success) return false;
  const r = await m.client.rpc("member_reported_value_remove", { p_id: id });
  return !r.error && r.data === true;
}

export type UploadResult = { status: "stored"; id: string } | { status: "duplicate"; id?: string } | { status: "invalid" | "too-large" | "limit" | "rate-limited" | "access" | "unavailable" };
/** Stores a member's earlier result. Bytes are checked by content, kept privately, and never read for values. */
export async function storeOwnDocument(input: { bytes: Buffer; fileName: string; resultDate: string | null; savedNotRead?: boolean }): Promise<UploadResult> {
  let m;
  try { m = await member(); } catch { return { status: "unavailable" }; }
  if (!m) return { status: "access" };
  try {
    if (!(await rateLimit("member_upload", [{ kind: "source" }, { kind: "user", value: m.userId }])).ok) return { status: "rate-limited" };
  } catch { return { status: "unavailable" }; }
  if (!input.bytes.length) return { status: "invalid" };
  if (input.bytes.length > MEMBER_UPLOAD_MAX_BYTES) return { status: "too-large" };
  const mime = sniffMime(input.bytes);
  if (!mime) return { status: "invalid" };
  if (input.resultDate !== null && !(/^\d{4}-\d{2}-\d{2}$/.test(input.resultDate) && input.resultDate >= "1950-01-01" && input.resultDate <= yerevanToday())) return { status: "invalid" };
  const sha256 = createHash("sha256").update(input.bytes).digest("hex");
  const admin = clinicalWriteClient();
  const id = randomUUID();
  const path = `${m.userId}/${id}${mime === "application/pdf" ? ".pdf" : mime === "image/png" ? ".png" : ".jpg"}`;
  const existing = await m.client.from("member_reported_documents").select("id").eq("user_id", m.userId).eq("sha256", sha256).maybeSingle();
  if (existing.error) return { status: "unavailable" };
  if (existing.data) return input.savedNotRead ? { status: "duplicate", id: existing.data.id } : { status: "duplicate" };
  const uploaded = await admin.storage.from(BUCKET).upload(path, input.bytes, { contentType: mime, upsert: false });
  if (uploaded.error) return { status: "unavailable" };
  const row = await admin.from("member_reported_documents").insert({ id, user_id: m.userId, object_path: path, file_name: cleanFileName(input.fileName, mime), mime, size_bytes: input.bytes.length, sha256, result_date: input.resultDate,
    ...(input.savedNotRead ? { auto_read_allowed: false, uploader_role: "member" } : {}) });
  if (row.error) {
    await admin.storage.from(BUCKET).remove([path]);
    if (row.error.code === "23505" && input.savedNotRead) {
      const duplicate = await m.client.from("member_reported_documents").select("id").eq("sha256", sha256).maybeSingle();
      if (duplicate.data) return { status: "duplicate", id: duplicate.data.id };
    }
    return row.error.code === "23505" ? { status: "duplicate" } : row.error.code === "23514" ? { status: "limit" } : { status: "unavailable" };
  }
  return { status: "stored", id };
}
export async function removeOwnDocument(id: string) {
  const m = await member().catch(() => null);
  if (!m || !z.uuid().safeParse(id).success) return false;
  const r = await m.client.rpc("member_reported_document_remove", { p_id: id });
  if (r.error) return false;
  if (typeof r.data === "string") {
    // The row is already hidden. If Storage fails, the cleanup worker retries until storage_purged_at is set.
    const admin = clinicalWriteClient();
    const removed = await admin.storage.from(BUCKET).remove([r.data]);
    if (!removed.error) await admin.from("member_reported_documents").update({ storage_purged_at: new Date().toISOString() }).eq("id", id);
  }
  return true;
}

/**
 * Serves a document after the caller's RLS read of its row, never a signed link. The stored hash and size are checked.
 * record: 'staff' records the open (staff_member_history_document) and serves nothing if that fails; 'member' is the
 * member reading their own upload, which that RPC refuses ("Active staff required"), so it is not called (#240 regression).
 */
const storedDocument = z.object({ object_path: z.string(), mime: z.string(), size_bytes: z.number(), sha256: z.string(), file_name: z.string() });
export async function documentBytesResponse(client: unknown, memberId: string, documentId: string, record: "staff" | "member") {
  if (!z.uuid().safeParse(memberId).success || !z.uuid().safeParse(documentId).success) return new Response(null, { status: 404 });
  // Staff: staff_member_history_document checks access and records the open before the bytes are
  // fetched; nothing is served if it cannot be recorded. Members read their own row through RLS.
  const row = record === "staff"
    ? await (client as Client).rpc("staff_member_history_document", { p_member: memberId, p_document: documentId }).then((r) => (r.error ? { error: r.error, data: null } : { error: null, data: r.data === null ? null : storedDocument.parse(r.data) }))
    : await (client as Client).from("member_reported_documents").select("object_path,mime,size_bytes,sha256,file_name").eq("id", documentId).eq("user_id", memberId).maybeSingle();
  // The database refusing an unassigned doctor is the same "no such file" everyone else who may not open it gets.
  if (row.error) return record === "staff" && row.error.code !== "42501" ? new Response("The document is unavailable.", { status: 503 }) : new Response(null, { status: 404 });
  if (!row.data) return new Response(null, { status: 404 });
  const download = await clinicalWriteClient().storage.from(BUCKET).download(row.data.object_path);
  if (download.error || !download.data) return new Response("The document is unavailable.", { status: 503 });
  const bytes = Buffer.from(await download.data.arrayBuffer());
  if (bytes.length !== row.data.size_bytes || createHash("sha256").update(bytes).digest("hex") !== row.data.sha256 || sniffMime(bytes) !== row.data.mime) return new Response("The document is unavailable.", { status: 503 });
  const ascii = row.data.file_name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return new Response(bytes, {
    headers: {
      "Content-Type": row.data.mime,
      "Content-Disposition": `inline; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(row.data.file_name)}`,
      "Cache-Control": "private, no-store",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
export async function ownDocumentResponse(documentId: string) {
  let m;
  try { m = await member(); } catch { return new Response("The document is unavailable.", { status: 503 }); }
  if (!m) return new Response(null, { status: 404 });
  return documentBytesResponse(m.client, m.userId, documentId, "member");
}
