import type { ReactNode } from "react";

/** Home's notice inventory. Both Home and chat render this list, with the same conditions/actions. */
export const HOME_NOTICE_IDS = [
  "chest-pain", "zoe-consent", "first-note", "ldl", "medicine-ask",
  "exercise-paused", "consultation-hold", "attention", "pending-review", "care-team",
] as const;
export type HomeNoticeId = typeof HOME_NOTICE_IDS[number];

export function HomeNotices({ cards }: { cards: Record<HomeNoticeId, ReactNode> }) {
  return HOME_NOTICE_IDS.map(id => cards[id] ? <div key={id} data-home-notice={id}>{cards[id]}</div> : null);
}
