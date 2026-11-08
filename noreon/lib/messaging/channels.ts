import {z} from 'zod';
/** Syntax alone does not establish sender registration or Armenian route approval. */
export const smsSender=z.string().refine(value=>/^\+[1-9][0-9]{7,14}$/.test(value)||(/^[A-Za-z0-9 ]{1,11}$/.test(value)&&/[A-Za-z]/.test(value)&&value.trim()===value));
