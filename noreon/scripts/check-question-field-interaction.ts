import assert from "node:assert/strict";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QuestionField, type Entry } from "@/components/patient/question-field";
import { CORE_QUESTIONS } from "@/lib/clinical/seed/questions";
import { NONE, UNKNOWN } from "@/lib/clinical/types";
import { NumericAnswer } from "@/components/patient/numeric-answer";
import { NUMERIC_STARTING_VALUES, numericStartingValue } from "@/components/patient/numeric-starting-values";
globalThis.requestAnimationFrame = callback => { callback(0); return 1; };

// Exercise the real numeric control's unset render and intentional handlers.
for (const locale of ["en", "hy"] as const) {
 let value:number|null=null;
 const changes:(number|null)[]=[];
 const numeric=()=>NumericAnswer({id:"q2.height",label:locale==="en"?"cm":"սմ",value,min:120,max:230,disabled:false,locale,onChange:next=>{value=next;changes.push(next);}});
 const nodes=(node:unknown):ReactElement<Record<string,unknown>>[]=>{
  if(Array.isArray(node))return node.flatMap(nodes);
  if(!node || typeof node!=="object")return [];
  const element=node as ReactElement<Record<string,unknown>>;
  return [element,...nodes(element.props?.children)];
 };
 const blank=nodes(numeric());
 assert.equal(changes.length,0,"Viewing an empty numeric control does not choose a value");
 assert.ok(!blank.some(node=>node.props?.type==="range"),"An unanswered control must not expose a midpoint slider value or thumb");
 assert.ok(!blank.some(node=>node.props?.["data-start-slider"]!==undefined),"No separate start-slider button");
 const unset=blank.find(node=>node.props?.["data-slider-unset"]===true);
 assert.ok(unset,"An empty slider shows the range control in an unset state");
 assert.equal(unset.props.role,"slider");
 assert.equal(unset.props.tabIndex,0,"The unset slider is keyboard-reachable");
 assert.equal(unset.props["aria-valuenow"],undefined,"The unset slider exposes no value");
 assert.equal(unset.props["aria-valuetext"],locale==="en"?"No answer":"Պատասխան չկա");
 const html=renderToStaticMarkup(numeric());
 assert.ok(html.includes(locale==="en"?"No answer yet. Drag, tap −/+ or type your reading.":"Պատասխան դեռ չկա։ Սահեցրեք, սեղմեք −/+ կամ մուտքագրեք ձեր չափումը։"));
 assert.ok(!/Start slider|Սկսել սահիչը|starting value|մեկնարկային/.test(html),"No start-slider wording remains");
 let prevented=false;
 (unset.props.onKeyDown as (event:unknown)=>void)({key:"Tab",preventDefault:()=>{prevented=true;}});
 assert.equal(value,null,"Tabbing through the unset slider chooses nothing");
 assert.equal(prevented,false);
 (unset.props.onKeyDown as (event:unknown)=>void)({key:"ArrowRight",preventDefault:()=>{prevented=true;}});
 assert.equal(value,175,"Without a typical value, the first arrow key starts at the midpoint, never the lower bound");
 assert.equal(prevented,true);
 value=null;
 // A pointer press commits where the member touched; a touch waits for a tap or sideways drag.
 const listeners=new Map<string,(event:unknown)=>void>();
 (globalThis as {window?:unknown}).window={addEventListener:(type:string,fn:(event:unknown)=>void)=>listeners.set(type,fn),removeEventListener:(type:string)=>listeners.delete(type)};
 const rect={left:0,width:110};
 const press=(pointerType:string,clientX:number)=>(nodes(numeric()).find(node=>node.props?.["data-slider-unset"]===true)!.props.onPointerDown as (event:unknown)=>void)({pointerType,button:0,clientX,preventDefault:()=>{},currentTarget:{getBoundingClientRect:()=>rect}});
 press("mouse",55);
 assert.equal(value,175,"A mouse press sets the value where it landed");
 listeners.get("pointermove")!({clientX:110});
 assert.equal(value,230,"The press keeps dragging");
 listeners.get("pointerup")!({type:"pointerup",clientX:110});
 assert.equal(listeners.size,0);
 value=null;
 press("touch",55);
 assert.equal(value,null,"A touch alone does not choose a value yet");
 listeners.get("pointermove")!({clientX:56});
 listeners.get("pointercancel")!({type:"pointercancel",clientX:56});
 assert.equal(value,null,"A touch that turns into a page scroll chooses nothing");
 press("touch",11);
 listeners.get("pointerup")!({type:"pointerup",clientX:11});
 assert.equal(value,131,"A tap sets the value where it landed");
 value=null;
 const disabledHtml=renderToStaticMarkup(NumericAnswer({id:"q2.height",label:"cm",value:null,min:120,max:230,disabled:true,locale,onChange:()=>{throw new Error("disabled");}}));
 assert.ok(disabledHtml.includes('tabindex="-1"'),"A disabled unset slider is not focusable");
 (unset.props.onKeyDown as (event:unknown)=>void)({key:"Home",preventDefault:()=>{}});
 assert.equal(value,120);
 const range=nodes(numeric()).find(node=>node.props?.type==="range")!;
 assert.equal(range.props.value,120);
 (range.props.onChange as (event:unknown)=>void)({target:{value:"174"}});
 assert.equal(value,174,"Intentional slider changes remain supported");
 const input=nodes(numeric()).find(node=>node.props?.type==="number")!;
 (input.props.onChange as (event:unknown)=>void)({target:{value:""}});
 assert.equal(value,null,"Clearing restores the unset state");
 assert.ok(!nodes(numeric()).some(node=>node.props?.type==="range"));
 const plus=nodes(numeric()).find(node=>String(node.props?.["aria-label"]).startsWith(locale==="en"?"Increase":"Ավելացնել"))!;
 (plus.props.onClick as ()=>void)();
 assert.equal(value,175,"Plus starts at the same point as the slider");
 const typed=nodes(numeric()).find(node=>node.props?.type==="number")!;
 (typed.props.onChange as (event:unknown)=>void)({target:{value:"1"}});
 const invalid=nodes(numeric());
 assert.equal(value,1,"Out-of-range typing remains a draft, not a clamped answer");
 assert.ok(!invalid.some(node=>node.props?.type==="range"),"Invalid draft must not expose a clamped slider/native value");
 assert.ok(invalid.some(node=>node.props?.["data-slider-unavailable"]===true),"Invalid draft exposes bounded help in place of the slider");
 (invalid.find(node=>node.props?.type==="number")!.props.onChange as (event:unknown)=>void)({target:{value:"170"}});
 assert.equal(nodes(numeric()).find(node=>node.props?.type==="range")!.props.value,170,"Correcting the typed value restores the matching slider");
 (nodes(numeric()).find(node=>node.props?.type==="number")!.props.onChange as (event:unknown)=>void)({target:{value:"170.5"}});
 assert.equal(value,170.5,"Off-step value remains in the typed draft");
 assert.ok(!nodes(numeric()).some(node=>node.props?.type==="range"),"Off-step height must not expose a misleading native slider value");
}

