"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

/**
 * Нижняя шторка в стиле iOS: закрывается свайпом вниз, по фону и Escape.
 * Контент рендерится только когда шторка открыта.
 */
export function Sheet({
  open,
  onClose,
  title,
  children,
}: { open: boolean; onClose: () => void; title?: string; children: React.ReactNode }) {
  const panelRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ startY: number; dy: number } | null>(null);
  const [offset, setOffset] = useState(0);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    const { overflow } = document.body.style;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = overflow;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  if (!open || typeof document === "undefined") return null;

  function onPointerDown(event: React.PointerEvent) {
    drag.current = { startY: event.clientY, dy: 0 };
    (event.target as HTMLElement).setPointerCapture(event.pointerId);
  }
  function onPointerMove(event: React.PointerEvent) {
    if (!drag.current) return;
    drag.current.dy = Math.max(0, event.clientY - drag.current.startY);
    setOffset(drag.current.dy);
  }
  function onPointerUp() {
    const dy = drag.current?.dy ?? 0;
    drag.current = null;
    setOffset(0);
    if (dy > 90) onClose();
  }

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center" role="dialog" aria-modal="true" aria-label={title}>
      <div className="animate-fade-in absolute inset-0 bg-[var(--backdrop)] backdrop-blur-[2px]" onClick={onClose} />
      <div
        ref={panelRef}
        className="animate-sheet-in safe-bottom relative flex max-h-[92dvh] w-full max-w-lg flex-col rounded-t-[28px] bg-surface"
        style={{ transform: offset ? `translateY(${offset}px)` : undefined, transition: offset ? "none" : "transform 200ms ease" }}
      >
        <div
          className="flex shrink-0 cursor-grab touch-none flex-col items-center pb-1 pt-2.5"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          <span className="h-1.5 w-10 rounded-full bg-surface-3" />
        </div>
        {title && (
          <div className="flex shrink-0 items-center justify-between px-5 pb-2 pt-1">
            <h2 className="text-[19px] font-bold tracking-tight">{title}</h2>
            <button type="button" onClick={onClose} aria-label="Закрыть" className="pressable -mr-1 flex size-8 items-center justify-center rounded-full bg-surface-2 text-muted">
              <X className="size-4" />
            </button>
          </div>
        )}
        <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-5">{children}</div>
      </div>
    </div>,
    document.body
  );
}
