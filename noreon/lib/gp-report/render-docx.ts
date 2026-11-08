import {deflateRawSync} from 'node:zlib';
import type {Block} from './document';

/** A Word file with the template's page, fonts, heading styles and table look
 * (NRN-GP-REP-001 v1.0): Letter, 0.65 in margins, DejaVu Sans, navy header rows. */
const esc=(s:string)=>s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g,'');
const run=(text:string,props='')=>`<w:r>${props?`<w:rPr>${props}</w:rPr>`:''}<w:t xml:space="preserve">${esc(text)}</w:t></w:r>`;
const W='xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';

function cell(text:string,width:number,head:boolean,band:boolean){
 const fill=head?'20374F':band?'F2F5F8':'FFFFFF';
 return `<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/><w:shd w:val="clear" w:color="auto" w:fill="${fill}"/><w:tcMar><w:top w:w="65" w:type="dxa"/><w:left w:w="85" w:type="dxa"/><w:bottom w:w="65" w:type="dxa"/><w:right w:w="85" w:type="dxa"/></w:tcMar><w:vAlign w:val="center"/></w:tcPr>`
  +`<w:p><w:pPr><w:spacing w:after="0" w:line="245" w:lineRule="auto"/></w:pPr>${run(text,head?'<w:b/><w:color w:val="FFFFFF"/><w:sz w:val="18"/>':'<w:sz w:val="18"/>')}</w:p></w:tc>`;
}
function body(blocks:Block[]){
 let breakNext=false;const out:string[]=[];
 const pPr=(style:string|null,extra='')=>{const b=breakNext;breakNext=false;return (style||b||extra)?`<w:pPr>${style?`<w:pStyle w:val="${style}"/>`:''}${b?'<w:pageBreakBefore/>':''}${extra}</w:pPr>`:'';};
 for(const b of blocks){
  if(b.type==='pagebreak'){breakNext=true;continue;}
  if(b.type==='table'){
   const border=['top','left','bottom','right','insideH','insideV'].map(k=>`<w:${k} w:val="single" w:sz="5" w:space="0" w:color="D9D9D9"/>`).join('');
   if(breakNext)out.push(`<w:p>${pPr(null)}</w:p>`);
   out.push(`<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/><w:jc w:val="center"/><w:tblBorders>${border}</w:tblBorders><w:tblLayout w:type="fixed"/><w:tblLook w:val="04A0" w:firstRow="1" w:lastRow="0" w:firstColumn="1" w:lastColumn="0" w:noHBand="0" w:noVBand="1"/></w:tblPr>`
    +`<w:tblGrid>${b.widths.map(w=>`<w:gridCol w:w="${w}"/>`).join('')}</w:tblGrid>`
    +`<w:tr><w:trPr><w:tblHeader/></w:trPr>${b.head.map((h,i)=>cell(h,b.widths[i],true,false)).join('')}</w:tr>`
    +b.rows.map((r,ri)=>`<w:tr><w:trPr><w:cantSplit/></w:trPr>${r.map((c,i)=>cell(c,b.widths[i],false,ri%2===0)).join('')}</w:tr>`).join('')+'</w:tbl>');
   continue;
  }
  const style={title:'Title',h1:'Heading1',h2:'Heading2',meta:null,p:null,small:null}[b.type];
  const props=b.type==='meta'||b.type==='small'?'<w:sz w:val="17"/>':'';
  out.push(`<w:p>${pPr(style)}${run(b.text,props)}</w:p>`);
 }
 return out.join('');
}

