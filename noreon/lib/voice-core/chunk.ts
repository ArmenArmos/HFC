/**
 * Spoken reply chunking, shared by the browser player and the streaming speech route. Prefer whole sentences around 160
 * characters; long sentences have a hard 200-character cap. A decimal point between digits is not a sentence end.
 */
export function splitConversationSpeech(text:string):string[]{
 const sentences:string[]=[];let start=0;
 for(const match of text.matchAll(/[.!?։;:\n]+["'»”’)]*/g)){
  const at=match.index;
  if(match[0]==='.'&&/\d/.test(text[at-1]??'')&&/\d/.test(text[at+1]??''))continue;
  sentences.push(text.slice(start,at+match[0].length).trim());start=at+match[0].length;
 }
 sentences.push(text.slice(start).trim());
 const chunks:string[]=[];let chunk='';
 const append=(part:string)=>{
  if(chunk&&chunk.length+1+part.length>160){chunks.push(chunk);chunk='';}
  chunk=chunk?`${chunk} ${part}`:part;
 };
 for(let sentence of sentences){
  while(sentence.length>200){
   const space=sentence.lastIndexOf(' ',200),end=space>0?space:200;
   append(sentence.slice(0,end));sentence=sentence.slice(end).trim();
  }
  if(sentence)append(sentence);
 }
 if(chunk)chunks.push(chunk);
 return chunks;
}
