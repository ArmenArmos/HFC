"use client"

import * as React from "react"
import { Select as SelectPrimitive } from "@base-ui/react/select"
import { Combobox as ComboboxPrimitive } from "@base-ui/react/combobox"
import { CheckIcon, ChevronDownIcon, SearchIcon } from "lucide-react"

import { cn } from "@/lib/utils"

/**
 * The product's one dropdown. Full width, 48px tall, a name with an optional
 * secondary line, and a search box once the list is longer than a screenful.
 *
 * Form behaviour stays native on purpose. A visually hidden `<select>` carries
 * `name`, `required` and `form`, so server actions read the same FormData as
 * before, `required` still blocks submission, and a form reset returns to
 * `defaultValue` exactly as a native select would. The visible control is the
 * Base UI Select (or Combobox when searchable), which owns keyboard and
 * screen-reader behaviour.
 */
export type SelectOption = {
  value: string
  label: string
  /** A quieter second line, such as the clinic of a doctor. */
  description?: string
  disabled?: boolean
}

type SelectFieldProps = {
  options: readonly SelectOption[]
  value?: string
  defaultValue?: string
  onValueChange?: (value: string) => void
  name?: string
  form?: string
  id?: string
  required?: boolean
  disabled?: boolean
  /** Shown when the value matches no option, typically "Choose one". */
  placeholder?: string
  /** Search box in the popup. Defaults to on for more than 8 options. */
  searchable?: boolean
  searchPlaceholder?: string
  emptyText?: string
  className?: string
  size?: "default" | "sm"
  "aria-label"?: string
  "aria-labelledby"?: string
  "aria-describedby"?: string
  "aria-invalid"?: boolean
}

const SEARCH_THRESHOLD = 8

const triggerClass =
  "flex w-full min-w-0 items-center justify-between gap-2 rounded-md border border-input bg-background px-3 text-left text-body2 text-foreground transition-colors outline-none select-none hover:border-ring/60 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/40 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive data-popup-open:border-ring data-[size=default]:min-h-12 data-[size=sm]:min-h-11 data-[size=default]:py-1.5 data-[size=sm]:py-1"

const popupClass =
  "z-50 max-h-[min(24rem,var(--available-height))] w-(--anchor-width) max-w-(--available-width) min-w-56 origin-(--transform-origin) overflow-hidden rounded-lg border bg-popover text-popover-foreground shadow-lg outline-none data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0"

const itemClass =
  "relative flex min-h-11 w-full cursor-default items-center gap-2 rounded-md py-2 pr-9 pl-3 text-left text-body2 outline-hidden select-none data-highlighted:bg-muted data-disabled:pointer-events-none data-disabled:opacity-50"

function OptionText({ option, trigger = false }: { option: SelectOption; trigger?: boolean }) {
  return (
    <span className="flex min-w-0 flex-1 flex-col">
      <span className={cn("break-words", trigger && "truncate")}>{option.label}</span>
      {option.description && (
        <span className={cn("text-caption text-muted-foreground", trigger ? "truncate" : "break-words")}>
          {option.description}
        </span>
      )}
    </span>
  )
}

function TriggerContent({ selected, placeholder }: { selected?: SelectOption; placeholder?: string }) {
  return (
    <>
      {selected ? (
        <OptionText option={selected} trigger />
      ) : (
        <span className="min-w-0 flex-1 truncate text-muted-foreground">{placeholder ?? ""}</span>
      )}
      <ChevronDownIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
    </>
  )
}

function matches(option: SelectOption, query: string) {
  const q = query.trim().toLocaleLowerCase()
  if (!q) return true
  return `${option.label} ${option.description ?? ""}`.toLocaleLowerCase().includes(q)
}

