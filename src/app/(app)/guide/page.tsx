import { requireUser } from "@/lib/server/auth";
import { BackButton } from "@/components/TelegramBackButton";
import { GuideList } from "@/components/GuideList";
import { FeedbackButton } from "@/components/settings/CommunitySections";

export default async function GuidePage() {
  await requireUser();
  return (
    <main className="safe-top px-4 pt-4">
      <BackButton href="/" label="Главная" />
      <h1 className="mb-1 mt-3 px-1 text-[28px] font-bold tracking-tight">Инструкция</h1>
      <p className="mb-5 px-1 text-[14px] text-muted">Что умеет FinCopilot, зачем это нужно и как работает. Нажмите на тему.</p>
      <GuideList />
      <p className="mb-2 mt-6 px-1 text-center text-[13px] text-muted">Не нашли ответ или есть идея?</p>
      <FeedbackButton variant="link" />
    </main>
  );
}
