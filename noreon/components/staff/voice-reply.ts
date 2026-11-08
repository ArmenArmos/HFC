/** Read the committed screen, never a record payload that may contain hidden identity fields. */
export function renderedStaffReply(root:HTMLElement|null,key:string):string{
 const reply=root&&Array.from(root.querySelectorAll<HTMLElement>('[data-message-key]')).find(node=>node.dataset.messageKey===key);
 if(!reply)return '';
 const words:string[]=[];
 const visit=(node:Node)=>{
  if(node.nodeType===Node.TEXT_NODE){if(node.textContent?.trim())words.push(node.textContent.trim());return;}
  if(!(node instanceof HTMLElement))return;
  if(node.matches('button,input,textarea,select,script,style,noscript,[hidden],[aria-hidden="true"],[data-member-identity],.member-identity,.sr-only,.visually-hidden'))return;
  const style=getComputedStyle(node);
  if(style.display==='none'||style.visibility==='hidden'||style.visibility==='collapse')return;
  for(const child of node.childNodes){
   if(node.tagName==='DETAILS'&&!node.hasAttribute('open')&&(!(child instanceof HTMLElement)||child.tagName!=='SUMMARY'))continue;
   visit(child);
  }
 };
 visit(reply);
 return words.join(' ');
}
/** Wait for the last reply to settle; never speak streaming cards or an earlier answer over a pending turn. */
export function staffConversationReply(messages:readonly {id:string;kind:string;reply?:{kind:string}}[],expectedKey?:string|null):string|null{
 const last=expectedKey?messages.find(message=>message.id===expectedKey):messages.at(-1);
 if(last?.kind==='open-chat')return last.id;
 if(!last||last.kind!=='reply'||!last.reply||last.reply.kind.startsWith('loading')||['zoe-loading','zoe-cards','building'].includes(last.reply.kind))return null;
 return last.id;
}
