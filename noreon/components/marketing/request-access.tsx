"use client";

import { CheckIcon } from "lucide-react";
import {
  createContext,
  use,
  useCallback,
  useId,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";

import { submitAccessRequest } from "@/app/(marketing)/actions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useMarketingLocale } from "@/components/marketing/locale";
import {
  LIMITS,
  validateAccessRequest,
  type AccessRequestField,
  type AccessRequestIntent,
} from "@/lib/marketing/access-request";
import type { LocalizedHyEn } from "@/lib/clinical/types";
import { cn } from "@/lib/utils";

/**
 * The public site's only way in.
 *
 * Every call to action on the marketing surface opens this, and none of them
 * navigates. The guided demonstration under `/demo` is for internal
 * stakeholders and is reached by typing its URL; nothing public links to it,
 * which is the whole reason this dialog exists.
 *
 * One dialog rather than two, because the two audiences want the same four
 * things from a stranger and differ only in why they are asking. `intent`
 * carries that difference into the sheet and changes the words on screen;
 * everything else is shared, so the two cannot drift apart.
 *
 * It lives in a context because the buttons that open it are scattered across
 * the header, the hero, the closing section, the footer and the mobile menu. A
 * dialog per button would be five dialogs, five pieces of state, and five places
 * to fix anything.
 */

type Opener = (intent: AccessRequestIntent) => void;

const RequestAccessContext = createContext<Opener | null>(null);

/**
 * Opens the request dialog.
 *
 * Throws rather than no-oping outside the provider, because a call to action
 * that silently does nothing is the worst failure this page has: it looks like
 * it worked.
 */
export function useRequestAccess(): Opener {
  const open = use(RequestAccessContext);
  if (!open) {
    throw new Error("useRequestAccess must be used inside <RequestAccessProvider>");
  }
  return open;
}

/** What each intent calls itself, on screen and in the sheet. */
const WORDING: Record<
  AccessRequestIntent,
  { title: LocalizedHyEn; description: LocalizedHyEn; submit: LocalizedHyEn }
> = {
  demo: {
    title: { hy: "Պատվիրել դեմո", en: "Request a demo" },
    description: {
      hy: "Թողեք ձեր տվյալները, և մենք կապ կհաստատենք ձեզ հետ՝ ձեր կազմակերպության համար ցուցադրություն պայմանավորվելու համար։",
      en: "Leave your details and we will get in touch to arrange a walkthrough for your organisation.",
    },
    submit: { hy: "Ուղարկել հարցումը", en: "Send my request" },
  },
  access: {
    title: { hy: "Ակտիվացնել հասանելիությունը", en: "Activate access" },
    description: {
      hy: "Եթե հրավիրվել եք գործատուի, ապահովագրողի, բուժհաստատության կամ պետական ծրագրի միջոցով, թողեք ձեր տվյալները և մենք կուղարկենք ձեր հասանելիությունը։",
      en: "If you were invited through your employer, insurer, healthcare provider or a public programme, leave your details and we will send your access.",
    },
    submit: { hy: "Ուղարկել տվյալները", en: "Send my details" },
  },
};

const LABELS: Record<AccessRequestField, LocalizedHyEn> = {
  firstName: { hy: "Անուն", en: "First name" },
  lastName: { hy: "Ազգանուն", en: "Last name" },
  email: { hy: "Էլ. փոստ", en: "Email" },
  notes: { hy: "Նշումներ", en: "Notes" },
};

const ERRORS: Record<AccessRequestField, LocalizedHyEn> = {
  firstName: { hy: "Նշեք ձեր անունը։", en: "Enter your first name." },
  lastName: { hy: "Նշեք ձեր ազգանունը։", en: "Enter your last name." },
  email: {
    hy: "Նշեք էլ. փոստի հասցե, որին կարող ենք պատասխանել։",
    en: "Enter an email address we can reply to.",
  },
  notes: { hy: "Նշումները չափազանց երկար են։", en: "That is longer than we can store." },
};

/** One labelled control, with the error that belongs to it. */
function FormField({
  name,
  required,
  invalid,
  onClear,
  children,
  id,
}: {
  name: AccessRequestField;
  required?: boolean;
  invalid: boolean;
  /** Called on the first keystroke after this field was marked wrong. */
  onClear: (name: AccessRequestField) => void;
  children: (props: {
    id: string;
    "aria-invalid": boolean;
    "aria-describedby"?: string;
    /**
     * Attach this to whichever prop the control actually reports edits on.
     * It is handed over rather than spread because the two controls disagree:
     * Base UI's `Input` swallows `onChange` and reports through
     * `onValueChange`, while `Textarea` is a plain element and uses `onChange`.
     * Spreading one of them silently does nothing on the other, which is the
     * bug this parameter exists to make impossible to write.
     */
    clear: () => void;
  }) => React.ReactNode;
  id: string;
}) {
  const { t } = useMarketingLocale();
  const errorId = `${id}-error`;

  return (
    <div className="grid gap-1.5">
      <label htmlFor={id} className="text-body2 font-medium">
        {t(LABELS[name])}
        {!required && (
          <span className="text-muted-foreground font-normal">
            {" "}
            {t({ hy: "(ըստ ցանկության)", en: "(optional)" })}
          </span>
        )}
      </label>
      {/* The error clears as soon as the field is touched rather than waiting
          for the next submit. Otherwise somebody corrects the thing they were
          just told about and the complaint stays on screen, which reads as the
          correction not having worked. */}
      {children({
        id,
        "aria-invalid": invalid,
        "aria-describedby": invalid ? errorId : undefined,
        clear: () => {
          if (invalid) onClear(name);
        },
      })}
      {invalid && (
        <p id={errorId} className="text-destructive text-caption">
          {t(ERRORS[name])}
        </p>
      )}
    </div>
  );
}

export function RequestAccessProvider({ children }: { children: React.ReactNode }) {
  const { locale, t } = useMarketingLocale();
  const [intent, setIntent] = useState<AccessRequestIntent>("demo");
  const [open, setOpen] = useState(false);
  const [problems, setProblems] = useState<AccessRequestField[]>([]);
  const [failed, setFailed] = useState(false);
  const [done, setDone] = useState(false);
  const [pending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);
  const id = useId();

  /** Drops one field's complaint once the person starts fixing it. */
  const clearProblem = useCallback((name: AccessRequestField) => {
    setProblems((current) => current.filter((field) => field !== name));
  }, []);

  const openDialog = useCallback<Opener>((next) => {
    setIntent(next);
    // A dialog reopened after a success should be a fresh form, not a
    // confirmation the person has already read.
    setProblems([]);
    setFailed(false);
    setDone(false);
    setOpen(true);
  }, []);

  const wording = WORDING[intent];

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const input = {
      intent,
      firstName: String(data.get("firstName") ?? ""),
      lastName: String(data.get("lastName") ?? ""),
      email: String(data.get("email") ?? ""),
      notes: String(data.get("notes") ?? ""),
      locale,
    };

    const found = validateAccessRequest(input);
    setProblems(found);
    setFailed(false);
    if (found.length > 0) return;

    startTransition(async () => {
      const result = await submitAccessRequest(input);
      if (result.ok) {
        setDone(true);
        formRef.current?.reset();
        return;
      }
      // `invalid` cannot happen here — the same validator just passed — so both
      // failure modes are reported as our end being at fault, which is what a
      // person who filled the form in correctly should be told.
      setFailed(true);
    });
  }

  const value = useMemo(() => openDialog, [openDialog]);

  return (
    <RequestAccessContext value={value}>
      {children}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          {done ? (
            <>
              <DialogHeader>
                <span
                  className="bg-[var(--status-success-bg)] text-[var(--status-success-fg)] grid size-10 place-items-center rounded-full"
                  aria-hidden
                >
                  <CheckIcon className="size-5" />
                </span>
                <DialogTitle className="text-h3 mt-2">
                  {t({ hy: "Ստացանք, շնորհակալություն։", en: "Got it, thank you." })}
                </DialogTitle>
                <DialogDescription className="text-body2">
                  {t({
                    hy: "Մենք կպատասխանենք ձեր նշած էլ. փոստին։",
                    en: "We will reply to the email address you gave us.",
                  })}
                </DialogDescription>
              </DialogHeader>
              <Button
                className="press h-11 w-full"
                onClick={() => setOpen(false)}
              >
                {t({ hy: "Փակել", en: "Close" })}
              </Button>
            </>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle className="text-h3">{t(wording.title)}</DialogTitle>
                <DialogDescription className="text-body2 text-pretty">
                  {t(wording.description)}
                </DialogDescription>
              </DialogHeader>

              {/* `noValidate` because the browser's own bubbles are unstyled,
                  untranslated and announce in the browser's language rather than
                  the page's. The same validator runs here and on the server. */}
              <form ref={formRef} noValidate onSubmit={onSubmit} className="grid gap-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <FormField
                    name="firstName"
                    required
                    id={`${id}-first`}
                    onClear={clearProblem}
                    invalid={problems.includes("firstName")}
                  >
                    {({ clear, ...props }) => (
                      <Input
                        {...props}
                        onValueChange={clear}
                        name="firstName"
                        autoComplete="given-name"
                        maxLength={LIMITS.name}
                        className="h-11"
                      />
                    )}
                  </FormField>
                  <FormField
                    name="lastName"
                    required
                    id={`${id}-last`}
                    onClear={clearProblem}
                    invalid={problems.includes("lastName")}
                  >
                    {({ clear, ...props }) => (
                      <Input
                        {...props}
                        onValueChange={clear}
                        name="lastName"
                        autoComplete="family-name"
                        maxLength={LIMITS.name}
                        className="h-11"
                      />
                    )}
                  </FormField>
                </div>

                <FormField
                  name="email"
                  required
                  id={`${id}-email`}
                  onClear={clearProblem}
                  invalid={problems.includes("email")}
                >
                  {({ clear, ...props }) => (
                    <Input
                      {...props}
                      onValueChange={clear}
                      name="email"
                      type="email"
                      inputMode="email"
                      autoComplete="email"
                      maxLength={LIMITS.email}
                      className="h-11"
                    />
                  )}
                </FormField>

                <FormField
                  name="notes"
                  id={`${id}-notes`}
                  onClear={clearProblem}
                  invalid={problems.includes("notes")}
                >
                  {({ clear, ...props }) => (
                    <Textarea
                      {...props}
                      onChange={clear}
                      name="notes"
                      rows={3}
                      maxLength={LIMITS.notes}
                      placeholder={t({
                        hy: "Ձեր կազմակերպությունը, անդամների թիվը կամ ինչ եք փնտրում",
                        en: "Your organisation, how many members, or what you are looking for",
                      })}
                    />
                  )}
                </FormField>

                {/* A failure at our end is said in those words. Somebody typed
                    their details correctly and pressed a button; telling them
                    the submission was rejected would be a lie. */}
                {failed && (
                  <p
                    role="alert"
                    className="text-destructive bg-destructive/10 text-body2 rounded-lg px-3 py-2.5 text-pretty"
                  >
                    {t({
                      hy: "Ինչ-որ բան սխալ գնաց մեր կողմից։ Փորձեք նորից մի փոքր ուշ։",
                      en: "Something went wrong at our end. Please try again in a moment.",
                    })}
                  </p>
                )}

                <Button
                  type="submit"
                  size="lg"
                  disabled={pending}
                  className={cn("press h-12 w-full text-body1", pending && "opacity-70")}
                >
                  {pending
                    ? t({ hy: "Ուղարկվում է…", en: "Sending…" })
                    : t(wording.submit)}
                </Button>

                <p className="text-muted-foreground text-caption text-pretty">
                  {t({
                    hy: "Ձեր տվյալներն օգտագործվում են միայն ձեզ պատասխանելու համար։",
                    en: "We use your details only to reply to you.",
                  })}
                </p>
              </form>
            </>
          )}
        </DialogContent>
      </Dialog>
    </RequestAccessContext>
  );
}

/**
 * A call to action that opens the dialog.
 *
 * It is a component rather than an `onClick` at each call site so that "this
 * button opens the request form" is one thing in the codebase. The page has
 * nine of these.
 */
export function RequestAccessButton({
  intent,
  children,
  ...props
}: { intent: AccessRequestIntent } & React.ComponentProps<typeof Button>) {
  const open = useRequestAccess();
  return (
    <Button {...props} onClick={() => open(intent)}>
      {children}
    </Button>
  );
}

/** The same action, set as running text rather than as a control. */
export function RequestAccessLink({
  intent,
  children,
  className,
}: {
  intent: AccessRequestIntent;
  children: React.ReactNode;
  className?: string;
}) {
  const open = useRequestAccess();
  return (
    <button type="button" onClick={() => open(intent)} className={className}>
      {children}
    </button>
  );
}