type Node = ReactElement<{ children?: unknown; "aria-pressed"?: boolean; onClick?: (event: { currentTarget: { isConnected: boolean } }) => void }>;
const options = (node: unknown): Node[] => {
  if (!node || typeof node !== "object") return [];
  if (Array.isArray(node)) return node.flatMap(options);
  const element = node as Node;
  return [ ...(typeof element.props?.["aria-pressed"] === "boolean" ? [element] : []), ...options(element.props?.children) ];
};
const fields = CORE_QUESTIONS.flatMap(q => q.fields);
const single = fields.find(field => field.kind === "single")!;
const multi = fields.find(field => field.kind === "multi" && field.options?.some(option => option.value === (field.exclusiveValue ?? NONE)))!;
for (const locale of ["en", "hy"] as const) {
  for (const field of [single, multi]) {
    let entries: Entry[] = [];
    let lastSave: { entries: Entry[]; advance?: boolean } | undefined;
    const props = () => ({ field, entries, locale, disabled: false, onChange: (next: Entry[]) => { entries = next; }, onSave: async (next: Entry[], advance?: boolean) => { lastSave = { entries: next, advance }; } });
    const buttons = options(QuestionField(props()));
    assert.equal(buttons.length, field.options!.length);
    const index = field.kind === "multi" ? field.options!.findIndex(option => option.value !== (field.exclusiveValue ?? NONE)) : 0;
    buttons[index].props.onClick!({ currentTarget: { isConnected: false } });
    assert.ok(lastSave);
    assert.equal(lastSave.advance, field.kind === "single" ? true : undefined, "Single selection keeps automatic advancement; multi selection only saves");
    assert.equal(options(QuestionField(props()))[index].props["aria-pressed"], true);
    const html = renderToStaticMarkup(createElement(QuestionField, props()));
    assert.ok(html.includes('aria-hidden="true"'), "Visual selection markers remain decorative for accessibility");
    assert.ok(html.includes(locale === "hy" ? field.options![index].label.hy : field.options![index].label.en ?? field.options![index].label.hy));
    if (field.kind === "multi") {
      const exclusive = field.exclusiveValue ?? NONE;
      const exclusiveIndex = field.options!.findIndex(option => option.value === exclusive);
      options(QuestionField(props()))[exclusiveIndex].props.onClick!({ currentTarget: { isConnected: false } });
      assert.deepEqual(entries[0].value, [exclusive], "The exclusive answer still replaces other selected answers");
      options(QuestionField(props()))[index].props.onClick!({ currentTarget: { isConnected: false } });
      assert.deepEqual(entries[0].value, [field.options![index].value], "Selecting a real answer clears the exclusive answer");
    }
    const locked = options(QuestionField({ ...props(), disabled: true }));
    assert.ok(locked.every(button => (button.props as { disabled?: boolean }).disabled));
  }
}
console.log("Actual EN/HY QuestionField retains single auto-advance, multi exclusivity/save, pressed/disabled semantics and clinical option text with decorative markers.");

