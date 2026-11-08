const call=async(name:string,input:unknown)=>(await fetch('/fixture/'+name,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(input)})).json();
export const startPracticeSession=(i:unknown)=>call('start',i);
export const sendPracticeMessage=(i:unknown)=>call('send',i);
export const changePracticeRecord=(i:unknown)=>call('edit',i);
export const resetPracticeSession=(i:unknown)=>call('reset',i);
export const markPracticeReply=(i:unknown)=>call('mark',i);