export function SelectField({
  options,
  value: controlled,
  defaultValue = "",
  onValueChange,
  name,
  form,
  id,
  required,
  disabled,
  placeholder,
  searchable,
  searchPlaceholder = "Search",
  emptyText = "No matches",
  className,
  size = "default",
  ...aria
}: SelectFieldProps) {
  // Like a native select: with no placeholder, an unmatched default falls back
  // to the first enabled option rather than submitting an empty value.
  const initial =
    placeholder !== undefined || options.some(option => option.value === defaultValue)
      ? defaultValue
      : (options.find(option => !option.disabled)?.value ?? defaultValue)
  const [uncontrolled, setUncontrolled] = React.useState(initial)
  const value = controlled ?? uncontrolled
  const latest = React.useRef({ value, defaultValue: initial, controlled: controlled !== undefined })
  React.useEffect(() => {
    latest.current = { value, defaultValue: initial, controlled: controlled !== undefined }
  })
  const nativeRef = React.useRef<HTMLSelectElement>(null)
  const triggerRef = React.useRef<HTMLButtonElement>(null)
  const generatedId = React.useId()
  const triggerId = id ?? generatedId
  const selected = options.find(option => option.value === value)
  const search = searchable ?? options.length > SEARCH_THRESHOLD

  const change = React.useCallback(
    (next: string) => {
      if (!latest.current.controlled) setUncontrolled(next)
      onValueChange?.(next)
    },
    [onValueChange]
  )

  // Keep the hidden native control in step with what is shown.
  React.useEffect(() => {
    if (nativeRef.current && nativeRef.current.value !== value) nativeRef.current.value = value
  })

  // A native select returns to its default on form reset; mirror that.
  React.useEffect(() => {
    const owner = nativeRef.current?.form
    if (!owner) return
    const onReset = () => {
      queueMicrotask(() => {
        const { controlled: isControlled, defaultValue: resetTo, value: current } = latest.current
        if (isControlled) {
          if (nativeRef.current) nativeRef.current.value = current
        } else setUncontrolled(resetTo)
      })
    }
    owner.addEventListener("reset", onReset)
    return () => owner.removeEventListener("reset", onReset)
  }, [])

  const native = (
    <select
      ref={nativeRef}
      aria-hidden
      tabIndex={-1}
      name={name}
      form={form}
      required={required}
      disabled={disabled}
      value={value}
      onChange={event => change(event.target.value)}
      onInvalid={() => triggerRef.current?.focus()}
      className="pointer-events-none absolute bottom-0 left-0 h-px w-full opacity-0"
    >
      {!selected && <option value={value}>{placeholder ?? ""}</option>}
      {options.map(option => (
        <option key={option.value} value={option.value} disabled={option.disabled}>
          {option.label}
        </option>
      ))}
    </select>
  )

  const triggerProps = {
    id: triggerId,
    "data-size": size,
    "aria-label": aria["aria-label"],
    "aria-labelledby": aria["aria-labelledby"],
    "aria-describedby": aria["aria-describedby"],
    "aria-invalid": aria["aria-invalid"],
    "aria-required": required || undefined,
    className: triggerClass,
  }

  if (search) {
    return (
      <div className={cn("relative w-full min-w-0", className)} data-slot="select-field">
        <SearchableSelect
          options={options}
          selected={selected}
          onChange={change}
          disabled={disabled}
          placeholder={placeholder}
          searchPlaceholder={searchPlaceholder}
          emptyText={emptyText}
          triggerRef={triggerRef}
          triggerProps={triggerProps}
        />
        {native}
      </div>
    )
  }

  return (
    <div className={cn("relative w-full min-w-0", className)} data-slot="select-field">
      <SelectPrimitive.Root
        value={value}
        onValueChange={next => change(String(next ?? ""))}
        disabled={disabled}
        items={options.map(option => ({ value: option.value, label: option.label }))}
      >
        <SelectPrimitive.Trigger ref={triggerRef} {...triggerProps}>
          <TriggerContent selected={selected} placeholder={placeholder} />
        </SelectPrimitive.Trigger>
        <SelectPrimitive.Portal>
          <SelectPrimitive.Positioner side="bottom" sideOffset={4} align="start" alignItemWithTrigger={false} className="isolate z-50">
            <SelectPrimitive.Popup className={popupClass}>
              <SelectPrimitive.List className="max-h-[min(24rem,var(--available-height))] overflow-y-auto overscroll-contain p-1">
                {options.map(option => (
                  <SelectPrimitive.Item key={option.value} value={option.value} disabled={option.disabled} className={itemClass}>
                    <SelectPrimitive.ItemText className="flex min-w-0 flex-1">
                      <OptionText option={option} />
                    </SelectPrimitive.ItemText>
                    <SelectPrimitive.ItemIndicator className="absolute right-3 flex items-center text-primary">
                      <CheckIcon className="size-4" aria-hidden />
                    </SelectPrimitive.ItemIndicator>
                  </SelectPrimitive.Item>
                ))}
              </SelectPrimitive.List>
            </SelectPrimitive.Popup>
          </SelectPrimitive.Positioner>
        </SelectPrimitive.Portal>
      </SelectPrimitive.Root>
      {native}
    </div>
  )
}

