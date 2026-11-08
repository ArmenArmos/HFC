'use client';
import {createContext,useContext,type ReactNode} from 'react';
import type {Locale} from '@/lib/locale';

const ClinicLocaleContext=createContext<Locale>('en');

/** The layout passes the httpOnly preference to client fallback screens. */
export function ClinicLocaleProvider({locale,children}:{locale:Locale;children:ReactNode}){
 return <ClinicLocaleContext.Provider value={locale}>{children}</ClinicLocaleContext.Provider>;
}

export function useClinicLocale(){return useContext(ClinicLocaleContext);}
