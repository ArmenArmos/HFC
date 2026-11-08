import Link from 'next/link';
import type {Route} from 'next';

/** A clinic address that does not exist (reports, exports, settings and other guesses) keeps the clinic look and leads back to the
 * chat, instead of the marketing site's 404. The locale is not known here, so the three languages are shown together. */
export default function ClinicPageNotFound(){
 const lines:[string,string,string][]=[
  ['en','This page does not exist in the clinic portal. Ask the clinic assistant for bookings, members or upload status.','Open the clinic chat'],
  ['hy','Այս էջը կլինիկայի պորտալում չկա։ Այցերի, անդամների կամ վերբեռնումների վիճակի մասին հարցրեք կլինիկայի օգնականին։','Բացել կլինիկայի զրույցը'],
  ['ru','Такой страницы в портале клиники нет. Спросите помощника клиники о записях, участниках или статусе загрузок.','Открыть чат клиники'],
 ];
 return <main className="mx-auto max-w-xl space-y-6 p-6">
  <h1 className="text-h1">Page not found · Էջը չի գտնվել · Страница не найдена</h1>
  {lines.map(([lang,text,action])=><section key={lang} lang={lang} className="space-y-2"><p className="text-body2">{text}</p>
   <Link href={`/clinic/real/chat?locale=${lang}` as Route} className="inline-flex min-h-11 items-center rounded-md bg-primary px-4 py-2 text-body2 font-medium text-primary-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">{action}</Link></section>)}
 </main>;
}
