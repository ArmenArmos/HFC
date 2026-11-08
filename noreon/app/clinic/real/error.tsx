'use client';
import {useSearchParams} from 'next/navigation';
import {parseLocale,pick} from '@/lib/locale';
import { ReportError } from '@/components/report-error';
import {useClinicLocale} from '@/components/clinic-portal/locale-provider';
export default function ClinicError({error,reset}:{error?:unknown;reset:()=>void}){const locale=parseLocale(useSearchParams().get('locale'),useClinicLocale()),t=(en:string,hy:string,ru:string)=>pick(locale,{en,hy,ru});return <main lang={locale} className="mx-auto max-w-xl space-y-4 px-5 py-12"><ReportError error={error}/><h1 className="text-h1">{t('Clinic access is unavailable','Կլինիկայի հասանելիությունն անհասանելի է','Клиника временно недоступна')}</h1><p role="alert" className="text-body2">{t('Your saved work has not changed. Try again later.','Պահպանված աշխատանքը չի փոխվել։ Փորձեք ավելի ուշ։','Сохранённые данные не изменились. Попробуйте позже.')}</p><button onClick={reset} className="min-h-12 rounded-md border px-4 text-body2">{t('Try again','Փորձել կրկին','Попробовать снова')}</button></main>;}
