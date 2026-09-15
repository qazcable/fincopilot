"use client";

import clsx from "clsx";
import { Mic, MessageCircle, Smartphone, CalendarCheck, FileText } from "lucide-react";
import { useTransactionSheet } from "./TransactionSheet";
import { CategoryIcon, Money } from "./ui/primitives";
import type { TransactionDto } from "@/lib/server/queries";
import { formatDayKey, weekdayOf } from "@/lib/domain/dates";

const SOURCE_ICON: Record<string, { icon: typeof Mic; label: string } | undefined> = {
  BOT_VOICE: { icon: Mic, label: "Голосом" },
  BOT_TEXT: { icon: MessageCircle, label: "Через бота" },
  SHORTCUT: { icon: Smartphone, label: "Быстрая команда" },
  PAYMENT: { icon: CalendarCheck, label: "Платёж по графику" },
  IMPORT: { icon: FileText, label: "Из выписки" },
};

export function TransactionRow({ tx }: { tx: TransactionDto }) {
  const { openEdit } = useTransactionSheet();
  const source = SOURCE_ICON[tx.source];
  const SourceIcon = source?.icon;

  if (tx.kind === "TRANSFER") {
    return (
      <button
        type="button"
        onClick={() => openEdit(tx)}
        className="pressable flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left active:bg-surface-2"
      >
        <CategoryIcon emoji="🔁" color="#6366F1" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[15px] font-medium">{tx.accountName} → {tx.toAccountName}</span>
          <span className="mt-0.5 flex items-center gap-1 text-[13px] text-muted">
            <span className="truncate">{tx.note || "Перевод между счетами"}</span>
            <span aria-hidden>·</span>
            <span className="tabular">{tx.time}</span>
            {SourceIcon && <SourceIcon className="ml-0.5 size-3.5 shrink-0" aria-label={source.label} />}
          </span>
        </span>
        <Money value={tx.amount} className="text-[15px] font-semibold text-muted" />
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={() => openEdit(tx)}
      className="pressable flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left active:bg-surface-2"
    >
      <CategoryIcon emoji={tx.category?.emoji ?? "💸"} color={tx.category?.color ?? "#A1A1AA"} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] font-medium">{tx.note || tx.category?.name || "Без категории"}</span>
        <span className="mt-0.5 flex items-center gap-1 text-[13px] text-muted">
          {tx.note && tx.category ? <span className="truncate">{tx.category.name}</span> : null}
          {tx.note && tx.category ? <span aria-hidden>·</span> : null}
          <span className="tabular">{tx.time}</span>
          {SourceIcon && <SourceIcon className="ml-0.5 size-3.5 shrink-0" aria-label={source.label} />}
        </span>
      </span>
      <Money
        value={tx.kind === "EXPENSE" ? -tx.amount : tx.amount}
        sign
        className={clsx("text-[15px] font-semibold", tx.kind === "INCOME" && "text-positive")}
      />
    </button>
  );
}

export function TransactionList({ items, today }: { items: TransactionDto[]; today: string }) {
  const groups: { dayKey: string; items: TransactionDto[]; expense: number }[] = [];
  for (const tx of items) {
    let group = groups.at(-1);
    if (!group || group.dayKey !== tx.dayKey) {
      group = { dayKey: tx.dayKey, items: [], expense: 0 };
      groups.push(group);
    }
    group.items.push(tx);
    if (tx.kind === "EXPENSE") group.expense += tx.amount;
  }

  return (
    <div className="space-y-5">
      {groups.map(group => (
        <section key={group.dayKey}>
          <div className="mb-1 flex items-baseline justify-between px-4">
            <h3 className="text-[13px] font-semibold uppercase tracking-wide text-muted">
              {formatDayKey(group.dayKey, today)}
              <span className="ml-1.5 font-normal normal-case tracking-normal text-faint">{weekdayOf(group.dayKey)}</span>
            </h3>
            {group.expense > 0 && <Money value={-group.expense} className="text-[13px] text-muted" currencyClassName="opacity-70" />}
          </div>
          <div className="rounded-3xl bg-surface p-1.5 shadow-card">
            {group.items.map(tx => <TransactionRow key={tx.id} tx={tx} />)}
          </div>
        </section>
      ))}
    </div>
  );
}
