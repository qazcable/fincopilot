"use client";

import { useState, useTransition } from "react";
import clsx from "clsx";
import { Check, ChevronRight, Copy, KeyRound, Plus } from "lucide-react";
import { Sheet } from "../ui/Sheet";
import { Button, Field, Money, SectionHeader, Segmented, Switch, inputClass } from "../ui/primitives";
import {
  archiveAccount, createShortcutKey, deleteIncome, removeShortcutKey, saveAccount, saveIncome, savePreferences, setDefaultAccount,
} from "@/lib/actions/settings";
import type { ActionResult } from "@/lib/actions/transactions";
import { ACCOUNT_KINDS, type AccountKind } from "@/lib/domain/constants";
import { minorToInput, parseAmount } from "@/lib/domain/money";
import { haptic } from "@/lib/client/telegram";
import type { AccountDto } from "@/lib/server/queries";

function useAction() {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  function run(action: () => Promise<ActionResult>, onSuccess?: () => void) {
    setError(null);
    start(async () => {
      const result = await action();
      if (result.ok) {
        haptic.success();
        onSuccess?.();
      } else {
        haptic.error();
        setError(result.error);
      }
    });
  }
  return { pending, error, setError, run };
}

function Row({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={() => { haptic.tap(); onClick(); }} className="pressable flex w-full items-center gap-3 px-4 py-3.5 text-left active:bg-surface-2">
      {children}
      <ChevronRight className="size-4 shrink-0 text-faint" />
    </button>
  );
}

/** Сумма со знаком: "-15 000" допускается для счетов с минусом */
function parseSigned(value: string) {
  const trimmed = value.trim();
  if (!trimmed || trimmed === "0") return 0;
  const negative = trimmed.startsWith("-") || trimmed.startsWith("−");
  const amount = parseAmount(trimmed.replace(/^[-−]/, ""));
  return amount === null ? null : negative ? -amount : amount;
}

// ── Счета ─────────────────────────────────────────────────

export function AccountsSection({ accounts }: { accounts: AccountDto[] }) {
  const [editing, setEditing] = useState<AccountDto | "new" | null>(null);

  return (
    <section>
      <SectionHeader title="Счета" />
      <div className="divide-y divide-line overflow-hidden rounded-3xl bg-surface shadow-card">
        {accounts.map(account => (
          <Row key={account.id} onClick={() => setEditing(account)}>
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-2 text-[15px] font-medium">
                <span className="truncate">{account.name}</span>
                {account.isDefault && <span className="rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-semibold text-accent">Основной</span>}
              </span>
              <span className="text-[13px] text-muted">
                {ACCOUNT_KINDS[account.kind as AccountKind] ?? account.kind}{!account.inBudget && " · не в лимите"}
              </span>
            </span>
            <Money value={account.balance} className={clsx("text-[15px] font-semibold", account.balance < 0 && "text-negative")} />
          </Row>
        ))}
        <button type="button" onClick={() => { haptic.tap(); setEditing("new"); }} className="pressable flex w-full items-center gap-2 px-4 py-3.5 text-[15px] font-medium text-accent active:bg-surface-2">
          <Plus className="size-4" /> Добавить счёт
        </button>
      </div>

      <Sheet open={editing !== null} onClose={() => setEditing(null)} title={editing === "new" ? "Новый счёт" : "Счёт"}>
        {editing !== null && (
          <AccountForm key={editing === "new" ? "new" : editing.id} account={editing === "new" ? null : editing} canArchive={accounts.length > 1} onDone={() => setEditing(null)} />
        )}
      </Sheet>
    </section>
  );
}

