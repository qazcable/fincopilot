"use client";

import { createContext, useCallback, useContext, useMemo, useState, useTransition } from "react";
import clsx from "clsx";
import { CalendarClock, Trash2 } from "lucide-react";
import { Sheet } from "./ui/Sheet";
import { Button, Segmented, inputClass } from "./ui/primitives";
import { AmountDisplay, Keypad, inputToMinor, minorToAmountInput } from "./AmountInput";
import { removeTransaction, saveTransaction } from "@/lib/actions/transactions";
import type { AccountDto, CategoryDto, TransactionDto } from "@/lib/server/queries";
import { haptic } from "@/lib/client/telegram";
import { instantToLocalInput } from "@/lib/domain/dates";

type Kind = TransactionDto["kind"];

type SheetState = ({ mode: "create"; kind: Kind } | { mode: "edit"; tx: TransactionDto }) & { now: string } | null;

const TransactionSheetContext = createContext<{ openCreate: (kind?: Kind) => void; openEdit: (tx: TransactionDto) => void } | null>(null);

export function useTransactionSheet() {
  const context = useContext(TransactionSheetContext);
  if (!context) throw new Error("useTransactionSheet outside provider");
  return context;
}

export function TransactionSheetProvider({
  categories,
  accounts,
  timezone,
  children,
}: { categories: CategoryDto[]; accounts: AccountDto[]; timezone: string; children: React.ReactNode }) {
  const [state, setState] = useState<SheetState>(null);
  const [formKey, setFormKey] = useState(0);

  const openCreate = useCallback((kind: Kind = "EXPENSE") => {
    haptic.tap();
    setFormKey(k => k + 1);
    setState({ mode: "create", kind, now: instantToLocalInput(new Date(), timezone) });
  }, [timezone]);
  const openEdit = useCallback((tx: TransactionDto) => {
    haptic.tap();
    setFormKey(k => k + 1);
    setState({ mode: "edit", tx, now: instantToLocalInput(new Date(), timezone) });
  }, [timezone]);
  const close = useCallback(() => setState(null), []);
  const value = useMemo(() => ({ openCreate, openEdit }), [openCreate, openEdit]);

  return (
    <TransactionSheetContext.Provider value={value}>
      {children}
      <Sheet open={state !== null} onClose={close} title={state?.mode === "edit" ? "Операция" : "Новая операция"}>
        {state && (
          <TransactionForm
            key={formKey}
            state={state}
            categories={categories}
            accounts={accounts}
            nowLocalDateTime={state.now}
            onDone={close}
          />
        )}
      </Sheet>
    </TransactionSheetContext.Provider>
  );
}

