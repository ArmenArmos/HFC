import type {Locale} from '@/lib/locale';
import { AlertTriangle, Bot } from "lucide-react";
import { analyteDisplayName } from "@/lib/lab-ai/analyte-names";
import type { StaffMemberUpload } from "@/lib/lab-ai/staff-results";
import { LabSummaryBlock } from "./lab-ai-results";
import { MemberUploadApprove,type MemberUploadChat } from "./member-upload-approve";
import type { ApproveCommand, ApproveResult, MemberUploadApprovals } from "@/lib/lab-ai/member-approval";

const enCopy={
    label: "From member upload · read by AI", ai: "Prepared by AI | Not reviewed by a doctor",
    queued: "Waiting to be read.", running: "Being read now.", rejected: "Not read: the file broke a limit or was removed.", failed: "Reading failed.", notQueued: "Not read by AI.",
    unreadable: "Read: not a lab sheet, or nothing could be read.", several: "Read: more than one person on the sheet, so no values were kept.", none: "Read: no values found.",
    confirmed: (n: number, c: number) => `Saved: ${n} values, ${c} added to the member's charts.`, pending: "Not saved yet: waiting for the member to say whether the sheet is theirs.", notMine: "Member said these results are not theirs. No values were kept.",
    mismatch: "Name or date of birth on the sheet differs from the member's profile.", mineAfterMismatch: "The member said these are their results.",
    status: { pending: "AI-read, not confirmed by member", confirmed: "member-confirmed", corrected: "member-corrected", rejected: "member removed" } as Record<string, string>,
    attention: { threshold: "matches a threshold rule", lab_critical: "lab marked critical", needs_doctor: "outside the lab range" } as Record<string, string>,
    aiRead: "AI read", summary: "AI summary", page: "page",
  };
const copy:Record<Locale,typeof enCopy>= {
  en:enCopy,
  hy: {
    label: "Անդամի վերբեռնումից · կարդացել է AI-ը", ai: "Պատրաստված է AI-ի միջոցով | Բժշկի կողմից չի վերանայվել",
    queued: "Սպասում է կարդալուն։", running: "Կարդացվում է։", rejected: "Չի կարդացվել․ ֆայլը խախտել է սահմանափակումը կամ հեռացվել է։", failed: "Կարդալը ձախողվեց։", notQueued: "AI-ը չի կարդացել։",
    unreadable: "Կարդացված է․ լաբորատոր թերթիկ չէ, կամ ոչինչ հնարավոր չեղավ կարդալ։", several: "Կարդացված է․ թերթիկին մեկից ավելի անձ կա, արժեքներ չեն պահվել։", none: "Կարդացված է․ արժեքներ չեն գտնվել։",
    confirmed: (n: number, c: number) => `Պահպանված է՝ ${n} արժեք, անդամի գծապատկերներին ավելացվել է ${c}։`, pending: "Դեռ պահպանված չէ․ սպասում է, որ անդամը ասի՝ թերթիկն իրենն է, թե ոչ։", notMine: "Անդամը նշել է, որ այս արդյունքներն իրենը չեն։ Արժեքներ չեն պահվել։",
    mismatch: "Թերթիկի անունը կամ ծննդյան ամսաթիվը տարբերվում է անդամի պրոֆիլից։", mineAfterMismatch: "Անդամը նշել է, որ սրանք իր արդյունքներն են։",
    status: { pending: "AI-ի կարդացած, անդամը չի հաստատել", confirmed: "անդամը հաստատել է", corrected: "անդամն ուղղել է", rejected: "անդամը հեռացրել է" } as Record<string, string>,
    attention: { threshold: "համապատասխանում է շեմային կանոնին", lab_critical: "լաբորատորիան նշել է կրիտիկական", needs_doctor: "լաբորատորիայի միջակայքից դուրս" } as Record<string, string>,
    aiRead: "AI-ի կարդացածը", summary: "AI ամփոփում", page: "էջ",
  },
 ru:{
  label:"Из файла участника · распознано ИИ",ai:"Подготовлено ИИ | Не проверено врачом",queued:"Ожидает распознавания.",running:"Распознаётся.",
  rejected:"Не распознано: файл превышает допустимые ограничения или удалён.",failed:"Не удалось распознать.",notQueued:"Не распознано ИИ.",
  unreadable:"Распознано: это не лабораторный бланк или данные не удалось прочитать.",several:"Распознано: на бланке данные нескольких человек, поэтому показатели не сохранены.",
  none:"Распознано: показатели не найдены.",pending:"Ещё не сохранено: ожидается подтверждение участника, что бланк принадлежит ему.",
  notMine:"Участник указал, что это не его результаты. Показатели не сохранены.",mismatch:"Имя или дата рождения на бланке отличаются от профиля участника.",
  mineAfterMismatch:"Участник указал, что это его результаты.",
  status:{pending:"распознано ИИ, не подтверждено участником",confirmed:"подтверждено участником",corrected:"исправлено участником",rejected:"удалено участником"} as Record<string,string>,
  attention:{threshold:"достигнут порог клинического правила",lab_critical:"лаборатория отметила как критический",needs_doctor:"за пределами референсного интервала лаборатории"} as Record<string,string>,
  aiRead:"Распознано ИИ",summary:"Сводка ИИ",page:"страница",confirmed:(n:number,c:number)=>`Сохранено показателей: ${n}, добавлено на графики участника: ${c}.`,
 },
};

