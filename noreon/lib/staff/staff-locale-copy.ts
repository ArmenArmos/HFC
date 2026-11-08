import type{Locale}from'@/lib/locale';
export type StaffLocale=Locale;
export const st=(locale:StaffLocale,en:string,hy:string,ru:string)=>locale==='hy'?hy:locale==='ru'?ru:en;
