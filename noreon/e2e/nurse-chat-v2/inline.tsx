import type {ReactNode} from 'react';
// The real answer component uses inline mode. A link would violate the chat contract.
export default function Link({children}:{children:ReactNode}){throw Error(`Unexpected link in nurse fixture: ${String(children)}`);}
export const stamp=(value:string)=>value.slice(0,10);
