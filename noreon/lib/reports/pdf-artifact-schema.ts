import {z} from 'zod';

/** Client-safe persisted report artifact shape. Context must additionally bind original
 * checksum, page count and contiguous page ordinals (as receipt validation does).
 * Existing legacy/report limit stays 10; batch technical page limits are separate. */
export const pdfArtifactSchema=z.strictObject({
 version:z.literal(1),parser:z.literal('qpdf-12.4.2'),policy:z.literal('noreon-pdf-v1'),
 original:z.strictObject({checksum:z.string().regex(/^[a-f0-9]{64}$/),byteLength:z.number().int().min(1).max(8*1024*1024)}),
 canonical:z.strictObject({checksum:z.string().regex(/^[a-f0-9]{64}$/),byteLength:z.number().int().min(1).max(12*1024*1024)}),
 pageMap:z.array(z.strictObject({originalPage:z.number().int().min(1),canonicalPage:z.number().int().min(1),originalObject:z.string().regex(/^[1-9][0-9]* [0-9]+ R$/),canonicalObject:z.string().regex(/^[1-9][0-9]* [0-9]+ R$/)})).min(1).max(10),
});

type ArtifactShape=z.infer<typeof pdfArtifactSchema>;
export type PdfArtifactProvenance=Readonly<Omit<ArtifactShape,'original'|'canonical'|'pageMap'> & {
 original:Readonly<ArtifactShape['original']>;
 canonical:Readonly<ArtifactShape['canonical']>;
 /** Ordinal correspondence is not rendered/clinical fidelity or reader consensus. */
 pageMap:readonly Readonly<ArtifactShape['pageMap'][number]>[];
}>;
