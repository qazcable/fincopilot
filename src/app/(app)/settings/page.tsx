import Link from "next/link";
import { headers } from "next/headers";
import { requireUser } from "@/lib/server/auth";
import { getSettingsData } from "@/lib/server/queries";
import { BackButton } from "@/components/TelegramBackButton";
import { AccountsSection, IncomesSection, PreferencesSection, ShortcutSection } from "@/components/settings/SettingsSections";
import { ImportSection } from "@/components/settings/ImportSection";
import { listImports } from "@/lib/server/imports";
import { isOwner, listInvites } from "@/lib/server/access";
import { FeedbackButton, InvitesSection } from "@/components/settings/CommunitySections";

async function appOrigin() {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/$/, "");
  const h = await headers();
  return `${h.get("x-forwarded-proto") ?? "https"}://${h.get("host")}`;
}

export default async function SettingsPage() {
  const user = await requireUser();
  const owner = isOwner(user.telegramId);
  const [data, origin, imports, invites] = await Promise.all([
    getSettingsData(user), appOrigin(), listImports(user.id), owner ? listInvites(user.id) : Promise.resolve([]),
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
        <FeedbackButton />
        {owner && <InvitesSection invites={invites} />}
        <AccountsSection accounts={data.accounts} />
        <IncomesSection incomes={data.incomes} />
        <ImportSection imports={imports} botUsername={botUsername} />
        <PreferencesSection cushion={data.cushion} timezone={data.timezone} remindersEnabled={data.remindersEnabled} morningDigest={data.morningDigest} eveningDigest={data.eveningDigest} weeklyDigest={data.weeklyDigest} />
        <ShortcutSection apiKeyHint={data.apiKeyHint} endpoint={`${origin}/api/shortcut`} />

        {botUsername && (
          <p className="pb-4 text-center text-[13px] text-muted">
            Бот: <a href={`https://t.me/${botUsername}`} className="font-medium text-accent">@{botUsername}</a> — пишите траты сообщением или голосом
          </p>
        )}
      </div>
    </main>
  );
}
