import {clean,parseDate,type Extraction} from './extraction';

/**
 * Does the sheet belong to the member it was attached to? Decided in code from what the model read,
 * never by the model. The attachment itself was made by a person; this is a second check, and only
 * a clear match lets the doctor review values without first confirming the identity.
 *  - match: the name matches and the date of birth matches.
 *  - unknown: not enough on the sheet to tell, or only one of the two matches.
 *  - mismatch: the date of birth differs, or the name clearly differs with no matching date of birth.
 *  - multiple_patients: two or more different people on one sheet. No values are kept.
 */
export type IdentityStatus='match'|'unknown'|'mismatch'|'multiple_patients';
export type IdentityResult={status:IdentityStatus;detail:{nameOnSheet:string|null;birthDateOnSheet:string|null;sampleDate:string|null;patientsSeen:number;nameMatch:'yes'|'no'|'unknown';birthDateMatch:'yes'|'no'|'unknown'}};

const HY:Record<string,string>={ա:'a',բ:'b',գ:'g',դ:'d',ե:'e',զ:'z',է:'e',ը:'y',թ:'t',ժ:'zh',ի:'i',լ:'l',խ:'kh',ծ:'ts',կ:'k',հ:'h',ձ:'dz',ղ:'gh',ճ:'ch',մ:'m',յ:'y',ն:'n',շ:'sh',ո:'o',չ:'ch',պ:'p',ջ:'j',ռ:'r',ս:'s',վ:'v',տ:'t',ր:'r',ց:'ts',ւ:'v',փ:'p',ք:'k',օ:'o',ֆ:'f',և:'ev'};
const RU:Record<string,string>={а:'a',б:'b',в:'v',г:'g',д:'d',е:'e',ё:'e',ж:'zh',з:'z',и:'i',й:'y',к:'k',л:'l',м:'m',н:'n',о:'o',п:'p',р:'r',с:'s',т:'t',у:'u',ф:'f',х:'kh',ц:'ts',ч:'ch',ш:'sh',щ:'sh',ъ:'',ы:'y',ь:'',э:'e',ю:'yu',я:'ya'};
/** Latin letters only, so «Պետրոսյան», «Петросян» and «Petrosyan» compare. */
export function latinTokens(name:string):string[]{
 const s=name.normalize('NFKC').toLowerCase().replace(/ու/g,'u');
 let out='';for(const ch of s)out+=HY[ch]??RU[ch]??ch;
 return out.normalize('NFKD').replace(/[̀-ͯ]/g,'').replace(/[^a-z\s-]/g,' ').split(/[\s-]+/).filter(t=>t.length>=2)
  .map(t=>t.replace(/kh/g,'h').replace(/(yan|ian|ean)$/,'yan').replace(/y/g,'i').replace(/(.)\1+/g,'$1'));
}
function distance(a:string,b:string){
 const d=Array.from({length:b.length+1},(_,i)=>i);
 for(let i=1;i<=a.length;i++){let prev=d[0]!;d[0]=i;for(let j=1;j<=b.length;j++){const t=d[j]!;d[j]=Math.min(d[j]!+1,d[j-1]!+1,prev+(a[i-1]===b[j-1]?0:1));prev=t;}}
 return d[b.length]!;
}
const sameToken=(a:string,b:string)=>a===b||(Math.min(a.length,b.length)>=5&&distance(a,b)<=(Math.min(a.length,b.length)>=8?2:1));
/** yes: every token of the shorter name is in the other, and at least two tokens agree (or both are single). */
export function namesMatch(a:string|null|undefined,b:string|null|undefined):'yes'|'no'|'unknown'{
 const x=latinTokens(a??''),y=latinTokens(b??'');
 if(!x.length||!y.length)return 'unknown';
 const [short,long]=x.length<=y.length?[x,y]:[y,x];
 const hits=short.filter(t=>long.some(u=>sameToken(t,u))).length;
 if(hits===short.length&&(hits>=2||long.length===1))return 'yes';
 return hits===0?'no':'unknown';
}

