/** Where a data point came from (build prompt section 2.1). The database checks hold the same list. */
export const PROVENANCE_TAGS=['patient_reported_anamnesis','historical_record_uploaded_by_patient','historical_record_uploaded_by_staff','patient_voice_confirmed','patient_text_entry','lab_ocr_confirmed','device_bluetooth_validated','clinician_measured_and_approved']as const;
export type ProvenanceTag=typeof PROVENANCE_TAGS[number];
