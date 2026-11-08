import{BackofficeSignInPage}from'@/components/backoffice/sign-in-page';
import{clinicLocale}from'@/lib/clinic-portal/locale';
export default async function ClinicLoginPage({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}){
 const query=await searchParams,locale=await clinicLocale(query.locale);
 return <BackofficeSignInPage searchParams={Promise.resolve({...query,locale})} path="/clinic/real/login"/>;
}