function AccountForm({ account, canArchive, onDone }: { account: AccountDto | null; canArchive: boolean; onDone: () => void }) {
  const [name, setName] = useState(account?.name ?? "");
  const [kind, setKind] = useState<AccountKind>((account?.kind as AccountKind) ?? "CARD");
  const [balance, setBalance] = useState(account ? (account.balance < 0 ? "-" : "") + minorToInput(Math.abs(account.balance)) : "");
  const [inBudget, setInBudget] = useState(account?.inBudget ?? true);
  const { pending, error, setError, run } = useAction();
  const archive = useAction();
  const makeDefault = useAction();

  function submit() {
    const amount = parseSigned(balance);
    if (!name.trim()) return setError("Укажите название");
    if (amount === null) return setError("Проверьте баланс");
    run(() => saveAccount({ id: account?.id, name, kind, balance: amount, inBudget }), onDone);
  }

  return (
    <div className="space-y-4">
      <Segmented value={kind} onChange={next => { setKind(next); if (next === "SAVINGS") setInBudget(false); }} options={(Object.keys(ACCOUNT_KINDS) as AccountKind[]).map(k => ({ value: k, label: ACCOUNT_KINDS[k] }))} />
      <Field label="Название">
        <input value={name} onChange={e => setName(e.target.value)} placeholder="Kaspi Gold" maxLength={40} className={inputClass} />
      </Field>
      <Field label="Текущий баланс, ₸" hint={account ? "Изменение не трогает историю — это корректировка остатка" : undefined}>
        <input value={balance} onChange={e => setBalance(e.target.value)} inputMode="decimal" placeholder="0" className={clsx(inputClass, "tabular")} />
      </Field>
      <div className="flex items-center justify-between gap-4 rounded-2xl bg-surface-2 px-4 py-3">
        <span>
          <span className="block text-[15px] font-medium">Учитывать в лимите</span>
          <span className="block text-[13px] text-muted">Накопления обычно не тратят</span>
        </span>
        <Switch checked={inBudget} onChange={setInBudget} label="Учитывать в лимите" />
      </div>
      {(error || archive.error || makeDefault.error) && <p className="text-center text-[14px] text-negative">{error || archive.error || makeDefault.error}</p>}
      <Button size="lg" className="w-full" loading={pending} onClick={submit}>Сохранить</Button>
      {account && !account.isDefault && (
        <Button variant="secondary" className="w-full" loading={makeDefault.pending} onClick={() => makeDefault.run(() => setDefaultAccount(account.id), onDone)}>
          Сделать основным
        </Button>
      )}
      {account && canArchive && (
        <Button variant="danger" className="w-full" loading={archive.pending} onClick={() => archive.run(() => archiveAccount(account.id), onDone)}>
          Скрыть счёт
        </Button>
      )}
    </div>
  );
}

// ── Доходы ────────────────────────────────────────────────

type IncomeDto = { id: string; title: string; dayOfMonth: number; amount: number | null };

export function IncomesSection({ incomes }: { incomes: IncomeDto[] }) {
  const [editing, setEditing] = useState<IncomeDto | "new" | null>(null);

  return (
    <section id="incomes">
      <SectionHeader title="Доходы" />
      <div className="divide-y divide-line overflow-hidden rounded-3xl bg-surface shadow-card">
        {incomes.map(income => (
          <Row key={income.id} onClick={() => setEditing(income)}>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[15px] font-medium">{income.title}</span>
              <span className="text-[13px] text-muted">Каждое {income.dayOfMonth} число</span>
            </span>
            {income.amount !== null && <Money value={income.amount} className="text-[15px] font-semibold text-positive" />}
          </Row>
        ))}
        <button type="button" onClick={() => { haptic.tap(); setEditing("new"); }} className="pressable flex w-full items-center gap-2 px-4 py-3.5 text-[15px] font-medium text-accent active:bg-surface-2">
          <Plus className="size-4" /> {incomes.length ? "Добавить доход" : "Указать день зарплаты"}
        </button>
      </div>
      <p className="mt-2 px-4 text-[13px] leading-snug text-muted">Лимит на день считается до ближайшего дохода.</p>

      <Sheet open={editing !== null} onClose={() => setEditing(null)} title={editing === "new" ? "Новый доход" : "Доход"}>
        {editing !== null && <IncomeForm key={editing === "new" ? "new" : editing.id} income={editing === "new" ? null : editing} onDone={() => setEditing(null)} />}
      </Sheet>
    </section>
  );
}

