import {createHash} from 'node:crypto';
import type {NextStep} from './next-step';
export const stableRequestId=(key:string)=>createHash('sha256').update(key).digest('hex').replace(/^(.{8})(.{4}).(.{3}).(.{3})(.{12}).*$/,'$1-$2-5$3-8$4-$5');
export const stepRequestId=(member:string,step:NextStep)=>stableRequestId(`zoe-next-step:${member}:${step.stage}`);
