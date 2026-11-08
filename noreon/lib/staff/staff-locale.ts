import 'server-only';
import{cookies,headers}from'next/headers';
import type{StaffLocale}from'./staff-locale-copy';
import{isLocale,parseLocale}from'@/lib/locale';
export const staffLocaleCookie='noreon-staff-locale';
/** Display language for nurse, doctor and care coordinator screens. A plain preference: it grants
 * nothing. Armenian unless the person chose otherwise; administrators stay in English
 * because their screens are not translated yet. */
export async function staffLocale(role:string):Promise<StaffLocale>{
 if(role!=='nurse'&&role!=='doctor'&&role!=='coordinator')return 'en';
 const locale=(await headers()).get('x-noreon-staff-locale');
 if(isLocale(locale))return locale;
 return parseLocale((await cookies()).get(staffLocaleCookie)?.value,'hy');
}
