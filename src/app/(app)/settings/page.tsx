import { headers } from "next/headers";
import { requireUser } from "@/lib/server/auth";
import { getSettingsData } from "@/lib/server/queries";
import { BackButton } from "@/components/TelegramBackButton";
import { AccountsSection, IncomesSection, PreferencesSection, ShortcutSection } from "@/components/settings/SettingsSections";

async function appOrigin() {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/$/, "");
  const h = await headers();
  return `${h.get("x-forwarded-proto") ?? "https"}://${h.get("host")}`;
}

export default async function SettingsPage() {
  const user = await requireUser();
  const [data, origin] = await Promise.all([getSettingsData(user), appOrigin()]);
  const botUsername = process.env.NEXT_PUBLIC_BOT_USERNAME;

  return (
    <main className="safe-top px-4 pt-4">
      <BackButton href="/" label="Главная" />
      <h1 className="mb-5 mt-3 px-1 text-[28px] font-bold tracking-tight">Настройки</h1>

      <div className="space-y-7">
        <AccountsSection accounts={data.accounts} />
        <IncomesSection incomes={data.incomes} />
        <PreferencesSection cushion={data.cushion} timezone={data.timezone} remindersEnabled={data.remindersEnabled} />
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
