'use client';
import {createContext,useMemo,useState,type ReactNode} from 'react';

/** Publishing changes the revision the page keys the review controls on, so a message kept inside them is lost as it appears (QA a4-01). */
export type Published={message:string;revision:number};
export const PublishConfirmation=createContext<{published:Published|null;set:(published:Published|null)=>void}>({published:null,set:()=>{}});
export function PublishConfirmationProvider({children}:{children:ReactNode}){
 const [published,set]=useState<Published|null>(null);
 const value=useMemo(()=>({published,set}),[published]);
 return <PublishConfirmation.Provider value={value}>{children}</PublishConfirmation.Provider>;
}
