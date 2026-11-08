import ResultsContent from "@/components/patient-care/member-results-content";

export default function ResultsPage({ searchParams = Promise.resolve({}) }: { searchParams?: Promise<{ view?: string }> } = {}) {
  return <ResultsContent searchParams={searchParams} />;
}