/** "PETROSYAN A." or "Petrosyan" as a short form of "Armen Petrosyan": a surname plus at most an initial. */
function shortForm(short:string,full:string):boolean{
 const raw=short.normalize('NFKC').replace(/[.,]/g,' ').split(/\s+/).filter(Boolean);
 const initials=raw.filter(t=>[...t].length===1).map(t=>latinTokens(t+t)[0]?.[0]).filter(Boolean);
 const s=latinTokens(short),f=latinTokens(full);
 if(s.length!==1||raw.length-initials.length!==1||initials.length>1||f.length<2)return false;
 const surname=f.find(t=>sameToken(t,s[0]!));
 if(!surname)return false;
 return !initials.length||f.some(t=>t!==surname&&t[0]===initials[0]);
}
export function checkIdentity(e:Extraction,member:{name:string;birthDate:string|null}):IdentityResult{
 const people=e.patients.map(p=>({name:clean(p.name,120),birthDate:parseDate(p.birthDate)})).filter(p=>p.name||p.birthDate);
 // The same person printed twice (header and footer, "PETROSYAN A." and "Armen Petrosyan") is one.
 const distinct:(typeof people[number]&{nameConflict?:boolean})[]=[];
 for(const p of people){
  // Same person: an equal date of birth (names not contradicting), a full name match, a surname with or without
  // an initial that fits the other name (a footer such as "PETROSYAN A."), or a nameless date-of-birth entry
  // beside a named one without a date (Fable F2, R2). Two full names sharing only a surname stay two people.
  const same=distinct.find(q=>p.birthDate&&q.birthDate?p.birthDate===q.birthDate&&(!p.name||!q.name||namesMatch(p.name,q.name)!=='no')
   :(!!p.name&&!!q.name&&(namesMatch(p.name,q.name)==='yes'||shortForm(p.name,q.name)||shortForm(q.name,p.name)))
    ||(!p.name&&!q.birthDate&&!!q.name)||(!q.name&&!p.birthDate&&!!p.name));
  // Keep what each entry adds: a merged footer or date-of-birth-only line must not drop the date (Opus N1).
  // The fuller form names the person, but only when it is the same name: a header "AVETISYAN T." and a footer "Tatevik
  // Avetisyan" compare by the full name (eval 19 Oct). "PETROSYAN K." beside "Armen Petrosyan" keeps the short form, so it
  // can never become a match (review #307 F1).
  // Two names merged on the date of birth alone that do not agree ("Armen Petrosyan" and "PETROSYAN K.", either order)
  // stay one entry, so the values are kept for the doctor, but the name can then never count as a match.
  if(!same)distinct.push({...p});
  else{
   const agree=!!p.name&&!!same.name&&(namesMatch(p.name,same.name)==='yes'||shortForm(same.name,p.name)||shortForm(p.name,same.name));
   if(p.name&&same.name&&!agree)same.nameConflict=true;
   const fuller=agree&&latinTokens(p.name!).length>latinTokens(same.name!).length;
   if(!same.name||fuller)same.name=p.name;same.birthDate??=p.birthDate;
  }
 }
 const first=distinct[0]??{name:null,birthDate:null};
 const raw=namesMatch(first.name,member.name),nameMatch=('nameConflict'in first&&first.nameConflict&&raw==='yes')?'unknown':raw;
 const birthDateMatch=!first.birthDate||!member.birthDate?'unknown':first.birthDate===member.birthDate?'yes':'no';
 const detail={nameOnSheet:first.name,birthDateOnSheet:first.birthDate,sampleDate:parseDate(e.sampleDate),patientsSeen:distinct.length,nameMatch,birthDateMatch}as const;
 if(distinct.length>1)return {status:'multiple_patients',detail};
 if(birthDateMatch==='no'||(nameMatch==='no'&&birthDateMatch!=='yes'))return {status:'mismatch',detail};
 if(nameMatch==='yes'&&birthDateMatch==='yes')return {status:'match',detail};
 return {status:'unknown',detail};
}
