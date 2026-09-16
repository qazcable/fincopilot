"use client";

import { useSyncExternalStore } from "react";
import clsx from "clsx";
import { X } from "lucide-react";
import { closeApp, getWebApp, haptic } from "@/lib/client/telegram";

const noop = () => () => {};

/**
 * Своя кнопка закрытия Mini App: не зависит от жеста свайпа и от кнопки Telegram,
 * которая на некоторых версиях срабатывает не всегда. Вне Telegram не показывается.
 */
export function CloseAppButton({ variant = "icon", className }: { variant?: "icon" | "row"; className?: string }) {
  // На сервере кнопки нет — она появляется, только когда приложение открыто внутри Telegram
  const inTelegram = useSyncExternalStore(noop, () => getWebApp() !== null, () => false);
  if (!inTelegram) return null;

  function close() {
    haptic.tap();
    closeApp();
  }

  if (variant === "row") {
    return (
      <button
        type="button"
        onClick={close}
        className={clsx("pressable flex w-full items-center justify-center gap-2 rounded-2xl bg-surface-2 px-4 py-3.5 text-[15px] font-medium text-muted", className)}
      >
        <X className="size-4" /> Закрыть приложение
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={close}
      aria-label="Закрыть приложение"
      className={clsx("pressable flex size-11 items-center justify-center rounded-full bg-surface text-muted shadow-card", className)}
    >
      <X className="size-5" />
    </button>
  );
}
