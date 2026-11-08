import ProgressContent from "@/components/patient-care/member-progress-content";

export default function ProgressPage({ searchParams }: { searchParams: Promise<{ section?: string; view?: string }> }) {
  return <ProgressContent searchParams={searchParams} />;
}
