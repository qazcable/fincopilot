"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import clsx from "clsx";
import { ArrowUp, Sparkles } from "lucide-react";
import { askAdvisorAction } from "@/lib/actions/advisor";
import { ADVISOR_SUGGESTIONS, adviceSegments, normalizeAdvice } from "@/lib/domain/advisor";
import { haptic } from "@/lib/client/telegram";

type Message = { id: string; role: "user" | "assistant"; text: string; error?: boolean };

function AdviceText({ text }: { text: string }) {
  return (
    <>
      {normalizeAdvice(text).split("\n").map((line, index) =>
        line.trim() === "" ? <span key={index} className="block h-2" /> : (
          <span key={index} className="block">
            {adviceSegments(line).map((segment, i) => segment.bold ? <b key={i} className="font-semibold">{segment.text}</b> : <span key={i}>{segment.text}</span>)}
          </span>
        )
      )}
    </>
  );
}

export function AdvisorChat({ initial }: { initial: Message[] }) {
  const [messages, setMessages] = useState<Message[]>(initial);
  const [draft, setDraft] = useState("");
  const [pending, startTransition] = useTransition();
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length, pending]);

  function send(text: string) {
    const question = text.trim();
    if (!question || pending) return;
    haptic.tap();
    setDraft("");
    setMessages(list => [...list, { id: crypto.randomUUID(), role: "user", text: question }]);
    startTransition(async () => {
      const result = await askAdvisorAction(question);
      if (result.ok) haptic.success();
      else haptic.error();
      setMessages(list => [...list, {
        id: crypto.randomUUID(),
        role: "assistant",
        text: result.ok ? result.answer : result.error,
        error: !result.ok,
      }]);
    });
  }

  return (
    <div className="flex min-h-[calc(100dvh-14rem)] flex-col px-4">
      {messages.length === 0 && (
        <div className="mb-6 rounded-3xl bg-surface p-5 shadow-card">
          <div className="flex size-12 items-center justify-center rounded-2xl bg-accent-soft text-accent">
            <Sparkles className="size-6" />
          </div>
          <p className="mt-3 text-[17px] font-semibold">Спросите что угодно о своих деньгах</p>
          <p className="mt-1 text-[14px] leading-snug text-muted">
            Советник видит ваши счета, траты по категориям, кредиты и цели — и отвечает с конкретными цифрами. Операции целиком в ИИ не отправляются, только итоги.
          </p>
        </div>
      )}

      <div className="flex-1 space-y-3">
        {messages.map(message => (
          <div key={message.id} className={clsx("flex", message.role === "user" ? "justify-end" : "justify-start")}>
            <div
              className={clsx(
                "max-w-[88%] rounded-3xl px-4 py-3 text-[15px] leading-relaxed",
                message.role === "user"
                  ? "rounded-br-lg bg-accent text-accent-fg"
                  : clsx("rounded-bl-lg bg-surface shadow-card", message.error && "text-negative")
              )}
            >
              {message.role === "assistant" ? <AdviceText text={message.text} /> : message.text}
            </div>
          </div>
        ))}
        {pending && (
          <div className="flex justify-start">
            <div className="flex items-center gap-1.5 rounded-3xl rounded-bl-lg bg-surface px-4 py-4 shadow-card" aria-label="Советник думает">
              {[0, 150, 300].map(delay => (
                <span key={delay} className="size-2 animate-bounce rounded-full bg-faint" style={{ animationDelay: `${delay}ms` }} />
              ))}
            </div>
          </div>
        )}
        <div ref={bottom} />
      </div>

      {/* Прилипает к низу экрана и сам закрывает зону над таб-баром, чтобы текст не просвечивал */}
      <div className="sticky bottom-0 -mb-[calc(6rem+env(safe-area-inset-bottom))] mt-4 space-y-2 bg-bg pb-[calc(6.5rem+env(safe-area-inset-bottom))] pt-3">
        {!pending && (
          <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4">
            {ADVISOR_SUGGESTIONS.map(suggestion => (
              <button
                key={suggestion}
                type="button"
                onClick={() => send(suggestion)}
                className="pressable shrink-0 rounded-full bg-surface px-3.5 py-2 text-[13px] font-medium text-fg shadow-card"
              >
                {suggestion}
              </button>
            ))}
          </div>
        )}
        <form
          onSubmit={event => { event.preventDefault(); send(draft); }}
          className="flex items-end gap-2 rounded-3xl bg-surface p-1.5 shadow-card"
        >
          <textarea
            value={draft}
            onChange={event => setDraft(event.target.value)}
            onKeyDown={event => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                send(draft);
              }
            }}
            rows={1}
            maxLength={1000}
            placeholder="Спросить советника…"
            className="max-h-32 min-h-11 flex-1 resize-none bg-transparent px-3 py-2.5 text-[16px] text-fg outline-none placeholder:text-faint [field-sizing:content]"
          />
          <button
            type="submit"
            disabled={!draft.trim() || pending}
            aria-label="Отправить"
            className="pressable flex size-11 shrink-0 items-center justify-center rounded-full bg-accent text-accent-fg disabled:opacity-40"
          >
            <ArrowUp className="size-5" />
          </button>
        </form>
      </div>
    </div>
  );
}
