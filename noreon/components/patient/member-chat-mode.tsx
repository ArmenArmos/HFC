"use client";
import { createContext, useContext, type ReactNode } from "react";

const MemberChatMode = createContext(false);
export function MemberChatModeProvider({ enabled, children }: { enabled: boolean; children: ReactNode }) {
  return <MemberChatMode.Provider value={enabled}>{children}</MemberChatMode.Provider>;
}
export const useMemberChatMode = () => useContext(MemberChatMode);