export type ApprovalProps = { data: MemberUploadApprovals | null | undefined; memberId: string; approve: (input: ApproveCommand) => Promise<ApproveResult> };
/** Under one member upload: the AI reading, each value with the member's answer, the AI summary and, while approval is
 * required, the doctor's approval (20261021070050). */
export function MemberUploadAi({ doc, locale, approval, chat }: { doc: StaffMemberUpload | undefined; locale: Locale; approval?: ApprovalProps; chat?:MemberUploadChat }) {
  const t = copy[locale];
  const j = doc?.job;
  const values = doc?.values ?? [];
  const head = <p className="flex items-center gap-2 text-caption font-medium"><Bot className="size-4" aria-hidden />{t.label}</p>;
  if (!j) return <div className="space-y-1 rounded-lg bg-muted p-3">{head}<p className="text-body2">{t.notQueued}</p></div>;
  const text = j.state !== "done" ? t[j.state] : j.outcome === "unreadable" ? t.unreadable : j.identityStatus === "multiple_patients" ? t.several : !values.length ? t.none : null;
  const c = j.confirmation;
  return (
    <div className="space-y-2 rounded-lg bg-muted p-3">
      {head}
      {text && <p className="text-body2">{text}</p>}
      {j.identityStatus === "mismatch" && <p className="text-body2"><AlertTriangle className="mr-1 inline size-4" aria-hidden />{t.mismatch}{c?.identityAnswer === "mine" ? ` ${t.mineAfterMismatch}` : ""}</p>}
      {values.length > 0 && <p className="text-body2 font-medium">{c ? (c.identityAnswer === "not_mine" ? t.notMine : t.confirmed(c.valuesSaved, c.valuesCharted)) : t.pending}</p>}
      {values.length > 0 && (
        <ul className="divide-y rounded-md border bg-background px-3">
          {values.map((v) => (
            <li key={v.valueId} className="space-y-0.5 py-2 text-body2">
              <p className="flex flex-wrap justify-between gap-2">
                <span>{v.attention && <AlertTriangle className="mr-1 inline size-4 text-destructive" aria-label={t.attention[v.attention]} />}{analyteDisplayName(v.testName, locale, v.catalogueRef)}: <span className="tabular-nums">{v.memberStatus === "corrected" ? `${v.memberValue}` : v.valueText}</span>{v.unit ? ` ${v.unit}` : ""}</span>
                <span className="text-caption text-muted-foreground">{t.status[v.memberStatus]}</span>
              </p>
              <p className="text-caption text-muted-foreground">
                {v.memberStatus === "corrected" ? `${t.aiRead} ${v.valueText} · ` : ""}{v.refText ? `${v.refText} · ` : ""}{v.collectedOn ? `${v.collectedOn} · ` : ""}{t.page} {v.page}{v.attention ? ` · ${t.attention[v.attention]}` : ""}
              </p>
            </li>
          ))}
        </ul>
      )}
      <LabSummaryBlock summary={j.summary} locale={locale} />
      {doc && approval?.data && (approval.data.required || approval.data.readings.some((r) => r.jobId === j.jobId && r.approval)) && (
        <MemberUploadApprove doc={doc} reading={approval.data.readings.find((r) => r.jobId === j.jobId)} canApprove={approval.data.canApprove && approval.data.required} memberId={approval.memberId} locale={locale} approve={approval.approve} chat={chat} />
      )}
    </div>
  );
}
