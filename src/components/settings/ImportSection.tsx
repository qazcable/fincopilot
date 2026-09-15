"use client";

import { useState, useTransition } from "react";
import clsx from "clsx";
import { FileText } from "lucide-react";
import { SectionHeader } from "../ui/primitives";
import { cancelImportAction } from "@/lib/actions/imports";
import { formatDayKeyShort } from "@/lib/domain/dates";
import { haptic } from "@/lib/client/telegram";

type ImportItem = { id: string; status: "APPLIED" | "CANCELLED"; periodFrom: string | null; periodTo: string | null; imported: number };

export function ImportSection({ imports, botUsername }: { imports: ImportItem[]; botUsername?: string }) {
  return (
    <section>
      <SectionHeader title="Выписка Kaspi" />
      <div className="space-y-4 rounded-3xl bg-surface p-4 shadow-card">
        <div className="flex gap-3">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-accent-soft text-accent"><FileText className="size-5" /></span>
          <p className="text-[14px] leading-snug text-muted">
            Импорт операций, которые вы не записали: без дублей, категории подбираются сами, баланс сверяется с Kaspi.
          </p>
        </div>
        <ol className="list-decimal space-y-1 pl-5 text-[14px] leading-snug text-muted">
          <li>Kaspi → <b className="font-medium text-fg">Kaspi Gold</b> → <b className="font-medium text-fg">Выписка</b> → период</li>
          <li><b className="font-medium text-fg">Поделиться</b> → Telegram → {botUsername ? `@${botUsername}` : "бот FinCopilot"}</li>
          <li>В ответ бот покажет сводку — нажмите «Импортировать»</li>
        </ol>
        {imports.length > 0 && (
          <div className="divide-y divide-line rounded-2xl bg-surface-2 px-3">
            {imports.map(item => <ImportRow key={item.id} item={item} />)}
          </div>
        )}
      </div>
    </section>
  );
}

function ImportRow({ item }: { item: ImportItem }) {
  const [confirm, setConfirm] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const cancelled = item.status === "CANCELLED";

  function cancel() {
    start(async () => {
      const result = await cancelImportAction(item.id);
      if (result.ok) haptic.success();
      else setError(result.error);
      setConfirm(false);
    });
  }

  return (
    <div className="flex items-center gap-3 py-3">
      <span className="min-w-0 flex-1">
        <span className={clsx("block text-[14px] font-medium", cancelled && "text-muted line-through")}>
          {item.periodFrom && item.periodTo ? `${formatDayKeyShort(item.periodFrom)} ${item.periodFrom.slice(2, 4)} – ${formatDayKeyShort(item.periodTo)} ${item.periodTo.slice(2, 4)}` : "Выписка"}
        </span>
        <span className="block text-[12px] text-muted">
          {cancelled ? "Отменён" : `${item.imported} операций`}{error ? ` · ${error}` : ""}
        </span>
      </span>
      {!cancelled && (
        confirm ? (
          <span className="flex gap-1.5">
            <button type="button" onClick={() => setConfirm(false)} className="pressable rounded-full bg-surface px-3 py-1.5 text-[13px] font-medium text-muted">Нет</button>
            <button type="button" onClick={cancel} disabled={pending} className="pressable rounded-full bg-negative-soft px-3 py-1.5 text-[13px] font-semibold text-negative disabled:opacity-50">
              {pending ? "…" : "Удалить"}
            </button>
          </span>
        ) : (
          <button type="button" onClick={() => { haptic.tap(); setConfirm(true); }} className="pressable rounded-full px-3 py-1.5 text-[13px] font-medium text-negative">
            Отменить
          </button>
        )
      )}
    </div>
  );
}
