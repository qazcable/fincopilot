"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { getWebApp } from "@/lib/client/telegram";

// Сколько экранов сейчас просят кнопку «Назад»: при переходе между ними новый экран монтируется раньше,
// чем размонтируется старый, поэтому прятать кнопку можно только когда её не просит никто
let requested = 0;

/** Нативная кнопка «Назад» Telegram; вне Telegram — обычная ссылка */
export function BackButton({ href, label }: { href: string; label: string }) {
  const router = useRouter();

  useEffect(() => {
    const backButton = getWebApp()?.BackButton;
    if (!backButton) return;
    const onClick = () => router.push(href);
    requested++;
    backButton.show();
    backButton.onClick(onClick);
    return () => {
      backButton.offClick(onClick);
      requested--;
      if (requested === 0) backButton.hide();
    };
  }, [href, router]);

  return (
    <Link href={href} className="pressable -ml-1 inline-flex items-center text-[15px] font-medium text-accent">
      <ChevronLeft className="size-5" /> {label}
    </Link>
  );
}
