/**
 * Pattern redaction before any provider call (ZOE_DESIGN §4.2, G4). Best effort and honestly
 * described: the text sent is pseudonymised, not identifier-free. Pure; the member's own name
 * tokens come from the profile server-side and are never sent themselves.
 */
export const REDACTION_VERSION='zoe-redact-1';
export const REDACTED='[redacted]';
export type RedactionCategory='email'|'url'|'handle'|'phone'|'document_number'|'own_name'|'street_address';
export type Redaction={text:string;count:number;categories:RedactionCategory[]};

const RULES:[RedactionCategory,RegExp][]=[
 ['email',/[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+\.[\p{L}]{2,}/gu],
 ['url',/\b(?:https?:\/\/|www\.)[^\s<>"']+|\b[a-z0-9-]+\.(?:com|am|ru|org|net|io|me|info)(?:\/[^\s<>"']*)?/giu],
 ['handle',/(?<![\p{L}\p{N}])@[a-z0-9_]{4,32}\b/giu],
 // Passport-like (two letters and seven digits) before generic digit runs.
 ['document_number',/\b[A-Z]{2}\s?\d{7}\b/g],
 // Seven or more digits with optional spaces, dashes, dots or brackets: phones, cards, national IDs.
 // A blood pressure reading (150/95) never matches because "/" is not a separator here.
 ['phone',/(?<![\p{N}/])\+?\(?\d(?:[\s\-.()]{0,2}\d){6,18}(?![\p{N}/])/gu],
 ['street_address',/(?:\b\d{1,4}[\s,]+)?[\p{L}-]{2,}\s+(?:street|st\.|avenue|ave\.|road|rd\.)(?:[\s,]+\d{1,4}\w?)?|[\p{L}-]{2,}\s+(?:փողոց|փող\.|պողոտա|պող\.)(?:[\s,]+\d{1,4})?|\bբն\.?\s*\d{1,4}|(?:улица|ул\.|проспект|пр\.)\s+[\p{L}-]{2,}(?:[\s,]+\d{1,4})?/giu],
];

const escape=(s:string)=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');

/** Redacts pattern identifiers and exact matches of the member's own name tokens. */
export function redactText(input:string,own:{nameTokens?:readonly string[]}={}):Redaction{
 let text=input,count=0;const categories=new Set<RedactionCategory>();
 const apply=(category:RedactionCategory,re:RegExp)=>{text=text.replace(re,m=>{
  // Keep the emergency number readable: 103 alone is never an identifier.
  if(category==='phone'&&m.replace(/\D/g,'')==='103')return m;
  count++;categories.add(category);return REDACTED;});};
 for(const [category,re] of RULES)apply(category,re);
 const names=[...new Set((own.nameTokens??[]).map(t=>t.trim()).filter(t=>t.length>=2))];
 if(names.length)apply('own_name',new RegExp(`(?<![\\p{L}\\p{N}])(?:${names.map(escape).join('|')})(?![\\p{L}\\p{N}])`,'giu'));
 return {text,count,categories:[...categories].sort()};
}

/** Name tokens of the member's own display name, for server-side redaction only. */
export const nameTokens=(displayName:string|null|undefined)=>(displayName??'').split(/[\s,.]+/u).filter(t=>t.length>=2);
