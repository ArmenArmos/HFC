"use client";

/** A display-only strip shared by member and staff composers. The parent owns the normal send path. */
export function ChatSuggestions({suggestions,hidden=false,label,onSend}: {
 suggestions:readonly {id:string;text:string}[];hidden?:boolean;label:string;onSend:(text:string)=>void;
}) {
 if(!suggestions.length)return null;
 return <div data-chat-suggestions role="group" aria-label={label} aria-hidden={hidden||undefined}
   className={`flex gap-2 overflow-x-auto pe-6 [mask-image:linear-gradient(to_right,black_calc(100%-1.5rem),transparent)] ${hidden?'invisible':''}`}>
  {suggestions.slice(0,3).map(s=><button key={s.id} type="button" tabIndex={hidden?-1:0}
    className="min-h-11 shrink-0 whitespace-nowrap rounded-full border border-border bg-background px-3 text-body2 text-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
    onPointerDown={e=>e.preventDefault()} onMouseDown={e=>e.preventDefault()}
    onClick={()=>onSend(s.text)}>{s.text}</button>)}
 </div>;
}
