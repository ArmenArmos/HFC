"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useReducer,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import { emptyReportReview, reportReviewReducer } from "@/lib/service-workflow/report-review-state";
import type { CaseHistoryItem } from "@/components/staff/case-history";
import type { DemoState } from "@/lib/patient/demo-model";
import { usePathname } from "next/navigation";
import type { ReportRecord } from "@/lib/reports/demo";
import { reportFailureCode, reportFailureMessage } from "@/lib/reports/feedback";
import { parseLocale, pick, type Locale } from "@/lib/locale";
import {
  reportPublication,
  type ReportApproval,
} from "@/lib/service-workflow/report-memory";

import { reportContentTransition } from "@/lib/service-workflow/report-associations";

type Publication = ReturnType<typeof reportPublication>;
export type ReviewSnapshot = {monitoring?:import("@/lib/service-workflow/follow-up").MonitoringSnapshot;reviewTasks?: import("@/lib/service-workflow/review-task").ReviewTask[]; reviewChanges?: {revision:number; kind:string; reference_id:string|null; created_at:string}[];history?: CaseHistoryItem[] | null; state: DemoState; changes: {revision:number; kind:string; reference_id:string|null; created_at:string}[]};
type Memory = {
  snapshot: ReviewSnapshot | null;
  reportEvidenceRevision: number;
  reportEvidenceSession: string;
  reports: ReportRecord[];
  setReports: Dispatch<SetStateAction<ReportRecord[]>>;
  approvals: Record<string, ReportApproval>;
  published: Publication | null;
  publish: (key: string) => void;
  associate: (reportId: string, requirementId: string, rowIndices: number[], doctor: string, evidenceRevision: number) => Promise<void>;
  approve: (report: ReportRecord, doctor: string) => Promise<void>;
  originalUrls: Record<string, string>;
  add: (report: ReportRecord, file?: File) => Promise<void>;
  remove: (id: string) => Promise<void>;
  clear: () => void;
  shared: boolean;
  persistenceError: string;
  clearUploadError: () => void;
  loaded: boolean;
  refresh: () => Promise<boolean>;
};
type SharedEntry = {
  record: ReportRecord;
  revision: number;
  approval: ReportApproval | null;
  published: (ReportApproval & { key?: string; approval?: ReportApproval }) | null;
  original: boolean;
};

const Context = createContext<Memory | null>(null);

function isReport(value: unknown): value is ReportRecord {
  return !!value && typeof value === "object" && typeof (value as ReportRecord).id === "string";
}

function sharedErrorMessage(code: string, locale: Locale) {
  if (['unauthorized', 'not_found', 'conflict', 'cleanup_pending'].includes(code)) return reportFailureMessage(code, locale);
  return pick(locale, {hy: 'Հետազոտությունները հասանելի չեն։ Խնդրում ենք փորձեք կրկին։', en: 'Reports are unavailable. Please try again.', ru: 'Результаты недоступны. Попробуйте снова.'});
}

