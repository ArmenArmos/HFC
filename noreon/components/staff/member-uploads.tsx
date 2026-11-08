import type {Locale} from '@/lib/locale';
import { FileText } from "lucide-react";
import { yerevanStamp } from "@/lib/staff/yerevan-time";
import { measures, type ReportedDocument, type ReportedValue } from "@/lib/member-history/measures";
import type { StaffLabResults } from "@/lib/lab-ai/staff-results";
import { MemberUploadAi, type ApprovalProps } from "./member-upload-ai";

const enCopy={ title: "Earlier results from the member", intro: "Files and values the member added themselves. They are not verified by the clinic and do not change any rule or plan.", label: "From the member, not verified", files: "Files", values: "Values from the member", fromFile: "From member upload, AI-read, member-confirmed", aiRead: "From member upload, AI-read, not confirmed by member", corrected: "From member upload, corrected by member", approved: "From member upload, approved by the doctor", approvalUnavailable: "Approvals of the member's files are unavailable. Reload to check them.", aiUnavailable: "AI reading of the member's files is unavailable. Reload to check it.", noFiles: "No files from the member.", noValues: "No values from the member.", resultDate: "Result date", added: "Added", unavailable: "The member's earlier results are unavailable. Reload to check them." };
const copy:Record<Locale,typeof enCopy>= {
  en:enCopy,
  hy: { title: "Անդամի նախկին արդյունքները", intro: "Անդամի կողմից ավելացված ֆայլեր և արժեքներ։ Դրանք կլինիկայի կողմից ստուգված չեն և չեն փոխում որևէ կանոն կամ պլան։", label: "Անդամից, չստուգված", files: "Ֆայլեր", values: "Անդամի արժեքները", fromFile: "Անդամի վերբեռնումից, կարդացել է AI-ը, հաստատել է անդամը", aiRead: "Անդամի վերբեռնումից, կարդացել է AI-ը, անդամը չի հաստատել", corrected: "Անդամի վերբեռնումից, ուղղել է անդամը", approved: "Անդամի վերբեռնումից, հաստատել է բժիշկը", approvalUnavailable: "Անդամի ֆայլերի հաստատումներն անհասանելի են։ Թարմացրեք էջը։", aiUnavailable: "Անդամի ֆայլերի AI ընթերցումն անհասանելի է։ Թարմացրեք էջը։", noFiles: "Անդամից ֆայլեր չկան։", noValues: "Անդամից արժեքներ չկան։", resultDate: "Արդյունքի ամսաթիվ", added: "Ավելացվել է", unavailable: "Անդամի նախկին արդյունքներն անհասանելի են։ Թարմացրեք էջը՝ ստուգելու համար։" },
 ru:{
  title:"Предыдущие результаты участника",intro:"Файлы и показатели, которые участник добавил самостоятельно. Они не проверены клиникой и не меняют правила или план.",
  label:"От участника, не проверено",files:"Файлы",values:"Показатели от участника",fromFile:"Из файла участника, распознано ИИ, подтверждено участником",
  aiRead:"Из файла участника, распознано ИИ, не подтверждено участником",corrected:"Из файла участника, исправлено участником",approved:"Из файла участника, утверждено врачом",
  approvalUnavailable:"Подтверждения файлов участника недоступны. Обновите страницу, чтобы проверить их.",
  aiUnavailable:"Распознавание файлов участника ИИ недоступно. Обновите страницу, чтобы проверить его.",noFiles:"Нет файлов от участника.",noValues:"Нет показателей от участника.",
  resultDate:"Дата результата",added:"Добавлено",unavailable:"Предыдущие результаты участника недоступны. Обновите страницу, чтобы проверить их.",
 },
};
const badge = "inline-flex rounded-md bg-muted px-2 py-1 text-caption text-muted-foreground";

/** `ai`: the AI reading of each file (undefined while the app switch is off; null when unreadable). */
export function MemberUploads({ data, memberId, locale, ai, approval }: { data: { documents: ReportedDocument[]; values: ReportedValue[] } | null; memberId: string; locale: Locale; ai?: StaffLabResults | null; approval?: ApprovalProps }) {
  const t = copy[locale];
  return (
    <section className="max-w-3xl space-y-4 rounded-xl border bg-background p-4 sm:p-6" aria-labelledby="member-uploads-title" lang={locale}>
      <header className="space-y-1">
        <h2 id="member-uploads-title" className="flex items-center gap-2 text-h3"><FileText className="size-5" aria-hidden />{t.title}</h2>
        <p className="text-body2 text-muted-foreground">{t.intro}</p>
        <span className={badge}>{t.label}</span>
      </header>
      {!data ? <p role="status" className="text-body2">{t.unavailable}</p> : <>
        <div className="space-y-2">
          <h3 className="text-body1 font-medium">{t.files}</h3>
          {data.documents.length ? <ul className="space-y-2">{data.documents.map(d => (
            <li key={d.id} id={`lab-ai-${d.id}`} className="min-w-0 scroll-mt-24 space-y-1 rounded-lg border p-3">
              <a className="inline-flex min-h-11 items-center break-all underline" href={`/staff/real/members/${memberId}/member-uploads/${d.id}`} target="_blank" rel="noreferrer">{d.fileName}</a>
              <p className="text-caption text-muted-foreground">{d.resultDate ? `${t.resultDate} ${d.resultDate} · ` : ""}{t.added} <time dateTime={d.createdAt}>{yerevanStamp(d.createdAt, locale)}</time> · <span className={badge}>{t.label}</span></p>
              {ai?.enabled && <MemberUploadAi doc={ai.memberUploads.find(x => x.documentId === d.id)} locale={locale} approval={approval} />}
            </li>))}</ul> : <p className="text-body2">{t.noFiles}</p>}
          {ai === null && <p role="status" className="text-body2">{t.aiUnavailable}</p>}
          {ai?.enabled && approval && approval.data === null && <p role="status" className="text-body2">{t.approvalUnavailable}</p>}
        </div>
        <div className="space-y-2">
          <h3 className="text-body1 font-medium">{t.values}</h3>
          {data.values.length ? <ul className="divide-y rounded-lg border px-3">{data.values.map(v => (
            <li key={v.id} className="flex flex-wrap justify-between gap-2 py-2 text-body2">
              <span>{measures[v.measure][locale]}: <span className="tabular-nums">{v.measure === "bp" ? `${v.value}/${v.value2}` : v.value} {v.unit}</span></span>
              <span className="text-caption text-muted-foreground">{v.measuredOn} · {v.source === "ai_confirmed" ? t.fromFile : v.source === "ai_read" ? t.aiRead : v.source === "member_corrected" ? t.corrected : v.source === "doctor_approved" ? t.approved : t.label}</span>
            </li>))}</ul> : <p className="text-body2">{t.noValues}</p>}
        </div>
      </>}
    </section>
  );
}
