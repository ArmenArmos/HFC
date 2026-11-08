import React from 'react';
import type {SelectOption} from '@/components/ui/select-field';
type Props={options:readonly SelectOption[];value?:string;defaultValue?:string;onValueChange?:(value:string)=>void;name?:string;id?:string;required?:boolean;disabled?:boolean;placeholder?:string;'aria-label'?:string};
/** For sandboxed component checks: SelectField's form contract (name, value,
 * options, onValueChange) rendered as the native select it keeps underneath. */
export const selectFieldNativeStub={SelectField:(p:Props)=>React.createElement('select',{name:p.name,id:p.id,required:p.required,disabled:p.disabled,'aria-label':p['aria-label'],...(p.value!==undefined?{value:p.value}:{defaultValue:p.defaultValue}),onChange:(e:{target:{value:string}})=>p.onValueChange?.(e.target.value)},
 ...(p.placeholder!==undefined?[React.createElement('option',{key:'\u0000placeholder',value:''},p.placeholder)]:[]),
 ...p.options.map(o=>React.createElement('option',{key:o.value,value:o.value,disabled:o.disabled},o.description?`${o.label} · ${o.description}`:o.label)))};