export function DemoReportsProvider({
  children,
  caseId,
  shared = false,
  locale: requestedLocale,
}: {
  children: React.ReactNode;
  caseId?: string;
  shared?: boolean;
  locale?: Locale;
}) {
  const pathname = usePathname();
  const locale = parseLocale(requestedLocale, pathname.startsWith("/staff") || pathname === "/patient/doctor" || pathname === "/patient/backoffice" ? "en" : "hy");
  const [snapshot, setSnapshot] = useState<ReviewSnapshot | null>(null);
  const [reportEvidenceSession] = useState(() => crypto.randomUUID());
  const [reviewState, dispatchReview] = useReducer(reportReviewReducer, emptyReportReview);
  const {reports, approvals, evidenceRevision: reportEvidenceRevision} = reviewState;
  const pendingWrites = useRef(0);
  const pendingWriteError = useRef<string | null>(null);
  const refreshGeneration = useRef(0);
  const memberRefreshPath = caseId ? "staff" : pathname;
  const setReportsState = useCallback((reports: ReportRecord[]) => {
    dispatchReview({trackEvidence: !shared, update: state => ({...state, reports})});
  }, [shared]);
  const setApprovals = useCallback((value: SetStateAction<Record<string, ReportApproval>>) => {
    dispatchReview({trackEvidence: !shared, update: state => ({...state, approvals: typeof value === "function" ? value(state.approvals) : value})});
  }, [shared]);
  const [published, setPublished] = useState<Publication | null>(null);
  const [originalUrls, setOriginalUrls] = useState<Record<string, string>>({});
  const [persistenceError, setPersistenceErrorState] = useState("");
  const uploadErrorActive = useRef(false);
  const setPersistenceError = useCallback((message: string, uploadFailure = false) => {
    uploadErrorActive.current = !!message && uploadFailure;
    setPersistenceErrorState(message);
  }, []);
  const clearUploadError = useCallback(() => {
    if (uploadErrorActive.current) setPersistenceError('');
  }, [setPersistenceError]);
  const loadedRef = useRef(false);
  const [loaded, setLoaded] = useState(!shared);
  const urls = useRef(new Map<string, string>());
  const rowsRef = useRef<ReportRecord[]>([]);
  const serverRevisions = useRef(new Map<string, number>());
  const updateTails = useRef(new Map<string, Promise<void>>());
  const staffMode = useRef(false);

  const sharedEndpoint = useCallback(() => {
    if (typeof window === "undefined") return null;
    const staff = window.location.pathname.startsWith("/staff/case/");
    staffMode.current = staff;
    if (staff) {
      const id = caseId ?? window.location.pathname.split("/")[3];
      if (!id) return null;
      return { staff: true, url: `/staff/reports?caseId=${encodeURIComponent(id)}`, caseId: id };
    }
    return { staff: false, url: "/patient/reports/shared", caseId: "" };
  }, [caseId]);

  const refresh = useCallback(async () => {
    if (!shared) return true;
    const generation = ++refreshGeneration.current;
    setLoaded(false);
    try {
      const endpoint = sharedEndpoint();
      if (!endpoint) throw new Error("Shared report storage is unavailable.");
      const response = await fetch(endpoint.url, { cache: "no-store" });
      const data = await response.json();
      if (!response.ok || !Array.isArray(data.reports)) throw new Error(sharedErrorMessage(data.error ?? "unavailable", locale));
      if (generation !== refreshGeneration.current || pendingWrites.current > 0) return false;
      const entries = data.reports as SharedEntry[];
      const nextReports = entries.map((entry) => entry.record).filter(isReport);
      rowsRef.current = nextReports;
      setReportsState(nextReports);
      setSnapshot(data.snapshot ?? null);
      serverRevisions.current = new Map(entries.map((entry) => [entry.record.id, entry.revision]));
      const nextApprovals: Record<string, ReportApproval> = {};
      const nextPublished: Record<string, ReportApproval> = {};
      const nextUrls: Record<string, string> = {};
      let publicationKey: string | null = null;
      for (const entry of entries) {
        if (entry.approval) nextApprovals[entry.record.id] = entry.approval;
        if (entry.published) {
          const snapshot = entry.published as ReportApproval & { key?: string; approval?: ReportApproval };
          if (snapshot.key) publicationKey = snapshot.key;
          const approval = snapshot.approval ?? snapshot;
          if (approval.report) nextPublished[entry.record.id] = approval;
        }
        if (entry.original) {
          nextUrls[entry.record.id] = endpoint.staff
            ? `/staff/reports?caseId=${encodeURIComponent(endpoint.caseId)}&original=${encodeURIComponent(entry.record.id)}`
            : `/patient/reports/shared?original=${encodeURIComponent(entry.record.id)}`;
        }
      }
      setApprovals(nextApprovals);
      setPublished({ key: publicationKey ?? "shared", reports: nextPublished });
      setOriginalUrls(nextUrls);
      setPersistenceError("");
      loadedRef.current = true;
      return true;
    } catch (error) {
      if (generation === refreshGeneration.current) setPersistenceError(error instanceof Error ? error.message : sharedErrorMessage("unavailable", locale));
      throw error;
    } finally {
      if (generation === refreshGeneration.current && pendingWrites.current === 0) setLoaded(true);
    }
  }, [sharedEndpoint, shared, setReportsState, setApprovals, locale, setPersistenceError]);

  useEffect(() => {
    if (!shared) {
      loadedRef.current = true;
      return;
    }
    let alive = true;
    const timer = window.setTimeout(() => {
      refresh().catch((error) => {
        if (alive) {
        setPersistenceError(error instanceof Error ? error.message : sharedErrorMessage("unavailable", locale));
        }
      });
    }, 0);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [refresh, shared, memberRefreshPath, locale, setPersistenceError]);

  useEffect(() => {
    const current = urls.current;
    return () => {
      current.forEach(URL.revokeObjectURL);
      current.clear();
    };
  }, []);

  const queueStaffUpdate = useCallback((record: ReportRecord) => {
    const endpoint = sharedEndpoint();
    if (!endpoint?.staff) return Promise.resolve();
    if (pendingWrites.current === 0) pendingWriteError.current = null;
    pendingWrites.current++;
    refreshGeneration.current++;
    setLoaded(false);
    const prior = updateTails.current.get(record.id) ?? Promise.resolve();
    const next = prior.catch(() => undefined).then(async () => {
      const expectedRevision = serverRevisions.current.get(record.id);
      if (expectedRevision === undefined) throw new Error("This report is no longer available. Refresh the page.");
      const response = await fetch("/staff/reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          caseId: endpoint.caseId,
          op: "update",
          id: record.id,
          expectedRevision,
          record: {
            revision: record.revision,
            state: record.state,
            reviewed: record.reviewed,
            explanation: record.explanation,
          },
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error === "conflict" ? "This report changed. Refresh the page before saving." : "Could not save this report.");
      serverRevisions.current.set(record.id, data.revision);
      setPersistenceError("");
    });
    const tracked = next.then(async () => {
      pendingWrites.current--;
      if (pendingWrites.current === 0) await refresh();
      if (pendingWriteError.current) setPersistenceError(pendingWriteError.current);
    }, async (error) => {
      pendingWriteError.current = error instanceof Error ? error.message : "Could not save this report. Check your edits and try again.";
      pendingWrites.current--;
      if (pendingWrites.current === 0) await refresh().catch(() => undefined);
      if (pendingWriteError.current) setPersistenceError(pendingWriteError.current);
      throw error;
    });
    updateTails.current.set(record.id, tracked);
    return tracked;
  }, [sharedEndpoint, refresh, setPersistenceError]);

  const setReports: Dispatch<SetStateAction<ReportRecord[]>> = useCallback((action) => {
    const previous = rowsRef.current;
    const requested = typeof action === "function" ? action(previous) : action;
    const next = requested.map(record => {
      const old = previous.find(row => row.id === record.id);
      return old && JSON.stringify(old) !== JSON.stringify(record)
        ? reportContentTransition(old, record, new Date().toISOString()) : record;
    });
    rowsRef.current = next;
    setReportsState(next);
    if (!shared) return;
    if (!loadedRef.current || !staffMode.current) return;
    for (const record of next) {
      const old = previous.find((row) => row.id === record.id);
      if (!old || JSON.stringify(old) === JSON.stringify(record)) continue;
      void queueStaffUpdate(record).catch(() => undefined);
    }
  }, [queueStaffUpdate, shared, setReportsState]);

  async function add(report: ReportRecord, file?: File) {
    const endpoint = shared ? sharedEndpoint() : null;
    if (shared && (!endpoint || endpoint.staff || !loadedRef.current)) {
      const error = new Error("not_ready");
      setPersistenceError(reportFailureMessage(error.message, locale), true);
      throw error;
    }
    const visibleReport = shared
      ? { ...report, object_path: "", extraction: null, reviewed: null, explanation: null, state: "needs_review" } as unknown as ReportRecord
      : report;
    if (file) {
      const old = urls.current.get(report.id);
      if (old) URL.revokeObjectURL(old);
      const url = URL.createObjectURL(file);
      urls.current.set(report.id, url);
      setOriginalUrls((oldUrls) => ({ ...oldUrls, [report.id]: url }));
    }
    const local = [visibleReport, ...rowsRef.current.filter((row) => row.id !== report.id)].slice(0, 10);
    rowsRef.current = local;
    setReportsState(local);
    if (!shared) return;
    if (!endpoint) throw new Error("Shared report storage is not ready. Try again after the report list loads.");
    try {
      let response: Response;
      if (file) {
        const form = new FormData();
        form.set("op", "upload");
        form.set("sharedConsent", "true");
        form.set("record", JSON.stringify(report));
        form.set("file", file, file.name);
        response = await fetch(endpoint.url, { method: "POST", body: form });
      } else {
        const year = report.file_name.includes("2025") ? 2025 : report.file_name.includes("2024") ? 2024 : null;
        if (year !== 2024 && year !== 2025) throw new Error("This report cannot be saved to the shared demo.");
        response = await fetch(endpoint.url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ op: "sample", year, sharedConsent: true }),
        });
      }
      const data = await response.json();
      if (!response.ok || !isReport(data.report)) throw new Error(reportFailureCode(data.error));
      const saved = data.report as ReportRecord;
      const withoutLocal = rowsRef.current.filter((row) => row.id !== report.id && row.id !== saved.id);
      const next = [saved, ...withoutLocal].slice(0, 10);
      rowsRef.current = next;
      setReportsState(next);
      setServerRevision(saved.id, 0);
      if (file) {
        const localUrl = urls.current.get(report.id);
        if (localUrl) URL.revokeObjectURL(localUrl);
        urls.current.delete(report.id);
        setOriginalUrls((old) => {
          const update = { ...old };
          delete update[report.id];
          update[saved.id] = `/patient/reports/shared?original=${encodeURIComponent(saved.id)}`;
          return update;
        });
      }
      setPersistenceError("");
    } catch (error) {
      const code = reportFailureCode(error instanceof Error ? error.message : 'unavailable');
      setPersistenceError(reportFailureMessage(code, locale), true);
      if (file) {
        const url = urls.current.get(report.id);
        if (url) URL.revokeObjectURL(url);
        urls.current.delete(report.id);
      }
      const next = rowsRef.current.filter((row) => row.id !== report.id);
      rowsRef.current = next;
      setReportsState(next);
      setOriginalUrls((old) => {
        const update = { ...old };
        delete update[report.id];
        return update;
      });
      throw new Error(code);
    }
  }

  function setServerRevision(id: string, revision: number) {
    serverRevisions.current.set(id, revision);
  }

  async function remove(id: string) {
    if (shared && staffMode.current) {
      setPersistenceError("Doctors cannot remove shared source reports.");
      return;
    }
    if (shared && !staffMode.current) {
      const endpoint = sharedEndpoint();
      if (!endpoint) return;
      try {
        const response = await fetch(endpoint.url, {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id }),
        });
        const data = await response.json();
        if (!response.ok) throw new Error(sharedErrorMessage(data.error ?? "unavailable", locale));
      } catch (error) {
        setPersistenceError(error instanceof Error ? error.message : sharedErrorMessage("unavailable", locale));
        return;
      }
    }
    const url = urls.current.get(id);
    if (url) URL.revokeObjectURL(url);
    urls.current.delete(id);
    const next = rowsRef.current.filter((row) => row.id !== id);
    rowsRef.current = next;
    dispatchReview({trackEvidence: !shared, update: state => {
      const approvals = {...state.approvals};
      delete approvals[id];
      return {reports: next, approvals};
    }});
    setPublished((old) => {
      if (!old) return old;
      const update = { ...old.reports };
      delete update[id];
      return { ...old, reports: update };
    });
    setOriginalUrls((old) => {
      const update = { ...old };
      delete update[id];
      return update;
    });
    serverRevisions.current.delete(id);
    setPersistenceError("");
  }

  function clear() {
    urls.current.forEach(URL.revokeObjectURL);
    urls.current.clear();
    rowsRef.current = [];
    dispatchReview({trackEvidence: !shared, update: () => ({reports:[],approvals:{}})});
    setOriginalUrls({});
    setPublished(null);
  }

  async function associate(reportId: string, requirementId: string, rowIndices: number[], doctor: string, evidenceRevision: number) {
    if (shared) {
      const endpoint = sharedEndpoint();
      if (!endpoint?.staff || !loaded || persistenceError) throw new Error("Refresh this review before changing associations.");
      await Promise.all([...updateTails.current.values()]);
      const expectedRevision = serverRevisions.current.get(reportId);
      if (expectedRevision === undefined) throw new Error("This report is no longer available. Refresh the page.");
      setLoaded(false);
      refreshGeneration.current++;
      try {
        const response = await fetch("/staff/reports", {
          method: "POST", headers: {"Content-Type":"application/json"},
          body: JSON.stringify({caseId:endpoint.caseId,op:"associate",id:reportId,expectedRevision,expectedEvidenceRevision:evidenceRevision,requirementId,rowIndices}),
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error === "conflict" ? "The evidence changed. Refresh before confirming this association." : "Could not save this association.");
        serverRevisions.current.set(reportId,data.revision);
        setApprovals(old => { const next={...old}; delete next[reportId]; return next; });
        try { await refresh(); } catch { throw new Error("Association saved. The updated review could not load; refresh before continuing."); }
      } finally { setLoaded(true); }
      return;
    }
    const at=new Date().toISOString();
    const next=rowsRef.current.map(record => {
      if(record.id!==reportId) return record;
      if(record.state!=="confirmed") throw new Error("Save checked report fields first.");
      const replaced=(record.associations??[]).filter(a=>a.requirementId===requirementId);
      return {...record,revision:record.revision+1,
        associations:[...(record.associations??[]).filter(a=>a.requirementId!==requirementId),...(rowIndices.length?[{requirementId,rowIndices:[...rowIndices],contentRevision:record.contentRevision??0,actorId:"local-doctor",actorLabel:doctor,confirmedAt:at}]:[])],
        associationHistory:[...(record.associationHistory??[]),...replaced.map(a=>({...a,retiredAt:at,reason:rowIndices.length?"replaced" as const:"removed" as const}))]};
    });
    rowsRef.current=next;
    dispatchReview({trackEvidence:true,update:state=>{const approvals={...state.approvals};delete approvals[reportId];return {...state,reports:next,approvals};}});
  }

  async function approve(report: ReportRecord, doctor: string) {
    if (shared && staffMode.current) {
      const endpoint = sharedEndpoint();
      if (!endpoint) throw new Error("Shared report storage is unavailable.");
      await (updateTails.current.get(report.id) ?? Promise.resolve());
      const expectedRevision = serverRevisions.current.get(report.id);
      if (expectedRevision === undefined) throw new Error("This report is no longer available. Refresh the page.");
      setLoaded(false);
      try {
        const response = await fetch("/staff/reports", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ caseId: endpoint.caseId, op: "approve", id: report.id, expectedRevision }),
        });
        const data = await response.json();
        if (!response.ok) {
          const message = data.error === "conflict" ? "This report changed. Refresh the page before approving it." : "Could not approve this report.";
          setPersistenceError(message);
          throw new Error(message);
        }
        serverRevisions.current.set(report.id, data.revision);
        setApprovals((old) => ({ ...old, [report.id]: data.approval }));
        setPersistenceError("");
      } finally {
        await refresh().catch(() => undefined);
      }
      return;
    }
    setApprovals((old) => ({
      ...old,
      [report.id]: {
        revision: report.revision,
        at: new Date().toISOString(),
        doctor,
        report: structuredClone(report),
      },
    }));
  }

  return (
    <Context.Provider
      value={{
        snapshot, reportEvidenceRevision, reportEvidenceSession,
        reports,
        setReports,
        approvals,
        originalUrls,
        add,
        remove,
        clear,
        published,
        publish: (key) => setPublished(reportPublication(key, rowsRef.current, approvals)),
        approve,
        associate,
        shared,
        persistenceError,
        clearUploadError,
        loaded,
        refresh,
      }}
    >
      {children}
    </Context.Provider>
  );
}

export function useDemoReports() {
  const value = useContext(Context);
  if (!value) throw new Error("Report memory provider missing");
  return value;
}

export function useOptionalDemoReports() { return useContext(Context); }
