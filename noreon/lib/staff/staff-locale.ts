import 'server-only';
import{cookies,headers}from'next/headers';
import type{StaffLocale}from'./staff-locale-copy';
import{isLocale,parseLocale}from'@/lib/locale';
export const staffLocaleCookie='noreon-staff-locale';
/** Display language for nurse and doctor screens. A plain preference: it grants
 * nothing, and administrators stay in English because their screens are not translated. */
export async function staffLocale(role:string):Promise<StaffLocale>{
 if(role!=='nurse'&&role!=='doctor')return 'en';
 const locale=(await headers()).get('x-noreon-staff-locale');
 if(isLocale(locale))return locale;
 return parseLocale((await cookies()).get(staffLocaleCookie)?.value,'en');
}
