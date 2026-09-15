"use client";

import { useState, useTransition } from "react";
import { usePathname } from "next/navigation";
import clsx from "clsx";
import { Check, Copy, MessageSquareHeart, Send, UserPlus } from "lucide-react";
import { Button, Field, SectionHeader, inputClass } from "../ui/primitives";
import { Sheet } from "../ui/Sheet";
import { createInviteAction, revokeInviteAction, sendFeedbackAction } from "@/lib/actions/community";
import { haptic } from "@/lib/client/telegram";

export type InviteItem = {
  id: string;
  note: string | null;
  link: string | null;
  createdAt: string;
  expired: boolean;
  usedBy: { name: string; username: string | null; onboarded: boolean } | null;
  usedAt: string | null;
};

const SHARE_TEXT = "Привет! Приглашаю протестировать FinCopilot — помощник по личным финансам в Telegram. Ссылка одноразовая:";

function shareUrl(link: string) {
  return `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(SHARE_TEXT)}`;
}

function openLink(url: string) {
  const tg = (window as unknown as { Telegram?: { WebApp?: { openTelegramLink?: (u: string) => void } } }).Telegram?.WebApp;
  if (tg?.openTelegramLink) tg.openTelegramLink(url);
  else window.open(url, "_blank");
}

/** Владелец: приглашения для близких */
export function InvitesSection({ invites }: { invites: InviteItem[] }) {
  const [note, setNote] = useState("");
  const [created, setCreated] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function create() {
    setError(null);
    start(async () => {
      const result = await createInviteAction(note);
      if (result.ok) {
        haptic.success();
        setCreated(result.link);
        setNote("");
      } else {
        haptic.error();
        setError(result.error);
      }
    });
  }

  async function copy(link: string) {
    try {
      await navigator.clipboard.writeText(link);
      haptic.success();
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }

  const joined = invites.filter(i => i.usedBy).length;

  return (
    <section>
      <SectionHeader title="Пригласить близких" />
      <div className="space-y-4 rounded-3xl bg-surface p-4 shadow-card">
        <div className="flex gap-3">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-accent-soft text-accent"><UserPlus className="size-5" /></span>
          <p className="text-[14px] leading-snug text-muted">
            Одноразовая ссылка на 30 дней. Человек откроет её в Telegram — и получит доступ. У каждого свои данные, вы их не видите.
            {joined > 0 && <span className="mt-1 block font-medium text-fg">Уже с нами: {joined}</span>}
          </p>
        </div>

        {created ? (
          <div className="space-y-2 rounded-2xl bg-accent-soft p-3">
            <p className="text-[13px] font-medium text-accent">Ссылка готова — отправьте её человеку</p>
            <div className="grid grid-cols-2 gap-2">
              <Button size="md" onClick={() => openLink(shareUrl(created))}><Send className="size-4" /> Отправить</Button>
              <Button size="md" variant="secondary" onClick={() => copy(created)}>
                {copied ? <Check className="size-4 text-positive" /> : <Copy className="size-4" />} {copied ? "Скопировано" : "Копировать"}
              </Button>
            </div>
            <button type="button" onClick={() => setCreated(null)} className="w-full pt-1 text-center text-[13px] text-muted">Создать ещё</button>
          </div>
        ) : (
          <div className="grid grid-cols-[1fr_auto] items-end gap-2">
            <Field label="Для кого" hint="Необязательно — чтобы помнить">
              <input value={note} onChange={e => setNote(e.target.value)} placeholder="Мама" maxLength={60} className={inputClass} />
            </Field>
            <Button size="md" className="mb-[22px]" loading={pending} onClick={create}>Создать</Button>
          </div>
        )}
        {error && <p className="text-[13px] font-medium text-negative">{error}</p>}

        {invites.length > 0 && (
          <div className="divide-y divide-line rounded-2xl bg-surface-2 px-3">
            {invites.map(invite => <InviteRow key={invite.id} invite={invite} />)}
          </div>
        )}
      </div>
    </section>
  );
}

function InviteRow({ invite }: { invite: InviteItem }) {
  const [confirm, setConfirm] = useState(false);
  const [pending, start] = useTransition();
  const status = invite.usedBy
    ? `${invite.usedBy.name}${invite.usedBy.username ? ` @${invite.usedBy.username}` : ""} · ${invite.usedBy.onboarded ? "пользуется" : "ещё не настроил"}`
    : invite.expired ? "Срок истёк" : "Ждёт, пока откроют";

  return (
    <div className="flex items-center gap-3 py-3">
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[14px] font-medium">{invite.note || (invite.usedBy ? invite.usedBy.name : "Приглашение")}</span>
        <span className={clsx("block truncate text-[12px]", invite.usedBy ? "text-positive" : "text-muted")}>{status}</span>
      </span>
      {!invite.usedBy && invite.link && !invite.expired && (
        <button type="button" onClick={() => openLink(shareUrl(invite.link!))} className="pressable rounded-full px-2.5 py-1.5 text-[13px] font-medium text-accent">Отправить</button>
      )}
      {confirm ? (
        <button
          type="button"
          disabled={pending}
          onClick={() => start(async () => { const r = await revokeInviteAction(invite.id); if (r.ok) haptic.success(); setConfirm(false); })}
          className="pressable rounded-full bg-negative-soft px-3 py-1.5 text-[13px] font-semibold text-negative disabled:opacity-50"
        >
          {pending ? "…" : invite.usedBy ? "Закрыть доступ" : "Удалить"}
        </button>
      ) : (
        <button type="button" onClick={() => { haptic.tap(); setConfirm(true); }} className="pressable rounded-full px-2.5 py-1.5 text-[13px] font-medium text-muted">
          {invite.usedBy ? "Доступ" : "✕"}
        </button>
      )}
    </div>
  );
}

/** Отзыв из приложения: кнопка открывает окно с полем */
export function FeedbackButton({ variant = "card" }: { variant?: "card" | "link" }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function send() {
    setError(null);
    start(async () => {
      const result = await sendFeedbackAction({ text, page: pathname });
      if (result.ok) {
        haptic.success();
        setSent(true);
        setText("");
      } else {
        haptic.error();
        setError(result.error);
      }
    });
  }

  return (
    <>
      {variant === "card" ? (
        <button type="button" onClick={() => { haptic.tap(); setSent(false); setOpen(true); }} className="pressable flex w-full items-center gap-3 rounded-3xl bg-surface p-4 text-left shadow-card">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-accent-soft text-accent"><MessageSquareHeart className="size-5" /></span>
          <span className="min-w-0 flex-1">
            <span className="block text-[15px] font-semibold">Оставить отзыв</span>
            <span className="block text-[13px] text-muted">Что неудобно, что сломалось, чего не хватает</span>
          </span>
        </button>
      ) : (
        <button type="button" onClick={() => { haptic.tap(); setSent(false); setOpen(true); }} className="pressable mx-auto flex items-center gap-1.5 rounded-full px-3 py-2 text-[13px] font-medium text-muted">
          <MessageSquareHeart className="size-4" /> Оставить отзыв
        </button>
      )}

      <Sheet open={open} onClose={() => setOpen(false)} title="Отзыв о FinCopilot">
        {sent ? (
          <div className="py-6 text-center">
            <p className="text-4xl" aria-hidden>🙏</p>
            <p className="mt-3 text-[16px] font-semibold">Спасибо! Отзыв получен</p>
            <p className="mt-1 text-[14px] text-muted">Это правда помогает сделать приложение лучше.</p>
            <Button className="mt-5 w-full" size="lg" variant="secondary" onClick={() => setOpen(false)}>Закрыть</Button>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-[14px] leading-snug text-muted">Пишите как есть: что понравилось, где запутались, какой функции не хватает. Скриншот или голосовое можно прислать боту командой /feedback.</p>
            <textarea
              value={text}
              onChange={e => setText(e.target.value)}
              rows={5}
              maxLength={4000}
              placeholder="Например: не понял, как добавить наличные…"
              className="w-full resize-none rounded-2xl bg-surface-2 px-4 py-3 text-[16px] text-fg outline-none placeholder:text-faint focus:ring-2 focus:ring-accent/40"
            />
            {error && <p className="text-[13px] font-medium text-negative">{error}</p>}
            <Button className="w-full" size="lg" loading={pending} disabled={text.trim().length < 3} onClick={send}>Отправить</Button>
          </div>
        )}
      </Sheet>
    </>
  );
}
