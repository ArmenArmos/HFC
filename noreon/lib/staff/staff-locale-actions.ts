'use server';
import {loggedAction} from '@/lib/observability/with-logging';
import{cookies}from'next/headers';
import{revalidatePath}from'next/cache';
import{requireRealStaff}from'@/lib/patient-care/clinical-case-repository';
import{staffLocaleCookie}from'./staff-locale';
import{parseLocale}from'@/lib/locale';

export const setStaffLocale=loggedAction("setStaffLocale",async function setStaffLocale(form:FormData){
 const{identity}=await requireRealStaff();
 if(identity.role!=='nurse'&&identity.role!=='doctor'&&identity.role!=='coordinator')return;
 const locale=parseLocale(form.get('locale'),'hy');
 (await cookies()).set(staffLocaleCookie,locale,{path:'/',httpOnly:true,sameSite:'lax',secure:process.env.NODE_ENV==='production',maxAge:60*60*24*365});
 revalidatePath('/staff/real','layout');
});
