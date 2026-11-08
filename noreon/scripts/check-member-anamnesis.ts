/** Actual MemberChat/Anamnesis/useQuestionnaire consent and emergency integration.
 * Rendering/action/router boundaries are mocked. This is not browser verification. */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import vm from "node:vm";
import ts from "typescript";
import * as React from "react";
import * as jsx from "react/jsx-runtime";
import type { ReactTestRenderer } from "react-test-renderer";
import type { AssessmentDraft } from "../lib/patient/types";
import type { FieldValue } from "../lib/clinical/types";
import type { MemberChat } from "../components/chat-v2/member-chat";
import type { ZoeThread } from "../lib/zoe/app-chat-contracts";
import type { QuestionField } from "../components/patient/question-field";
import type { Button } from "../components/ui/button";
import {cardSchema,type ZoeCards} from '../lib/zoe-chat-actions/registry';
import {chatNextStep} from '../lib/zoe-chat-actions/next-step';
import {STAGE_CLASSES} from '../lib/patient/journey-stage';
const nodeRequire=createRequire(import.meta.url);
const {create,act}=nodeRequire("react-test-renderer") as typeof import("react-test-renderer");
(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
type Entry={fieldId:string;value:FieldValue|null};
type Result={ok:true;revision:number}|{ok:false;reason:string};
let completionCalls=0, failures=0, attempts=0, effectiveSaves=0;
let visibleCards:ZoeCards={enabled:false,cards:[],clearedSeq:null};
let persisted!:AssessmentDraft;
let hold:Promise<void>|undefined;
let shown:{requestId:string;text:string;state:'sending'}[]=[];
const destinations:string[]=[];
const router={replace:(path:string)=>destinations.push(path),push:(path:string)=>destinations.push(path),refresh() {}};
async function save(revision:number,entries:Entry[]):Promise<Result> {
  attempts++;
  if(hold) await hold;
  if(failures>0) { failures--; return {ok:false,reason:"unavailable"}; }
  assert.equal(revision,persisted.revision,"Save queue must use the latest persisted revision");
  persisted={...persisted,answers:mergeAnswers(persisted.answers,entries),revision:revision+1};
  effectiveSaves++;
  return {ok:true,revision:persisted.revision};
}
const modules = new Map<string, Record<string, unknown>>();
function load<T>(path: string): T {
  const absolute = resolve(path);
  const cached = modules.get(absolute);
  if (cached) return cached as T;
  const exports: Record<string, unknown> = {};
  modules.set(absolute, exports);
  const code = ts.transpileModule(readFileSync(absolute, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  new vm.Script(code, { filename: absolute }).runInNewContext({
    exports, Date, Intl, URL, URLSearchParams, Event, performance, setTimeout, clearTimeout,
    process: { env: { NEXT_PUBLIC_PATIENT_DEMO: "false" } },
    window: { innerHeight: 812, addEventListener() {}, removeEventListener() {}, location: { href: "https://test.invalid/patient/questions", origin: "https://test.invalid", reload() {} } },
    document: { addEventListener() {}, removeEventListener() {} },
    requestAnimationFrame: (callback: () => void) => setTimeout(callback, 0),
    cancelAnimationFrame: clearTimeout,
    require(name: string): unknown {
      if (name === "zod") return nodeRequire(name);
      if (name === "lucide-react") return {Phone:()=>null,ArrowUp:()=>null};
      if (name === "@/components/patient/use-zoe-thread") return {useZoeThread:()=>({items:[],cards:visibleCards,setCards(){},focusCard:null,opening:null,openCard(){},localEmergencies:{},thread:{messages:[]},emergencies:{},shown,input:React.useRef(null),text:"",setText(){},notice:null,setNotice(){},submit(){},deliver(){}})};
      if (name === "@/components/patient/use-chat-viewport") return {useChatViewport(){}};
      if (name === "./use-thread-scroll") return {useThreadScroll:()=>({threadRef:React.useRef(null),contentRef:React.useRef(null),unread:false,newest(){},isFollowing:()=>true})};
      if (name === "./reading-card") return {ReadingCard:()=>null,SavedReading:()=>null};
      if (name === "./bp-flow-cards") return {ContextStripView:()=>null,FlagsTurn:()=>null,RedFlagCard:()=>null};
      if(name==='./next-step-card')return {NextStepCard:()=>null,NextStepTurn:()=>null,ReviewCard:()=>null};
      if(name==='./results-message-card'){const record=({card}:{card:{kind:string}})=>React.createElement('article',{'data-pr13-card':card.kind});return {ResultsMessageCard:record,JourneyRecordCard:record,JourneyRecordTurn:()=>null};}
      if (name === "./profile-card") return {ProfileCard:()=>null,SavedProfileTurn:()=>null};
      if (name === "./medicines-card") return {MedicinesCard:()=>null,SavedMedicinesTurn:()=>null};
      if (name === "./symptom-gate-card") return {SymptomGateCard:()=>null,SavedGateTurn:()=>null};
      if (name === "./consult-questions-card") return {ConsultQuestionsCard:()=>null,SavedQuestionsTurn:()=>null};
      if (name === "./lab-visit-card") return {LabVisitCard:()=>null,SavedLabTurn:()=>null};
      if (name === "./visit-card") return {VisitCard:()=>null,SavedVisitTurn:()=>null};
      if (name === "./document-card") return {DocumentCard:()=>null,SavedDocumentTurn:()=>null};
      if (name === "@/components/patient/zoe-attach") return {ZoeAttach:()=>null};
      if (name === "@/lib/zoe-chat-actions/labs-actions") return {openDocumentCard:()=>{throw Error('Unexpected document action in anamnesis check');}};
      if (name === "./plan-card") return {PlanCard:()=>null,ConfirmedPlanTurn:()=>null};
      if (name === "./dose-card") return {DoseCard:()=>null,DoseTurn:()=>null};
      // WP F: caregiver, consents and invitation blocks (none drawn in this check).
      if (name === "./member-settings-cards") return {CaregiverCard:()=>null,ConsentsCard:()=>null,CaregiverInvitations:()=>null};
      if (name === "./dose-flow-cards") return {DoseReasonCard:()=>null,DoseReasonTurn:()=>null,SamsCard:()=>null,SamsTurn:()=>null};
      if (name === "./menu") return {ChatMenu:(props:Record<string,unknown>)=>React.createElement('aside',{...props,'data-chat-menu':true})};
      if (name === "@/components/patient/zoe-chat-consent") return {ZoeChatConsent:({onResolved}:{onResolved:()=>void})=>React.createElement("button",{"data-consent-resolve":true,onClick:onResolved},"Resolve consent")};
      if (name === "@/components/patient/zoe-notice") return {ZoeNotice:()=>null};
      if (name === "@/components/patient/sign-in-ended") return {SignInEnded:()=>null};
      if (name === "react") return React;
      if (name === "react/jsx-runtime") return jsx;
      if (name === "next/navigation") return { useRouter: () => router };
      if (name === "@/app/patient/actions") return { completeAssessment: async (revision:number) => { completionCalls++; return {ok:true,revision:revision+1}; } };
      if (name === "@/lib/patient/answer-transport") return { saveQuestionnaireAnswers: ({ expectedRevision, entries }: { expectedRevision: number; entries: Entry[] }) => save(expectedRevision, entries) };
      if (name === "@/components/ui/button") return { Button: ({ children, ...props }: React.ComponentProps<typeof Button>) => React.createElement("button", props, children) };
      if (name === "@/components/patient/zoe-emergency-card") return { ZoeEmergencyCard: () => React.createElement("button", {"data-zoe-emergency-card": true}, "Call 103 now") };
      if (name === "./profile-form") return { ProfileForm: () => null };
      if (name === "./questionnaire-intro") return { QuestionnaireIntro: () => null };
      if (name === "./question-field" || name === "@/components/patient/question-field") return { QuestionField: (props: React.ComponentProps<typeof QuestionField>) => React.createElement("fieldset", { ...props, "data-field-id": props.field.id }) };
      if (name.startsWith("@/") || name.startsWith(".")) {
        const stem = name.startsWith("@/") ? resolve(name.slice(2)) : resolve(dirname(absolute), name);
        const file = [stem, `${stem}.ts`, `${stem}.tsx`].find(existsSync);
        if (!file) throw new Error(`Cannot load ${name} from ${absolute}`);
        return load(file);
      }
      throw new Error(`Unexpected module boundary: ${name}`);
    },
  });
  return exports as T;
}
const {MemberChat:Component}=load<{MemberChat:typeof MemberChat}>("components/chat-v2/member-chat.tsx");
const {Anamnesis}=load<typeof import('../components/chat-v2/anamnesis')>('components/chat-v2/anamnesis.tsx');
const {mergeAnswers}=load<typeof import("../lib/patient/questionnaire")>("lib/patient/questionnaire.ts");
const {clearQuestionnaireSession}=load<typeof import("../lib/patient/questionnaire-session")>("lib/patient/questionnaire-session.ts");
const initial:ZoeThread={ok:true,version:1,ack:null,zoeReplies:false,settledSeq:0,messages:[],replies:[],answers:[]};
// A next step is a single accessible Zoe message after the real questionnaire completion.
{
 const draft:AssessmentDraft={id:'member-next-step',revision:1,assessmentDate:'2026-11-03',answers:{},completedAt:null,urgentRule:null};
 const props={locale:'en' as const,memberName:'Synthetic member',revision:1,initial,assessment:draft};
 const nextStep={stage:'tests_to_choose' as const,text:STAGE_CLASSES.tests_to_choose,href:'/patient/service'};
 let tree!:ReactTestRenderer;
 await act(async()=>{tree=create(React.createElement(Component,{...props,nextStep,refreshOnComplete:true}));});
 assert.equal(tree.root.findByType(Anamnesis).props.refreshOnComplete,true,'The screen passes the V3 refresh to the questionnaire');
 assert.equal(tree.root.findAllByProps({'data-journey-stage':'tests_to_choose'}).length,0,'Incomplete assessment suppresses the next step even if supplied');
 const complete={...draft,completedAt:'2026-11-03T09:00:00Z'};
 await act(async()=>tree.update(React.createElement(Component,{...props,assessment:complete})));
 assert.equal(tree.root.findByType(Anamnesis).props.refreshOnComplete,false);
 assert.equal(tree.root.findAllByProps({'data-journey-stage':'tests_to_choose'}).length,0,'No prop adds no message to the switch-off view');
 shown=[{requestId:'synthetic-pending',text:'Synthetic pending message',state:'sending'}];
 for(const locale of ['hy','en','ru'] as const){
  await act(async()=>tree.unmount());
  await act(async()=>{tree=create(React.createElement(Component,{...props,locale,assessment:complete,nextStep}));});
  const log=tree.root.findByProps({role:'log'});
  const message=log.findByProps({'data-journey-stage':'tests_to_choose'});
  assert.equal(message.props.className,'cv2-msg cv2-zoe');assert.equal(message.props.role,'status');
  assert.deepEqual(message.findByProps({className:'cv2-say'}).children,[nextStep.text[locale]]);
  const link=message.findByType('a');assert.equal(link.props.href,'/patient/service');
  assert.equal(log.findAllByType('a').length,1,'Only one next-step link');
  const articles=log.findAllByType('article');
  assert.equal(articles.at(-1),message,'The next step follows all questionnaire content');
  assert.ok(articles.indexOf(log.findByProps({'data-pending':'sending'}))<articles.indexOf(message),'The next step follows pending member messages too');
  if(locale==='en'){
   const words=log.findAllByType('p').flatMap(p=>p.children.filter(c=>typeof c==='string')).join(' ');
   assert.ok(words.includes('Your questionnaire is complete.'));
   assert.ok(words.indexOf('Your questionnaire is complete.')<words.indexOf(nextStep.text.en),'The sentence follows the questionnaire-complete line');
  }
 }
 await act(async()=>tree.unmount());
 await act(async()=>{tree=create(React.createElement(Component,{...props,assessment:complete,nextStep:{stage:null,text:{en:'Not available right now. Your next step is on your home page.',hy:'Հիմա հասանելի չէ։ Ձեր հաջորդ քայլը ձեր գլխավոր էջում է։',ru:'Сейчас недоступно. Ваш следующий шаг на вашей главной странице.'},href:'/patient'}}));});
 const fallback=tree.root.findByProps({'data-journey-stage':'unavailable'});
 assert.deepEqual(fallback.findByProps({className:'cv2-say'}).children,['Not available right now. Your next step is on your home page.']);
 assert.equal(fallback.findByType('a').props.href,'/patient');
 for(const stage of ['waiting','plan_confirmed'] as const){
  await act(async()=>tree.update(React.createElement(Component,{...props,assessment:complete,nextStep:{stage,text:STAGE_CLASSES[stage],href:null}})));
  const message=tree.root.findByProps({'data-journey-stage':stage});
  assert.deepEqual(message.findByProps({className:'cv2-say'}).children,[STAGE_CLASSES[stage].en]);
  assert.equal(message.findAllByType('a').length,0,'Nothing due has no link');
 }
 // Cards already saved by classic chat must stay hidden with V3 off.
 const historicalResult=cardSchema.parse({id:crypto.randomUUID(),requestId:crypto.randomUUID(),kind:'results',source:'chip',sourceSeq:null,state:'open',outcome:{},at:'2026-11-04T08:00:00Z',snapshot:{v:1,available:true,publishedAt:null,rows:[],more:0}});
 visibleCards={enabled:true,cards:[historicalResult],clearedSeq:null};
 await act(async()=>tree.update(React.createElement(Component,{...props,assessment:complete,nextStep})));
 assert.equal(tree.root.findAllByProps({'data-pr13-card':'results'}).length,0,'V3 off keeps existing saved result cards out of the new chat');
 await act(async()=>tree.update(React.createElement(Component,{...props,assessment:complete,nextStep,onboarding:{profileRequest:null}})));
 assert.equal(tree.root.findAllByProps({'data-pr13-card':'results'}).length,1,'V3 on renders the same saved result card');
 // With both switches on, an older page prop cannot contradict a newly polled card stage.
 const v3Card=cardSchema.parse({id:crypto.randomUUID(),requestId:crypto.randomUUID(),kind:'next_step',source:'chip',sourceSeq:null,state:'open',outcome:{},at:'2026-11-04T09:00:00Z',snapshot:chatNextStep({questionnaireComplete:true,review:null,appointments:[],clinics:{},canBook:true,hasOpenRequest:false,lab:'at-lab',planPublished:false,now:new Date()},{episode:'synthetic'})});
 visibleCards={enabled:true,cards:[v3Card],clearedSeq:null};
 await act(async()=>tree.update(React.createElement(Component,{...props,assessment:complete,nextStep,onboarding:{profileRequest:null}})));
 const currentLine=tree.root.findByProps({'data-journey-stage':'results_waiting'});
 assert.deepEqual(currentLine.findByProps({className:'cv2-say'}).children,[STAGE_CLASSES.results_waiting.en]);
 assert.equal(currentLine.findAllByType('a').length,0,'V3 keeps the action inside the chat');
 visibleCards={...visibleCards,nextStepStatus:'unavailable'};
 await act(async()=>tree.update(React.createElement(Component,{...props,assessment:complete,nextStep,onboarding:{profileRequest:null}})));
 assert.equal(tree.root.findAllByProps({'data-journey-stage':'results_waiting'}).length,0,'Failed polls cannot retain a positive next-step sentence');
 {
  const says=tree.root.findAll(n=>typeof n.type==='string'&&n.props.className==='cv2-say'&&n.children.join('')==='Not available right now. Try again later.');
  assert.equal(says.length,1,'A failed next-step read says so once, not twice (Gohar QA 253)');
 }
 visibleCards={enabled:false,cards:[],clearedSeq:null};
 await act(async()=>tree.unmount());clearQuestionnaireSession(draft.id);shown=[];
}
for(const urgent of [false,true]) {
  persisted={id:`member-consent-${urgent}`,revision:0,assessmentDate:'2026-11-01',completedAt:null,urgentRule:null,
    answers:Object.fromEntries(Object.entries({'q1.age':40,'q1.sex':'female',...(urgent?{'q9.present':'yes','q9.right_now':'yes'}:{})}).map(([fieldId,value])=>[
      fieldId,{fieldId,value,source:'manual' as const,answeredAt:'2026-11-01T12:00:00Z'},
    ]))};
  let tree!:ReactTestRenderer;
  await act(async()=>{tree=create(React.createElement(Component,{locale:'en',memberName:'Synthetic member',revision:1,initial,
    assessment:persisted,emergencyCard:true,consent:{directAnswers:false}}));});
  assert.equal(tree.root.findAllByProps({'data-consent-resolve':true}).length,1,'Consent is unresolved at entry');
  assert.equal(tree.root.findAllByProps({'data-chat-anamnesis':true}).length,urgent?1:0,'Existing red answer bypasses only the questionnaire consent gate');
  assert.equal(tree.root.findAllByProps({'data-zoe-emergency-card':true}).length,urgent?1:0,'Call guidance for recorded red answers is visible before resolving consent');
  assert.equal(tree.root.findAllByType('fieldset').length,0,'No active question while consent is unresolved or red is present');
  const composer=tree.root.findByType('textarea');
  assert.equal(composer.props.disabled,false,'Care-team composer stays available');
  if(!urgent) {
    await act(async()=>tree.root.findByProps({'data-consent-resolve':true}).props.onClick());
    assert.equal(tree.root.findAllByProps({'data-chat-anamnesis':true}).length,1,'Resolving normal consent opens the questionnaire offer');
    const offer=tree.root.findAllByType('button').find(button=>button.children.includes('Yes, answer now'));
    assert.ok(offer);
    await act(async()=>offer.props.onClick());
    assert.equal(tree.root.findByType('fieldset').props['data-field-id'],'q2.weight_perception','Normal consent resolution enables opt-in questions');
  }
  assert.equal(tree.root.findAllByType('a').length,0);
  await act(async()=>tree.unmount());clearQuestionnaireSession(persisted.id);
}
assert.equal(attempts,0,'Reading recorded urgent answers never writes them again');
assert.equal(effectiveSaves,0);assert.equal(completionCalls,0);
{
  persisted={id:'member-menu-revision',revision:0,assessmentDate:'2026-11-01',completedAt:null,urgentRule:null,
    answers:Object.fromEntries(Object.entries({'q1.age':40,'q1.sex':'female'}).map(([fieldId,value])=>[
      fieldId,{fieldId,value,source:'manual' as const,answeredAt:'2026-11-01T12:00:00Z'},
    ]))};
  let tree!:ReactTestRenderer;
  await act(async()=>{tree=create(React.createElement(Component,{locale:'en',memberName:'Synthetic member',revision:0,initial,assessment:persisted,emergencyCard:true}));});
  const optIn=tree.root.findAllByType('button').find(button=>button.children.includes('Yes, answer now'))!;
  await act(async()=>optIn.props.onClick());
  const first=tree.root.findByType('fieldset');
  await act(async()=>{first.props.onChange([{fieldId:'q2.weight_perception',value:'ok'}]);await first.props.onSave([{fieldId:'q2.weight_perception',value:'ok'}],true);});
  assert.equal(persisted.revision,1);
  const openMenu=()=>tree.root.findAllByType('button').find(button=>button.props.className==='cv2-avatar')!;
  await act(async()=>openMenu().props.onClick());
  const menu=tree.root.findByProps({'data-chat-menu':true});
  assert.equal(menu.props.revision,1,'Menu receives revision advanced by questionnaire save');
  assert.equal(menu.props.disabled,false);
  await act(async()=>menu.props.onBusy(true));
  assert.equal(tree.root.findByType('fieldset').props.disabled,true,'Language write locks questionnaire answers');
  const callbacks=menu.props;
  await act(async()=>callbacks.onClose());
  assert.equal(tree.root.findAllByProps({'data-chat-menu':true}).length,0);
  assert.equal(tree.root.findByType('fieldset').props.disabled,true,'Closing menu during write keeps questionnaire locked');
  await act(async()=>openMenu().props.onClick());
  assert.equal(tree.root.findByProps({'data-chat-menu':true}).props.disabled,true,'Reopening menu during the same write keeps language actions locked');
  persisted={...persisted,revision:2};
  await act(async()=>{callbacks.onLocale('hy',2);callbacks.onBusy(false);});
  assert.equal(tree.root.findByProps({'data-chat-menu':true}).props.disabled,false,'Settled language result unlocks the reopened menu');
  const numeric=tree.root.findByType('fieldset');
  assert.equal(numeric.props.disabled,false);
  assert.equal(numeric.props.locale,'hy');
  assert.equal(numeric.props.field.id,'q2.height');
  await act(async()=>numeric.props.onChange([{fieldId:'q2.height',value:169}]));
  const questionnaireForm=tree.root.findAllByType('form').find(form=>form.props.className!=='cv2-composer')!;
  await act(async()=>questionnaireForm.props.onSubmit({preventDefault(){}}));
  assert.equal(persisted.revision,3,'Answer after language write uses the new shared revision');
  assert.equal(persisted.answers['q2.height'].value,169);
  assert.equal(effectiveSaves,2);
  assert.equal(tree.root.findByProps({'data-chat-menu':true}).props.revision,3,'Reopened menu receives latest answer revision');
  await act(async()=>tree.unmount());clearQuestionnaireSession(persisted.id);
}
console.log('MemberChat integration: red guidance before consent, normal consent/opt-in, questionnaire/menu revision handoff, language-write locking through menu close, and next-answer save pass. Real MemberChat/Anamnesis/hooks/clinical/session; mocked IO and rendering boundaries, no browser proof.');
