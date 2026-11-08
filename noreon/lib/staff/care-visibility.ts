import type {StaffRole} from './types';
/** Never pass an unpublished treatment draft to nurse pages or snapshot APIs. */
export function staffVisibleState<T extends object>(state:T,role:StaffRole):T {
 if(role!=='nurse')return state;
 const copy=structuredClone(state);
 if('workflow' in copy&&copy.workflow&&typeof copy.workflow==='object'&&!Array.isArray(copy.workflow)){
  const workflow=copy.workflow as Record<string,unknown>;
  workflow.draft={explanation:'',instructions:'',followUp:'',medicationName:'',medicationDose:'',medicationInstructions:'',medicationTimes:[]};
  workflow.draftSaved=false;
 }
 return copy;
}
