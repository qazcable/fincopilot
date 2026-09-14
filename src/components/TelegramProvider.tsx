"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { getWebApp } from "@/lib/client/telegram";

function syncColors() {
  const webApp = getWebApp();
  if (!webApp) return;
  document.documentElement.dataset.theme = webApp.colorScheme;
  const bg = getComputedStyle(document.documentElement).getPropertyValue("--bg").trim();
  if (!bg.startsWith("#")) return;
  webApp.setHeaderColor(bg);
  webApp.setBackgroundColor(bg);
  webApp.setBottomBarColor?.(bg);
}

/** Инициализация Mini App: тема, жесты и вход по подписанным данным Telegram */
export function TelegramProvider({ authenticated, children }: { authenticated: boolean; children: React.ReactNode }) {
  const router = useRouter();

  useEffect(() => {
    const webApp = getWebApp();
    if (!webApp) return;

    webApp.ready();
    webApp.expand();
    if (webApp.isVersionAtLeast("7.7")) webApp.disableVerticalSwipes?.();
    syncColors();
    webApp.onEvent("themeChanged", syncColors);
    return () => webApp.offEvent("themeChanged", syncColors);
  }, []);

  useEffect(() => {
    const webApp = getWebApp();
    if (authenticated || !webApp) return;

    fetch("/api/auth/telegram", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ initData: webApp.initData }),
    })
      .then(res => { if (res.ok) router.refresh(); })
      .catch(error => console.error("Telegram auth failed:", error));
  }, [authenticated, router]);

  return children;
}
