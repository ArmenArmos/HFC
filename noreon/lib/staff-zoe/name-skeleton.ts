// Search evidence only. A skeleton is never a member ID or a displayed name.
const LETTERS:Record<string,string>={
 ա:'a',բ:'b',գ:'g',դ:'d',ե:'e',զ:'z',է:'e',ը:'',թ:'t',ժ:'zh',ի:'i',լ:'l',խ:'kh',ծ:'ts',կ:'k',հ:'h',ձ:'dz',ղ:'gh',ճ:'ch',մ:'m',յ:'y',ն:'n',շ:'sh',ո:'o',չ:'ch',պ:'p',ջ:'j',ռ:'r',ս:'s',վ:'v',տ:'t',ր:'r',ց:'ts',ւ:'v',փ:'p',ք:'k',օ:'o',ֆ:'f',և:'ev',
 а:'a',б:'b',в:'v',г:'g',д:'d',е:'e',ё:'e',ж:'zh',з:'z',и:'i',й:'y',к:'k',л:'l',м:'m',н:'n',о:'o',п:'p',р:'r',с:'s',т:'t',у:'u',ф:'f',х:'h',ц:'ts',ч:'ch',ш:'sh',щ:'shch',ъ:'',ы:'y',ь:'',э:'e',ю:'yu',я:'ya',
};
// Spoken English numbers also occur in the supplied multilingual member labels.
const SPOKEN:Record<string,string>={one:'uan',two:'tu',three:'tri',four:'for',five:'fav',six:'siks'};
export const hasNameInflection=(text:string)=>/-(?:ի|ին|ից|ը)(?=\s|$|[^\p{L}])/u.test(text.normalize('NFKC').toLowerCase());
export function nameSkeleton(text:string):string{
 return text.normalize('NFKC').toLowerCase().replace(/-(?:ի|ին|ից|ը)(?=\s|$)/gu,'').replace(/[՛՜՞]/gu,'').replace(/ու/gu,'u')
  .replace(/[\p{L}\p{M}]/gu,letter=>LETTERS[letter]??letter)
  .replace(/ye/gu,'e').replace(/y(?=[bcdfghjklmnpqrstvwxz])/gu,'')
  .replace(/[^\p{L}\p{N}]+/gu,' ').trim().split(/\s+/u).map(word=>Object.hasOwn(SPOKEN,word)?SPOKEN[word]!:word).join(' ');
}
/** Inflection and one-letter mistakes offer choices; they are never exact identity evidence. */
export function nameWordMatches(query:string,name:string):boolean{
 const q=nameSkeleton(query).replace(/ (?:ի|i)$/u,''),n=nameSkeleton(name);
 if(q===n)return true;
 if(q.length<3||n.length<3)return false;
 if(q.startsWith(n)&&['i','in','a','u','e','y','om','em','oy','oi','ym','im','ami','yami','ov','ev'].includes(q.slice(n.length)))return true;
 if(n.endsWith('ya')&&['i','e','yu','ey'].some(ending=>q===n.slice(0,-2)+ending))return true;
 if(Math.abs(q.length-n.length)>1)return false;
 let i=0,j=0,edits=0;
 while(i<q.length&&j<n.length){
  if(q[i]===n[j]){i++;j++;continue;}
  if(++edits>1)return false;
  if(q.length>=n.length)i++;
  if(n.length>=q.length)j++;
 }
 return edits+Number(i<q.length||j<n.length)<=1;
}

/** Retain literal search as well as skeleton matching. Prefer exact evidence to typo suggestions. */
export function matchingNameRows<T extends {name:string|null}>(rows:T[],query:string,allowVariants=true):T[]{
 const literal=query.normalize('NFKC').toLowerCase(),tokens=nameSkeleton(query).split(' ');
 if(!tokens.some(Boolean))return [];
 const exact=hasNameInflection(query)?[]:rows.filter(row=>tokens.every(token=>nameSkeleton(row.name??'').split(' ').includes(token)));
 return exact.length||!allowVariants?exact:rows.filter(row=>(row.name??'').normalize('NFKC').toLowerCase().includes(literal)||tokens.every(token=>nameSkeleton(row.name??'').split(' ').some(word=>nameWordMatches(token,word))));
}
