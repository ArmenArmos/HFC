import 'server-only';
import {bpTargetsEnabled,riskTiersEnabled} from './config';
import {readDoctorBpTarget,type BpTargetRpc} from '@/lib/bp-target/runtime';
import {readMemberRiskTier,type WorklistRpc} from '@/lib/worklist/server';
import {RISK_TIERS,type RiskTier} from '@/lib/clinical/rules/risk-tier';
import type {DoctorLdl} from '@/lib/ldl/schema';

export type StaffClinicalHeader={tier:{tier:RiskTier;reasons:string[]}|null;bpTarget:{systolic:number;diastolic:number}|null;ldlGoalMmol:number|null;targets:boolean};

/** The staff member header's tier and targets (WP T). Null while both switches are off. Each read is audited by its RPC. */
export async function readStaffClinicalHeader(client:unknown,memberId:string,ldl:DoctorLdl|null):Promise<StaffClinicalHeader|null>{
 const targets=bpTargetsEnabled(),tiers=riskTiersEnabled();
 if(!targets&&!tiers)return null;
 const [tier,bp]=await Promise.all([
  tiers?readMemberRiskTier(client as WorklistRpc,memberId):Promise.resolve(null),
  targets?readDoctorBpTarget(client as BpTargetRpc,memberId):Promise.resolve(null),
 ]);
 const known=tier&&(RISK_TIERS as readonly string[]).includes(tier.tier)?{tier:tier.tier as RiskTier,reasons:tier.reasons}:null;
 const current=bp?.current??null;
 return {tier:known,bpTarget:current?{systolic:current.homeSystolicTarget,diastolic:current.homeDiastolicTarget}:null,
  ldlGoalMmol:ldl?.enabled&&ldl.goals[0]?ldl.goals[0].thresholdMmol:null,targets};
}
