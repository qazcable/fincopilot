"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { Loader2 } from "lucide-react";
import { getWebApp } from "@/lib/client/telegram";

const subscribe = () => () => {};

/** Экран, пока сервер не знает пользователя: вход через Telegram или подсказка открыть бота */
export function AuthGate({ botUsername }: { botUsername?: string }) {
  const inTelegram = useSyncExternalStore(subscribe, () => Boolean(getWebApp()), () => null);
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setSlow(true), 8000);
    return () => clearTimeout(timer);
  }, []);

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-8 text-center">
      <div className="mb-6 flex size-20 items-center justify-center rounded-[28px] bg-accent text-4xl shadow-[0_16px_40px_-12px_var(--accent)]">
        ₸
      </div>
      <h1 className="text-[24px] font-bold tracking-tight">FinCopilot</h1>

      {inTelegram !== false && !slow && (
        <p className="mt-3 flex items-center gap-2 text-[15px] text-muted">
          <Loader2 className="size-4 animate-spin" /> Входим…
        </p>
      )}

      {inTelegram && slow && (
        <p className="mt-3 max-w-[280px] text-[15px] leading-snug text-muted">
          Не получилось войти. FinCopilot сейчас в закрытом тестировании — доступ по приглашению. Если ссылка у вас есть, откройте её, а потом приложение ещё раз.
        </p>
      )}

      {inTelegram === false && (
        <>
          <p className="mt-3 max-w-[280px] text-[15px] leading-snug text-muted">
            Приложение работает внутри Telegram — откройте его через бота.
          </p>
          {botUsername && (
            <a
              href={`https://t.me/${botUsername}`}
              className="pressable mt-6 inline-flex h-12 items-center rounded-2xl bg-accent px-6 text-[15px] font-semibold text-accent-fg"
            >
              Открыть @{botUsername}
            </a>
          )}
        </>
      )}
    </main>
  );
}