for (const id of ["q6.conditions", "q7.relatives"]) {
 const field = fields.find(f => f.id === id)!;
 let saved: {entries: Entry[]; advance?: boolean} | undefined;
 const tree = QuestionField({field, entries: [], locale: "en", disabled:false, onChange:()=>{}, onSave:async(entries,advance)=>{saved={entries,advance};}});
 const buttons = options(tree);
 const none = buttons[field.options!.findIndex(o=>o.value===NONE)];
 none.props.onClick!({currentTarget:{isConnected:false}});
 assert.equal(saved?.advance,true,"None is an immediate exclusive action");
 const html = renderToStaticMarkup(none);
 assert.ok(!html.includes('aria-hidden="true"'),"None action has no checkbox marker");
}

for (const field of fields.filter(f => f.skippable || f.kind === "blood-pressure" || ["q6.conditions","q7.relatives"].includes(f.id))) {
 let entries: Entry[] = [];
 let advance: boolean | undefined;
 const props = () => ({field, entries,locale:"en" as const,disabled:false,onChange:(next:Entry[])=>{entries=next;},onSave:async(next:Entry[],a?:boolean)=>{advance=a;}});
 const buttons = options(QuestionField(props()));
 buttons.at(-1)!.props.onClick!({currentTarget:{isConnected:false}});
 assert.equal(advance,true,field.id + " unknown advances immediately");
 assert.ok(entries.every(e=>e.value===UNKNOWN));
 assert.equal(options(QuestionField(props())).at(-1)!.props["aria-pressed"],true,"Back announces the retained unknown answer");
}

// Back restores a visibly selected UNKNOWN, not only an accessibility attribute.
for (const id of ["q6.conditions", "q7.relatives"]) {
 const field = fields.find(f => f.id === id)!;
 const render = (value: Entry["value"]) => options(QuestionField({ field, entries: value === null ? [] : [{fieldId:id,value}], locale:"en",disabled:false,onChange:()=>{},onSave:async()=>{} }));
 const blank = render(null).at(-1)!;
 const chosen = render("unknown").at(-1)!;
 assert.notEqual((blank.props as {variant?:string}).variant, (chosen.props as {variant?:string}).variant);
 assert.equal(chosen.props["aria-pressed"],true);
}

// Render the actual QuestionField UNKNOWN boundary and deliberately replace it.
for(const locale of ["en","hy"] as const) {
 const field=fields.find(f=>f.id==="q2.waist")!;
 let entries:Entry[]=[{fieldId:field.id,value:UNKNOWN}];
 const props=()=>({field,entries,locale,disabled:false,onChange:(next:Entry[])=>{entries=next;},onSave:async()=>{}});
 const findNumeric=(node:unknown):ReactElement<React.ComponentProps<typeof NumericAnswer>>|undefined=>{
  if(Array.isArray(node))return node.map(findNumeric).find(Boolean);
  if(!node || typeof node!=="object")return;
  const element=node as ReactElement<{children?:unknown}>;
  return element.type===NumericAnswer?element as ReactElement<React.ComponentProps<typeof NumericAnswer>>:findNumeric(element.props?.children);
 };
 const tree=QuestionField(props());
 const html=renderToStaticMarkup(tree);
 assert.ok(!html.includes(locale==="en"?"No answer":"Պատասխան չկա") && !html.includes(locale==="en"?"No answer yet":"Պատասխան դեռ չկա"),"Explicit UNKNOWN is not described as unanswered");
 assert.ok(html.includes(locale==="en"?"Not provided":"Չի տրամադրվել"),"UNKNOWN has truthful localized feedback");
 assert.equal(entries[0].value,UNKNOWN,"Viewing UNKNOWN preserves the recorded choice");
 const numeric=findNumeric(tree)!;
 numeric.props.onChange(90);
 assert.equal(entries[0].value,90,"Only intentional measurement entry replaces UNKNOWN");
 assert.ok(!renderToStaticMarkup(QuestionField(props())).includes(locale==="en"?"Not provided":"Չի տրամադրվել"));
}

