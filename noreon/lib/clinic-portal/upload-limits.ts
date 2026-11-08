/** Clinic PDFs travel as one raw request body through a Vercel Function, whose request body is capped at
 * 4.5 MB. Every application gate stays at this product limit; the database contract (8 MiB) is the outer bound. */
export const CLINIC_UPLOAD_MAX_BYTES=4*1024*1024;
