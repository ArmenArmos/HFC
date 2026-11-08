import type {KeyboardEvent} from 'react';

/** Desktop Enter sends; touch keyboards and composed text retain their normal editing. */
export function submitChatOnEnter(event:KeyboardEvent<HTMLTextAreaElement>){
 if(event.key!=='Enter'||event.shiftKey||event.altKey||event.ctrlKey||event.metaKey||event.nativeEvent.isComposing||event.keyCode===229)return;
 if(!window.matchMedia('(hover: hover) and (pointer: fine)').matches)return;
 event.preventDefault();
 event.currentTarget.form?.requestSubmit();
}
