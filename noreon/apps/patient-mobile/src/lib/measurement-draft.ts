import { validMeasurement } from "../../../../lib/patient/validation.ts";
export function localMeasurementTime(now = new Date()): string {
  return new Date(now.getTime() - now.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16)
    .replace("T", " ");
}
export function measurementDraft(
  submissionId: string,
  sys: string,
  dia: string,
  pulse: string,
  time: string,
) {
  if (
    !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(time) ||
    !/^\d+$/.test(sys) ||
    !/^\d+$/.test(dia) ||
    (pulse && !/^\d+$/.test(pulse))
  )
    return null;
  const date = new Date(time.replace(" ", "T"));
  if (!Number.isFinite(date.getTime()) || localMeasurementTime(date) !== time)
    return null;
  const input = {
    submissionId,
    systolic: Number(sys),
    diastolic: Number(dia),
    pulse: pulse ? Number(pulse) : undefined,
    measuredAt: date.toISOString(),
  };
  return validMeasurement(input) ? input : null;
}
