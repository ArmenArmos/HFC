'use client';

import type {ReactNode} from 'react';
import {Dialog as DialogPrimitive} from '@base-ui/react/dialog';
import {XIcon} from 'lucide-react';
import {Dialog, DialogDescription, DialogOverlay, DialogPortal, DialogTitle, DialogTrigger} from '@/components/ui/dialog';

/** One staff-directory action: a labelled trigger in the row and its form in a dialog
 * (a bottom sheet on phones). The popup stays mounted while closed, as the old inline
 * disclosure did, so a form that is waiting on an unconfirmed outcome keeps its
 * request id and its lock when the dialog is closed and opened again. */
export function StaffActionDialog({label, icon, title, description, tone = 'default', children}: {label: string; icon: ReactNode; title: string; description?: string; tone?: 'default' | 'destructive'; children: ReactNode}) {
  const trigger = tone === 'destructive'
    ? 'border-destructive/30 text-destructive hover:bg-destructive/10'
    : 'hover:bg-muted';
  return <Dialog>
    <DialogTrigger className={`inline-flex min-h-11 min-w-0 items-center gap-1.5 rounded-md border bg-background px-2.5 text-left sm:gap-2 sm:px-3 whitespace-nowrap text-body2 font-medium focus-visible:outline-2 focus-visible:outline-ring ${trigger}`}>
      <span className="shrink-0 [&_svg]:size-4" aria-hidden>{icon}</span><span>{label}</span>
    </DialogTrigger>
    <DialogPortal keepMounted>
      <DialogOverlay/>
      <DialogPrimitive.Popup className="fixed inset-x-0 bottom-0 z-50 max-h-[90dvh] overflow-y-auto rounded-t-xl bg-popover p-5 text-popover-foreground ring-1 ring-foreground/10 outline-none sm:inset-x-auto sm:bottom-auto sm:top-1/2 sm:left-1/2 sm:w-full sm:max-w-lg sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-xl data-closed:hidden">
        <div className="mb-4 space-y-1 pr-10">
          <DialogTitle className="break-words text-h3 font-semibold">{title}</DialogTitle>
          {description && <DialogDescription className="break-words text-caption">{description}</DialogDescription>}
        </div>
        {children}
        <DialogPrimitive.Close className="absolute top-3 right-3 inline-flex size-11 items-center justify-center rounded-md hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring">
          <XIcon className="size-4" aria-hidden/><span className="sr-only">Close</span>
        </DialogPrimitive.Close>
      </DialogPrimitive.Popup>
    </DialogPortal>
  </Dialog>;
}
