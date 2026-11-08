import {BP_PHOTO_MAX_BYTES} from './config';
/** Redraw strips metadata. The original and the JPEG live only in this tab's memory. */
export async function prepareBpPhoto(file:File):Promise<Blob>{
 if(!['image/jpeg','image/png'].includes(file.type))throw Error('Unsupported photo');
 const url=URL.createObjectURL(file);
 try{
  const image=new Image();image.src=url;await image.decode();
  const scale=Math.min(1,1600/Math.max(image.naturalWidth,image.naturalHeight));
  const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(image.naturalWidth*scale));canvas.height=Math.max(1,Math.round(image.naturalHeight*scale));
  const context=canvas.getContext('2d');if(!context)throw Error('Photo unavailable');
  context.drawImage(image,0,0,canvas.width,canvas.height);
  const blob=await new Promise<Blob|null>(resolve=>canvas.toBlob(resolve,'image/jpeg',0.85));
  if(!blob||blob.size>BP_PHOTO_MAX_BYTES)throw Error('Photo too large');
  return blob;
 }finally{URL.revokeObjectURL(url);}
}
