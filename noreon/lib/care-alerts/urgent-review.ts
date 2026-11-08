import {fieldById} from '@/lib/clinical/seed/questions';
import type {Answers,AssessmentField,FieldValue,Rule} from '@/lib/clinical/types';

type Env=Record<string,string|undefined>;
/**
 * "I answered this by mistake" (QA M-01, lead decision 17 Oct). Off by default until the
 * clinical team (Armen) decides whether a member may undo a red-flag answer. Even when on, it
 * only opens while care-team alerts are on, because every change still alerts the care team.
 */
export const urgentAnswerReviewEnabled=(env:Env=process.env)=>env.NOREON_URGENT_ANSWER_REVIEW_ENABLED==='true';

export type ReviewableAnswer={field:AssessmentField&{options:NonNullable<AssessmentField['options']>};value:FieldValue|undefined};
/**
 * The one answer that fired this red flag, when it is a single-choice questionnaire answer the
 * member can look at again. Episode clarifiers, measurements and multi-part answers are not
 * reviewable here: the member uses 103 or Help instead.
 */
export function reviewableAnswer(rule:Pick<Rule,'evaluate'|'urgency'>,answers:Answers):ReviewableAnswer|null{
 if(rule.urgency!=='red')return null;
 const id=rule.evaluate({answers,observations:[]})?.triggeredBy;
 const field=id?fieldById(id):undefined;
 if(!field||field.id!==id||field.kind!=='single'||!field.options?.length)return null;
 return {field:field as ReviewableAnswer['field'],value:answers[id]?.value};
}
