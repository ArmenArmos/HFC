import{staffNoticeReturnPath}from'@/lib/staff-zoe/notice-link';
import{notFound,redirect}from'next/navigation';
import type{Route}from'next';
import{captchaSiteKey}from'@/lib/captcha';
import{backofficePortals,signedInDestination}from'@/lib/backoffice/signin';
import{BackofficeSignIn}from'@/components/backoffice/sign-in';
import{SigninLanguageLinks}from'@/components/real-review/signin-language';
import{parseLocale,pick}from'@/lib/locale';
type Params=Record<string,string|string[]|undefined>;
/** One sign-in page for staff and clinic accounts, served at the backoffice root (Khikar, 17 Oct). */
export async function BackofficeSignInPage({searchParams,path='/staff/real/login'}:{searchParams:Promise<Params>;path?:string}){
 const portals=await backofficePortals();
 if(!portals.staff&&!portals.clinic)notFound();
 const params=await searchParams,locale=parseLocale(params.locale,'en'),hy=locale==='hy',t=(en:string,hy:string,ru:string)=>pick(locale,{en,hy,ru});
 const next=staffNoticeReturnPath(params.next);
 const destination=await signedInDestination(hy);
 if(destination?.startsWith('/staff/real/')&&next)redirect(next as Route);
 if(destination){
  if(locale==='ru'){const [pathname,search='']=destination.split('?');const query=new URLSearchParams(search);query.set('locale','ru');redirect(`${pathname}?${query}` as Route);}
  redirect(destination as Route);
 }
 const reset=params['password-reset']==='complete'||params.reset==='1',invited=params.invited==='1';
 return <main lang={locale} className="mx-auto max-w-md space-y-6 px-5 py-12"><SigninLanguageLinks path={path} locale={locale} extra={[reset?'password-reset=complete':invited?'invited=1':'',next?new URLSearchParams({next}).toString():''].filter(Boolean).join('&')}/><p className="text-h2 font-semibold">Noreon</p><h1 className="text-h1">{t("Staff and clinic sign in","Աշխատակցի և կլինիկայի մուտք","Вход для сотрудников и клиник")}</h1><p className="text-body2">{t("Use your assigned Noreon or clinic account.","Մուտք գործեք Noreon-ի կամ կլինիկայի տրամադրված հաշվով։","Используйте выданную вам учётную запись Noreon или клиники.")}</p>{reset&&<p role="status" className="rounded-md border p-4 text-body2">{t("Your password is changed. Sign in with your new password.","Գաղտնաբառը փոխված է։ Մուտք գործեք նոր գաղտնաբառով։","Пароль изменён. Войдите с новым паролем.")}</p>}{invited&&<p role="status" className="rounded-md border p-4 text-body2">{t("Your account is ready. Sign in with your email and new password.","Ձեր հաշիվը պատրաստ է։ Մուտք գործեք ձեր էլ. հասցեով և նոր գաղտնաբառով։","Ваша учётная запись готова. Войдите с электронной почтой и новым паролем.")}</p>}<BackofficeSignIn locale={locale} siteKey={captchaSiteKey()} next={next??''}/><p className="text-caption text-muted-foreground">{t("For an invitation or password recovery, contact your administrator.","Հրավերի կամ գաղտնաբառի վերականգնման համար կապվեք ադմինիստրատորի հետ։","Для приглашения или восстановления пароля обратитесь к администратору.")}</p></main>;
}
