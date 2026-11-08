import type { ServiceWorkflow } from "./types";
/** No unpublished clinician text in the member page's serialized props. */
export function clientWorkflow(state: ServiceWorkflow): ServiceWorkflow {
  return {
    ...state,
    events: [],
    draft: {
      explanation: "",
      instructions: "",
      followUp: "",
      medicationName: "",
      medicationDose: "",
      medicationInstructions: "",
      medicationTimes: [],
    },
  };
}
