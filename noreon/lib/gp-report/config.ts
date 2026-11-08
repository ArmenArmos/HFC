/** Dark until the results assessment has its clinical and release checks. */
export function resultsReportEnabled(env:Record<string,string|undefined>=process.env):boolean{
 return env.NOREON_RESULTS_REPORT==='true';
}