function TransactionForm({
  state,
  categories,
  accounts,
  nowLocalDateTime,
  onDone,
}: {
  state: NonNullable<SheetState>;
  categories: CategoryDto[];
  accounts: AccountDto[];
  nowLocalDateTime: string;
  onDone: () => void;
}) {
  const editing = state.mode === "edit" ? state.tx : null;
  const defaultAccount = accounts.find(a => a.isDefault) ?? accounts[0];

  const [kind, setKind] = useState<Kind>(editing?.kind ?? (state.mode === "create" ? state.kind : "EXPENSE"));
  const [amount, setAmount] = useState(editing ? minorToAmountInput(editing.amount) : "");
  const [categoryId, setCategoryId] = useState<string | null>(editing?.category?.id ?? null);
  const [accountId, setAccountId] = useState(editing?.accountId ?? defaultAccount?.id ?? "");
  const [toAccountId, setToAccountId] = useState<string | null>(
    editing?.toAccountId ?? accounts.find(a => a.id !== (editing?.accountId ?? defaultAccount?.id))?.id ?? null
  );
  const [note, setNote] = useState(editing?.note ?? "");
  const [dateTime, setDateTime] = useState(editing?.localDateTime ?? nowLocalDateTime);
  const [error, setError] = useState<string | null>(null);
  const [saving, startSaving] = useTransition();
  const [deleting, startDeleting] = useTransition();

  const lockedAmount = Boolean(editing?.isPayment);
  const visibleCategories = categories.filter(c => c.kind === kind);
  const minor = inputToMinor(amount);

  const canTransfer = accounts.length > 1;
  const kindOptions: { value: Kind; label: string }[] = [
    { value: "EXPENSE", label: "Расход" },
    { value: "INCOME", label: "Доход" },
    ...(canTransfer || kind === "TRANSFER" ? [{ value: "TRANSFER" as const, label: "Перевод" }] : []),
  ];

  function changeKind(next: Kind) {
    setKind(next);
    setCategoryId(null);
  }

  function chooseFrom(id: string) {
    setAccountId(id);
    if (toAccountId === id) setToAccountId(accounts.find(a => a.id !== id)?.id ?? null);
  }

  function submit() {
    if (!minor) {
      haptic.error();
      setError("Введите сумму");
      return;
    }
    setError(null);
    startSaving(async () => {
      const result = await saveTransaction({
        id: editing?.id,
        kind,
        amount: minor,
        categoryId: kind === "TRANSFER" ? null : categoryId,
        accountId,
        toAccountId: kind === "TRANSFER" ? toAccountId : null,
        note,
        localDateTime: dateTime,
      });
      if (result.ok) {
        haptic.success();
        onDone();
      } else {
        haptic.error();
        setError(result.error);
      }
    });
  }

  function remove() {
    if (!editing) return;
    startDeleting(async () => {
      const result = await removeTransaction(editing.id);
      if (result.ok) {
        haptic.success();
        onDone();
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <div className="space-y-4">
      {!lockedAmount && (
        <Segmented value={kind} onChange={changeKind} options={kindOptions} />
      )}

      <AmountDisplay value={amount} tone={kind} />
      {lockedAmount && (
        <p className="-mt-2 text-center text-[13px] text-muted">Оплата по графику — сумму меняйте в платеже</p>
      )}

      {kind === "TRANSFER" ? (
        <div className="space-y-2">
          <AccountChips label="Откуда" accounts={accounts} value={accountId} onChange={chooseFrom} />
          <AccountChips label="Куда" accounts={accounts.filter(a => a.id !== accountId)} value={toAccountId} onChange={setToAccountId} />
        </div>
      ) : (
      <div className="no-scrollbar -mx-5 flex gap-2 overflow-x-auto px-5 pb-1">
        {visibleCategories.map(category => {
          const active = categoryId === category.id;
          return (
            <button
              key={category.id}
              type="button"
              onClick={() => { haptic.select(); setCategoryId(active ? null : category.id); }}
              className={clsx(
                "pressable flex shrink-0 items-center gap-1.5 rounded-full py-2 pl-2.5 pr-3.5 text-[14px] font-medium transition-colors",
                active ? "text-fg" : "bg-surface-2 text-muted"
              )}
              style={active ? { backgroundColor: `color-mix(in srgb, ${category.color} 22%, transparent)`, boxShadow: `inset 0 0 0 1.5px ${category.color}` } : undefined}
            >
              <span aria-hidden>{category.emoji}</span>
              {category.name}
            </button>
          );
        })}
      </div>
      )}

      <div className="grid grid-cols-[1fr_auto] gap-2">
        <input
          value={note}
          onChange={event => setNote(event.target.value)}
          placeholder="Комментарий"
          maxLength={200}
          className={inputClass}
        />
        <label className="pressable relative flex h-12 items-center gap-1.5 rounded-2xl bg-surface-2 px-3.5 text-[14px] font-medium text-muted">
          <CalendarClock className="size-4" />
          {dateTime.slice(0, 10) === nowLocalDateTime.slice(0, 10) ? dateTime.slice(11) : `${dateTime.slice(8, 10)}.${dateTime.slice(5, 7)}`}
          <input
            type="datetime-local"
            value={dateTime}
            max={nowLocalDateTime.slice(0, 10) + "T23:59"}
            onChange={event => event.target.value && setDateTime(event.target.value)}
            className="absolute inset-0 opacity-0"
            aria-label="Дата и время"
          />
        </label>
      </div>

      {accounts.length > 1 && kind !== "TRANSFER" && (
        <div className="no-scrollbar -mx-5 flex gap-2 overflow-x-auto px-5">
          {accounts.map(account => (
            <button
              key={account.id}
              type="button"
              onClick={() => { haptic.select(); setAccountId(account.id); }}
              className={clsx(
                "pressable shrink-0 rounded-full px-3.5 py-2 text-[13px] font-medium",
                accountId === account.id ? "bg-accent-soft text-accent" : "bg-surface-2 text-muted"
              )}
            >
              {account.name}
            </button>
          ))}
        </div>
      )}

      {!lockedAmount && <Keypad value={amount} onChange={value => { setError(null); setAmount(value); }} />}

      {error && <p className="text-center text-[14px] font-medium text-negative">{error}</p>}

      <div className={clsx("grid gap-2", editing ? "grid-cols-[auto_1fr]" : "grid-cols-1")}>
        {editing && (
          <Button variant="danger" size="icon" onClick={remove} loading={deleting} aria-label="Удалить операцию">
            <Trash2 className="size-5" />
          </Button>
        )}
        <Button size="lg" onClick={submit} loading={saving} disabled={!minor}>
          {editing ? "Сохранить" : kind === "EXPENSE" ? "Добавить расход" : kind === "INCOME" ? "Добавить доход" : "Перевести"}
        </Button>
      </div>
    </div>
  );
}

function AccountChips({ label, accounts, value, onChange }: { label: string; accounts: AccountDto[]; value: string | null; onChange: (id: string) => void }) {
  return (
    <div className="no-scrollbar -mx-5 flex items-center gap-2 overflow-x-auto px-5">
      <span className="w-14 shrink-0 text-[13px] text-muted">{label}</span>
      {accounts.map(account => (
        <button
          key={account.id}
          type="button"
          onClick={() => { haptic.select(); onChange(account.id); }}
          className={clsx(
            "pressable shrink-0 rounded-full px-3.5 py-2 text-[13px] font-medium",
            value === account.id ? "bg-accent-soft text-accent" : "bg-surface-2 text-muted"
          )}
        >
          {account.name}
        </button>
      ))}
    </div>
  );
}
