import { redirect } from "next/navigation";
// The member experience has one view. Legacy presentation links enter the care hub.
export default function JourneyPage() {
  redirect("/patient/dashboard");
}
