import Link from "next/link";
import clsx from "clsx";
import { ChevronRight, Plus } from "lucide-react";
import { requireUser } from "@/lib/server/auth";
import { getPaymentsData } from "@/lib/server/queries";
import { PaymentRow } from "@/components/PaymentRow";
import { DebtStrategy } from "@/components/PayoffCalculator";
import { DebtsBoard } from "@/components/DebtsBoard";
import { Card, CategoryIcon, EmptyState, Money, PageHeader, SectionHeader } from "@/components/ui/primitives";
import { formatDayKey, plural } from "@/lib/domain/dates";
import { OBLIGATION_KINDS, type ObligationKind } from "@/lib/domain/constants";

const KIND_COLOR: Record<string, string> = { LOAN: "#6366F1", CREDIT_CARD: "#0EA5E9", INSTALLMENT: "#F59E0B", BILL: "#10B981" };

export default async function PaymentsPage() {
  const user = await requireUser();
  const data = await getPaymentsData(user);

  const beforeHorizon = data.pending.filter(p => p.dueOn < data.horizon);
  const later = data.pending.filter(p => p.dueOn >= data.horizon);
  const active = data.obligations.filter(o => !o.completed);
  const completed = data.obligations.filter(o => o.completed);
  const totalDebt = active.reduce((sum, o) => sum + (o.principalLeft ?? 0), 0);
  const debts = active
    .filter(o => o.principalLeft !== null && o.principalLeft > 0)
    .map(o => ({ id: o.id, title: o.title, balance: o.principalLeft!, ratePercent: o.interestRate ?? 0, minPayment: o.monthlyAmount }));

  return (
    <main className="safe-top">
      <PageHeader
        title="Платежи"
        help="payments"
        action={
          <Link href="/payments/new" aria-label="Добавить обязательство" className="pressable flex size-11 items-center justify-center rounded-full bg-accent text-accent-fg shadow-[0_8px_20px_-8px_var(--accent)]">
            <Plus className="size-6" />
          </Link>
        }
      />

      <div className="space-y-6 px-4">
        {data.obligations.length === 0 ? (
          <Card>
            <EmptyState emoji="🏦" title="Добавьте обязательства" text="Кредиты, рассрочки, кредитки и регулярные счета — приложение напомнит о платеже и учтёт его в лимите.">
              <Link href="/payments/new" className="pressable inline-flex h-11 items-center rounded-2xl bg-accent px-5 text-[15px] font-semibold text-accent-fg">
                Добавить первое
              </Link>
            </EmptyState>
          </Card>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3">
              <Card className="p-4">
                <p className="text-[13px] font-medium text-muted">До {formatDayKey(data.horizon)}</p>
                <Money value={data.reserved} className="mt-1 block text-[20px] font-bold tracking-tight" />
                <p className="mt-0.5 text-[12px] text-faint">{beforeHorizon.length} {plural(beforeHorizon.length, "платёж", "платежа", "платежей")}</p>
              </Card>
              <Card className="p-4">
                <p className="text-[13px] font-medium text-muted">Общий долг</p>
                <Money value={totalDebt} className="mt-1 block text-[20px] font-bold tracking-tight" />
                <p className="mt-0.5 text-[12px] text-faint">{active.length} {plural(active.length, "обязательство", "обязательства", "обязательств")}</p>
              </Card>
            </div>

            {beforeHorizon.length > 0 && (
              <section>
                <SectionHeader title={data.hasIncomeSchedule ? "До зарплаты" : "До конца месяца"} />
                <Card className="p-1.5">
                  {beforeHorizon.map(p => <PaymentRow key={p.id} payment={p} today={data.today} />)}
                </Card>
              </section>
            )}

            {later.length > 0 && (
              <section>
                <SectionHeader title="Дальше" />
                <Card className="p-1.5">
                  {later.map(p => <PaymentRow key={p.id} payment={p} today={data.today} />)}
                </Card>
              </section>
            )}

            {debts.length >= 2 && <DebtStrategy debts={debts} />}

            <section>
              <SectionHeader title="Обязательства" />
              <div className="space-y-3">
                {[...active, ...completed].map(o => {
                  const kind = OBLIGATION_KINDS[o.kind as ObligationKind];
                  const paidShare = o.principalTotal && o.principalLeft !== null
                    ? Math.min(100, Math.max(0, Math.round(((o.principalTotal - o.principalLeft) / o.principalTotal) * 100)))
                    : null;
                  return (
                    <Link key={o.id} href={`/payments/${o.id}`} className="pressable block">
                      <Card className={clsx("p-4", o.completed && "opacity-60")}>
                        <div className="flex items-center gap-3">
                          <CategoryIcon emoji={kind?.emoji ?? "🧾"} color={KIND_COLOR[o.kind] ?? "#64748B"} />
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-[16px] font-semibold">{o.title}</p>
                            <p className="text-[13px] text-muted">
                              {o.completed ? "Выплачено 🎉" : `${kind?.label ?? ""} · ${o.dueDay} числа`}
                              {o.interestRate != null && !o.completed ? ` · ${String(o.interestRate).replace(".", ",")}%` : ""}
                            </p>
                          </div>
                          <div className="text-right">
                            <Money value={o.principalLeft ?? o.monthlyAmount} className="text-[16px] font-semibold" />
                            <p className="text-[12px] text-muted">{o.principalLeft !== null ? "осталось" : "в месяц"}</p>
                          </div>
                          <ChevronRight className="size-4 shrink-0 text-faint" />
                        </div>
                        {paidShare !== null && !o.completed && (
                          <div className="mt-3.5">
                            <div className="h-1.5 overflow-hidden rounded-full bg-surface-2">
                              <div className="h-full rounded-full bg-positive" style={{ width: `${paidShare}%` }} />
                            </div>
                            <p className="mt-1.5 text-[12px] text-muted">Выплачено {paidShare}% · платёж <Money value={o.monthlyAmount} /></p>
                          </div>
                        )}
                        {o.graceUntil && !o.completed && (
                          <p className="mt-2 text-[12px] font-medium text-warning">Льготный период до {formatDayKey(o.graceUntil)}</p>
                        )}
                      </Card>
                    </Link>
                  );
                })}
              </div>
            </section>
          </>
        )}

        <DebtsBoard debts={data.debts} today={data.today} />
      </div>
    </main>
  );
}
