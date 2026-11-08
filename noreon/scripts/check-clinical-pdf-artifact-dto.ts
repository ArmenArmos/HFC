import assert from'node:assert/strict';import{snapshotSchema}from'@/lib/patient-care/clinical-case-repository';
const artifact={version:1,parser:'qpdf-12.4.2',policy:'noreon-pdf-v1',original:{checksum:'a'.repeat(64),byteLength:100},canonical:{checksum:'b'.repeat(64),byteLength:200},pageMap:[{originalPage:1,canonicalPage:1,originalObject:'3 0 R',canonicalObject:'4 0 R'}]};
const report={id:'synthetic',revision:0,state:'needs_review',reviewed:null,confirmedAt:null};
const schema=snapshotSchema.shape.evidence.shape.reports.element;
assert.equal(schema.parse(report).pdfArtifact,undefined,'Historical metadata remains unknown');
assert.deepEqual(schema.parse({...report,pdfArtifact:artifact}).pdfArtifact,artifact,'Source DTO must retain deterministic metadata');
assert.equal(schema.safeParse({...report,pdfArtifact:{}}).success,false,'Malformed present metadata cannot be silently stripped');
console.log('Clinical report source DTO retains shared PDF artifact schema and accepts unknown legacy metadata. Shape only; row-context binding is SQL.');
