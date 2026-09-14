"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { getWebApp } from "@/lib/client/telegram";

/** Нативная кнопка «Назад» Telegram; вне Telegram — обычная ссылка */
export function BackButton({ href, label }: { href: string; label: string }) {
  const router = useRouter();

  useEffect(() => {
    const backButton = getWebApp()?.BackButton;
    if (!backButton) return;
    const onClick = () => router.push(href);
    backButton.show();
    backButton.onClick(onClick);
    return () => {
      backButton.offClick(onClick);
      backButton.hide();
    };
  }, [href, router]);

  return (
    <Link href={href} className="pressable -ml-1 inline-flex items-center text-[15px] font-medium text-accent">
      <ChevronLeft className="size-5" /> {label}
    </Link>
  );
}
