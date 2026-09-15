import Link from "next/link";
import clsx from "clsx";
import { ChevronRight } from "lucide-react";

type Warning = { emoji: string; name: string; percent: number; state: "ok" | "warn" | "over" };

/** Категории, где месячный лимит почти или уже исчерпан — компактная плашка на главной */
export function LimitWarnings({ items }: { items: Warning[] }) {
  if (items.length === 0) return null;
  const over = items.some(item => item.state === "over");

  return (
    <Link
      href="/stats#limits"
      className={clsx(
        "pressable flex items-center gap-3 rounded-3xl px-4 py-3",
        over ? "bg-negative-soft" : "bg-warning-soft"
      )}
    >
      <span className="text-lg" aria-hidden>{over ? "🚫" : "⚠️"}</span>
      <span className="no-scrollbar flex min-w-0 flex-1 gap-3 overflow-x-auto text-[14px] font-medium">
        {items.map(item => (
          <span key={item.name} className={clsx("shrink-0 whitespace-nowrap", item.state === "over" ? "text-negative" : "text-warning")}>
            {item.emoji} {item.name} {item.percent}%
          </span>
        ))}
      </span>
      <ChevronRight className={clsx("size-4 shrink-0", over ? "text-negative" : "text-warning")} />
    </Link>
  );
}