function SearchableSelect({
  options,
  selected,
  onChange,
  disabled,
  placeholder,
  searchPlaceholder,
  emptyText,
  triggerRef,
  triggerProps,
}: {
  options: readonly SelectOption[]
  selected?: SelectOption
  onChange: (value: string) => void
  disabled?: boolean
  placeholder?: string
  searchPlaceholder: string
  emptyText: string
  triggerRef: React.Ref<HTMLButtonElement>
  triggerProps: Record<string, unknown> & { className: string }
}) {
  return (
    <ComboboxPrimitive.Root
      items={options as SelectOption[]}
      value={selected ?? null}
      onValueChange={next => {
        if (next) onChange((next as SelectOption).value)
      }}
      disabled={disabled}
      isItemEqualToValue={(item: SelectOption, current: SelectOption) => item.value === current.value}
      itemToStringLabel={(item: SelectOption) => item.label}
      filter={(item: SelectOption, query: string) => matches(item, query)}
      autoHighlight
    >
      <ComboboxPrimitive.Trigger ref={triggerRef} {...triggerProps}>
        <TriggerContent selected={selected} placeholder={placeholder} />
      </ComboboxPrimitive.Trigger>
      <ComboboxPrimitive.Portal>
        <ComboboxPrimitive.Positioner side="bottom" sideOffset={4} align="start" className="isolate z-50">
          <ComboboxPrimitive.Popup className={cn(popupClass, "flex flex-col")} aria-label={searchPlaceholder}>
            <div className="relative border-b p-1">
              <SearchIcon className="pointer-events-none absolute top-1/2 left-4 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <ComboboxPrimitive.Input
                placeholder={searchPlaceholder}
                className="min-h-11 w-full rounded-md bg-transparent pr-3 pl-9 text-body2 outline-none placeholder:text-muted-foreground"
              />
            </div>
            <ComboboxPrimitive.Empty className="px-3 py-4 text-body2 text-muted-foreground empty:hidden">{emptyText}</ComboboxPrimitive.Empty>
            <ComboboxPrimitive.List className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-1 empty:p-0">
              {(option: SelectOption) => (
                <ComboboxPrimitive.Item key={option.value} value={option} disabled={option.disabled} className={itemClass}>
                  <OptionText option={option} />
                  <ComboboxPrimitive.ItemIndicator className="absolute right-3 flex items-center text-primary">
                    <CheckIcon className="size-4" aria-hidden />
                  </ComboboxPrimitive.ItemIndicator>
                </ComboboxPrimitive.Item>
              )}
            </ComboboxPrimitive.List>
          </ComboboxPrimitive.Popup>
        </ComboboxPrimitive.Positioner>
      </ComboboxPrimitive.Portal>
    </ComboboxPrimitive.Root>
  )
}
