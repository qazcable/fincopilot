import { notFound } from "next/navigation";
import clsx from "clsx";
import { requireUser } from "@/lib/server/auth";
import { getObligation } from "@/lib/server/queries";
import { BackButton } from "@/components/TelegramBackButton";
import { ObligationForm } from "@/components/ObligationForm";
import { Card, Money, SectionHeader } from "@/components/ui/primitives";
import { formatDayKey } from "@/lib/domain/dates";
import type { ObligationKind } from "@/lib/domain/constants";

const STATUS_LABEL: Record<string, { label: string; className: string }> = {
  PAID: { label: "Оплачен", className: "bg-positive-soft text-positive" },
  PENDING: { label: "Ожидается", className: "bg-surface-2 text-muted" },
  SKIPPED: { label: "Пропущен", className: "bg-warning-soft text-warning" },
};

export default async function ObligationPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const obligation = await getObligation(user, (await params).id);
  if (!obligation) notFound();

  return (
    <main className="safe-top px-4 pt-4">
      <BackButton href="/payments" label="Платежи" />
      <h1 className="mb-5 mt-3 truncate px-1 text-[28px] font-bold tracking-tight">{obligation.title}</h1>

      <ObligationForm initial={{ ...obligation, kind: obligation.kind as ObligationKind }} />

      {obligation.payments.length > 0 && (
        <section className="mt-8">
          <SectionHeader title="График платежей" />
          <Card className="divide-y divide-line px-4">
            {obligation.payments.map(payment => (
              <div key={payment.id} className="flex items-center justify-between py-3">
                <span className="text-[15px]">{formatDayKey(payment.dueOn)} {payment.dueOn.slice(0, 4)}</span>
                <span className="flex items-center gap-3">
                  <Money value={payment.amount} className="text-[15px] font-medium" />
                  <span className={clsx("rounded-full px-2 py-0.5 text-[12px] font-semibold", STATUS_LABEL[payment.status]?.className)}>
                    {STATUS_LABEL[payment.status]?.label ?? payment.status}
                  </span>
                </span>
              </div>
            ))}
          </Card>
        </section>
      )}
    </main>
  );
}