function IncomeForm({ income, onDone }: { income: IncomeDto | null; onDone: () => void }) {
  const [title, setTitle] = useState(income?.title ?? "Зарплата");
  const [day, setDay] = useState(income?.dayOfMonth ?? 10);
  const [amount, setAmount] = useState(minorToInput(income?.amount));
  const { pending, error, setError, run } = useAction();
  const removal = useAction();

  function submit() {
    const parsed = amount.trim() ? parseAmount(amount) : null;
    if (amount.trim() && !parsed) return setError("Проверьте сумму");
    run(() => saveIncome({ id: income?.id, title, dayOfMonth: day, amount: parsed }), onDone);
  }

  return (
    <div className="space-y-4">
      <Field label="Название">
        <input value={title} onChange={e => setTitle(e.target.value)} maxLength={40} className={inputClass} />
      </Field>
      <Field label="День месяца">
        <div className="grid grid-cols-7 gap-1.5">
          {Array.from({ length: 31 }, (_, i) => i + 1).map(d => (
            <button key={d} type="button" onClick={() => { haptic.select(); setDay(d); }} className={clsx("pressable tabular aspect-square rounded-xl text-[14px] font-semibold", d === day ? "bg-accent text-accent-fg" : "bg-surface-2")}>
              {d}
            </button>
          ))}
        </div>
      </Field>
      <Field label="Сумма, ₸" hint="Необязательно — для справки">
        <input value={amount} onChange={e => setAmount(e.target.value)} inputMode="decimal" placeholder="350 000" className={clsx(inputClass, "tabular")} />
      </Field>
      {(error || removal.error) && <p className="text-center text-[14px] text-negative">{error || removal.error}</p>}
      <Button size="lg" className="w-full" loading={pending} onClick={submit}>Сохранить</Button>
      {income && (
        <Button variant="danger" className="w-full" loading={removal.pending} onClick={() => removal.run(() => deleteIncome(income.id), onDone)}>Удалить</Button>
      )}
    </div>
  );
}

// ── Бюджет ────────────────────────────────────────────────

const TIMEZONES = [
  { value: "Asia/Almaty", label: "Казахстан (UTC+5)" },
  { value: "Europe/Moscow", label: "Москва (UTC+3)" },
  { value: "Asia/Tashkent", label: "Ташкент (UTC+5)" },
  { value: "Asia/Bishkek", label: "Бишкек (UTC+6)" },
  { value: "Europe/Istanbul", label: "Стамбул (UTC+3)" },
  { value: "Asia/Dubai", label: "Дубай (UTC+4)" },
];

type Preferences = {
  cushion: number;
  timezone: string;
  remindersEnabled: boolean;
  morningDigest: boolean;
  eveningDigest: boolean;
  weeklyDigest: boolean;
};

const NOTIFICATIONS: { key: "morningDigest" | "eveningDigest" | "weeklyDigest" | "remindersEnabled"; title: string; text: string }[] = [
  { key: "morningDigest", title: "Утренний прогноз", text: "В 9:00 — сколько можно потратить, платежи и лимиты" },
  { key: "eveningDigest", title: "Итоги дня", text: "В 21:00 — сколько потрачено и лимит на завтра" },
  { key: "weeklyDigest", title: "Итоги недели", text: "По понедельникам — куда ушли деньги" },
  { key: "remindersEnabled", title: "Напоминания о платежах", text: "За 2 дня до списания, если утренний прогноз выключен" },
];

