'use client';
import{useActionState,useEffect,useRef,useState}from'react';
import HCaptcha from'@hcaptcha/react-hcaptcha';
import{backofficeSignIn}from'@/lib/backoffice/actions';
import{pick,type Locale}from'@/lib/locale';
/** The one staff and clinic sign-in form; the server decides where the account belongs. */
export function BackofficeSignIn({locale,siteKey,next=''}:{locale:Locale;siteKey:string;next?:string}){
 const[captcha,setCaptcha]=useState(''),widget=useRef<HCaptcha>(null),t=(en:string,hy:string,ru:string)=>pick(locale,{en,hy,ru});const[state,action,pending]=useActionState(async(previous:{ok:boolean;message:string},form:FormData)=>{const result=await backofficeSignIn(previous,form);setCaptcha('');widget.current?.resetCaptcha();return result;},{ok:false,message:''});
 // QA 188: a failed attempt keeps the email (controlled, so the form reset leaves it; never in the
 // URL), clears only the password and puts focus there.
 const[email,setEmail]=useState(''),password=useRef<HTMLInputElement>(null);
 useEffect(()=>{if(state.ok||!state.message||!password.current)return;password.current.value='';password.current.focus();},[state]);
 return <form action={action} className="space-y-4"><input type="hidden" name="next" value={next}/><input type="hidden" name="locale" value={locale}/><label className="block text-body2">{t("Email","Էլ․ հասցե","Электронная почта")}<input name="email" type="email" autoComplete="username" required maxLength={320} value={email} onChange={event=>setEmail(event.target.value)} className="mt-1 min-h-12 w-full rounded-md border bg-background px-3"/></label><label className="block text-body2">{t("Password","Գաղտնաբառ","Пароль")}<input ref={password} name="password" type="password" autoComplete="current-password" required maxLength={1024} className="mt-1 min-h-12 w-full rounded-md border bg-background px-3"/></label>{siteKey&&<HCaptcha ref={widget} sitekey={siteKey} onVerify={setCaptcha} onExpire={()=>setCaptcha('')} onError={()=>setCaptcha('')}/>}<input type="hidden" name="captchaToken" value={captcha}/><button disabled={pending||!!siteKey&&!captcha} className="min-h-12 rounded-md bg-primary px-5 text-body2 text-primary-foreground disabled:opacity-50">{pending?(t("Signing in…","Մուտք է կատարվում…","Вход…")):(t("Sign in","Մուտք գործել","Войти"))}</button>{state.message&&<p role="alert" className="text-body2">{locale==='ru'?({
 'Check your sign-in details.':'Проверьте данные для входа.',
 'Complete the sign-in verification.':'Пройдите проверку для входа.',
 'Too many sign-in attempts. Wait 15 minutes and try again.':'Слишком много попыток входа. Подождите 15 минут и попробуйте снова.',
 'Sign-in could not be completed. Try again later.':'Не удалось завершить вход. Попробуйте позже.',
 'Sign-in was unsuccessful. Check your details or contact your administrator.':'Войти не удалось. Проверьте данные или обратитесь к администратору.',
 'Telegram is not set up for your account yet. Contact your administrator.':'Telegram ещё не настроен для вашей учётной записи. Обратитесь к администратору.',
 'An active staff or clinic account is required.':'Нужна активная учётная запись сотрудника или клиники.',
 }[state.message]??'Не удалось завершить вход. Попробуйте позже.'):state.message}</p>}</form>;
}
