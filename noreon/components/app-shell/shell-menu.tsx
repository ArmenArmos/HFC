"use client";
import { useId, useState } from "react";
import { usePathname } from "next/navigation";
import { Menu, X } from "lucide-react";

/** On phones the links sit behind a button, so a page starts on the first screen. From lg up the button
 * is gone and the links are always shown. The shell stays mounted across navigation, so a new path closes it. */
export function ShellMenu({ label, brand, sidebarHeader, children }: {
  label: string;
  brand: React.ReactNode;
  sidebarHeader: React.ReactNode;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const panel = useId();
  const path = usePathname();
  const [openedOn, setOpenedOn] = useState(path);
  if (openedOn !== path) { setOpenedOn(path); setOpen(false); }
  const Icon = open ? X : Menu;
  return <>
    <div className="flex items-center gap-3 px-5 py-2 lg:justify-between lg:px-6 lg:pb-6 lg:pt-8">
      {brand}
      {children && <button type="button" aria-expanded={open} aria-controls={panel} onClick={() => setOpen(value => !value)} className="ml-auto inline-flex min-h-11 items-center gap-2 rounded-md border px-3 text-body2 font-medium focus-visible:outline-2 focus-visible:outline-ring lg:hidden">
        <Icon className="size-5" aria-hidden />{label}
      </button>}
    </div>
    {sidebarHeader}
    <div id={panel} className={open ? "lg:block" : "hidden lg:block"}>{children}</div>
  </>;
}