const styles=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles ${W}>`
 +'<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="DejaVu Sans" w:eastAsia="DejaVu Sans" w:hAnsi="DejaVu Sans" w:cs="DejaVu Sans"/><w:sz w:val="20"/><w:szCs w:val="20"/><w:lang w:val="en-US"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="80" w:line="252" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>'
 +'<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/><w:rPr><w:rFonts w:ascii="DejaVu Sans" w:eastAsia="DejaVu Sans" w:hAnsi="DejaVu Sans" w:cs="DejaVu Sans"/><w:color w:val="000000"/><w:sz w:val="20"/></w:rPr></w:style>'
 +'<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:after="100" w:line="240" w:lineRule="auto"/></w:pPr><w:rPr><w:sz w:val="34"/></w:rPr></w:style>'
 +'<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:keepLines/><w:spacing w:before="0" w:after="120"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:sz w:val="28"/></w:rPr></w:style>'
 +'<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:keepLines/><w:spacing w:before="100" w:after="60"/><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:b/><w:sz w:val="22"/></w:rPr></w:style>'
 +'<w:style w:type="paragraph" w:styleId="Footer"><w:name w:val="footer"/><w:basedOn w:val="Normal"/><w:pPr><w:jc w:val="right"/><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:rPr><w:sz w:val="15"/></w:rPr></w:style>'
 +'</w:styles>';

export function renderDocx(blocks:Block[],footer:string,title:string):Uint8Array{
 const document=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${W}><w:body>${body(blocks)}`
  +'<w:sectPr><w:footerReference w:type="default" r:id="rIdFooter"/><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="835" w:right="936" w:bottom="835" w:left="936" w:header="720" w:footer="317" w:gutter="0"/><w:cols w:space="720"/></w:sectPr></w:body></w:document>';
 const footerXml=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:ftr ${W}><w:p><w:pPr><w:pStyle w:val="Footer"/></w:pPr>${run(`${footer} | `)}<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r>${run('1')}<w:r><w:fldChar w:fldCharType="end"/></w:r></w:p></w:ftr>`;
 const files:[string,string][]=[
  ['[Content_Types].xml','<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>'],
  ['_rels/.rels','<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>'],
  ['docProps/core.xml',`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${esc(title)}</dc:title><dc:creator>Noreon</dc:creator></cp:coreProperties>`],
  ['word/_rels/document.xml.rels','<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rIdFooter" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/></Relationships>'],
  ['word/document.xml',document],['word/styles.xml',styles],['word/footer1.xml',footerXml],
 ];
 return zip(files.map(([name,text])=>[name,new TextEncoder().encode(text)]));
}

// A minimal deflate zip writer; Word needs nothing more.
const CRC=(()=>{const t=new Uint32Array(256);for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;t[n]=c>>>0;}return t;})();
function crc32(b:Uint8Array){let c=0xffffffff;for(const x of b)c=CRC[(c^x)&0xff]^(c>>>8);return (c^0xffffffff)>>>0;}
function zip(files:[string,Uint8Array][]):Uint8Array{
 const parts:Uint8Array[]=[];const central:Uint8Array[]=[];let offset=0;
 for(const [name,data] of files){
  const nameBytes=new TextEncoder().encode(name);const packed=deflateRawSync(data);const crc=crc32(data);
  const local=new DataView(new ArrayBuffer(30));
  local.setUint32(0,0x04034b50,true);local.setUint16(4,20,true);local.setUint16(6,0x0800,true);local.setUint16(8,8,true);
  local.setUint16(10,0,true);local.setUint16(12,0x21,true);local.setUint32(14,crc,true);local.setUint32(18,packed.length,true);local.setUint32(22,data.length,true);local.setUint16(26,nameBytes.length,true);
  parts.push(new Uint8Array(local.buffer),nameBytes,packed);
  const c=new DataView(new ArrayBuffer(46));
  c.setUint32(0,0x02014b50,true);c.setUint16(4,20,true);c.setUint16(6,20,true);c.setUint16(8,0x0800,true);c.setUint16(10,8,true);c.setUint16(12,0,true);c.setUint16(14,0x21,true);
  c.setUint32(16,crc,true);c.setUint32(20,packed.length,true);c.setUint32(24,data.length,true);c.setUint16(28,nameBytes.length,true);c.setUint32(42,offset,true);
  central.push(new Uint8Array(c.buffer),nameBytes);
  offset+=30+nameBytes.length+packed.length;
 }
 const size=central.reduce((a,b)=>a+b.length,0);
 const end=new DataView(new ArrayBuffer(22));
 end.setUint32(0,0x06054b50,true);end.setUint16(8,files.length,true);end.setUint16(10,files.length,true);end.setUint32(12,size,true);end.setUint32(16,offset,true);
 const all=[...parts,...central,new Uint8Array(end.buffer)];
 const out=new Uint8Array(all.reduce((a,b)=>a+b.length,0));let at=0;for(const p of all){out.set(p,at);at+=p.length;}
 return out;
}
