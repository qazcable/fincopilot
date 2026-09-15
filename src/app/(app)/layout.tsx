import { getCurrentUser } from "@/lib/server/auth";
import { getTransactionFormData } from "@/lib/server/queries";
import { getNbkRates } from "@/lib/server/rates";
import { TelegramProvider } from "@/components/TelegramProvider";
import { TransactionSheetProvider } from "@/components/TransactionSheet";
import { CurrencyProvider } from "@/components/CurrencyProvider";
import { TabBar } from "@/components/TabBar";
import { AuthGate } from "@/components/AuthGate";
import { Onboarding } from "@/components/Onboarding";
import { currencyCode } from "@/lib/domain/currency";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();

  if (!user) {
    return (
      <TelegramProvider authenticated={false}>
        <AuthGate botUsername={process.env.NEXT_PUBLIC_BOT_USERNAME} />
      </TelegramProvider>
    );
  }

  const currency = currencyCode(user.currency);
  const secondary = user.secondaryCurrency ? currencyCode(user.secondaryCurrency) : null;

  if (!user.onboardedAt) {
    return (
      <TelegramProvider authenticated>
        <CurrencyProvider currency={currency} secondary={null} rates={[]} ratesDate={null}>
          <Onboarding firstName={user.firstName} />
        </CurrencyProvider>
      </TelegramProvider>
    );
  }

  const [{ categories, accounts }, nbk] = await Promise.all([getTransactionFormData(user.id), getNbkRates()]);

  return (
    <TelegramProvider authenticated>
      <CurrencyProvider currency={currency} secondary={secondary} rates={nbk.rates} ratesDate={nbk.date}>
        <TransactionSheetProvider categories={categories} accounts={accounts} timezone={user.timezone}>
          <div className="mx-auto min-h-dvh max-w-lg pb-[calc(6rem+env(safe-area-inset-bottom))]">{children}</div>
          <TabBar />
        </TransactionSheetProvider>
      </CurrencyProvider>
    </TelegramProvider>
  );
}
