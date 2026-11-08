'use server';
import {cookies} from 'next/headers';
import {revalidatePath} from 'next/cache';
import type {Route} from 'next';
import {redirect} from 'next/navigation';
import {parseLocale} from '@/lib/locale';
import {clinicLocaleCookie} from './locale';
import {loggedAction} from '@/lib/observability/with-logging';

/** A display preference only, available before sign-in and without JavaScript. */
export const setClinicLocale=loggedAction('setClinicLocale',async function setClinicLocale(form:FormData){
 const locale=parseLocale(form.get('locale'),'hy');
 (await cookies()).set(clinicLocaleCookie,locale,{path:'/clinic',httpOnly:true,sameSite:'lax',secure:process.env.NODE_ENV==='production',maxAge:60*60*24*365});
 revalidatePath('/clinic/real','layout');
 const returnTo=form.get('returnTo');
 // Only return to this portal. Never accept an external redirect from form data.
 if(typeof returnTo==='string'&&/^\/clinic\/real(?:\/[a-zA-Z0-9-]+)*\?/.test(returnTo)){
  const target=new URL(returnTo,'https://clinic.invalid');
  target.searchParams.set('locale',locale);
  redirect((target.pathname+target.search) as Route);
 }
});
