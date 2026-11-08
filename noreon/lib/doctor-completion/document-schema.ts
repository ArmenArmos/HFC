import {z} from 'zod';
/** Clinic lab PDFs reach the member only through an explicit doctor release. */
export const memberDocumentVersion='member-document-v1' as const;
const uuid=z.uuid(),instant=z.iso.datetime({offset:true});
export const doctorDocumentSchema=z.strictObject({fileId:uuid,name:z.string().min(1).max(500),clinic:z.string().min(1).max(500),uploadedAt:instant,attachedAt:instant,released:z.boolean(),releasedAt:instant.nullable(),openedByYou:z.boolean()});
export const doctorDocumentsReadSchema=z.strictObject({version:z.literal('member-documents-v1'),enabled:z.boolean(),documents:z.array(doctorDocumentSchema)});
export const memberDocumentSchema=z.strictObject({fileId:uuid,clinic:z.string().min(1).max(500),uploadedAt:instant,releasedAt:instant});
export const memberDocumentsReadSchema=z.strictObject({version:z.literal('released-documents-v1'),documents:z.array(memberDocumentSchema)});
export const documentCommandSchema=z.strictObject({version:z.literal(memberDocumentVersion),submissionId:uuid,memberId:uuid,fileId:uuid,action:z.enum(['release','withdraw']),singleMemberConfirmed:z.boolean().optional()});
export const documentOpenSchema=z.strictObject({fileId:uuid,bucket:z.literal('clinic-originals'),objectKey:z.string().min(1).max(1024),sha256:z.string().regex(/^[a-f0-9]{64}$/),sizeBytes:z.number().int().positive()});
export const documentResultSchema=z.strictObject({status:z.enum(['released','withdrawn','unchanged','confirm-required','open-first','stale','invalid','disabled','access','unavailable','outcome-unknown'])});
export type DoctorDocument=z.infer<typeof doctorDocumentSchema>;
export type DoctorDocumentsRead=z.infer<typeof doctorDocumentsReadSchema>;
export type MemberDocument=z.infer<typeof memberDocumentSchema>;
export type DocumentCommand=z.infer<typeof documentCommandSchema>;
export type DocumentResult=z.infer<typeof documentResultSchema>;
export type DocumentCommandPort=(input:DocumentCommand)=>Promise<DocumentResult>;
