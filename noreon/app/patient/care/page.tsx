import CareContent from "@/components/patient-care/member-care-content";

export default function CarePage({ searchParams = Promise.resolve({}) }: { searchParams?: Promise<{ view?: string }> } = {}) {
  return <CareContent searchParams={searchParams} />;
}
