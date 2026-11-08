import type {Metadata} from 'next';
import type {ReactNode} from 'react';
import {clinicLocale} from '@/lib/clinic-portal/locale';
import {ClinicLocaleProvider} from '@/components/clinic-portal/locale-provider';

// The private clinic workspace uses the brand name in every language.
// Do not inherit the public site's English marketing title and description.
export const metadata:Metadata={title:{absolute:'Noreon'},description:null};
export default async function ClinicLayout({children}:{children:ReactNode}){return <ClinicLocaleProvider locale={await clinicLocale()}>{children}</ClinicLocaleProvider>;}
