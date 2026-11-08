import type { Metadata } from "next";
import { ContactForm } from "@/components/marketing/contact-form";

export const metadata: Metadata = { title: "Contact us" };

export default function ContactPage() {
  return (
    <section className="max-w-noreon mx-auto px-6 py-16 md:px-8 md:py-24">
      <div className="mx-auto max-w-xl">
        <h1 className="text-display3 font-extrabold tracking-tight">Contact us</h1>
        <p className="text-muted-foreground mt-4 mb-10 text-body1">Have a question or want to discuss working together? Write to us or request a call. You can also email <a href="mailto:info@noreon.health" className="text-primary underline underline-offset-4">info@noreon.health</a>.</p>
        <ContactForm />
      </div>
    </section>
  );
}
