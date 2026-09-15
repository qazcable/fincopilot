import { requireUser } from "@/lib/server/auth";
import { getBudgetSnapshot } from "@/lib/server/overview";
import { BackButton } from "@/components/TelegramBackButton";
import { GoalsBoard } from "@/components/GoalsBoard";

export default async function GoalsPage() {
  const user = await requireUser();
  const snapshot = await getBudgetSnapshot(user);
  // Копить можно на счетах, которые не входят в лимит на день (депозит, накопления)
  const accounts = snapshot.accounts
    .filter(a => !a.inBudget || a.kind === "SAVINGS")
    .map(a => ({ id: a.id, name: a.name, balance: a.balance }));

  return (
    <main className="safe-top pt-4">
      <div className="px-4">
        <BackButton href="/" label="Главная" />
        <h1 className="mb-5 mt-3 px-1 text-[28px] font-bold tracking-tight">Цели</h1>
      </div>
      <GoalsBoard goals={snapshot.goals} accounts={accounts} today={snapshot.today} reservedForGoals={snapshot.budget.reservedForGoals} />
    </main>
  );
}
