import assert from "node:assert/strict";
import {createElement} from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {Inbox} from "@/components/notifications/inbox";
import {NextSteps} from "@/components/patient-care/next-steps";
import type {CareAction} from "@/lib/patient-care/types";
for (const locale of ["en","hy"] as const) {
  const staff=renderToStaticMarkup(createElement(Inbox,{compact:true,staff:true,locale}));
  assert.ok(staff.includes('href="/staff/notifications"'),"Staff inbox contract is unchanged");
  const actions=[{id:"urgent",kind:"urgent",title:{en:"Urgent guidance",hy:"Շտապ օգնություն"},detail:{en:"Full safety instruction",hy:"Ամբողջական ցուցում"},href:"/patient/urgent",button:{en:"Get help",hy:"Օգնություն"}},{id:"second",kind:"questions",title:{en:"Continue questions",hy:"Շարունակել հարցերը"},detail:{en:"Secondary instruction",hy:"Լրացուցիչ ցուցում"},href:"/patient/questions",button:{en:"Continue",hy:"Շարունակել"}}] as CareAction[];
  const primary=renderToStaticMarkup(createElement(NextSteps,{actions,locale,mode:"primary"}));
  const secondary=renderToStaticMarkup(createElement(NextSteps,{actions,locale,mode:"secondary"}));
  assert.ok(primary.includes('href="/patient/urgent"')&&!primary.includes('href="/patient/questions"'));
  assert.ok(secondary.includes('href="/patient/questions"')&&!secondary.includes('href="/patient/urgent"'));
  const all=renderToStaticMarkup(createElement(NextSteps,{actions,locale}));
  assert.ok(all.includes('href="/patient/urgent"')&&all.includes('href="/patient/questions"'),"Default urgent layout retains every clinical action");
}
console.log("Compact controls keep unchanged staff access and complete primary/secondary action destinations.");
