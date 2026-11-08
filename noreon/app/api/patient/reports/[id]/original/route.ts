import { withRouteLogging } from "@/lib/observability/with-logging";
import { z } from "zod";
import { parseLocale, pick } from "@/lib/locale";
import type { ReportContext } from "@/lib/reports/server";
import { validateFile } from "@/lib/reports/files";
import { BUCKET, ownedReport, reportContext } from "@/lib/reports/server";
export const runtime = "nodejs";
export const GET = withRouteLogging(async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  let ctx: ReportContext | undefined;
  try {
    ctx = await reportContext();
    const report = await ownedReport(ctx, (await context.params).id);
    const file = await ctx.admin.storage
      .from(BUCKET)
      .download(report.object_path);
    if (file.error || !file.data) throw new Error("unavailable");
    const preview = new URL(request.url).searchParams.get("preview") === "1";
    if (preview) {
      try { await validateFile(Buffer.from(await file.data.arrayBuffer()), report.mime); }
      catch { throw new Error("not_found"); }
    }
    return new Response(file.data.stream(), {
      headers: {
        "Content-Type": report.mime,
        "Content-Disposition": `${preview ? "inline" : "attachment"}; filename="report.${report.mime === "application/pdf" ? "pdf" : report.mime === "image/png" ? "png" : "jpg"}"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; frame-ancestors 'self'",
      },
    });
  } catch (error) {
    if (!(error instanceof Error) || !["unauthorized", "not_found", "disabled"].includes(error.message)) {
      const id = (await context.params).id;
      const retry = z.uuid().safeParse(id).success ? `/api/patient/reports/${id}/original` : "/patient/reports";
      const locale = parseLocale(ctx?.locale, "en");
      const title = pick(locale, {hy: "Բնօրինակը հիմա հասանելի չէ", en: "Your original report is temporarily unavailable", ru: "Оригинал вашего отчёта временно недоступен"});
      const message = pick(locale, {hy: "Փորձեք կրկին մի փոքր անց։ Ձեր պահված տվյալները չեն փոխվել։", en: "Try again in a moment. Your saved details have not changed.", ru: "Попробуйте снова чуть позже. Ваши сохранённые данные не изменились."});
      const label = pick(locale, {hy: "Կրկին ներբեռնել", en: "Try downloading again", ru: "Попробовать скачать снова"});
      return new Response(`<!doctype html><html lang="${locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title} | Noreon</title></head><body><main><p>Noreon</p><h1>${title}</h1><p>${message}</p><p><a href="${retry}">${label}</a></p></main></body></html>`, {status: 503, headers: {"Content-Type": "text/html; charset=utf-8", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; frame-ancestors 'self'"}});
    }
    return Response.json({ error: "unavailable" }, { status: 404 });
  }
});
