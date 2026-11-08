"use client";
import { useRef, type ReactNode } from "react";
import { Speaker } from "./speaker";

/** A finished block as dialog, for every block: what the member did, unless their own message already says it, then Zoe's reply. */
export function DialogTurn({ action, time, children }: { action: string | null; time: string; children: ReactNode }) {
  const content = useRef<HTMLDivElement>(null);
  const stamp = <p className="cv2-time" suppressHydrationWarning>{time}</p>;
  return <>
    {action && <article className="cv2-msg cv2-me" data-turn-action><p className="cv2-say">{action}</p>{stamp}</article>}
    <article className="cv2-msg cv2-zoe" data-turn-reply>
      <p className="cv2-from"><i className="cv2-orb" aria-hidden />Zoe</p>
      <div ref={content} className="cv2-say cv2-turn-reply">{children}</div>
      <Speaker text={() => content.current?.innerText ?? ""} />
      {stamp}
    </article>
  </>;
}
