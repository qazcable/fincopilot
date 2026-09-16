import type { Metadata, Viewport } from "next";
import { Onest } from "next/font/google";
import Script from "next/script";
import "./globals.css";

const onest = Onest({
  variable: "--font-onest",
  subsets: ["latin", "cyrillic"],
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: process.env.APP_URL ? new URL(process.env.APP_URL) : undefined,
  title: "FinCopilot",
  applicationName: "FinCopilot",
  description: "Сколько можно потратить сегодня — чтобы хватило до зарплаты. Траты голосом, платежи, итоги.",
  appleWebApp: { title: "FinCopilot", statusBarStyle: "black-translucent" },
  openGraph: { title: "FinCopilot", siteName: "FinCopilot", locale: "ru_RU", type: "website" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  themeColor: "#09090c",
};

// Тема Telegram применяется до первой отрисовки, чтобы не было вспышки светлого экрана
const themeScript = `try{var w=window.Telegram&&window.Telegram.WebApp;if(w&&w.initData){document.documentElement.dataset.theme=w.colorScheme}}catch(e){}`;

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ru" className={onest.variable} suppressHydrationWarning>
      <body className="min-h-dvh font-sans antialiased">
        {children}
        <Script src="https://telegram.org/js/telegram-web-app.js" strategy="beforeInteractive" />
        <Script id="tg-theme" strategy="beforeInteractive">{themeScript}</Script>
      </body>
    </html>
  );
}
