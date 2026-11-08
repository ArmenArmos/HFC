/** Plain words for actions the buttons already do. A match only opens the same flow the button opens (the visit flow, the task note
 * composer) so the confirm step is the button's: nothing is saved by the words alone. Whole-message phrases, en/ru/hy, no model. */
export type ActionIntent=
 |{kind:'start-visit';name:string|null;next?:boolean}
 |{kind:'complete-task';which:'first'|null;note:string|null};

const clean=(raw:string)=>raw.normalize('NFKC').replace(/[’`]/gu,"'").replace(/[՛՜՞]/gu,'').replace(/\s+/gu,' ').trim();
const NAME='([\\p{L}][\\p{L}\'-]*(?: [\\p{L}][\\p{L}\'-]*){0,2})';
const START_VISIT:RegExp[]=[
 new RegExp(`^${NAME}'s visit$`,'iu'),
 new RegExp(`^(?:визит (?:для|у) |այցը )${NAME}$`,'iu'),
 new RegExp(`^(?:please )?(?:start|begin|open|resume)(?: the| my)? visit(?: (?:for|with) ${NAME})?$`,'iu'),
 // Russian and Armenian in one rule: "начни визит для X", "սկսել այցը X-ի համար".
 new RegExp(`^(?:пожалуйста )?(?:(?:начать|начни|начните|открой|открыть)(?: мой| этот)? визит(?: (?:для|у|с) ${NAME})?|(?:սկսել|սկսիր|բացել|բացիր) այցը(?: ${NAME}(?:-ի համար)?)?)$`,'iu'),
];
const NOTE_EN=/[,;:]?\s*(?:with )?note\s*[:,-]?\s*(.+)$/iu;
const NOTE_RU=/[,;:]?\s*(?:с )?(?:заметк\S*|комментари\S*)\s*[:,-]?\s*(.+)$/iu;
const NOTE_HY=/[,;:]?\s*(?:նշում\S*)\s*[:,-]?\s*(.+)$/iu;
const COMPLETE:{head:RegExp;note:RegExp}[]=[
 {head:/^(?:please )?(?:mark|set|close|finish)(?: the| my)?(?: (first|next))? task(?: as)?(?: (?:done|complete|completed|finished))?$/iu,note:NOTE_EN},
 {head:/^(?:пожалуйста )?(?:отметь|закрой|заверши)(?: (первую|следующую))? задачу(?: как)?(?: (?:выполненн\S*|готов\S*|сделанн\S*))?$/iu,note:NOTE_RU},
 {head:/^(?:փակիր|փակել|նշիր)(?: (առաջին))? առաջադրանքը(?: (?:կատարված|ավարտված))?$/iu,note:NOTE_HY},
];

export function actionIntent(raw:unknown):ActionIntent|null{
 if(typeof raw!=='string'||raw.length>300||/[\u0000-\u001f\u007f]/u.test(raw))return null;
 const text=clean(raw).replace(/[?!.։]+$/u,'');
 if(!text)return null;
 if(/^(?:what(?:'s| is) next|что дальше|ինչն է հաջորդը|հաջորդը ինչ)$/iu.test(text))return {kind:'start-visit',name:null,next:true};
 for(const pattern of START_VISIT){const m=pattern.exec(text);if(m)return {kind:'start-visit',name:m[1]?.trim()??null};}
 for(const {head,note} of COMPLETE){
  // The note is whatever follows "note"/"заметка"/"նշում"; everything before it must be the command itself.
  const n=note.exec(text);
  const lead=n?text.slice(0,n.index).trim():text;
  const m=head.exec(lead);
  if(m){const body=n?.[1]?.trim()??'';return {kind:'complete-task',which:m[1]?'first':null,note:body.length>0&&body.length<=1500?body:null};}
 }
 return null;
}

/** Words that act on the open member (Zoe mode only): they open the same composers the Notes and Hand over buttons open, with the text
 * prefilled. Her own send is still the confirm step. */
export type MemberActionIntent={kind:'care-note';text:string}|{kind:'hand-over';note:string|null};
const CARE_NOTE:RegExp=new RegExp(`^(?:please )?(?:(?:add|write|save|record|put)(?: a| the)?(?: care)? note(?: for (?:her|him|them|this member))?|(?:добавь|запиши|сохрани) заметку(?: об уходе)?|(?:ավելացրու|գրիր) նշում)\\s*[:,-]\\s*(.+)$`,'iu');
const HAND_OVER:RegExp=new RegExp(`^(?:please )?(?:(?:hand(?: this)? over|hand-over|send|escalate|pass)(?: this| it| the case)? to (?:the )?doctor|(?:передай|передать|отправь)(?: это| случай)? врачу|(?:փոխանցիր|փոխանցել) բժշկին)(?:\\s*[:,-]\\s*(.+))?$`,'iu');
export function memberActionIntent(raw:unknown):MemberActionIntent|null{
 if(typeof raw!=='string'||raw.length>2100||/[\u0000-\u001f\u007f]/u.test(raw))return null;
 const text=clean(raw);
 const note=CARE_NOTE.exec(text);
 if(note){const body=note[1]!.trim();if(body.length>0&&body.length<=1500)return {kind:'care-note',text:body};}
 const hand=HAND_OVER.exec(text);
 if(hand){const body=hand[1]?.trim()??'';return {kind:'hand-over',note:body.length>0&&body.length<=2000?body:null};}
 return null;
}
