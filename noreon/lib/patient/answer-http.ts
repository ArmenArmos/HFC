import { z } from "zod";
import { createPatientService } from "@/lib/patient/service";
const MAX_BODY_BYTES = 16000;
const inputSchema = z.object({
  expectedAssessmentId: z.string().min(1).max(128),
  expectedRevision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  entries: z.array(z.object({
    fieldId: z.string().min(1).max(128),
    value: z.union([z.number(), z.string().max(128), z.array(z.string().max(128)).max(64), z.null()]),
  })).min(1).max(10),
  expectedAnswers: z.string().regex(/^[0-9a-f]{16}$/).optional(),
});
function response(body: unknown, status: number) {
  return Response.json(body, {status, headers:{"Cache-Control":"no-store"}});
}

/** Fixed-path writes avoid Server Action forwarding dropping demo Set-Cookie
 * when a queued save runs after the questionnaire route has unmounted.
 */
export function createPatientAnswerHandler(deps: Parameters<typeof createPatientService>[0] & {
  /** Called when a save finished the questionnaire or raised a red flag (the caller enrols the member). */
  onEnrol?: (reason: "completed" | "urgent") => void;
}) {
  return async (request: Request) => {
    if (request.headers.get("origin") !== new URL(request.url).origin)
      return response({ok:false,reason:"invalid"},403);
    if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get("content-type") ?? ""))
      return response({ok:false,reason:"invalid"},415);
    try {
      const user = await deps.user();
      if (!user) return response({ok:false,reason:"invalid"},401);
      const reader = request.body?.getReader();
      if (!reader) return response({ok:false,reason:"invalid"},400);
      const decoder = new TextDecoder();
      let text = "", size = 0;
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        size += part.value.byteLength;
        if (size > MAX_BODY_BYTES) {
          await reader.cancel();
          return response({ok:false,reason:"invalid"},413);
        }
        text += decoder.decode(part.value,{stream:true});
      }
      text += decoder.decode();
      let parsed: unknown;
      try { parsed = JSON.parse(text); } catch { return response({ok:false,reason:"invalid"},400); }
      const input = inputSchema.safeParse(parsed);
      if (!input.success) return response({ok:false,reason:"invalid"},400);
      const result = await createPatientService({user:async()=>user,store:deps.store,answerSource:deps.answerSource}).saveAnswers(input.data);
      if (!result.ok) return response(result,result.reason === "conflict" ? 409 : result.reason === "unavailable" ? 503 : 400);
      // The enrolment hint is internal: the browser gets the same body as before (Fable #277 F1).
      const {enrol, ...body} = result;
      if (enrol) deps.onEnrol?.(enrol);
      return response(body,200);
    } catch {
      return response({ok:false,reason:"unavailable"},503);
    }
  };
}
