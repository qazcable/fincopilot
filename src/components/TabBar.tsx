"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import clsx from "clsx";
import { ChartPie, House, CalendarClock, ReceiptText, Plus } from "lucide-react";
import { useTransactionSheet } from "./TransactionSheet";
import { haptic } from "@/lib/client/telegram";

const tabs = [
  { href: "/", label: "Главная", icon: House },
  { href: "/history", label: "История", icon: ReceiptText },
  null,
  { href: "/payments", label: "Платежи", icon: CalendarClock },
  { href: "/stats", label: "Аналитика", icon: ChartPie },
];

export function TabBar() {
  const pathname = usePathname();
  const { openCreate } = useTransactionSheet();

  return (
    <nav className="safe-bottom fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface/80 backdrop-blur-xl">
      <div className="mx-auto grid h-16 max-w-lg grid-cols-5 items-center">
        {tabs.map(tab => {
          if (!tab) {
            return (
              <div key="add" className="flex justify-center">
                <button
                  type="button"
                  onClick={() => openCreate()}
                  aria-label="Добавить операцию"
                  className="pressable -mt-5 flex size-14 items-center justify-center rounded-full bg-accent text-accent-fg shadow-[0_10px_24px_-8px_var(--accent)]"
                >
                  <Plus className="size-7" strokeWidth={2.5} />
                </button>
              </div>
            );
          }
          const active = tab.href === "/" ? pathname === "/" : pathname.startsWith(tab.href);
          const Icon = tab.icon;
          return (
            <Link
              key={tab.href}
              href={tab.href}
              onClick={() => { if (!active) haptic.select(); }}
              className={clsx("flex h-full flex-col items-center justify-center gap-1 transition-colors", active ? "text-fg" : "text-faint")}
            >
              <Icon className="size-[22px]" strokeWidth={active ? 2.4 : 2} />
              <span className="text-[10.5px] font-medium">{tab.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
