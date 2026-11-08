import 'server-only';
import {cookies} from 'next/headers';
import {isLocale,parseLocale,type Locale} from '@/lib/locale';

export const clinicLocaleCookie='noreon-clinic-locale';

/** Explicit page/action language wins over the clinic's remembered preference; Armenian by default. */
export async function clinicLocale(value?:unknown):Promise<Locale>{
 if(isLocale(value))return value;
 return parseLocale((await cookies()).get(clinicLocaleCookie)?.value,'hy');
}
