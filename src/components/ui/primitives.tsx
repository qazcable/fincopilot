"use client";

import clsx from "clsx";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { formatMoney } from "@/lib/domain/money";
import { haptic } from "@/lib/client/telegram";
import { HelpLink } from "../GuideList";

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "soft";
type ButtonSize = "sm" | "md" | "lg" | "icon";

const buttonVariants: Record<ButtonVariant, string> = {
  primary: "bg-accent text-accent-fg hover:opacity-90",
  secondary: "bg-surface-2 text-fg hover:bg-surface-3",
  soft: "bg-accent-soft text-accent hover:opacity-80",
  ghost: "text-muted hover:text-fg hover:bg-surface-2",
  danger: "bg-negative-soft text-negative hover:opacity-80",
};

const buttonSizes: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-[13px] rounded-full gap-1.5",
  md: "h-11 px-4 text-[15px] rounded-2xl gap-2",
  lg: "h-14 px-5 text-base rounded-2xl gap-2",
  icon: "size-14 rounded-2xl",
};

export function Button({
  variant = "primary",
  size = "md",
  loading = false,
  className,
  children,
  disabled,
  onClick,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: ButtonSize; loading?: boolean }) {
  return (
    <button
      type="button"
      {...props}
      disabled={disabled || loading}
      onClick={event => { haptic.tap(); onClick?.(event); }}
      className={clsx(
        "pressable inline-flex items-center justify-center font-semibold select-none disabled:opacity-50 disabled:pointer-events-none",
        buttonVariants[variant],
        buttonSizes[size],
        className
      )}
    >
      {loading ? <Loader2 className="size-4 animate-spin" /> : children}
    </button>
  );
}

export function Card({ className, children, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div {...props} className={clsx("rounded-3xl bg-surface shadow-card", className)}>
      {children}
    </div>
  );
}

export function Money({
  value,
  sign = false,
  className,
  currencyClassName,
}: { value: number; sign?: boolean; className?: string; currencyClassName?: string }) {
  const text = formatMoney(value, { sign, currency: false });
  return (
    <span className={clsx("tabular whitespace-nowrap", className)}>
      {text}
      <span className={clsx("ml-[0.18em]", currencyClassName ?? "opacity-60")}>₸</span>
    </span>
  );
}

export function CategoryIcon({ emoji, color, size = "md" }: { emoji: string; color: string; size?: "sm" | "md" | "lg" }) {
  const sizes = { sm: "size-8 text-base rounded-xl", md: "size-11 text-xl rounded-2xl", lg: "size-14 text-2xl rounded-[1.25rem]" };
  return (
    <span
      className={clsx("inline-flex shrink-0 items-center justify-center", sizes[size])}
      style={{ backgroundColor: `color-mix(in srgb, ${color} 16%, transparent)` }}
      aria-hidden
    >
      {emoji}
    </span>
  );
}

export function SectionHeader({ title, href, action, help }: { title: string; href?: string; action?: string; help?: string }) {
  return (
    <div className="mb-3 flex items-end justify-between px-1">
      <h2 className="flex items-center gap-0.5 text-[17px] font-semibold tracking-tight">
        {title}
        {help && <HelpLink topic={help} className="-my-1" />}
      </h2>
      {href && (
        <Link href={href} onClick={() => haptic.tap()} className="text-[14px] font-medium text-accent">
          {action ?? "Все"}
        </Link>
      )}
    </div>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  className,
}: { value: T; options: { value: T; label: string }[]; onChange: (value: T) => void; className?: string }) {
  return (
    <div role="tablist" className={clsx("grid rounded-2xl bg-surface-2 p-1", className)} style={{ gridTemplateColumns: `repeat(${options.length}, 1fr)` }}>
      {options.map(option => (
        <button
          key={option.value}
          type="button"
          role="tab"
          aria-selected={value === option.value}
          onClick={() => { haptic.select(); onChange(option.value); }}
          className={clsx(
            "h-9 rounded-xl text-[14px] font-semibold transition-all",
            value === option.value ? "bg-surface text-fg shadow-card" : "text-muted"
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (checked: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => { haptic.select(); onChange(!checked); }}
      className={clsx("relative h-7 w-12 shrink-0 rounded-full transition-colors", checked ? "bg-accent" : "bg-surface-3")}
    >
      <span className={clsx("absolute left-0 top-0.5 size-6 rounded-full bg-white shadow transition-transform", checked ? "translate-x-[22px]" : "translate-x-0.5")} />
    </button>
  );
}

export function Field({ label, hint, error, children }: { label: string; hint?: string; error?: string | null; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block px-1 text-[13px] font-medium text-muted">{label}</span>
      {children}
      {(error || hint) && (
        <span className={clsx("mt-1.5 block px-1 text-[12px]", error ? "text-negative" : "text-faint")}>{error || hint}</span>
      )}
    </label>
  );
}

export const inputClass =
  "h-12 w-full rounded-2xl bg-surface-2 px-4 text-[16px] text-fg placeholder:text-faint outline-none transition-shadow focus:ring-2 focus:ring-accent/40";

export function EmptyState({ emoji, title, text, children }: { emoji: string; title: string; text?: string; children?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 py-10 text-center">
      <div className="mb-3 text-4xl" aria-hidden>{emoji}</div>
      <p className="text-[16px] font-semibold">{title}</p>
      {text && <p className="mt-1 max-w-[260px] text-[14px] leading-snug text-muted">{text}</p>}
      {children && <div className="mt-4">{children}</div>}
    </div>
  );
}

export function PageHeader({ title, subtitle, action, help }: { title: string; subtitle?: string; action?: React.ReactNode; help?: string }) {
  return (
    <header className="flex items-end justify-between gap-3 px-5 pb-4 pt-6">
      <div className="min-w-0">
        <h1 className="flex items-center gap-1 text-[28px] font-bold leading-tight tracking-tight">
          {title}
          {help && <HelpLink topic={help} />}
        </h1>
        {subtitle && <p className="mt-0.5 text-[14px] text-muted">{subtitle}</p>}
      </div>
      {action}
    </header>
  );
}
