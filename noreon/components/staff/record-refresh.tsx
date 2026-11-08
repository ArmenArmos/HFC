'use client';
import {createContext,useContext} from 'react';
import {useRouter} from 'next/navigation';

/** Mutations are saved by default; read-only refreshes pass saved=false. */
type RefreshRecord=(preserveState?:boolean,saved?:boolean)=>void;
const RecordRefresh=createContext<RefreshRecord|null>(null);
export const RecordRefreshProvider=RecordRefresh.Provider;

/** Pages refresh their route. Chat cards distinguish saved changes from reads and PDF-open audits. */
export function useRecordRefresh():RefreshRecord{
 const router=useRouter();
 return useContext(RecordRefresh)??router.refresh;
}
