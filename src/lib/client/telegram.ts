// Минимальные типы Telegram WebApp, которые использует приложение

type HapticImpact = "light" | "medium" | "heavy" | "rigid" | "soft";
type HapticNotification = "error" | "success" | "warning";

export type TelegramWebApp = {
  initData: string;
  colorScheme: "light" | "dark";
  version: string;
  ready: () => void;
  expand: () => void;
  close: () => void;
  disableVerticalSwipes?: () => void;
  isVersionAtLeast: (version: string) => boolean;
  setHeaderColor: (color: string) => void;
  setBackgroundColor: (color: string) => void;
  setBottomBarColor?: (color: string) => void;
  onEvent: (event: string, handler: () => void) => void;
  offEvent: (event: string, handler: () => void) => void;
  openLink: (url: string) => void;
  HapticFeedback?: {
    impactOccurred: (style: HapticImpact) => void;
    notificationOccurred: (type: HapticNotification) => void;
    selectionChanged: () => void;
  };
  BackButton?: {
    show: () => void;
    hide: () => void;
    onClick: (handler: () => void) => void;
    offClick: (handler: () => void) => void;
  };
};

declare global {
  interface Window {
    Telegram?: { WebApp: TelegramWebApp };
  }
}

export function getWebApp(): TelegramWebApp | null {
  if (typeof window === "undefined") return null;
  const webApp = window.Telegram?.WebApp;
  // Скрипт telegram-web-app.js создаёт объект и вне Telegram — отличаем по initData
  return webApp && webApp.initData ? webApp : null;
}

/** Закрывает Mini App. Вне Telegram — ничего не делает */
export function closeApp() {
  const webApp = getWebApp();
  if (!webApp) return false;
  webApp.close();
  return true;
}

export const haptic = {
  tap: () => getWebApp()?.HapticFeedback?.impactOccurred("light"),
  select: () => getWebApp()?.HapticFeedback?.selectionChanged(),
  success: () => getWebApp()?.HapticFeedback?.notificationOccurred("success"),
  error: () => getWebApp()?.HapticFeedback?.notificationOccurred("error"),
  warning: () => getWebApp()?.HapticFeedback?.notificationOccurred("warning"),
};
