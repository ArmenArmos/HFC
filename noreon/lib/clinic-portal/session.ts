import {parseLocale,pick} from '@/lib/locale';
import{NextResponse,type NextRequest}from'next/server';
import{createServerClient}from'@supabase/ssr';
import type{Database}from'@/lib/db/types';
import{clinicHostAllowed,clinicPortalEnabled}from'./config';
/** Cookie refresh only. Membership/current-session authority remains mandatory
 * in the route and every RPC. Never touches patient or Noreon staff cookies. */
export async function updateClinicSession(request:NextRequest){
 const locale=parseLocale(request.nextUrl.searchParams.get('locale'),parseLocale(request.cookies.get('noreon-clinic-locale')?.value,'en'));
 const t=(en:string,hy:string,ru:string)=>pick(locale,{en,hy,ru});
 if(!clinicPortalEnabled()||!clinicHostAllowed(request.headers.get('host')??request.nextUrl.host))return new NextResponse(t('Not found','Չի գտնվել','Не найдено'),{status:404});
 const url=process.env.NEXT_PUBLIC_SUPABASE_URL,key=process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
 if(!url||!key)return new NextResponse(t('Clinic access is temporarily unavailable.','Կլինիկայի հասանելիությունը ժամանակավորապես անհասանելի է։','Клиника временно недоступна.'),{status:503,headers:{'Cache-Control':'no-store'}});
 let response=NextResponse.next({request});
 const client=createServerClient<Database>(url,key,{cookieOptions:{name:'noreon-real-clinic-auth',httpOnly:true,sameSite:'lax',secure:process.env.NODE_ENV==='production',path:'/'},cookies:{getAll:()=>request.cookies.getAll(),setAll:values=>{for(const{name,value}of values)request.cookies.set(name,value);response=NextResponse.next({request});for(const{name,value,options}of values)response.cookies.set(name,value,options);}}});
 await client.auth.getUser();
 return response;
}
