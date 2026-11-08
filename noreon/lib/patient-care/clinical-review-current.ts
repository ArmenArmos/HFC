import {clinicalReviewEngine} from './clinical-review-engine';
import type {ClinicalSnapshot} from './clinical-case-repository';

/** JSONB key order is immaterial, including for comparing the editor's saved baseline. */
export function sameClinicalValue(a:unknown,b:unknown):boolean{
 const json=(value:unknown)=>JSON.stringify(value,(_key,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
 return json(a)===json(b);
}
export function currentClinicalReview(snapshot:ClinicalSnapshot,doctorId?:string):boolean{
 const review=snapshot.review;
 if(!review||review.evidenceToken!==snapshot.evidenceToken||(doctorId&&review.doctorId!==doctorId))return false;
 try{return sameClinicalValue(review.engine,clinicalReviewEngine(snapshot));}catch{return false;}
}
