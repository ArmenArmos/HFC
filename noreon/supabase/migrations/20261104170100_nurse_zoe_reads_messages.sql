-- Ask Zoe for a nurse: the member's conversation.
--
-- A nurse opens the same conversation directly (conversation_nurse_workspace: the member's messages, the replies she and the
-- doctor sent, and Zoe's answers; never a private doctor draft or a model trace). Ask Zoe refused it for her ("Not shown for
-- your role"), so it answered "Not known" to a question the conversation settles (Armen's staging QA, 4 Nov). The tool is
-- now allowed for the nurse and reads through conversation_nurse_workspace, which keeps its own assignment check and audit.
-- Zoe's run history (zoe_runs_for_doctor) stays doctor only. Doctor tools, and the nurse's other tools, are unchanged.
create or replace function public._staff_zoe_tool_allowed(p_role text,p_tool text)returns boolean language sql immutable set search_path=''as $$
 select case p_role
  when 'doctor' then p_tool in('overview','bp','labs','ldl','plan','adherence','open_items','visits','member_messages','zoe_why','lipid_plan')
  when 'nurse' then p_tool in('overview','bp','plan','adherence','open_items','visits','member_messages')
  else false end
$$;
