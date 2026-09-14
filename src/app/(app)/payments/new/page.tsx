import { BackButton } from "@/components/TelegramBackButton";
import { ObligationForm } from "@/components/ObligationForm";

export default function NewObligationPage() {
  return (
    <main className="safe-top px-4 pt-4">
      <BackButton href="/payments" label="Платежи" />
      <h1 className="mb-5 mt-3 px-1 text-[28px] font-bold tracking-tight">Новое обязательство</h1>
      <ObligationForm />
    </main>
  );
}
