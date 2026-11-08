import {z} from 'zod';
export const memberContactSchema=z.strictObject({phone:z.string().regex(/^\+[0-9]{4,15}$/).nullable(),telegramLinked:z.boolean()});
export const memberContactsSchema=z.record(z.uuid(),memberContactSchema);
export type MemberContact=z.infer<typeof memberContactSchema>;
/** Display form "+374 77 123456" for Armenian numbers; other numbers keep their digits. */
export function phoneText(phone:string){const m=/^\+374(\d{2})(\d{6})$/.exec(phone);return m?`+374 ${m[1]} ${m[2]}`:phone;}
