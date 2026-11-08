import type { ServiceCommand, ServiceWorkflow } from "@/lib/service-workflow/types";

/** Old demo commands cannot alter bookings controlled by the request lifecycle. */
export function legacyBookingFailure(workflow: ServiceWorkflow, command: ServiceCommand): string | null {
  const controlled = (id: string) => workflow.bookingRequests?.some(request => id === request.bookingId || id.startsWith(`demo-request-${request.id}-`));
  if (command.type === "book") {
    if (command.replacingId && controlled(command.replacingId)) return "Use the test request controls to change this arrangement.";
    if (command.testIds.some(id => workflow.tests.find(test => test.id === id)?.method !== "home-log")) return "Open Arrange your tests to request provider terms and accept them before booking.";
  }
  if ("bookingId" in command && controlled(command.bookingId)) return "Use the test request controls to change this arrangement.";
  return null;
}
