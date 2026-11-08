/** Pure recognition of existing conversation warnings. Shared with the screen; no model dependencies. */
const SAME_DAY=/needs a doctor today|doctor (?:should|must|needs to) (?:see|assess|look at) (?:this|it|you) today|see a doctor today|today, within|within the next 2|2 to 4 hours|2-4 ժամ|2–4 ժամ|բժշկի գնահատում այսօր|պետք է (?:տեսնի|գնահատի) այսօր|բժիշկը պետք է տեսնի այսօր|այսօր՝ առաջիկա|нужно показать врачу сегодня|врачу сегодня|сегодня, в ближайшие|в ближайшие 2/iu;
const TODAY=/\btoday\b|\bsame.day\b|այսօր|aysor|сегодня/iu;
const REFERRAL=new RegExp([
 /ready for (?:your|the) doctor|(?:see|contact|call|speak to|talk to|check with|visit|reach)(?![\p{L}])[^.։!?\n]{0,50}\b(?:doctor|clinician|physician|urgent care)\b/u.source,
 /(?:doctor|clinician|physician)[^.։!?\n]{0,20}(?:should|must|needs? to|will|can) (?:see|assess|review|check)|(?:after|until)[^.։!?\n]{0,30}doctor has seen|medical (?:assessment|review|attention)/u.source,
 /(?:դիմ\p{L}*|կապվ\p{L}*|այցել\p{L}*|գնա\p{L}*)[^.։!?\n]{0,40}բժշկ|բժշկ[^.։!?\n]{0,40}(?:դիմ\p{L}*|կապվ\p{L}*|այցել\p{L}*|գնա\p{L}*|գնահատ\p{L}*)|(?:dim\w*|kapv\w*|aycel\w*|gnal|gnaq)[^.։!?\n]{0,40}bzhshk/u.source,
 /(?:обратитесь|обратиться|свяжитесь|связаться|покажите|показать|посетите|посетить|осмотр(?:а|у|ом|е)?|поговорите|поговорить)(?![\p{L}])[^.։!?\n]{0,40}(?:врач|доктор)|(?:врач|доктор)[^.։!?\n]{0,40}(?:осмотрит|оценит|посмотрит)/u.source,
].join('|'),'iu');
const NO_REFERRAL=/no need|do not need|don't need|needn't|not necessary|(?:do not|don't|should not|shouldn't|must not|mustn't|never) (?:see|contact|call|speak to|talk to|check with|visit|reach)|չկա կարիք|կարիք չկա|պետք չէ|մի (?:դիմեք|այցելեք|գնացեք)|(?:դիմել|այցելել) եք|գնահատել է|не нужно|не надо|не требуется|не (?:обращайтесь|связывайтесь|посещайте|звоните)/iu;
/** Match affirmative referral and timing in the same clause, in either order. */
export const hasSameDayWarning=(text:string)=>text.split(/(?<=[.!?։])\s+|\n+|\bbut\b|բայց|(?<![\p{L}])но(?![\p{L}])/iu).some(s=>!NO_REFERRAL.test(s)&&(SAME_DAY.test(s)||TODAY.test(s)&&REFERRAL.test(s)));

export const SIGN_103=/(?<![\d/.])103(?![\d/]|\.\d)/u;
export const FORWARD_LINE=/I've also passed this to|Սա փոխանցեցի նաև|Я также передала это/u;

/** Routine task controls need a clinical warning, not bare timing words. A warning stays unresolved until a doctor replies. */
export const hasOpenTaskWarning=(w:{answers:readonly {body:string;minutesAgo:number}[];replies:readonly {minutesAgo:number}[]})=>{
 const lastDoctor=Math.min(Infinity,...w.replies.map(r=>r.minutesAgo));
 return w.answers.some(a=>a.minutesAgo<lastDoctor&&(hasSameDayWarning(a.body)||SIGN_103.test(a.body)
  ||/emergency|շտապ|скорую|неотложн/iu.test(a.body)||FORWARD_LINE.test(a.body)));
};
