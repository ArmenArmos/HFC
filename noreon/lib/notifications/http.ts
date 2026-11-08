import { readInbox, markNotificationRead, NotificationUnauthorized } from './server';
import { sameWorkspaceOrigin } from '@/lib/staff/request';
const headers = {'Cache-Control':'no-store'};
export async function notificationsGet(staff:boolean) {
 try { return Response.json({items:await readInbox(staff)},{headers}); }
 catch (error) {
  if (error instanceof NotificationUnauthorized) return Response.json({error:'Please sign in to see your notifications.'},{status:401,headers});
  return Response.json({error:'Notifications are unavailable. Try again.'},{status:503,headers});
 }
}
export async function notificationsPost(request:Request,staff:boolean) {
 if(!sameWorkspaceOrigin(request)) return new Response(null,{status:403});
 try { const {id}=await request.json(); if(!Number.isSafeInteger(id)||id<=0) return new Response(null,{status:400}); await markNotificationRead(staff,id);return Response.json({ok:true}); }
 catch (error) {
  if (error instanceof NotificationUnauthorized) return Response.json({error:'Please sign in to see your notifications.'},{status:401,headers});
  return Response.json({error:'Could not mark this notification as read. Try again.'},{status:400,headers});
 }
}
