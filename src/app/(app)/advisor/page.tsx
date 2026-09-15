import { requireUser } from "@/lib/server/auth";
import { getAdvisorHistory } from "@/lib/server/advisor";
import { BackButton } from "@/components/TelegramBackButton";
import { AdvisorChat } from "@/components/AdvisorChat";

// Ответ модели с размышлениями может идти дольше стандартного лимита функции
export const maxDuration = 60;

export default async function AdvisorPage() {
  const user = await requireUser();
  const history = await getAdvisorHistory(user.id);

  return (
    <main className="safe-top pt-4">
      <div className="px-4">
        <BackButton href="/" label="Главная" />
        <h1 className="mb-1 mt-3 px-1 text-[28px] font-bold tracking-tight">Советник</h1>
        <p className="mb-5 px-1 text-[14px] text-muted">Переписка общая с ботом. Советы — не инвестиционная рекомендация.</p>
      </div>
      <AdvisorChat initial={history} />
    </main>
  );
}
