"use client";

import { useState } from "react";
import clsx from "clsx";
import { Check, Sparkles } from "lucide-react";
import { Sheet } from "../ui/Sheet";
import { Button, SectionHeader } from "../ui/primitives";
import { FREE_LIMITS, PRICE } from "@/lib/domain/plan";
import { haptic } from "@/lib/client/telegram";

export type Subscription = {
  pro: boolean;
  kind: "forever" | "paid" | "trial" | "free";
  until: string | null;
  daysLeft: number | null;
  aiUsed: number;
  aiLimit: number;
  importsUsed: number;
  importsLimit: number;
};

const PRO_FEATURES = [
  "Голос и текст без ограничений — несколько трат одним сообщением",
  "Выписки всех банков сколько угодно раз",
  "ИИ-советник по вашим деньгам",
  "Кнопка на iPhone, Apple Pay и SMS банка",
  "Прогноз остатка, цели и мультивалюта",
];

function statusText(plan: Subscription) {
  switch (plan.kind) {
    case "forever": return "Pro без ограничения по сроку";
    case "paid": return `Pro до ${new Date(plan.until!).toLocaleDateString("ru-RU", { day: "numeric", month: "long" })}`;
    case "trial": return `Пробный Pro, осталось ${plan.daysLeft} дн.`;
    case "free": return "Бесплатный тариф";
  }
}

export function SubscriptionSection({ plan, payContact }: { plan: Subscription; payContact: string | null }) {
  const [open, setOpen] = useState(false);

  return (
    <section>
      <SectionHeader title="Подписка" />
      <div className="space-y-4 rounded-3xl bg-surface p-4 shadow-card">
        <div className="flex items-center gap-3">
          <span className={clsx("flex size-11 shrink-0 items-center justify-center rounded-2xl", plan.pro ? "bg-accent-soft text-accent" : "bg-surface-2 text-muted")}>
            <Sparkles className="size-5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[16px] font-semibold">{statusText(plan)}</p>
            <p className="text-[13px] text-muted">
              {plan.pro
                ? "Все возможности открыты"
                : `${plan.aiUsed} из ${plan.aiLimit} разборов ИИ в этом месяце · выписок ${plan.importsUsed} из ${plan.importsLimit}`}
            </p>
          </div>
        </div>

        {!plan.pro && (
          <div className="h-1.5 overflow-hidden rounded-full bg-surface-2">
            <div
              className={clsx("h-full rounded-full", plan.aiUsed >= plan.aiLimit ? "bg-negative" : "bg-accent")}
              style={{ width: `${Math.min(100, Math.round((plan.aiUsed / Math.max(1, plan.aiLimit)) * 100))}%` }}
            />
          </div>
        )}

        <Button variant={plan.pro ? "secondary" : "primary"} className="w-full" onClick={() => { haptic.tap(); setOpen(true); }}>
          {plan.pro ? "Что входит в Pro" : `Подключить Pro · ${PRICE.monthly.toLocaleString("ru-RU")} ${PRICE.currency}`}
        </Button>
      </div>

      <Sheet open={open} onClose={() => setOpen(false)} title="FinCopilot Pro">
        <div className="space-y-4">
          <ul className="space-y-2.5">
            {PRO_FEATURES.map(feature => (
              <li key={feature} className="flex gap-2.5 text-[15px] leading-snug">
                <Check className="mt-0.5 size-4 shrink-0 text-positive" />
                <span>{feature}</span>
              </li>
            ))}
          </ul>

          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-2xl bg-surface-2 p-4">
              <p className="text-[13px] text-muted">Месяц</p>
              <p className="text-[20px] font-bold tabular">{PRICE.monthly.toLocaleString("ru-RU")} {PRICE.currency}</p>
            </div>
            <div className="rounded-2xl bg-accent-soft p-4">
              <p className="text-[13px] text-accent">Год · выгоднее на 28%</p>
              <p className="text-[20px] font-bold tabular text-accent">{PRICE.yearly.toLocaleString("ru-RU")} {PRICE.currency}</p>
            </div>
          </div>

          <div className="space-y-1.5 rounded-2xl bg-surface-2 p-4 text-[14px] leading-snug text-muted">
            <p className="font-semibold text-fg">Как подключить</p>
            <p>
              {payContact
                ? <>Переведите сумму на Kaspi <b className="font-semibold text-fg">{payContact}</b> и пришлите чек боту — включим Pro в тот же день.</>
                : <>Напишите в бот команду <code>/subscribe</code> — там актуальные реквизиты для оплаты.</>}
            </p>
            <p className="text-[13px] text-faint">
              Бесплатный тариф остаётся навсегда: {FREE_LIMITS.aiPerMonth} разборов ИИ в месяц, одна выписка и полный ручной ввод.
            </p>
          </div>

          <Button variant="secondary" className="w-full" onClick={() => setOpen(false)}>Закрыть</Button>
        </div>
      </Sheet>
    </section>
  );
}
