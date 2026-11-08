/** Whether members can upload reports. Kept apart so screens can ask without importing the report model. */
export function reportsEnabled() {
  return (
    process.env.NOREON_REPORT_IMPORT_ENABLED === "true" &&
    !!process.env.OPENAI_API_KEY
  );
}
