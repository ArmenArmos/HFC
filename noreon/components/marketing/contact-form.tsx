"use client";

import { useRef, useState } from "react";
import { sendContact } from "@/app/(marketing)/contact/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

export function ContactForm() {
  const [callback, setCallback] = useState(false);
  const [status, setStatus] = useState<"idle" | "sending" | "error" | "sent">("idle");
  const requestId = useRef<string | null>(null);
  const sending = useRef(false);

  if (status === "sent") return (
    <div role="status" className="bg-muted rounded-2xl p-6">
      <h2 className="text-h2">Your message has been sent.</h2>
      <p className="text-muted-foreground mt-3">We’ll reply using the contact details you provided.</p>
    </div>
  );

  return (
    <form className="space-y-5" onSubmit={async (event) => {
      event.preventDefault();
      if (sending.current) return;
      sending.current = true;
      setStatus("sending");
      const data = new FormData(event.currentTarget);
      requestId.current ??= crypto.randomUUID();
      try {
        const result = await sendContact({
          id: requestId.current, name: String(data.get("name") ?? ""), email: String(data.get("email") ?? ""),
          message: String(data.get("message") ?? ""), callback,
          phone: String(data.get("phone") ?? ""), website: String(data.get("website") ?? ""),
        });
        setStatus(result.ok ? "sent" : "error");
      } catch { setStatus("error"); }
      finally { sending.current = false; }
    }}>
      <div>
        <label htmlFor="contact-name" className="mb-2 block font-medium">Name</label>
        <Input className="h-11" id="contact-name" name="name" autoComplete="name" required maxLength={100} disabled={status === "sending"} />
      </div>
      <div>
        <label htmlFor="contact-email" className="mb-2 block font-medium">Email</label>
        <Input className="h-11" id="contact-email" name="email" type="email" autoComplete="email" required maxLength={320} disabled={status === "sending"} />
      </div>
      <div>
        <label htmlFor="contact-message" className="mb-2 block font-medium">Message</label>
        <Textarea id="contact-message" name="message" required maxLength={2000} rows={5} disabled={status === "sending"} />
      </div>
      <label className="flex min-h-11 cursor-pointer items-center gap-3">
        <input type="checkbox" className="size-5 shrink-0 accent-primary" aria-controls="contact-phone-field" checked={callback} onChange={(event) => setCallback(event.target.checked)} disabled={status === "sending"} />
        Please call me. We’ll ask for your phone number.
      </label>
      {callback && <div id="contact-phone-field">
        <label htmlFor="contact-phone" className="mb-2 block font-medium">Phone number</label>
        <Input className="h-11" id="contact-phone" name="phone" type="tel" autoComplete="tel" required minLength={6} maxLength={50} pattern="[+0-9().\s\-]{6,50}" disabled={status === "sending"} />
      </div>}
      <div className="hidden" aria-hidden="true">
        <label htmlFor="contact-website">Website</label>
        <input id="contact-website" name="website" tabIndex={-1} autoComplete="off" />
      </div>
      <p className="text-muted-foreground text-caption">We’ll use these details to respond to your enquiry. Please avoid sending medical records or sensitive health information.</p>
      {status === "error" && <p role="alert" className="text-destructive">We couldn’t confirm delivery. Please try again or email <a className="underline" href="mailto:info@noreon.health">info@noreon.health</a>.</p>}
      <Button type="submit" size="lg" className="h-11 px-4" disabled={status === "sending"}>{status === "sending" ? "Sending…" : "Send message"}</Button>
    </form>
  );
}
