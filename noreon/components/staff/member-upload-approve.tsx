"use client";
import {notDone} from '@/lib/staff-zoe/outcome-copy';
import type {Locale} from '@/lib/locale';
import {st} from '@/lib/staff/staff-locale-copy';
import { useMemo, useState } from "react";
import {useRecordRefresh} from '@/components/staff/record-refresh';
import { CheckCircle2, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { analyteDisplayName } from "@/lib/lab-ai/analyte-names";
import { rangeStatus, type RangeStatus } from "@/lib/member-history/lab-results";
import { approveVersion, approveValueAction, draftInterpretation, type ApproveCommand, type ApproveResult, type MemberUploadReadingApproval } from "@/lib/lab-ai/member-approval";
import type { StaffMemberUpload } from "@/lib/lab-ai/staff-results";
import { yerevanStamp } from "@/lib/staff/yerevan-time";

const enCopy={
    title: "Your check before the member sees it",
    waiting: "Waiting for your approval. The member sees the file and “Waiting for your doctor to check”, not the values.",
    waitingOther: "Waiting for the assigned doctor’s approval. The member does not see these values yet.",
    approved: (name: string, at: string, v: number) => `Approved by ${name} on ${at} (version ${v}). ${memberUploadApprovedText('en')}`,
    identityFirst: "Waiting for the member to say whether the sheet is theirs. You can approve after that.",
    aiRead: "AI read", value: "Value", remove: "Remove", keep: "Keep", removed: "Not shown to the member",
    range: { in: "In range", borderline: "Near the edge of the range", out: "Out of range", none: "No printed range" } as Record<RangeStatus, string>,
    interpretation: "What the member reads, in plain words", draftNote: "Prepared from the values and the printed ranges. Edit it before approving. The member sees it marked as checked by you.",
    hy: "Armenian", en: "English", page:"p.",
    approve: "Approve and show to the member", again: "Change and approve again", cancel: "Cancel", sending: "Approving…",
    failed: {
      invalid: "Check the values and fill in both texts, then try again.", stale: "This reading changed since you opened it. Reload the page.", "not-ready": "This reading cannot be approved yet. Reload the page.",
      disabled: "Reading member files is switched off.", access: "Only the assigned doctor can approve. Sign in again if you are.", unavailable: "Busy right now. Try again.", "outcome-unknown": "Not sure it was saved. Try again: a repeat is safe.",
    } as Record<string, string>,
  };
const copy:Record<Locale,typeof enCopy>= {
  en:enCopy,
  hy: {
    title: "Ձեր ստուգումը՝ նախքան անդամը կտեսնի",
    waiting: "Սպասում է ձեր հաստատմանը։ Անդամը տեսնում է ֆայլը և «Սպասում է ձեր բժշկի ստուգմանը», ոչ արժեքները։",
    waitingOther: "Սպասում է նշանակված բժշկի հաստատմանը։ Անդամը դեռ չի տեսնում այս արժեքները։",
    approved: (name: string, at: string, v: number) => `Հաստատել է ${name}՝ ${at} (տարբերակ ${v})։ ${memberUploadApprovedText('hy')}`,
    identityFirst: "Սպասում է, որ անդամը ասի՝ թերթիկն իրենն է, թե ոչ։ Դրանից հետո կարող եք հաստատել։",
    aiRead: "AI-ի կարդացածը", value: "Արժեք", remove: "Հեռացնել", keep: "Պահել", removed: "Անդամին ցույց չի տրվի",
    range: { in: "Միջակայքում", borderline: "Միջակայքի սահմանին մոտ", out: "Միջակայքից դուրս", none: "Միջակայք նշված չէ" } as Record<RangeStatus, string>,
    interpretation: "Ինչ կկարդա անդամը՝ պարզ բառերով", draftNote: "Պատրաստված է արժեքներից և տպված միջակայքերից։ Խմբագրեք հաստատելուց առաջ։ Անդամը կտեսնի այն՝ նշված որպես ձեր ստուգած։",
    hy: "Հայերեն", en: "Անգլերեն", page:"p.",
    approve: "Հաստատել և ցույց տալ անդամին", again: "Փոխել և կրկին հաստատել", cancel: "Չեղարկել", sending: "Հաստատվում է…",
    failed: {
      invalid: "Ստուգեք արժեքները և լրացրեք երկու տեքստը, ապա կրկին փորձեք։", stale: "Այս ընթերցումը փոխվել է բացելուց հետո։ Թարմացրեք էջը։", "not-ready": "Այս ընթերցումը դեռ հնարավոր չէ հաստատել։ Թարմացրեք էջը։",
      disabled: "Անդամի ֆայլերի ընթերցումն անջատված է։", access: "Հաստատել կարող է միայն նշանակված բժիշկը։ Եթե դա դուք եք, կրկին մուտք գործեք։", unavailable: "Այս պահին զբաղված է։ Փորձեք կրկին։", "outcome-unknown": "Հայտնի չէ՝ պահպանվե՞լ է։ Կրկին փորձեք․ կրկնելն անվտանգ է։",
    } as Record<string, string>,
  },
 ru:{
  title:"Ваша проверка перед показом участнику",waiting:"Ожидает вашего утверждения. Участник видит файл и надпись «Ожидает проверки вашим врачом», но не показатели.",
  waitingOther:"Ожидает утверждения назначенного врача. Участник пока не видит эти показатели.",
  identityFirst:"Ожидается подтверждение участника, что бланк принадлежит ему. После этого вы сможете утвердить результаты.",aiRead:"Распознано ИИ",value:"Значение",remove:"Убрать",
  keep:"Оставить",removed:"Не показывается участнику",
  range:{in:"В пределах референсного интервала",borderline:"Близко к границе референсного интервала",out:"За пределами референсного интервала",none:"Референсный интервал не указан"} as Record<RangeStatus,string>,
  interpretation:"Пояснение для участника простыми словами",
  draftNote:"Подготовлено по показателям и указанным референсным интервалам. Отредактируйте перед утверждением. Участник увидит отметку о вашей проверке.",hy:"Армянский",en:"Английский",page:"стр.",
  approve:"Утвердить и показать участнику",again:"Изменить и утвердить ещё раз",cancel:"Отмена",sending:"Утверждается…",
  failed:{invalid:"Проверьте показатели и заполните оба текста, затем попробуйте снова.",stale:"Результаты распознавания изменились после открытия. Обновите страницу.","not-ready":"Эти результаты пока нельзя утвердить. Обновите страницу.",disabled:"Распознавание файлов участников отключено.",access:"Утвердить может только назначенный врач. Если это вы, войдите ещё раз.",unavailable:"Сейчас сервис занят. Попробуйте снова.","outcome-unknown":"Неизвестно, сохранилось ли утверждение. Попробуйте снова: повтор безопасен."} as Record<string,string>,
  approved:(name:string,at:string,v:number)=>`Утверждено: ${name}, ${at} (версия ${v}). ${memberUploadApprovedText('ru')}`,
 },
};
const tone: Record<RangeStatus, "success" | "attention" | "danger" | "muted"> = { in: "success", borderline: "attention", out: "danger", none: "muted" };
/** The existing approved sentence, shared by the chat's acknowledgement. */
export const memberUploadApprovedText=(locale:Locale)=>st(locale,'The member sees the kept values and the text below.','Անդամը տեսնում է պահված արժեքները և ստորև տեքստը։','Участник видит оставленные показатели и текст ниже.');
export type MemberUploadChat={onApproved:()=>void;onOpenPdf:(page:number)=>void};
type Approve = (input: ApproveCommand) => Promise<ApproveResult>;

/** Under one member upload: the doctor checks every value, edits the member's text and approves. Read-only for others. */
export function MemberUploadApprove({ doc, reading, canApprove, memberId, locale, approve, chat }: { doc: StaffMemberUpload; reading: MemberUploadReadingApproval | undefined; canApprove: boolean; memberId: string; locale: Locale; approve: Approve; chat?:MemberUploadChat }) {
  const t = copy[locale];
  const j = doc.job;
  const a = reading?.approval ?? null;
  const values = doc.values.filter((v) => v.memberStatus !== "rejected");
  // The form shows while there is no approval, or while the doctor changes an approved reading.
  const [editing, setEditing] = useState(false);
  if (!j || j.state !== "done" || !values.length || j.confirmation?.identityAnswer === "not_mine") return null;
  const head = a
    ? <p className="flex items-start gap-2 text-body2"><CheckCircle2 aria-hidden className="mt-0.5 size-4 shrink-0" />{t.approved(a.doctorName ?? "", yerevanStamp(a.approvedAt, locale), a.version)}</p>
    : <p className="flex items-start gap-2 text-body2 font-medium"><Clock aria-hidden className="mt-0.5 size-4 shrink-0" />{canApprove ? t.waiting : t.waitingOther}</p>;
  return (
    <section className="space-y-3 rounded-md border bg-background p-3" aria-label={t.title}>
      <h4 className="text-body1 font-medium">{t.title}</h4>
      {head}
      {!j.confirmation ? <p className="text-body2">{t.identityFirst}</p>
        : canApprove && (!a || editing) ? <ApproveForm doc={doc} reading={reading!} memberId={memberId} locale={locale} approve={approve} cancel={a ? () => setEditing(false) : null} done={() => setEditing(false)} chat={chat} />
        : a ? <>
          <ApprovedText a={a} locale={locale} />
          {canApprove && <Button type="button" variant="outline" className="h-auto min-h-11 whitespace-normal" onClick={() => setEditing(true)}>{t.again}</Button>}
        </> : null}
    </section>
  );
}

function ApprovedText({ a, locale }: { a: NonNullable<MemberUploadReadingApproval["approval"]>; locale: Locale }) {
  const t = copy[locale];
  return <dl className="grid gap-2 text-body2">
    <div><dt className="text-caption text-muted-foreground">{t.hy}</dt><dd lang="hy" className="whitespace-pre-line">{a.interpretationHy}</dd></div>
    <div><dt className="text-caption text-muted-foreground">{t.en}</dt><dd lang="en" className="whitespace-pre-line">{a.interpretationEn}</dd></div>
  </dl>;
}

function ApproveForm({ doc, reading, memberId, locale, approve, cancel, done, chat }: { doc: StaffMemberUpload; reading: MemberUploadReadingApproval; memberId: string; locale: Locale; approve: Approve; cancel: (() => void) | null; done: () => void; chat?:MemberUploadChat }) {
  const t = copy[locale];
  const refresh=useRecordRefresh();
  const j = doc.job!;
  const a = reading.approval;
  const values = doc.values.filter((v) => v.memberStatus !== "rejected");
  const ranges = new Map(reading.ranges.map((r) => [r.valueId, r]));
  // The number the database treats as "keep": the current approval's, else the member's correction, else the AI reading.
  const baseline = (v: (typeof values)[number]) => {
    const p = a?.values.find((x) => x.valueId === v.valueId);
    return p ? (p.action === "corrected" ? p.value : v.value) : v.memberStatus === "corrected" ? v.memberValue : v.value;
  };
  const [rows, setRows] = useState(() => Object.fromEntries(values.map((v) => {
    const b = baseline(v);
    return [v.valueId, { text: b === null ? "" : String(b), removed: a?.values.find((x) => x.valueId === v.valueId)?.action === "removed" }];
  })));
  const number = (s: string) => { const n = Number(s.trim().replace(",", ".")); return s.trim() && Number.isFinite(n) ? n : null; };
  const draft = useMemo(() => draftInterpretation(values.map((v) => {
    const r = rows[v.valueId]!, rg = ranges.get(v.valueId);
    return { testName: v.testName, catalogueRef: v.catalogueRef, value: number(r.text), refLow: rg?.refLow ?? null, refHigh: rg?.refHigh ?? null, collectedOn: v.collectedOn, removed: r.removed };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  })), [rows]);
  const [text, setText] = useState<{ hy: string | null; en: string | null }>({ hy: a?.interpretationHy ?? null, en: a?.interpretationEn ?? null });
  const hy = text.hy ?? draft.hy, en = text.en ?? draft.en;
  const [submissionId, setSubmissionId] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [bad, setBad] = useState<Set<string>>(new Set());

  async function send() {
    if (busy) return;
    const wrong = new Set<string>();
    const out: ApproveCommand["values"] = [];
    for (const v of values) {
      const r = rows[v.valueId]!, b = baseline(v);
      if (r.removed) { out.push({ valueId: v.valueId, action: "remove" }); continue; }
      const action = approveValueAction(r.text, b);
      if (action === null) { wrong.add(v.valueId); continue; }
      out.push({ valueId: v.valueId, ...action });
    }
    setBad(wrong);
    if (wrong.size || !hy.trim() || !en.trim()) { setError(t.failed.invalid!); return; }
    setBusy(true);
    setError(null);
    const r = await approve({ version: approveVersion, submissionId, memberId, jobId: j.jobId, basedOn: a?.version ?? null, values: out,
      interpretationHy: hy.trim(), interpretationEn: en.trim(), interpretationEdited: hy.trim() !== draft.hy.trim() || en.trim() !== draft.en.trim() }).catch((): ApproveResult => ({ status: "outcome-unknown" }));
    setBusy(false);
    if (r.status === "approved") { done(); if(chat)chat.onApproved();else refresh(); return; }
    // A new submission for a fresh attempt, except when the outcome is unknown (a resend is the safe retry).
    if (r.status !== "outcome-unknown") setSubmissionId(crypto.randomUUID());
    setError(t.failed[r.status] ?? t.failed.unavailable!);
  }

  return <div className="space-y-3">
    <ul className="divide-y rounded-md border px-3">
      {values.map((v) => {
        const r = rows[v.valueId]!, rg = ranges.get(v.valueId);
        const n = number(r.text);
        const status = rangeStatus({ value: n, refLow: rg?.refLow ?? null, refHigh: rg?.refHigh ?? null });
        const name = analyteDisplayName(v.testName, locale, v.catalogueRef);
        const set = (patch: Partial<typeof r>) => setRows((all) => ({ ...all, [v.valueId]: { ...r, ...patch } }));
        return <li key={v.valueId} className="space-y-2 py-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className={`min-w-0 break-words text-body2 font-medium ${r.removed ? "text-muted-foreground line-through" : ""}`}>{name}</p>
            {r.removed ? <span className="text-caption text-muted-foreground">{t.removed}</span> : <Badge variant={tone[status]}>{t.range[status]}</Badge>}
          </div>
          <p className="text-caption text-muted-foreground">{t.aiRead}: <span className="tabular-nums">{v.valueText}</span>{v.unit ? ` ${v.unit}` : ""}{v.refText ? ` · ${v.refText}` : ""}{v.collectedOn ? ` · ${v.collectedOn}` : ""} · {chat?<button type="button" className="dcv2-choice" onClick={()=>chat.onOpenPdf(v.page)}>{t.page} {v.page}</button>:<>{t.page} {v.page}</>}</p>
          <div className="flex flex-wrap items-center gap-3">
            <Input aria-label={`${name}, ${t.value}`} aria-invalid={bad.has(v.valueId) || undefined} inputMode="decimal" className="min-h-11 w-28 shrink-0 tabular-nums" value={r.text} disabled={r.removed} onChange={(e) => set({ text: e.target.value })} />
            <span className="min-w-0 flex-1 break-words text-body2 text-muted-foreground">{v.unit ?? ""}</span>
            <Button type="button" variant="outline" className="h-auto min-h-11 shrink-0" aria-pressed={r.removed} aria-label={`${r.removed ? t.keep : t.remove} ${name}`} onClick={() => set({ removed: !r.removed })}>{r.removed ? t.keep : t.remove}</Button>
          </div>
        </li>;
      })}
    </ul>
    <fieldset className="space-y-2">
      <legend className="text-body2 font-medium">{t.interpretation}</legend>
      <p className="text-caption text-muted-foreground">{t.draftNote}</p>
      <label className="block space-y-1 text-caption">{t.hy}<Textarea lang="hy" rows={3} maxLength={2000} value={hy} onChange={(e) => setText((x) => ({ ...x, hy: e.target.value }))} /></label>
      <label className="block space-y-1 text-caption">{t.en}<Textarea lang="en" rows={3} maxLength={1500} value={en} onChange={(e) => setText((x) => ({ ...x, en: e.target.value }))} /></label>
    </fieldset>
    {error && <p role="alert" className="text-body2">{chat?notDone('action',locale,error):error}</p>}
    <div className="flex flex-wrap gap-3">
      <Button type="button" className="h-auto min-h-11 gap-2 whitespace-normal" disabled={busy} onClick={() => void send()}><CheckCircle2 aria-hidden className="size-4" />{busy ? t.sending : t.approve}</Button>
      {cancel && <Button type="button" variant="ghost" className="h-auto min-h-11" onClick={cancel}>{t.cancel}</Button>}
    </div>
  </div>;
}
