/** QA 180: every member link to a PDF or uploaded file opens it in a new tab, so the app stays
 * where it was and the member can return to it. One definition, so the links cannot drift apart. */
export const FILE_LINK = { target: "_blank", rel: "noopener noreferrer" } as const;