// Fractional clinical seed steps remain supported, including floating-point tolerance.
for(const locale of ["en","hy"] as const) for(const field of fields.filter(f=>f.step===0.1 || f.step===0.5)) {
 const value=field.step===0.1?6.4:7.5;
 const markup=(number:number)=>renderToStaticMarkup(createElement(QuestionField,{field,entries:[{fieldId:field.id,value:number}],locale,disabled:false,onChange:()=>{},onSave:async()=>{}}));
 const valid=markup(value);
 assert.ok(valid.includes('type="range"'),`${field.id} accepts its seeded fractional step`);
 assert.ok(valid.includes(`aria-valuetext="${value} `),"Slider describes the actual valid typed value");
 assert.ok(!markup(value+field.step!/2).includes('type="range"'),`${field.id} off-step draft must not expose a clamped/rounded slider`);
}

// Typical starting values are UI only: inside the bounds, on the step, never the
// lower bound, and nothing is chosen until the member acts.
{
 const numericIds=fields.flatMap(f=>f.kind==="blood-pressure"
  ?[{id:f.id+".systolic",min:f.parts!.systolic.min,max:f.parts!.systolic.max,step:1},{id:f.id+".diastolic",min:f.parts!.diastolic.min,max:f.parts!.diastolic.max,step:1}]
  :f.kind==="number"||f.kind==="scale"?[{id:f.id,min:f.min,max:f.max,step:f.step??1}]:[]);
 for(const id of Object.keys(NUMERIC_STARTING_VALUES)) assert.ok(numericIds.some(n=>n.id===id),`${id} starting value names a real field`);
 for(const n of numericIds){
  const start=numericStartingValue(n.id,n.min,n.max,n.step);
  assert.ok(start!==undefined,`${n.id} has a starting point`);
  assert.equal(NUMERIC_STARTING_VALUES[n.id],start,`${n.id} is listed in the starting-value map inside its bounds`);
  if(n.min!==undefined) assert.ok(start>n.min,`${n.id} does not start at the lower bound`);
  if(n.max!==undefined) assert.ok(start<n.max,`${n.id} does not start at the upper bound`);
  assert.ok(Math.abs(start/n.step-Math.round(start/n.step))<0.000001,`${n.id} starts on its step`);
 }
 const height=fields.find(f=>f.id==="q2.height")!;
 for(const locale of ["en","hy"] as const){
  let entries:Entry[]=[];
  const html=renderToStaticMarkup(createElement(QuestionField,{field:height,entries,locale,disabled:false,onChange:next=>{entries=next;},onSave:async()=>{}}));
  assert.ok(html.includes("left:45.45%"),"Unset height thumb sits at 170 cm");
  assert.ok(!html.includes('type="range"') && !html.includes("aria-valuenow"),"Starting point is not exposed as a value");
  assert.equal(entries.length,0,"Rendering does not save the starting point");
 }
 const bp=fields.find(f=>f.kind==="blood-pressure")!;
 let entries:Entry[]=[];
 const tree=QuestionField({field:bp,entries,locale:"en",disabled:false,onChange:next=>{entries=next;},onSave:async()=>{}});
 const all=(node:unknown):ReactElement<Record<string,unknown>>[]=>{
  if(Array.isArray(node))return node.flatMap(all);
  if(!node || typeof node!=="object")return [];
  const element=node as ReactElement<Record<string,unknown>>;
  if(element.type===NumericAnswer) return [element,...all((NumericAnswer as (p:unknown)=>unknown)(element.props))];
  return [element,...all(element.props?.children)];
 };
 const starts=all(tree).filter(node=>node.type===NumericAnswer).map(node=>[node.props.id,node.props.startingValue]);
 assert.deepEqual(starts,[[bp.id+".systolic",120],[bp.id+".diastolic",80]],"Blood pressure still starts at 120/80");
}
