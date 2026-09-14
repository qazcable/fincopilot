import { getCurrentUser } from "@/lib/server/auth";
import { getTransactionFormData } from "@/lib/server/queries";
import { TelegramProvider } from "@/components/TelegramProvider";
import { TransactionSheetProvider } from "@/components/TransactionSheet";
import { TabBar } from "@/components/TabBar";
import { AuthGate } from "@/components/AuthGate";
import { Onboarding } from "@/components/Onboarding";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();

  if (!user) {
    return (
      <TelegramProvider authenticated={false}>
        <AuthGate botUsername={process.env.NEXT_PUBLIC_BOT_USERNAME} />
      </TelegramProvider>
    );
  }

  if (!user.onboardedAt) {
    return (
      <TelegramProvider authenticated>
        <Onboarding firstName={user.firstName} />
      </TelegramProvider>
    );
  }

  const { categories, accounts } = await getTransactionFormData(user.id);

  return (
    <TelegramProvider authenticated>
      <TransactionSheetProvider categories={categories} accounts={accounts} timezone={user.timezone}>
        <div className="mx-auto min-h-dvh max-w-lg pb-[calc(6rem+env(safe-area-inset-bottom))]">{children}</div>
        <TabBar />
      </TransactionSheetProvider>
    </TelegramProvider>
  );
}
