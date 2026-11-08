import type {z} from 'zod';
import type {clinicAdminPageSchema,clinicMembershipSchema,ClinicAdminCommand} from './admin-schema';
export type ClinicAdminPage=z.infer<typeof clinicAdminPageSchema>;
export type ClinicMembership=z.infer<typeof clinicMembershipSchema>;
export type ClinicAdminPorts={
 read:(clinicId:string,cursor:string|null,scope:string)=>Promise<unknown>;
 lookup:(clinicId:string,email:string,scope:string)=>Promise<unknown>;
 command:(clinicId:string,input:ClinicAdminCommand,scope:string)=>Promise<unknown>;
 recover:(clinicId:string,input:ClinicAdminCommand,scope:string)=>Promise<unknown>;
};
