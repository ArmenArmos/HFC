import {z} from 'zod';
import {staffMemberIdentitySchema} from './member-search-schema';

// Full phones only arrive from the care-team branch of the server RPC.
export const chatMemberIdentitySchema=staffMemberIdentitySchema.extend({
 sex:z.enum(['male','female']).nullable(),clinic:z.string().nullable(),
 phone:z.string().regex(/^\+[0-9]{4,15}$/).optional(),
});
export type ChatMemberIdentity=z.infer<typeof chatMemberIdentitySchema>;
