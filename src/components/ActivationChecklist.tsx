import Link from "next/link";
import clsx from "clsx";
import { Check } from "lucide-react";
import { Card } from "./ui/primitives";

export type ChecklistItem = { id: string; emoji: string; title: string; href: string; done: boolean };

/** Чек-лист первых шагов на главном экране: показывает прогресс и ведёт к нужным экранам, скрывается сам, когда всё сделано */
export function ActivationChecklist({ items }: { items: ChecklistItem[] }) {
  const doneCount = items.filter(i => i.done).length;
  if (doneCount === items.length) return null;

  return (
    <section>
      <Card className="space-y-3 p-4">
        <div className="flex items-center justify-between">
          <p className="text-[15px] font-semibold">Первые шаги в FinCopilot</p>
          <p className="text-[13px] text-muted">{doneCount} из {items.length}</p>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-surface-2">
          <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${Math.round((doneCount / items.length) * 100)}%` }} />
        </div>
        <div className="space-y-1">
          {items.map(item => (
            <Link key={item.id} href={item.href} className="pressable flex items-center gap-3 rounded-2xl px-1 py-2">
              <span className={clsx("flex size-8 shrink-0 items-center justify-center rounded-full", item.done ? "bg-positive-soft text-positive" : "bg-surface-2 text-muted")}>
                {item.done ? <Check className="size-4" /> : <span aria-hidden>{item.emoji}</span>}
              </span>
              <span className={clsx("text-[14px]", item.done ? "text-muted line-through" : "font-medium")}>{item.title}</span>
            </Link>
          ))}
        </div>
      </Card>
    </section>
  );
}
