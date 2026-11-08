/**
 * The Zoe statement shown at the enrolment Agree step and on the one-time Home card
 * (zoe-consent-draft-2). STAGING DRAFT WORDING: not approved; legal (P14/P16/P34) and Tatevik
 * sign it off before real members. Changing the text means a new wording version (lib/zoe/member.ts
 * ZOE_CONSENT_VERSION and zoe_settings.consent_wording_version together), which re-asks members.
 */
export const ZOE_STATEMENT={
 en:'Zoe, our AI assistant, reads your messages to help your care team. You can turn this off any time in Me, under My consents.',
 hy:'Zoe-ն՝ մեր արհեստական բանականությամբ օգնականը, կարդում է ձեր հաղորդագրությունները՝ օգնելու ձեր խնամքի թիմին։ Կարող եք ցանկացած պահի անջատել սա «Իմ էջը» բաժնում՝ «Իմ համաձայնությունները»։',
} as const;
/** Added only while zoe_settings.direct_answers_enabled is on, so the text matches what Zoe does (Fable F3). */
export const ZOE_DIRECT_ANSWERS={
 en:'Zoe can answer simple questions about visits and the app herself. Anything about your health goes to your doctor first.',
 hy:'Zoe-ն կարող է ինքը պատասխանել այցերի և հավելվածի մասին պարզ հարցերին։ Ձեր առողջությանը վերաբերող ամեն ինչ նախ գնում է ձեր բժշկին։',
} as const;
/** The statement the member reads: the base text, plus direct answers when they are on. */
export const zoeStatement=(l:'en'|'hy',directAnswers:boolean)=>directAnswers?`${ZOE_STATEMENT[l]} ${ZOE_DIRECT_ANSWERS[l]}`:ZOE_STATEMENT[l];
