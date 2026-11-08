import {readFile} from 'node:fs/promises';
import path from 'node:path';
import fontkit from '@pdf-lib/fontkit';
import {PDFDocument,rgb,type PDFFont,type PDFPage} from 'pdf-lib';
import type {Block} from './document';

/**
 * The template's page in PDF: US Letter, 0.65 in margins, DejaVu Sans (the template's
 * body font, which also covers Armenian), navy table headers with banded rows.
 * Sizes are the template's half-point sizes divided by two.
 */
// Template margins: 835 twips top and bottom, 936 left and right; footer 317 twips from the edge.
const PAGE={w:612,h:792,side:46.8,top:41.75,bottom:41.75,footer:15.85};
const NAVY=rgb(0x20/255,0x37/255,0x4f/255),BAND=rgb(0xf2/255,0xf5/255,0xf8/255),RULE=rgb(0xd9/255,0xd9/255,0xd9/255),INK=rgb(0,0,0),WHITE=rgb(1,1,1);
const STYLE={title:{size:17,bold:false,before:0,after:5,lead:1.15},meta:{size:8.5,bold:false,before:0,after:3,lead:1.25},h1:{size:14,bold:true,before:4,after:8,lead:1.2},h2:{size:11,bold:true,before:5,after:3,lead:1.2},p:{size:9.5,bold:false,before:0,after:3,lead:1.2},small:{size:8.25,bold:false,before:0,after:3,lead:1.2}} as const;
const CELL={size:8.25,pad:3.25,lead:1.18};
// DejaVu's Armenian glyphs run wider than its Latin ones; Armenian pages are set 6% smaller
// so the same content keeps the template's page budget.
const scaleOf=(text:string)=>/[\u0531-\u058f]/.test(text)?0.94:1;

export const FONT_DIR=path.join(process.cwd(),'lib/gp-report/fonts');
export async function loadFonts(){
 const [regular,bold]=await Promise.all([readFile(path.join(FONT_DIR,'DejaVuSans.ttf')),readFile(path.join(FONT_DIR,'DejaVuSans-Bold.ttf'))]);
 return {regular,bold};
}

function wrap(text:string,font:PDFFont,size:number,width:number):string[]{
 const lines:string[]=[];
 for(const para of text.split('\n')){
  let line='';
  for(const word of para.split(/ +/)){
   const next=line?`${line} ${word}`:word;
   if(font.widthOfTextAtSize(next,size)<=width){line=next;continue;}
   if(line)lines.push(line);
   // A single word wider than the column is broken by characters.
   let rest=word;
   while(font.widthOfTextAtSize(rest,size)>width){
    let i=rest.length;while(i>1&&font.widthOfTextAtSize(rest.slice(0,i),size)>width)i--;
    lines.push(rest.slice(0,i));rest=rest.slice(i);
   }
   line=rest;
  }
  lines.push(line);
 }
 return lines;
}

export async function renderPdf(blocks:Block[],footer:string,fonts:{regular:Uint8Array;bold:Uint8Array},title:string):Promise<Uint8Array>{
 const pdf=await PDFDocument.create();
 pdf.registerFontkit(fontkit);
 pdf.setTitle(title);pdf.setCreator('Noreon');pdf.setProducer('Noreon GP report');
 const regular=await pdf.embedFont(fonts.regular,{subset:true}),bold=await pdf.embedFont(fonts.bold,{subset:true});
 const width=PAGE.w-2*PAGE.side;
 let page:PDFPage=pdf.addPage([PAGE.w,PAGE.h]);let y=PAGE.h-PAGE.top;
 const pages=[page];
 const newPage=()=>{page=pdf.addPage([PAGE.w,PAGE.h]);pages.push(page);y=PAGE.h-PAGE.top;};
 const bottom=PAGE.bottom;
 const ensure=(h:number)=>{if(y-h<bottom)newPage();};
 for(let bi=0;bi<blocks.length;bi++){
  const block=blocks[bi];
  if(block.type==='pagebreak'){newPage();continue;}
  if(block.type==='table'){
   const total=block.widths.reduce((a,b)=>a+b,0);
   const cols=block.widths.map(w=>w/total*width);
   const size=CELL.size*scaleOf(block.head.join(' '));
   const drawRow=(cells:string[],head:boolean,band:boolean)=>{
    const font=head?bold:regular;
    const wrapped=cells.map((c,i)=>wrap(c,font,size,cols[i]-2*CELL.pad));
    const h=Math.max(...wrapped.map(w=>w.length))*size*CELL.lead+2*CELL.pad;
    ensure(h);
    let x=PAGE.side;
    cells.forEach((_,i)=>{
     page.drawRectangle({x,y:y-h,width:cols[i],height:h,color:head?NAVY:band?BAND:WHITE,borderColor:RULE,borderWidth:0.6});
     wrapped[i].forEach((line,j)=>page.drawText(line,{x:x+CELL.pad,y:y-CELL.pad-(j+1)*size*CELL.lead+size*0.25,size,font,color:head?WHITE:INK}));
     x+=cols[i];
    });
    y-=h;
   };
   drawRow(block.head,true,false);
   block.rows.forEach((r,i)=>drawRow(r,false,i%2===0));
   y-=4;continue;
  }
  const base=STYLE[block.type];const font=base.bold?bold:regular;
  const st={...base,size:base.size*scaleOf(block.text)};
  const lines=wrap(block.text,font,st.size,width);
  const lineH=st.size*st.lead;
  // Keep a heading with the first lines of what follows it.
  const keep=block.type==='h1'||block.type==='h2'?lineH*3+st.before:lineH;
  y-=st.before;ensure(Math.max(keep,lineH));
  for(const line of lines){ensure(lineH);y-=lineH;page.drawText(line,{x:PAGE.side,y:y+st.size*0.22,size:st.size,font,color:INK});}
  y-=st.after;
 }
 pages.forEach((p,i)=>{
  const text=`${footer} | ${i+1}`;const size=7.5;
  p.drawText(text,{x:PAGE.w-PAGE.side-regular.widthOfTextAtSize(text,size),y:PAGE.footer,size,font:regular,color:INK});
 });
 return pdf.save();
}
