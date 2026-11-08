import {validateReview, type ReportExtraction} from './schema';
/** Minimize structured identities on the explanation path; never mutate the saved source. */
export function explanationInput(value: unknown): ReportExtraction {
  const report = validateReview(value);
  return {...report, personName: null, laboratory: null};
}
