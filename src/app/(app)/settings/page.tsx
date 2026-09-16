import Link from "next/link";
import { headers } from "next/headers";
import { requireUser } from "@/lib/server/auth";
import { getSettingsData } from "@/lib/server/queries";
import { BackButton } from "@/components/TelegramBackButton";
import { AccountsSection, CurrencySection, IncomesSection, PreferencesSection, ShortcutSection } from "@/components/settings/SettingsSections";
import { getNbkRates } from "@/lib/server/rates";
import { ImportSection } from "@/components/settings/ImportSection";
import { listImports, listTransferSuggestions } from "@/lib/server/imports";
import { listInvites } from "@/lib/server/access";
import { FeedbackButton, InvitesSection } from "@/components/settings/CommunitySections";
import { SubscriptionSection } from "@/components/settings/SubscriptionSection";
import { CloseAppButton } from "@/components/CloseAppButton";
import { TransferSuggestions } from "@/components/settings/TransferSuggestions";
import { subscriptionSummary } from "@/lib/server/plan";

async function appOrigin() {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/$/, "");
  const h = await headers();
  return `${h.get("x-forwarded-proto") ?? "https"}://${h.get("host")}`;
}

export default async function SettingsPage() {
  const user = await requireUser();
  const [data, origin, imports, invites, nbk, plan, transferSuggestions] = await Promise.all([
    getSettingsData(user), appOrigin(), listImports(user.id), listInvites(user.id), getNbkRates(),
    subscriptionSummary(user), listTransferSuggestions(user),
  ]);
  const botUsername = process.env.NEXT_PUBLIC_BOT_USERNAME;

  return (
    <main className="safe-top px-4 pt-4">
      <BackButton href="/" label="Главная" />
      <h1 className="mb-5 mt-3 px-1 text-[28px] font-bold tracking-tight">Настройки</h1>

      <div className="space-y-7">
        <Link href="/guide" className="pressable flex items-center gap-3 rounded-3xl bg-surface p-4 shadow-card">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-accent-soft text-xl" aria-hidden>📖</span>
          <span className="min-w-0 flex-1">
            <span className="block text-[15px] font-semibold">Инструкция</span>
            <span className="block text-[13px] text-muted">Как работает каждая функция</span>
          </span>
        </Link>
        <SubscriptionSection plan={plan} payContact={process.env.PAY_KASPI ?? null} />
        <FeedbackButton />
        <InvitesSection invites={invites} />
        <AccountsSection accounts={data.accounts} />
        <IncomesSection incomes={data.incomes} />
        <CurrencySection currency={user.currency} secondary={user.secondaryCurrency} ratesDate={nbk.date} />
        <TransferSuggestions suggestions={transferSuggestions} />
        <ImportSection imports={imports} botUsername={botUsername} />
        <PreferencesSection cushion={data.cushion} timezone={data.timezone} remindersEnabled={data.remindersEnabled} morningDigest={data.morningDigest} eveningDigest={data.eveningDigest} weeklyDigest={data.weeklyDigest} digestCards={data.digestCards} />
        <ShortcutSection apiKeyHint={data.apiKeyHint} endpoint={`${origin}/api/shortcut`} />

        <CloseAppButton variant="row" />

        {botUsername && (
          <p className="pb-4 text-center text-[13px] text-muted">
            Бот: <a href={`https://t.me/${botUsername}`} className="font-medium text-accent">@{botUsername}</a> — пишите траты сообщением или голосом
          </p>
        )}
      </div>
    </main>
  );
}