export function PreferencesSection(initial: Preferences) {
  const [prefs, setPrefs] = useState(initial);
  const [cushionInput, setCushionInput] = useState(initial.cushion ? minorToInput(initial.cushion) : "");
  const [saved, setSaved] = useState(false);
  const { pending, error, setError, run } = useAction();

  const timezones = TIMEZONES.some(t => t.value === prefs.timezone) ? TIMEZONES : [{ value: prefs.timezone, label: prefs.timezone }, ...TIMEZONES];

  function save(patch: Partial<Preferences>, cushionText = cushionInput) {
    // Пустое поле или ноль — запаса нет
    const cushion = /^[\s0.,]*$/.test(cushionText) ? 0 : parseAmount(cushionText);
    if (cushion === null) return setError("Проверьте сумму");
    const next = { ...prefs, ...patch, cushion };
    setPrefs(next);
    setSaved(false);
    run(() => savePreferences(next), () => setSaved(true));
  }

  return (
    <>
      <section>
        <SectionHeader title="Уведомления в Telegram" />
        <div className="divide-y divide-line overflow-hidden rounded-3xl bg-surface shadow-card">
          {NOTIFICATIONS.map(item => (
            <div key={item.key} className="flex items-center justify-between gap-4 px-4 py-3.5">
              <span>
                <span className="block text-[15px] font-medium">{item.title}</span>
                <span className="block text-[13px] leading-snug text-muted">{item.text}</span>
              </span>
              <Switch checked={prefs[item.key]} onChange={value => save({ [item.key]: value })} label={item.title} />
            </div>
          ))}
        </div>
      </section>

      <section>
        <SectionHeader title="Бюджет" />
        <div className="divide-y divide-line overflow-hidden rounded-3xl bg-surface shadow-card">
          <div className="px-4 py-3.5">
            <Field label="Неприкосновенный запас, ₸" hint="Эта сумма не попадёт в лимит на день">
              <div className="flex gap-2">
                <input value={cushionInput} onChange={e => { setSaved(false); setCushionInput(e.target.value); }} inputMode="decimal" placeholder="0" className={clsx(inputClass, "tabular")} />
                <Button variant="soft" className="h-12 shrink-0" loading={pending} onClick={() => save({})} aria-label="Сохранить запас">
                  {saved ? <Check className="size-5" /> : "OK"}
                </Button>
              </div>
            </Field>
          </div>
          <label className="flex items-center justify-between gap-4 px-4 py-3.5">
            <span className="text-[15px] font-medium">Часовой пояс</span>
            <select value={prefs.timezone} onChange={e => save({ timezone: e.target.value })} className="max-w-[55%] bg-transparent text-right text-[15px] text-muted outline-none">
              {timezones.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </label>
        </div>
        {error && <p className="mt-2 text-center text-[14px] text-negative">{error}</p>}
      </section>
    </>
  );
}
// ── Быстрая команда iPhone ────────────────────────────────

export function ShortcutSection({ apiKeyHint, endpoint }: { apiKeyHint: string | null; endpoint: string }) {
  const [key, setKey] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const revoke = useAction();

  function generate() {
    start(async () => {
      const result = await createShortcutKey();
      if (result.ok) {
        haptic.success();
        setKey(result.key);
      }
    });
  }

  async function copy(value: string, label: string) {
    try {
      await navigator.clipboard.writeText(value);
      haptic.success();
      setCopied(label);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      setCopied(null);
    }
  }

  return (
    <section>
      <SectionHeader title="Кнопка на iPhone" />
      <div className="space-y-4 rounded-3xl bg-surface p-4 shadow-card">
        <div className="flex gap-3">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-accent-soft text-accent"><KeyRound className="size-5" /></span>
          <p className="text-[14px] leading-snug text-muted">
            Запишите трату нажатием кнопки Action Button: быстрая команда отправит текст или голос сюда.
          </p>
        </div>

        {key ? (
          <div className="space-y-2">
            <p className="text-[13px] font-medium text-warning">Скопируйте ключ сейчас — он больше не будет показан</p>
            <button type="button" onClick={() => copy(key, "key")} className="pressable flex w-full items-center gap-2 rounded-2xl bg-surface-2 px-4 py-3 text-left">
              <code className="min-w-0 flex-1 break-all text-[13px]">{key}</code>
              {copied === "key" ? <Check className="size-4 text-positive" /> : <Copy className="size-4 text-muted" />}
            </button>
          </div>
        ) : apiKeyHint ? (
          <p className="rounded-2xl bg-surface-2 px-4 py-3 text-[14px]">Ключ активен: <code>fc_…{apiKeyHint}</code></p>
        ) : null}

        <ol className="list-decimal space-y-1.5 pl-5 text-[14px] leading-snug text-muted">
          <li>В приложении «Команды» создайте команду: «Диктовать текст» → «Получить содержимое URL».</li>
          <li>
            URL:{" "}
            <button type="button" onClick={() => copy(endpoint, "url")} className="font-medium text-accent underline-offset-2 hover:underline">
              {copied === "url" ? "скопировано" : endpoint}
            </button>
            , метод POST, JSON: <code>text</code> = диктованный текст.
          </li>
          <li>Заголовок <code>Authorization</code>: <code>Bearer ваш_ключ</code>.</li>
          <li>Добавьте «Показать результат» и назначьте команду на Action Button.</li>
        </ol>

        <div className="grid gap-2">
          <Button variant={apiKeyHint ? "secondary" : "primary"} loading={pending} onClick={generate}>
            {apiKeyHint ? "Создать новый ключ" : "Создать ключ"}
          </Button>
          {apiKeyHint && (
            <Button variant="ghost" loading={revoke.pending} onClick={() => revoke.run(removeShortcutKey, () => setKey(null))}>Отключить</Button>
          )}
        </div>
      </div>
    </section>
  );
}
